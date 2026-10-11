import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import router from "./leads";

const fixtures = vi.hoisted(() => ({
  insert: vi.fn(), values: vi.fn(), returning: vi.fn(), send: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  db: { insert: fixtures.insert }, leadsTable: {},
}));
vi.mock("../lib/pilot-details-mailer", () => ({ sendPilotDetails: fixtures.send }));

const saved = {
  id: 42, type: "contact", name: "Pilot signup", email: "signup@example.invalid",
  source: "readyloq-pilot", status: "new", createdAt: new Date("2026-10-10T00:00:00Z"),
};
const payload = { type: saved.type, name: saved.name, email: saved.email, source: saved.source };
const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use("/api/leads", router);
beforeEach(() => {
  vi.clearAllMocks();
  fixtures.insert.mockReturnValue({ values: fixtures.values });
  fixtures.values.mockReturnValue({ returning: fixtures.returning });
  fixtures.returning.mockResolvedValue([saved]);
  fixtures.send.mockResolvedValue("accepted");
});
describe("private pilot lead capture and delivery", () => {
  it("rejects invalid input before writing or emailing", async () => {
    const res = await request(app).post("/api/leads").send({ ...payload, email: "invalid" });
    expect(res.status).toBe(400);
    expect(fixtures.insert).not.toHaveBeenCalled();
    expect(fixtures.send).not.toHaveBeenCalled();
  });
  it("saves first and waits for email acceptance before returning success", async () => {
    fixtures.send.mockImplementation(async () => {
      expect(fixtures.returning).toHaveBeenCalledTimes(1);
      return "accepted";
    });
    const res = await request(app).post("/api/leads").send(payload);
    expect(res.status).toBe(201);
    expect(fixtures.values).toHaveBeenCalledWith(payload);
    expect(fixtures.send).toHaveBeenCalledWith(saved.email, saved.id);
    expect(res.body.createdAt).toBe("2026-10-10T00:00:00.000Z");
  });
  it("keeps the saved lead but returns failure when delivery is rejected", async () => {
    fixtures.send.mockResolvedValue("failed");
    const res = await request(app).post("/api/leads").send(payload);
    expect(res.status).toBe(502);
    expect(res.body.error).toContain("signup was saved");
    expect(fixtures.returning).toHaveBeenCalledTimes(1);
  });
  it("reports missing transport configuration explicitly", async () => {
    fixtures.send.mockResolvedValue("unconfigured");
    const res = await request(app).post("/api/leads").send(payload);
    expect(res.status).toBe(503);
    expect(res.body.error).toContain("not configured");
  });
  it("does not send email when the database write fails", async () => {
    fixtures.returning.mockRejectedValue(new Error("fixture database failure"));
    const res = await request(app).post("/api/leads").send(payload);
    expect(res.status).toBe(500);
    expect(fixtures.send).not.toHaveBeenCalled();
  });
  it("leaves other lead workflows unchanged and does not expose a public list", async () => {
    fixtures.returning.mockResolvedValue([{ ...saved, source: "contact" }]);
    expect((await request(app).post("/api/leads").send({ ...payload, source: "contact" })).status).toBe(201);
    expect(fixtures.send).not.toHaveBeenCalled();
    expect((await request(app).get("/api/leads")).status).toBe(404);
  });
  it("retains the per-IP abuse limit, including email attempts", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 16; i++) {
      lastStatus = (await request(app).post("/api/leads")
        .set("X-Forwarded-For", "198.51.100.77").send(payload)).status;
    }
    expect(lastStatus).toBe(429);
    expect(fixtures.send).toHaveBeenCalledTimes(15);
  });
});
