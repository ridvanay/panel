import type { FastifyInstance } from "fastify";
import { EgressStatus, WebhookReceiver } from "livekit-server-sdk";
import { env } from "../../config/env";
import { archiveRecordingFromEgress } from "../../lib/telehealth-recording-archive";

/**
 * `.claude/architect-scope-telehealth-template.md` (TUR 3, bağlayıcı) — integration-agent'ın TEK
 * SAHASI. Konum BİLİNÇLİ OLARAK `modules/webhooks/` DEĞİL, `modules/telehealth/`dir (architect
 * kararı) — ama KAYIT (`api.register(telehealthEgressWebhookRoutes, { prefix: "/webhooks/livekit" })`)
 * backend-agent'ın FAZ B'sinde `app.ts`'e eklenecek, bu dosya `app.ts`'e DOKUNMAZ.
 *
 * `/webhooks/stripe` (stripe.routes.ts) İLE AYNI iskelet: kendi encapsulation context'ine özel bir
 * `addContentTypeParser` ham gövdeyi ALIR (LiveKit `application/webhook+json` gönderir),
 * `WebhookReceiver.receive(rawBody, authHeader)` ile imza doğrulanır. İmza geçersizse `400` ve
 * gövde ASLA loglanmaz (yalnızca `err` loglanır).
 *
 * **Modül guard'ı BİLİNÇLİ OLARAK YOKTUR (gerekçeli istisna, architect onaylı):** kayıt sürerken
 * yönetici `telehealth-recording` modülünü kapatırsa `egress_ended` olayı YİNE DE işlenmelidir;
 * aksi hâlde S3'te şifrelenmemiş yetim bir nesne kalırdı.
 *
 * **Ajan sınırı (bağlayıcı):** LiveKit SDK tipleri (`EgressInfo`/`EgressStatus`/`WebhookEvent`)
 * BU DOSYANIN DIŞINA sızdırılmaz — `archiveRecordingFromEgress` (backend-agent'ın FAZ A çıktısı)
 * yalnızca düz bir `{ egressId, durationSeconds, error }` nesnesiyle çağrılır.
 */
export async function telehealthEgressWebhookRoutes(app: FastifyInstance) {
  app.addContentTypeParser(["application/webhook+json", "application/json"], { parseAs: "string" }, (_request, body, done) => {
    done(null, body);
  });

  // security-agent denetimi — `rateLimit: false` DoS amplifikasyon riski taşıyordu (imzasız
  // istekler hiçbir sınır olmadan `WebhookReceiver.receive()`'in kriptografik doğrulama
  // maliyetini tetikleyebilirdi). `/webhooks/stripe` İLE AYNI disiplin: global rate limit korunur,
  // sadece route-level bir override YAPILMAZ.
  app.post("/", async (request, reply) => {
    const authHeader = request.headers["authorization"];
    if (!authHeader || typeof authHeader !== "string") {
      return reply.code(400).send({ error: "invalid signature" });
    }

    let event: Awaited<ReturnType<WebhookReceiver["receive"]>>;
    try {
      const receiver = new WebhookReceiver(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
      event = await receiver.receive(request.body as string, authHeader);
    } catch (err) {
      // Gövde BİLEREK loglanmaz (imzasız/tahrif edilmiş bir payload olabilir) — yalnızca `err`.
      request.log.warn({ err }, "LiveKit egress webhook imza doğrulaması başarısız.");
      return reply.code(400).send({ error: "invalid signature" });
    }

    switch (event.event) {
      case "egress_started": {
        const egressInfo = event.egressInfo;
        if (egressInfo) {
          // İDEMPOTENT: satır zaten `RECORDING`'se (route `consent` ucu zaten bu geçişi yapmış
          // olabilir) no-op; `PENDING_CONSENT`'ten `RECORDING`'e de geçirir (webhook, route'tan
          // ÖNCE gelirse diye — iki yol da AYNI nihai duruma varır).
          await app.prisma.consultationRecording.updateMany({
            where: { egressId: egressInfo.egressId, status: { in: ["PENDING_CONSENT", "RECORDING"] } },
            data: { status: "RECORDING" },
          });
        }
        break;
      }
      case "egress_updated":
        // security-agent denetimi — `egressId` debug logunda dahi görünmez (madde 4, sızıntı
        // kontrolü). Bu olay zaten no-op'tur, tanılama için içerik GEREKMEZ.
        request.log.debug("LiveKit egress_updated (no-op).");
        break;
      case "egress_ended": {
        const egressInfo = event.egressInfo;
        if (egressInfo) {
          const durationNs = egressInfo.fileResults?.[0]?.duration;
          const isFailure =
            egressInfo.status === EgressStatus.EGRESS_FAILED || egressInfo.status === EgressStatus.EGRESS_ABORTED || Boolean(egressInfo.error);
          await archiveRecordingFromEgress(app, {
            egressId: egressInfo.egressId,
            durationSeconds: durationNs ? Number(durationNs) / 1e9 : null,
            error: isFailure ? egressInfo.error || `Egress başarısız oldu (status=${EgressStatus[egressInfo.status]}).` : null,
          });
        }
        break;
      }
      default:
        request.log.debug({ type: event.event }, "İşlenmeyen LiveKit egress webhook olayı.");
    }

    return reply.code(200).send({ received: true });
  });
}
