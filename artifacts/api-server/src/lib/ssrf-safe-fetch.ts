/**
 * SSRF-safe fetch using a DNS-pinning undici Agent.
 *
 * Problem: resolving DNS then calling native `fetch` still has a TOCTOU window —
 * `fetch` performs its own independent DNS lookup at connect time.  An attacker
 * can exploit this by changing a hostname's resolution between our pre-flight
 * check and the actual TCP handshake ("DNS rebinding").
 *
 * Solution: use an undici Agent with a custom `connect` handler that:
 *   1. Resolves the hostname via Node's `dns.promises` API.
 *   2. Validates every returned address against the SSRF block list.
 *   3. Connects the TCP socket to the *validated address* — not the hostname —
 *      using the resolved IP as the `host` option for net/tls.connect.
 *   4. Sets `servername` to the original hostname so TLS SNI and certificate
 *      verification still use the correct name.
 *
 * This eliminates the TOCTOU window: step 3 bypasses the OS resolver entirely
 * for the actual connection, so a DNS rebinding event after step 2 cannot
 * redirect the connection.
 *
 * Use ssrfSafeFetch for every outbound call to a user-configurable endpoint.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Agent, buildConnector, fetch as undiciFetch } from "undici";
import { promises as dns } from "node:dns";
import { isSafeIPv4, isSafeIPv6 } from "./ssrf-guard";

// A baseline TLS/TCP connector built from undici's default settings.
const baseConnector = buildConnector({});

/**
 * Custom connect handler that resolves DNS, validates all returned addresses,
 * and connects the TCP socket to the resolved IP (not the hostname).
 * This eliminates the TOCTOU window between DNS validation and actual connection.
 */
function ssrfConnect(rawOptions: any, callback: any): void {
  const hostname: string = rawOptions.hostname ?? "";

  // Empty hostname — pass through; the connector will handle the error.
  if (!hostname) {
    baseConnector(rawOptions, callback);
    return;
  }

  // ── IPv6 literal (bracketed form from undici) ──────────────────────────────
  // Do NOT trust write-time validation here — defense-in-depth requires an
  // independent check at connection time so that any gap in isSafeBaseUrl
  // (e.g. IPv4-compatible ::7f00:1 forms that bypass an earlier guard) cannot
  // reach the wire.
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    const inner = hostname.slice(1, -1);
    if (!isSafeIPv6(inner)) {
      callback(
        new Error(`SSRF guard: blocked IPv6 address ${hostname} — refusing connection`),
        null,
      );
      return;
    }
    baseConnector(rawOptions, callback);
    return;
  }

  // ── IPv4 literal ───────────────────────────────────────────────────────────
  // Validate independently — same defense-in-depth rationale as IPv6 above.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    if (!isSafeIPv4(hostname)) {
      callback(
        new Error(`SSRF guard: blocked IPv4 address ${hostname} — refusing connection`),
        null,
      );
      return;
    }
    baseConnector(rawOptions, callback);
    return;
  }

  // ── Named host — resolve, validate, pin ───────────────────────────────────
  Promise.all([
    dns.resolve4(hostname).catch((): string[] => []),
    dns.resolve6(hostname).catch((): string[] => []),
  ])
    .then(([addrs4, addrs6]) => {
      const all = [...addrs4, ...addrs6];

      // Fail closed: if we cannot resolve the hostname, refuse to connect.
      if (all.length === 0) {
        callback(
          new Error(`SSRF guard: cannot resolve '${hostname}' — refusing connection`),
          null,
        );
        return;
      }

      // Validate every returned address.
      for (const addr of all) {
        const safe = addr.includes(":") ? isSafeIPv6(addr) : isSafeIPv4(addr);
        if (!safe) {
          callback(
            new Error(
              `SSRF guard: '${hostname}' resolves to blocked address ${addr} — refusing connection`,
            ),
            null,
          );
          return;
        }
      }

      // Pin to the first validated address.
      // Prefer IPv4 for predictability; fall back to IPv6 if no IPv4 records.
      const pinnedIp = addrs4[0] ?? all[0]!;

      // Keep the original hostname as the TLS SNI value so certificate
      // verification uses the correct name even though we connect to an IP.
      const servername: string = (rawOptions.servername as string | undefined) ?? hostname;

      baseConnector({ ...rawOptions, hostname: pinnedIp, servername }, callback);
    })
    .catch((err: unknown) => {
      callback(err instanceof Error ? err : new Error(String(err)), null);
    });
}

// The undici Agent whose `connect` hook performs DNS validation + IP pinning.
const ssrfAgent = new Agent({ connect: ssrfConnect as any });

/**
 * Drop-in replacement for the global `fetch` that uses a DNS-pinning undici
 * Agent.  Every request goes through DNS validation and IP pinning regardless
 * of whether it was already validated at schema/pre-flight time.
 *
 * The `dispatcher` option is a non-standard undici extension not part of the
 * WHATWG Fetch spec.
 */
export async function ssrfSafeFetch(
  url: string | URL,
  init?: RequestInit,
): Promise<Response> {
  return (undiciFetch as any)(url, { ...init, dispatcher: ssrfAgent });
}
