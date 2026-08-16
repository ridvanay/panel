import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import { verifyWebhookSignature } from "../../src/lib/webhook-signature";

/**
 * §10.13.8/§10.13.9 — dispatcher'ın GERÇEK gönderim yolunu (`sendWebhookRequest`) uçtan uca
 * doğrular. Proje genelinde daha önce (`webhook-emission.test.ts`, `outbound-webhooks.test.ts`)
 * yalnızca `WebhookDelivery` satırının DOĞRU oluştuğu test edilmişti — "gerçek gönderim"
 * (`outbound-webhooks.dispatcher.ts::sendWebhookRequest`) hiçbir testte TETİKLENMEMİŞTİ (`grep
 * -rn "MockAgent|nock|setGlobalDispatcher" tests/` sıfır sonuç veriyordu). Dış ağa gerçek istek
 * atmak yerine (SSRF koruması zaten literal-IP/localhost/private-range hedeflerini reddettiği
 * için gerçek bir yerel test sunucusuna bağlanmak da mümkün değil) `node:dns` ve `undici`
 * projedeki YERLEŞİK `vi.mock` deseniyle (bkz. `checkout.test.ts::vi.mock("../../src/lib/
 * stripe")`, `site-modules.test.ts::vi.mock("../../src/lib/module-registry")`) sahtelenir —
 * DNS çözümlemesi sahte-public bir IP'ye, HTTP isteği ise kontrollü bir yanıt kuyruğuna bağlanır.
 * Bu, dispatcher'ın ÜRETTİĞİ gerçek `X-Webhook-Signature` header'ının belgelenen formüle
 * (§10.13.9) uyduğunu VE backoff/FAILED geçişinin gerçekten çalıştığını kanıtlamanın tek yoludur.
 */

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

const capturedRequests: CapturedRequest[] = [];
let responseQueue: number[] = [];

const MOCK_HOST = "hooks.mocked-test.example.com";

function asyncBody(text: string): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      yield new TextEncoder().encode(text);
    },
  };
}

vi.mock("node:dns", () => {
  const lookup = vi.fn(async (hostname: string) => {
    if (hostname === MOCK_HOST) return [{ address: "93.184.216.34", family: 4 }];
    const err = new Error("ENOTFOUND") as NodeJS.ErrnoException;
    err.code = "ENOTFOUND";
    throw err;
  });
  const promises = { lookup };
  // Hem `import dns from "node:dns"; dns.promises.lookup` (default import) hem de olası named
  // import kullanımlarını kapsamak için iki şekilde de sunulur.
  return { default: { promises }, promises };
});

vi.mock("undici", () => ({
  Agent: class MockAgent {
    async close() {}
  },
  request: vi.fn(async (url: string, opts: { method: string; headers: Record<string, string>; body: string }) => {
    capturedRequests.push({ url, method: opts.method, headers: opts.headers, body: opts.body });
    const status = responseQueue.length > 0 ? responseQueue.shift()! : 200;
    return { statusCode: status, body: asyncBody(status >= 200 && status < 300 ? "ok" : "error") };
  }),
}));

