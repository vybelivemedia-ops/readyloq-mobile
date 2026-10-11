import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { Router } from "wouter";
import Home from "../src/pages/home";
import { ProductUpdates } from "../src/components/product-updates";
import { SecurityAuditWidget } from "../src/components/security-audit-widget";
import { FaieAssistant } from "../src/components/faie-assistant";
import { streamFaieReply } from "../src/lib/faie";

vi.mock("../src/lib/faie", () => ({ streamFaieReply: vi.fn() }));
vi.mock("../src/components/cta-section", () => ({ CtaSection: () => <section>Original CTA</section> }));
beforeAll(() => {
  // jsdom has no viewport observer or element scrolling; keep these browser
  // APIs out of the copy/interaction tests without changing application code.
  vi.stubGlobal("IntersectionObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
});
afterAll(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("homepage credibility boundaries", () => {
  it("removes the unmeasured FAIE metric and puts real voice and wearable implementation in validation", () => {
    const { container } = render(<ProductUpdates />);
    expect(container.textContent).not.toMatch(/76%|confidence is (?:building|growing)|current confidence level/i);
    expect(screen.queryByRole("progressbar")).toBeNull();
    const implemented = screen.getByText("Implemented capabilities").closest("div.rounded-2xl")!;
    expect(implemented.textContent).toContain("Property memory and prior-visit context");
    expect(implemented.textContent).not.toMatch(/voice|wearable|Meta glasses/i);
    expect(screen.getByText(/Voice Capture and multilingual commands are implemented/).textContent)
      .toContain("Android transcription currently requires connectivity");
    expect(screen.getByText(/Meta glasses capture is implemented/).textContent)
      .toContain("physical-hardware validation");
    expect(screen.getByText("Planned")).toBeTruthy();
  });

  it("preserves institutional memory and original sections without automatic measurement, white-label, or free-price claims", () => {
    const { container } = render(<Router><Home /></Router>);
    expect(screen.getByText("Institutional Knowledge, Standardized.")).toBeTruthy();
    expect(container.textContent).toContain("shared institutional memory");
    expect(screen.getByText("FAIE Visual Assistance")).toBeTruthy();
    expect(container.textContent).toContain("FAIE does not replace on-site measurements");
    expect(container.textContent).not.toMatch(/automatically measures|door frames|brick courses|white-labeled|proof of service.*automatically/i);
    expect(container.textContent).toContain("review and approval before client sharing");
    expect(screen.getByText("For Technicians")).toBeTruthy();
    expect(screen.getByText("For Management")).toBeTruthy();
    expect(screen.getByText("Original CTA")).toBeTruthy();
    const structuredData = JSON.parse(container.querySelector('script[type="application/ld+json"]')!.textContent!);
    expect(structuredData.offers).toBeUndefined();
  });

  it.each([0, 1, 2])("labels quiz outcome %s as a self-reported summary, never security verification", async (option) => {
    render(<Router><SecurityAuditWidget /></Router>);
    expect(screen.getByText("Informational Self-Assessment")).toBeTruthy();
    expect(screen.getByTestId<HTMLButtonElement>("button-audit-next").disabled).toBe(true);
    for (let step = 0; step < 3; step++) {
      const radio = await screen.findByTestId(`audit-option-${step}-${option}`);
      fireEvent.click(radio);
      fireEvent.click(screen.getByTestId("button-audit-next"));
    }
    expect(await screen.findByText("Answer summary — not a security rating")).toBeTruthy();
    expect(screen.getByTestId("text-audit-score").textContent).toBe(`${(2 - option) * 50}/100`);
    expect(screen.getByText(/Calculated only from your three answers/).textContent)
      .toContain("not a security audit, compliance certification, or proof of security");
    expect(screen.queryByText(/closes that last gap|every ounce|database layer|encrypted end-to-end/i)).toBeNull();
    fireEvent.click(screen.getByTestId("button-audit-restart"));
    expect(await screen.findByTestId("audit-option-0-0")).toBeTruthy();
    expect(screen.getByTestId<HTMLButtonElement>("button-audit-next").disabled).toBe(true);
  });

  it("preserves answer selection when navigating back through the quiz", async () => {
    render(<Router><SecurityAuditWidget /></Router>);
    fireEvent.click(screen.getByTestId("audit-option-0-1"));
    fireEvent.click(screen.getByTestId("button-audit-next"));
    await screen.findByTestId("audit-option-1-0");
    fireEvent.click(screen.getByTestId("button-audit-back"));
    expect((await screen.findByTestId("audit-option-0-1")).getAttribute("aria-checked")).toBe("true");
  });

  it("qualifies homepage product Q&A and replaces a generated unsupported security guarantee", async () => {
    vi.mocked(streamFaieReply).mockImplementation(async ({ onToken }) => {
      onToken("Every management action has immutable audit trails and guarantees compliance.");
    });
    render(<FaieAssistant homepageContext />);
    expect(screen.queryByText("Online")).toBeNull();
    expect(screen.getByText("Product Q&A")).toBeTruthy();
    expect(screen.getByText(/not access to your company's records/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "How is my company's data isolated from others?" }));
    await waitFor(() => expect(screen.getByText(/That answer included claims that need verification/)).toBeTruthy());
    expect(screen.queryByText(/Every management action has immutable/)).toBeNull();
    expect(screen.getByText(/AI-generated draft/)).toBeTruthy();
  });

  it("retains ordinary homepage product answers and leaves the shared pricing-page assistant unchanged", async () => {
    const answer = "Inspection history helps technicians review recorded prior findings.";
    vi.mocked(streamFaieReply).mockImplementation(async ({ onToken }) => { onToken(answer); });
    const first = render(<FaieAssistant homepageContext />);
    fireEvent.click(screen.getByRole("button", { name: "How does AI inspection vision work?" }));
    expect(await screen.findByText(answer)).toBeTruthy();
    first.unmount();
    render(<FaieAssistant />);
    expect(screen.getByText("Online")).toBeTruthy();
    expect(screen.queryByText(/Confirm pricing and feature availability/)).toBeNull();
    const form = screen.getByPlaceholderText("Ask FAIE about ReadyLoq...").closest("form")!;
    fireEvent.change(within(form).getByRole("textbox"), { target: { value: "How do inspection records help?" } });
    fireEvent.submit(form);
    expect(await screen.findByText(answer)).toBeTruthy();
    expect(screen.queryByText(/AI-generated draft/)).toBeNull();
  });

  it("does not move the pilot, change route gating, or alter the tracking tag", () => {
    const layout = readFileSync("src/components/layout.tsx", "utf8");
    expect(layout).toContain('{location === "/" && <PilotSignup />}');
    expect(layout.indexOf("<PilotSignup")).toBeLessThan(layout.indexOf("<header"));
    const head = readFileSync("index.html", "utf8");
    const tracker = '<script src="https://zero-to-sale.vercel.app/t.js" data-page="07a7e2abd88cbfdd96e01645" defer></script>';
    expect(head.split(tracker).length - 1).toBe(1);
    expect(head.indexOf(tracker)).toBeLessThan(head.indexOf("</head>"));
  });
});
