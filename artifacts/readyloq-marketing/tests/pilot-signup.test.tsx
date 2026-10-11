import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { PilotSignup } from "../src/components/pilot-signup";
import { submitLead } from "../src/lib/api";

vi.mock("../src/lib/api", () => ({ submitLead: vi.fn() }));
const submit = vi.mocked(submitLead);
afterEach(cleanup);
beforeEach(() => { submit.mockReset(); });
function enterEmail(value = "owner@example.com") {
  fireEvent.change(screen.getByLabelText("Where should the pilot details go?"), {
    target: { value },
  });
}
function send() {
  fireEvent.submit(screen.getByRole("button", { name: "Email me the pilot details" }).closest("form")!);
}

describe("existing ReadyLoq pilot signup", () => {
  it("preserves every supplied string and renders only one required email field", () => {
    const { container } = render(<PilotSignup />);
    expect(screen.getByRole("heading", { level: 1 }).textContent)
      .toBe("Yesterday's inspections, owner-ready by morning.");
    expect(screen.getByText("A tech finishes the job, the photos never land, and you eat the re-service and an hour chasing him for it.")).toBeTruthy();
    expect(screen.getByText("Built by a route supervisor who runs home, apartment, restaurant and commercial inspections himself every day.")).toBeTruthy();
    const input = container.querySelector("input")!;
    expect(container.querySelectorAll("input").length).toBe(1);
    expect(input.type).toBe("email");
    expect(input.required).toBe(true);
    expect(input.checkValidity()).toBe(false);
    enterEmail("not-an-email");
    expect(input.checkValidity()).toBe(false);
    expect(container.querySelector("img,svg")).toBeNull();
  });

  it("awaits persistence before swapping only the form in place", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof submitLead>>) => void;
    submit.mockImplementation(() => new Promise(r => { resolve = r; }));
    const { container } = render(<PilotSignup />);
    const section = container.firstElementChild;
    enterEmail();
    send();
    expect(submit).toHaveBeenCalledWith({
      type: "contact", name: "Pilot signup", email: "owner@example.com", source: "readyloq-pilot",
    });
    expect(container.querySelector("form")).not.toBeNull();
    expect(screen.queryByText("Got it. Details are coming to your inbox.")).toBeNull();
    resolve({ id: 1, type: "contact", name: "Pilot signup", email: "owner@example.com", status: "new", createdAt: "2026-10-10T00:00:00.000Z" });
    await waitFor(() => expect(screen.getByText("Got it. Details are coming to your inbox.")).toBeTruthy());
    expect(container.querySelector("form")).toBeNull();
    expect(container.firstElementChild).toBe(section);
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
  });

  it("blocks simultaneous duplicate requests", () => {
    submit.mockImplementation(() => new Promise(() => {}));
    render(<PilotSignup />);
    enterEmail();
    send();
    send();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole<HTMLButtonElement>("button").disabled).toBe(true);
  });

  it("retains the form and email on failure and permits a real retry", async () => {
    submit.mockRejectedValueOnce(new Error("Please try again.")).mockResolvedValueOnce({
      id: 2, type: "contact", name: "Pilot signup", email: "owner@example.com", status: "new", createdAt: "2026-10-10T00:00:00.000Z",
    });
    render(<PilotSignup />);
    enterEmail();
    send();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Please try again."));
    expect(screen.getByLabelText<HTMLInputElement>("Where should the pilot details go?").value).toBe("owner@example.com");
    expect(screen.queryByText("Got it. Details are coming to your inbox.")).toBeNull();
    send();
    await waitFor(() => expect(screen.getByText("Got it. Details are coming to your inbox.")).toBeTruthy());
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("adds exactly the unmodified tracker in the shared HTML head", () => {
    const html = readFileSync("index.html", "utf8");
    const tag = '<script src="https://zero-to-sale.vercel.app/t.js" data-page="07a7e2abd88cbfdd96e01645" defer></script>';
    expect(html.split(tag).length - 1).toBe(1);
    expect(html.indexOf(tag)).toBeLessThan(html.indexOf("</head>"));
    expect(html).toContain("family=Archivo:wght@700");
    expect(html).toContain("family=Source+Sans+3:wght@400");
  });

  it("places the pilot before existing navigation only on the existing home route", () => {
    const layout = readFileSync("src/components/layout.tsx", "utf8");
    expect(layout).toContain('{location === "/" && <PilotSignup />}');
    expect(layout.indexOf("<PilotSignup")).toBeLessThan(layout.indexOf("<header"));
  });
});
