import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  WEBHOOK_SECRET_PREFIX,
  buildSignedPayload,
  generateWebhookSecret,
  signWebhookPayload,
  verifyWebhookSignature,
  webhookSecretLast4,
} from "../../src/lib/webhook-signature";

describe("generateWebhookSecret", () => {
  it("produces whsec_<64hex>", () => {
    const secret = generateWebhookSecret();
    expect(secret.startsWith(WEBHOOK_SECRET_PREFIX)).toBe(true);
    expect(secret).toMatch(/^whsec_[0-9a-f]{64}$/);
  });

  it("produces unique secrets on repeated calls", () => {
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });
});

describe("webhookSecretLast4", () => {
  it("returns the final 4 characters", () => {
    const secret = generateWebhookSecret();
    expect(webhookSecretLast4(secret)).toBe(secret.slice(-4));
    expect(webhookSecretLast4(secret)).toHaveLength(4);
  });
});

describe("buildSignedPayload / signWebhookPayload", () => {
  const secret = "whsec_" + "a".repeat(64);
  const rawBody = JSON.stringify({ id: "1", event: "PING", apiVersion: "v1", createdAt: "2026-08-16T10:00:00.000Z", data: {} });
  const timestamp = 1755334800;

  it("signs `${timestamp}.${rawBody}` (bağlayıcı imzalanan dize formatı)", () => {
    const signedPayload = buildSignedPayload(timestamp, rawBody);
    expect(signedPayload).toBe(`${timestamp}.${rawBody}`);
  });

  it("produces a sha256=<lowercase hex> header matching an independently computed HMAC", () => {
    const header = signWebhookPayload(secret, timestamp, rawBody);
    const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
    expect(header).toBe(`sha256=${expected}`);
    expect(header).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("changes the signature if the timestamp changes (replay protection)", () => {
    const a = signWebhookPayload(secret, timestamp, rawBody);
    const b = signWebhookPayload(secret, timestamp + 1, rawBody);
    expect(a).not.toBe(b);
  });

  it("changes the signature if the body changes", () => {
    const a = signWebhookPayload(secret, timestamp, rawBody);
    const b = signWebhookPayload(secret, timestamp, rawBody + " ");
    expect(a).not.toBe(b);
  });

  it("is deterministic for identical inputs (retry re-signs identical bytes)", () => {
    expect(signWebhookPayload(secret, timestamp, rawBody)).toBe(signWebhookPayload(secret, timestamp, rawBody));
  });
});

describe("verifyWebhookSignature", () => {
  const secret = "whsec_" + "b".repeat(64);
  const rawBody = JSON.stringify({ hello: "world" });
  const timestamp = Math.floor(Date.now() / 1000);

  it("validates a correctly signed payload", () => {
    const header = signWebhookPayload(secret, timestamp, rawBody);
    expect(verifyWebhookSignature(secret, timestamp, rawBody, header)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const header = signWebhookPayload(secret, timestamp, rawBody);
    expect(verifyWebhookSignature(secret, timestamp, rawBody + "tampered", header)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const header = signWebhookPayload(secret, timestamp, rawBody);
    expect(verifyWebhookSignature("whsec_" + "c".repeat(64), timestamp, rawBody, header)).toBe(false);
  });
});
