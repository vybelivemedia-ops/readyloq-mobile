/**
 * SSRF guard — IP-address validation helpers.
 *
 * All helpers are exported so they can be reused by the HTTP layer, route
 * validation, and tests without circular imports.
 *
 * Design notes
 * ─────────────
 * • IPv4: every IANA special-use range from RFC 6890 / RFC 8190 is blocked.
 *   This includes CGNAT (100.64.0.0/10), documentation ranges, benchmarking
 *   ranges, the unspecified / broadcast addresses, and all RFC 1918 private
 *   ranges.  Only globally routable unicast addresses are permitted.
 *
 * • IPv6: loopback (::1), unspecified (::), unique-local (fc00::/7),
 *   link-local (fe80::/10), and IPv4-mapped addresses (::ffff:0:0/96) are
 *   blocked.  IPv4-mapped blocking also covers the Node.js URL-parser
 *   normalisation that converts ::ffff:127.0.0.1 to ::ffff:7f00:1.
 *
 * • DNS TOCTOU: isSafeBaseUrl / validateBaseUrlDns operate on literal strings
 *   only.  The actual TOCTOU mitigation is in ssrf-safe-fetch.ts which pins
 *   the TCP connection to the DNS-validated address.
 */

import { promises as dns } from "node:dns";

// ─── IPv4 helpers ─────────────────────────────────────────────────────────────

/**
 * Parse two colon-separated 16-bit hex groups (e.g. "7f00:1") back to a
 * dotted-decimal IPv4 string.  Returns null if the format is unexpected.
 *
 * Node's URL parser normalises ::ffff:127.0.0.1 → ::ffff:7f00:1, so we need
 * to recover the embedded address before running it through isSafeIPv4.
 */
