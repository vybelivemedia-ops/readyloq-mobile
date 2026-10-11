import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendMail } from "./mailer";
import { pilotEmailConfigured, sendPilotDetails } from "./pilot-details-mailer";

vi.mock("./mailer", () => ({ sendMail: vi.fn() }));
vi.mock("./logger", () => ({ logger: { warn: vi.fn() } }));
const mail = vi.mocked(sendMail);
beforeEach(() => {
  mail.mockReset();
  for (const key of ["RESEND_API_KEY", "RESEND_FROM", "SMTP_FROM", "SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) {
    vi.stubEnv(key, "");
  }
});
afterEach(() => vi.unstubAllEnvs());

describe("pilot delivery configuration and outcomes", () => {
  it("does not fake delivery without a transport", async () => {
    expect(pilotEmailConfigured()).toBe(false);
    expect(await sendPilotDetails("signup@example.invalid", 1)).toBe("unconfigured");
    expect(mail).not.toHaveBeenCalled();
  });
  it("requires a sender when Resend is selected, even with SMTP available", () => {
    vi.stubEnv("RESEND_API_KEY", "fixture-only");
    vi.stubEnv("SMTP_HOST", "smtp.example.invalid");
    vi.stubEnv("SMTP_USER", "fixture");
    vi.stubEnv("SMTP_PASS", "fixture");
    expect(pilotEmailConfigured()).toBe(false);
    vi.stubEnv("RESEND_FROM", "ReadyLoq <pilot@example.invalid>");
    expect(pilotEmailConfigured()).toBe(true);
  });
  it("supports the existing complete SMTP fallback", () => {
    vi.stubEnv("SMTP_HOST", "smtp.example.invalid");
    vi.stubEnv("SMTP_USER", "fixture");
    expect(pilotEmailConfigured()).toBe(false);
    vi.stubEnv("SMTP_PASS", "fixture");
    expect(pilotEmailConfigured()).toBe(true);
  });
  it("sends bounded, static pilot context only to the submitted address", async () => {
    vi.stubEnv("RESEND_API_KEY", "fixture-only");
    vi.stubEnv("RESEND_FROM", "ReadyLoq <pilot@example.invalid>");
    mail.mockResolvedValue({ delivered: true });
    expect(await sendPilotDetails("signup@example.invalid", 1)).toBe("accepted");
    expect(mail).toHaveBeenCalledTimes(1);
    const options = mail.mock.calls[0][0];
    expect(options.to).toBe("signup@example.invalid");
    expect(options.subject).toBe("ReadyLoq pilot details");
    expect(options.timeoutMs).toBe(10_000);
    expect(options.text).toContain("owner-ready morning review");
    expect(options.html).not.toMatch(/price|tomorrow|\$\d|2026/);
  });
  it("does not report provider rejection or transport exceptions as success", async () => {
    vi.stubEnv("RESEND_API_KEY", "fixture-only");
    vi.stubEnv("RESEND_FROM", "ReadyLoq <pilot@example.invalid>");
    mail.mockResolvedValueOnce({ delivered: false, reason: "resend_error" });
    expect(await sendPilotDetails("signup@example.invalid", 1)).toBe("failed");
    mail.mockRejectedValueOnce(new Error("fixture failure"));
    expect(await sendPilotDetails("signup@example.invalid", 1)).toBe("failed");
  });
});
