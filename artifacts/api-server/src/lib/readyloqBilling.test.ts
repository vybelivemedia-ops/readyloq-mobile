import { beforeEach, describe, expect, it, vi } from "vitest";

const { storage, stripe } = vi.hoisted(() => ({
  storage: {
    listProductsWithPrices: vi.fn(),
    hasCurrentSubscriptionForCustomer: vi.fn(),
    getCompany: vi.fn(),
    updateCompanyStripeInfo: vi.fn(),
  },
  stripe: {
    subscriptions: { list: vi.fn(), retrieve: vi.fn(), update: vi.fn() },
    checkout: { sessions: { create: vi.fn() } },
  },
}));

vi.mock("./stripeStorage", () => ({ stripeStorage: storage }));
vi.mock("./stripeClient", () => ({
  getUncachableStripeClient: vi.fn(async () => stripe),
  getStripeSync: vi.fn(),
  getStripeCredentials: vi.fn(),
}));

import { StripeService } from "./stripeService";
import { WebhookHandlers, addUtcMonths } from "./webhookHandlers";

describe("ReadyLoq billing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.hasCurrentSubscriptionForCustomer.mockResolvedValue(false);
    storage.getCompany.mockResolvedValue(null);
    stripe.subscriptions.list.mockResolvedValue({ data: [] });
  });

  it("adds UTC calendar months with month-end clamping", () => {
    const jan31 = Math.floor(Date.UTC(2026, 0, 31, 12) / 1000);
    expect(new Date(addUtcMonths(jan31, 1) * 1000).toISOString())
      .toBe("2026-02-28T12:00:00.000Z");
    const leapDay = Math.floor(Date.UTC(2028, 1, 29) / 1000);
    expect(new Date(addUtcMonths(leapDay, 12) * 1000).toISOString())
      .toBe("2029-02-28T00:00:00.000Z");
  });

  it("resolves only exact current-catalog monthly metadata", async () => {
    storage.listProductsWithPrices.mockResolvedValue([
      { price_id: "legacy", price_metadata: { plan_key: "solo", catalog_version: "old", billing_period: "month" }, recurring: { interval: "month" } },
      { price_id: "yearly", price_metadata: { plan_key: "solo", catalog_version: "readyloq_2026_09", billing_period: "year" }, recurring: { interval: "year" } },
      { price_id: "current", price_metadata: { plan_key: "solo", catalog_version: "readyloq_2026_09", billing_period: "month" }, recurring: { interval: "month" } },
    ]);
    await expect(new StripeService().resolvePriceIds("solo", "monthly"))
      .resolves.toEqual({ basePriceId: "current", perSeatPriceId: undefined });
  });

  it("blocks a checkout when a current subscription is recorded", async () => {
    storage.hasCurrentSubscriptionForCustomer.mockResolvedValue(true);
    await expect(new StripeService().createCheckoutSession({
      customerId: "cus_1", companyId: 1, tier: "solo", period: "monthly",
      successUrl: "https://ok", cancelUrl: "https://cancel",
    })).rejects.toThrow("current subscription");
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("sets a pilot cutoff once and never transitions a standard plan", async () => {
    const service = WebhookHandlers as unknown as {
      handleReadyLoqEvent: (event: unknown) => Promise<void>;
    };
    const pilot = {
      id: "sub_pilot", billing_cycle_anchor: Math.floor(Date.UTC(2026, 0, 31) / 1000),
      cancel_at: null, metadata: {}, status: "active",
    };
    stripe.subscriptions.retrieve.mockResolvedValue(pilot);
    await service.handleReadyLoqEvent({
      type: "checkout.session.completed",
      data: { object: { id: "cs_1", mode: "subscription", subscription: "sub_pilot", metadata: { companyId: "1", tier: "pilot" } } },
    });
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_pilot", expect.objectContaining({
      billing_cycle_anchor: "unchanged",
      cancel_at: addUtcMonths(pilot.billing_cycle_anchor, 3),
    }));

    await service.handleReadyLoqEvent({
      type: "checkout.session.completed",
      data: { object: { id: "cs_2", mode: "subscription", subscription: "sub_standard", metadata: { companyId: "1", tier: "solo" } } },
    });
    expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
  });
});