export function hexGroupsToIPv4(hexPart: string): string | null {
  const parts = hexPart.split(":");
  if (parts.length !== 2) return null;
  const high = parseInt(parts[0]!, 16);
  const low = parseInt(parts[1]!, 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
}

/**
 * Returns true only when `ip` (dotted-decimal) is a globally-routable unicast
 * address — i.e. not in any IANA special-use range.
 *
 * Special-use ranges blocked (RFC 6890 + RFC 8190):
 *   0.0.0.0/8         "This" network (host on this network)
 *   10.0.0.0/8        Private-Use (RFC 1918)
 *   100.64.0.0/10     Shared Address Space / CGNAT (RFC 6598)
 *   127.0.0.0/8       Loopback
 *   169.254.0.0/16    Link Local (APIPA; includes cloud metadata 169.254.169.254)
 *   172.16.0.0/12     Private-Use (RFC 1918)
 *   192.0.0.0/24      IETF Protocol Assignments
 *   192.0.2.0/24      Documentation (TEST-NET-1)
 *   192.88.99.0/24    6to4 Relay Anycast (deprecated, RFC 7526)
 *   192.168.0.0/16    Private-Use (RFC 1918)
 *   198.18.0.0/15     Benchmarking (RFC 2544)
 *   198.51.100.0/24   Documentation (TEST-NET-2)
 *   203.0.113.0/24    Documentation (TEST-NET-3)
 *   240.0.0.0/4       Reserved for Future Use
 *   255.255.255.255   Limited Broadcast
 */
export function isSafeIPv4(ip: string): boolean {
  const octets = ip.split(".").map(Number);
  if (octets.length !== 4 || octets.some((o) => !Number.isFinite(o) || o < 0 || o > 255)) {
    return false; // not a valid IPv4 address
  }
  const [a, b, c] = octets as [number, number, number];

  if (a === 0) return false;                                   // 0.0.0.0/8 — "This" network
  if (a === 10) return false;                                  // 10.0.0.0/8 — RFC 1918 class A
  if (a === 100 && b >= 64 && b <= 127) return false;          // 100.64.0.0/10 — CGNAT
  if (a === 127) return false;                                 // 127.0.0.0/8 — Loopback
  if (a === 169 && b === 254) return false;                    // 169.254.0.0/16 — Link Local / APIPA
  if (a === 172 && b >= 16 && b <= 31) return false;           // 172.16.0.0/12 — RFC 1918 class B
  if (a === 192 && b === 0 && c === 0) return false;           // 192.0.0.0/24 — IETF Protocol Assignments
  if (a === 192 && b === 0 && c === 2) return false;           // 192.0.2.0/24 — TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return false;         // 192.88.99.0/24 — 6to4 Relay
  if (a === 192 && b === 168) return false;                    // 192.168.0.0/16 — RFC 1918 class C
  if (a === 198 && b >= 18 && b <= 19) return false;           // 198.18.0.0/15 — Benchmarking
  if (a === 198 && b === 51 && c === 100) return false;        // 198.51.100.0/24 — TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false;         // 203.0.113.0/24 — TEST-NET-3
  if (a >= 240) return false;                                  // 240.0.0.0/4 — Reserved; also covers 255.255.255.255
  return true;
}

// ─── IPv6 helpers ─────────────────────────────────────────────────────────────

/**
 * Returns true only when `addr` (bare IPv6 address, no brackets) is a globally
 * routable unicast address.
 *
 * Blocked ranges:
 *   ::1             Loopback
 *   ::              Unspecified
 *   ::ffff:0:0/96   IPv4-mapped (decoded and checked via isSafeIPv4)
 *   fc00::/7        Unique-Local (RFC 4193) — fc and fd prefixes
 *   fe80::/10       Link-Local — fe80 through febf
 *   2001:db8::/32   Documentation
 */
export function isSafeIPv6(addr: string): boolean {
  const a = addr.toLowerCase();

  if (a === "::1" || a === "::") return false; // Loopback / Unspecified

  // IPv4-mapped (::ffff:<ipv4>) — RFC 4291 §2.5.5.2
  // Also covers the Node.js URL-normalised hex-group form ::ffff:7f00:1.
  if (a.startsWith("::ffff:")) {
    const suffix = a.slice(7);
    const embedded = /^\d{1,3}(\.\d{1,3}){3}$/.test(suffix)
      ? suffix                     // dotted-decimal input
      : hexGroupsToIPv4(suffix);   // hex-group (Node-normalised)
    if (embedded === null) return false; // unknown format — reject conservatively
    return isSafeIPv4(embedded);
  }

  // IPv4-compatible (::​<ipv4> / ::<hex16>:<hex16>) — RFC 4291 §2.5.5.1
  // These are deprecated but still parsed. Node.js normalises
  // https://[::127.0.0.1] to hostname [::7f00:1], so we must handle both
  // dotted-decimal and hex-group representations (no "ffff:" in between).
  //
  // Pattern: starts with "::" and the remainder looks like an IPv4 address or
  // two colon-separated hex groups that decode to 32 bits.
  if (a.startsWith("::") && a.length > 2 && !a.startsWith("::f")) {
    // Not already handled by ::ffff: or fc00::/7 below.
    const suffix = a.slice(2); // strip leading "::"
    const embedded = /^\d{1,3}(\.\d{1,3}){3}$/.test(suffix)
      ? suffix
      : hexGroupsToIPv4(suffix);
    if (embedded !== null) {
      // Successfully decoded as an embedded IPv4 — apply the same block list.
      return isSafeIPv4(embedded);
    }
    // Could not decode as IPv4; fall through to other checks.
  }

  // Unique-local fc00::/7 (fc and fd prefixes, RFC 4193)
  if (/^f[cd]/.test(a)) return false;

  // Link-local fe80::/10 (fe80 through febf)
  if (/^fe[89ab]/.test(a)) return false;

  // Multicast ff00::/8 (RFC 4291 §2.7) — never a valid server destination
  if (a.startsWith("ff")) return false;

  // NAT64 / IPv4-IPv6 translation 64:ff9b::/96 (RFC 6052)
  // An attacker can reach a private IPv4 host via a NAT64 gateway by encoding
  // its address in this prefix.  Decode the embedded IPv4 and apply the same
  // block list.
  if (a.startsWith("64:ff9b::")) {
    const suffix = a.slice(9); // strip "64:ff9b::"
    const embedded = /^\d{1,3}(\.\d{1,3}){3}$/.test(suffix)
      ? suffix
      : hexGroupsToIPv4(suffix);
    if (embedded === null) return false; // unknown format — reject conservatively
    return isSafeIPv4(embedded);
  }

  // Well-known prefix for IPv4-IPv6 translation 64:ff9b:1::/48 (RFC 8215)
  // Used for local-use NAT64; block the entire prefix regardless of the
  // embedded address since this prefix is assigned for internal/enterprise use.
  if (a.startsWith("64:ff9b:1:")) return false;

  // Documentation 2001:db8::/32
  if (a.startsWith("2001:db8:")) return false;

  // Discard-only 100::/64 (RFC 6666)
  if (a.startsWith("100::")) return false;

  return true;
}

// ─── URL-level guard ──────────────────────────────────────────────────────────

/**
 * Validates a URL string against SSRF rules at the *literal* level:
 *   • Must be HTTPS.
 *   • IP literals (IPv4 and IPv6) are checked against the block list.
 *   • "localhost" is rejected.
 *   • Named hosts are passed — they must be checked at connection time via
 *     validateBaseUrlDns or the ssrfSafeFetch DNS-pinning layer.
 */
export function isSafeBaseUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();

  // IPv6 literal (wrapped in [...] by the URL parser)
  if (host.startsWith("[") && host.endsWith("]")) {
    return isSafeIPv6(host.slice(1, -1));
  }

  if (host === "localhost") return false;

  // IPv4 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return isSafeIPv4(host);
  }

  return true; // named host — validated at connection time
}

