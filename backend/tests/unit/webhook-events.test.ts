import { describe, expect, it } from "vitest";
import { WEBHOOK_EVENT_REGISTRY, SUBSCRIBABLE_WEBHOOK_EVENTS, isEventPii } from "../../src/lib/webhook-events";

describe("WEBHOOK_EVENT_REGISTRY", () => {
  it("contains an entry for every WebhookEvent enum value used by the contract", () => {
    const events = WEBHOOK_EVENT_REGISTRY.map((e) => e.event);
    expect(events).toEqual([
      "PING",
      "PAGE_PUBLISHED",
      "BLOG_POST_PUBLISHED",
      "BLOG_POST_UPDATED",
      "PRODUCT_CREATED",
      "PRODUCT_UPDATED",
      "PRODUCT_DELETED",
      "PORTFOLIO_ITEM_PUBLISHED",
      "ORDER_CREATED",
      "ORDER_PAID",
      "ORDER_STATUS_CHANGED",
    ]);
  });

  it("excludes PING from the subscribable list — it is not a real event (§10.13.10)", () => {
    expect(SUBSCRIBABLE_WEBHOOK_EVENTS).not.toContain("PING");
    expect(SUBSCRIBABLE_WEBHOOK_EVENTS).toHaveLength(WEBHOOK_EVENT_REGISTRY.length - 1);
  });

  it("flags all ORDER_* events as containing PII", () => {
    for (const event of ["ORDER_CREATED", "ORDER_PAID", "ORDER_STATUS_CHANGED"] as const) {
      expect(isEventPii(event)).toBe(true);
    }
  });

  it("flags all non-order events as PII-free", () => {
    for (const event of WEBHOOK_EVENT_REGISTRY.map((e) => e.event)) {
      if (event.startsWith("ORDER_")) continue;
      expect(isEventPii(event)).toBe(false);
    }
  });
});
