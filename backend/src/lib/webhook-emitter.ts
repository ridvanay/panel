import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { WebhookEvent } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { isEventPii } from "./webhook-events";
import { enqueueWebhookDispatch } from "../modules/outbound-webhooks/outbound-webhooks.dispatcher";

/**
 * §10.13.8 — `emitWebhookEvent()` TEK giriş noktasıdır: hiçbir route/service katmanı doğrudan
 * `WebhookDelivery` satırı OLUŞTURMAZ. Bağlayıcı kurallar:
 *
 *  - Çağıran taraf bunu transaction COMMIT'inden SONRA çağırmalıdır (geri alınan bir işlem için
 *    webhook gitmiş olmasın diye) — bu fonksiyonun kendisi transaction AÇMAZ.
 *  - Asıl isteği ASLA düşürmez — `logAudit` ile AYNI desen (try/catch, hata yalnızca loglanır).
 *  - O olaya abone `ACTIVE` webhook yoksa hiçbir satır yazılmaz (sıfır maliyet).
 */
export async function emitWebhookEvent(app: FastifyInstance, event: WebhookEvent, data: Record<string, unknown>): Promise<void> {
  try {
    const subscribers = await app.prisma.outboundWebhook.findMany({
      where: { status: "ACTIVE", events: { has: event } },
      select: { id: true },
    });
    if (subscribers.length === 0) return;

    const containsPii = isEventPii(event);
    const createdAt = new Date();

    for (const webhook of subscribers) {
      const deliveryId = crypto.randomUUID();
      const payload = {
        id: deliveryId,
        event,
        apiVersion: "v1" as const,
        createdAt: createdAt.toISOString(),
        data,
      };

      await app.prisma.webhookDelivery.create({
        data: {
          id: deliveryId,
          webhookId: webhook.id,
          event,
          payload: payload as Prisma.InputJsonValue,
          status: "PENDING",
          nextAttemptAt: createdAt,
          containsPii,
        },
      });
    }

    // Dispatcher'ın 15 sn'lik sweeper turunu beklemeden, mümkünse hemen bir tetikleme dene
    // (best-effort — sweeper zaten bir güvenlik ağı olarak vardır, bkz. dispatcher.ts).
    enqueueWebhookDispatch(app);
  } catch (err) {
    app.log.error({ err, event }, "Webhook olayı kuyruklanamadı");
  }
}