// ─── DNS-level guard ──────────────────────────────────────────────────────────

/**
 * Resolves the hostname in `raw` and checks every returned address against the
 * SSRF block list.
 *
 * @param raw    A URL string that has already passed {@link isSafeBaseUrl}.
 * @param strict When true (connection-time use in /sync and /test routes) the
 *               call fails closed: a DNS failure or zero-record response returns
 *               an error message instead of null.  This blocks the TOCTOU window
 *               where an attacker saves a config while DNS resolves publicly
 *               (or during an outage), then rebinds the hostname before sync.
 *               At save time (strict = false, default) a resolution failure is
 *               allowed — the host may not yet be live.
 *
 * Returns an error message string on failure, or null when safe.
 */
export async function validateBaseUrlDns(
  raw: string,
  strict = false,
): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null; // already rejected by Zod
  }
  const host = u.hostname.toLowerCase();

  // IP literals and localhost — already handled by isSafeBaseUrl.
  if (
    host === "localhost" ||
    /^\[.+\]$/.test(host) ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
  ) {
    return null;
  }

  let addrs4: string[] = [];
  let addrs6: string[] = [];
  let resolutionFailed = false;

  try {
    [addrs4, addrs6] = await Promise.all([
      dns.resolve4(host).catch((): string[] => []),
      dns.resolve6(host).catch((): string[] => []),
    ]);
  } catch {
    resolutionFailed = true;
  }

  if (resolutionFailed || (addrs4.length === 0 && addrs6.length === 0)) {
    if (strict) {
      return `Cannot verify '${host}' resolves to a public address — DNS resolution returned no records. Confirm the host is reachable before syncing.`;
    }
    return null; // save-time: host may not be live yet; sync will fail with a clear error
  }

  for (const addr of [...addrs4, ...addrs6]) {
    const safe = addr.includes(":") ? isSafeIPv6(addr) : isSafeIPv4(addr);
    if (!safe) {
      return `Hostname '${host}' resolves to a private or reserved IP address (${addr}). Configure a publicly-routable host.`;
    }
  }

  return null;
}
