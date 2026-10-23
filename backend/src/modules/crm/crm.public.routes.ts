import type { FastifyInstance, FastifyRequest } from "fastify";
import type { z } from "zod";
import { env } from "../../config/env";
import { ApiError, ForbiddenError } from "../../lib/errors";
import { ok } from "../../lib/envelope";
import { CRM_CONSENT_VERSION, readCrmSettings } from "./crm.settings";
import { CRM_HEARTBEAT_SECONDS, CollectPayloadSchema, ingestCollect } from "./crm.collect";
import { AttributionRequestSchema, ConsentRequestSchema, recordBookingAttribution, recordConsent } from "./crm.attribution";

/** Paket N1 — takip ucu hız sınırları (IP başına, global limitin içinde ayrı kova). */
export const CRM_COLLECT_RATE_LIMIT = { max: 120, timeWindow: "1 minute" };
export const CRM_CONSENT_RATE_LIMIT = { max: 20, timeWindow: "1 minute" };
export const CRM_ATTRIBUTION_RATE_LIMIT = { max: 10, timeWindow: "1 minute" };
/** Tek paket en fazla 50 olay; 64 KB üstü gövde 413. */
export const CRM_BODY_LIMIT = 64 * 1024;

function allowedOrigins(): string[] {
  const origins: string[] = [];
  try {
    const url = new URL(env.FRONTEND_URL);
    origins.push(url.origin);
    // `alanadi.com` ↔ `www.alanadi.com` — aynı sitenin iki adı; diğerinden gelen ziyaretçi sessizce 403 almasın.
    const alt = new URL(url.origin);
    alt.hostname = url.hostname.startsWith("www.") ? url.hostname.slice(4) : `www.${url.hostname}`;
    if (!/^(localhost|\d+\.\d+\.\d+\.\d+)$/.test(url.hostname)) origins.push(alt.origin);
  } catch {
    // env doğrulaması zaten URL zorunlu tutar
  }
  return origins;
}

/**
 * YALNIZCA kendi sitemizden gelen istekler: tarayıcılar POST'ta `Origin` başlığını her zaman gönderir
 * (aynı origin dahil). Başlık yoksa ya da farklıysa 403 — sunucudan sunucuya sahte olay basmayı ve
 * başka sitelerden CSRF benzeri olay göndermeyi engeller.
 */
function assertSameSiteOrigin(request: FastifyRequest): void {
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins().includes(origin)) {
    throw new ForbiddenError("İzin verilmeyen kaynak (origin).");
  }
}

/** `sendBeacon` `text/plain` gönderir; `fetch` yedeği `application/json`. İkisi de aynı şemadan geçer. */
function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  let value: unknown = body;
  if (typeof body === "string") {
    try {
      value = JSON.parse(body);
    } catch {
      throw new ApiError(400, "BAD_REQUEST", "Gövde geçerli JSON değil.");
    }
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, "BAD_REQUEST", "Geçersiz olay paketi.");
  }
  return parsed.data;
}

export async function crmPublicRoutes(app: FastifyInstance) {
  /** Site düzeni (SSR) bu ayara göre takip modülünü HİÇ yüklemez ya da onaydan sonra yükler. */
  app.get("/config", async (_request, reply) => {
    const settings = await readCrmSettings(app.prisma);
    return reply.send(
      ok({
        trackingEnabled: settings.trackingEnabled,
        trackStaff: settings.trackStaff,
        whatsappRef: settings.whatsappRef,
        excludedPaths: settings.excludedPaths,
        consentVersion: CRM_CONSENT_VERSION,
        heartbeatSeconds: CRM_HEARTBEAT_SECONDS,
      })
    );
  });

  app.post("/collect", { bodyLimit: CRM_BODY_LIMIT, config: { rateLimit: CRM_COLLECT_RATE_LIMIT } }, async (request, reply) => {
    assertSameSiteOrigin(request);
    const payload = parseBody(CollectPayloadSchema, request.body);
    await ingestCollect(app, payload, { ip: request.ip, userAgent: request.headers["user-agent"] });
    // Sonuç (kabul/atlama) istemciye BİLİNÇLİ OLARAK söylenmez — bot/hariç tutma tespitini zorlaştırır.
    return reply.code(204).send();
  });

  app.post("/consent", { bodyLimit: 4 * 1024, config: { rateLimit: CRM_CONSENT_RATE_LIMIT } }, async (request, reply) => {
    assertSameSiteOrigin(request);
    const input = parseBody(ConsentRequestSchema, request.body);
    await recordConsent(app, input);
    return reply.code(204).send();
  });

  app.post("/attribution", { bodyLimit: 4 * 1024, config: { rateLimit: CRM_ATTRIBUTION_RATE_LIMIT } }, async (request, reply) => {
    assertSameSiteOrigin(request);
    const input = parseBody(AttributionRequestSchema, request.body);
    await recordBookingAttribution(app, input, { userAgent: request.headers["user-agent"] });
    return reply.code(204).send();
  });
}
