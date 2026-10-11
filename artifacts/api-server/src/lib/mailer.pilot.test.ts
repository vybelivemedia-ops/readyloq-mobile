import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendMail } from "./mailer";

const smtp = vi.hoisted(() => ({ create: vi.fn(), send: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: smtp.create } }));
vi.mock("./logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  for (const key of ["RESEND_API_KEY", "RESEND_FROM", "SMTP_FROM", "SMTP_HOST", "SMTP_USER", "SMTP_PASS"]) {
    vi.stubEnv(key, "");
  }
  smtp.create.mockReturnValue({ sendMail: smtp.send });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const message = { to: "signup@example.invalid", subject: "ReadyLoq pilot details", html: "<p>ReadyLoq</p>", text: "ReadyLoq", timeoutMs: 10_000 };

describe("real mailer with mocked external transports", () => {
  it("posts through Resend with an abort deadline and the configured sender", async () => {
    vi.stubEnv("RESEND_API_KEY", "fixture-only-not-a-real-key");
    vi.stubEnv("RESEND_FROM", "ReadyLoq <pilot@example.invalid>");
    fetchMock.mockResolvedValue(new Response('{"id":"fixture"}', { status: 200 }));
    expect(await sendMail(message)).toEqual({ delivered: true });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(options.method).toBe("POST");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(options.body)).toEqual({
      from: "ReadyLoq <pilot@example.invalid>", to: [message.to],
      subject: message.subject, html: message.html, text: message.text,
    });
  });
  it("reports provider rejection and timeout as unsuccessful", async () => {
    vi.stubEnv("RESEND_API_KEY", "fixture-only-not-a-real-key");
    vi.stubEnv("RESEND_FROM", "ReadyLoq <pilot@example.invalid>");
    fetchMock.mockResolvedValueOnce(new Response("fixture rejection", { status: 403 }));
    expect((await sendMail(message)).delivered).toBe(false);
    fetchMock.mockRejectedValueOnce(new DOMException("Fixture timeout", "TimeoutError"));
    expect((await sendMail(message)).delivered).toBe(false);
  });
  it("does not call any provider when the Resend sender is missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "fixture-only-not-a-real-key");
    expect(await sendMail(message)).toEqual({ delivered: false, reason: "no_transport" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("applies the optional deadline to SMTP without changing other callers' defaults", async () => {
    vi.stubEnv("SMTP_HOST", "smtp.example.invalid");
    vi.stubEnv("SMTP_USER", "fixture");
    vi.stubEnv("SMTP_PASS", "fixture");
    smtp.send.mockResolvedValue({});
    expect((await sendMail(message)).delivered).toBe(true);
    expect(smtp.create).toHaveBeenCalledWith(expect.objectContaining({
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 10_000,
    }));
    const { timeoutMs: _deadline, ...ordinary } = message;
    await sendMail(ordinary);
    expect(smtp.create.mock.calls[1][0]).not.toHaveProperty("connectionTimeout");
  });
});