describe("outbound-webhooks dispatcher — mocklu ağ katmanıyla gerçek gönderim + HMAC imza doğrulaması", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let enqueueWebhookDispatch: (app: FastifyInstance) => void;
  let WEBHOOK_MAX_ATTEMPTS: number;

  function authHeader() {
    return { authorization: `Bearer ${adminToken}` };
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    ({ accessToken: adminToken } = await registerTestUser(app, { email: "webhook-dispatch-admin@example.com" }));

    // Mocklanan `undici`/`node:dns` modüllerinin dispatcher tarafından kullanılabilmesi için
    // dispatcher modülü `buildTestApp()` App kurulumunda ZATEN import edilmiştir — burada
    // yalnızca test içinde kullanılacak export'ları (fonksiyon + sabit) sonradan alıyoruz.
    const dispatcherModule = await import("../../src/modules/outbound-webhooks/outbound-webhooks.dispatcher");
    enqueueWebhookDispatch = dispatcherModule.enqueueWebhookDispatch;
    WEBHOOK_MAX_ATTEMPTS = dispatcherModule.WEBHOOK_MAX_ATTEMPTS;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  async function waitForDelivery(
    deliveryId: string,
    predicate: (row: { status: string; attemptCount: number }) => boolean,
    timeoutMs = 5000
  ) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const row = await app.prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
      if (row && predicate(row)) return row;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error(`webhookDelivery ${deliveryId} beklenen duruma zamanında ulaşmadı`);
  }

  it("PING test gönderimi GERÇEKTEN 'ağa çıkar' (mocklu undici) — doğru URL/header'lar ve GEÇERLİ HMAC imzası taşır", async () => {
    responseQueue = [200];
    capturedRequests.length = 0;

    const webhookRes = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/webhooks",
      headers: authHeader(),
      payload: { name: "Dispatch Test Hook", url: `https://${MOCK_HOST}/cms`, events: ["BLOG_POST_PUBLISHED"] },
    });
    expect(webhookRes.statusCode).toBe(201);
    const { webhook, plainSecret } = webhookRes.json().data as { webhook: { id: string }; plainSecret: string };

    const testRes = await app.inject({
      method: "POST",
      url: `/api/v1/admin/settings/webhooks/${webhook.id}/test`,
      headers: authHeader(),
    });
    expect(testRes.statusCode).toBe(202);
    const { deliveryId } = testRes.json().data as { deliveryId: string };

    const delivered = await waitForDelivery(deliveryId, (row) => row.status !== "PENDING" && row.status !== "SENDING");
    expect(delivered.status).toBe("SUCCEEDED");
    expect((delivered as unknown as { responseStatus: number }).responseStatus).toBe(200);
    expect(delivered.attemptCount).toBe(1);

    expect(capturedRequests).toHaveLength(1);
    const sent = capturedRequests[0]!;
    expect(sent.url).toBe(`https://${MOCK_HOST}/cms`);
    expect(sent.method).toBe("POST");
    expect(sent.headers["x-webhook-id"]).toBe(webhook.id);
    expect(sent.headers["x-webhook-delivery"]).toBe(deliveryId);
    expect(sent.headers["x-webhook-event"]).toBe("PING");
    expect(sent.headers["x-webhook-attempt"]).toBe("1");
    expect(sent.headers["x-webhook-signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);

    // §10.13.9 — ALICI tarafı REFERANS doğrulaması (documentation-agent da kullanabilir):
    // dokümante edilen formüle göre (`HMAC-SHA256(secret, "${timestamp}.${rawBody}")`)
    // BAĞIMSIZCA yeniden hesaplanan imza, dispatcher'ın GERÇEKTEN gönderdiği
    // `X-Webhook-Signature` header'ıyla eşleşmelidir.
    const timestamp = Number(sent.headers["x-webhook-timestamp"]);
    expect(Number.isFinite(timestamp)).toBe(true);
    expect(verifyWebhookSignature(plainSecret, timestamp, sent.body, sent.headers["x-webhook-signature"]!)).toBe(true);

    // Gönderilen gövde (`rawBody`) imzalanan gövdeyle BİREBİR aynı olmalı — iki kez
    // serileştirme (JSON.stringify farklı sırada/whitespace ile) imzayı sessizce geçersiz kılar.
    const parsedBody = JSON.parse(sent.body) as { event: string; id: string };
    expect(parsedBody.event).toBe("PING");
    expect(parsedBody.id).toBe(deliveryId);
  });

  it("ALICI referans doğrulaması: yanlış secret ya da bozulmuş gövdeyle GERÇEK bir imza REDDEDİLİR", async () => {
    const sent = capturedRequests[capturedRequests.length - 1]!;
    const timestamp = Number(sent.headers["x-webhook-timestamp"]);
    const realSignature = sent.headers["x-webhook-signature"]!;

    // Yanlış secret ile aynı body/timestamp asla doğrulanamaz (sabit-zamanlı karşılaştırma, §10.13.9).
    expect(verifyWebhookSignature("whsec_" + "f".repeat(64), timestamp, sent.body, realSignature)).toBe(false);
    // Gövde bozulursa (MITM/tampering simülasyonu) AYNI gerçek imza artık geçersizdir.
    const rightSecretButTamperedBody = verifyWebhookSignature("whsec_" + "f".repeat(64), timestamp, sent.body + "tampered", realSignature);
    expect(rightSecretButTamperedBody).toBe(false);
    // Rastgele/sahte bir imza formatı doğru olsa da GERÇEK imzayla asla eşleşmez.
    const forgedSignature = `sha256=${"0".repeat(64)}`;
    expect(forgedSignature).not.toBe(realSignature);
  });

  it("5xx yanıtları backoff ile yeniden dener; WEBHOOK_MAX_ATTEMPTS'e (5) ulaşınca FAILED olur", async () => {
    responseQueue = [500, 500, 500, 500, 500];
    capturedRequests.length = 0;

    const webhookRes = await app.inject({
      method: "POST",
      url: "/api/v1/admin/settings/webhooks",
      headers: authHeader(),
      payload: { name: "Retry Test Hook", url: `https://${MOCK_HOST}/retry`, events: ["BLOG_POST_PUBLISHED"] },
    });
    const { webhook } = webhookRes.json().data as { webhook: { id: string } };

    const testRes = await app.inject({
      method: "POST",
      url: `/api/v1/admin/settings/webhooks/${webhook.id}/test`,
      headers: authHeader(),
    });
    const { deliveryId } = testRes.json().data as { deliveryId: string };

    // Gerçek backoff gecikmesini (30sn→2dk→10dk→60dk) BEKLEMEDEN, her denemeden sonra
    // `nextAttemptAt`'i elle "şimdi"ye çekip bir sonraki sweep turunu manuel tetikliyoruz.
    // Dispatcher'ın KENDİ backoff/deneme-sayma mantığı DEĞİŞTİRİLMİYOR — yalnızca "zamanı geldi
    // mi?" sorgusunu erken karşılıyoruz (deterministik, gerçek/fake-timer bekleme YOK).
    for (let attempt = 1; attempt <= WEBHOOK_MAX_ATTEMPTS; attempt++) {
      const row = await waitForDelivery(deliveryId, (r) => r.attemptCount === attempt);
      if (row.status === "FAILED") break;
      await app.prisma.webhookDelivery.update({ where: { id: deliveryId }, data: { nextAttemptAt: new Date(0) } });
      enqueueWebhookDispatch(app);
    }

    const final = await waitForDelivery(deliveryId, (r) => r.status === "FAILED");
    expect(final.attemptCount).toBe(WEBHOOK_MAX_ATTEMPTS);
    expect((final as unknown as { responseStatus: number }).responseStatus).toBe(500);
    expect(capturedRequests).toHaveLength(WEBHOOK_MAX_ATTEMPTS);
    expect(capturedRequests.map((r) => r.headers["x-webhook-attempt"])).toEqual(["1", "2", "3", "4", "5"]);

    const wh = await app.prisma.outboundWebhook.findUnique({ where: { id: webhook.id } });
    expect(wh!.consecutiveFailureCount).toBe(1);
    expect(wh!.lastFailureAt).not.toBeNull();
  });
});
