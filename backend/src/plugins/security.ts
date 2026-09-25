import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import cookie from "@fastify/cookie";
import { env } from "../config/env";
import { createInternalClientResolver } from "../lib/internal-clients";
import { INTERNAL_RATE_LIMIT_KEY, INTERNAL_RATE_LIMIT_MAX } from "../lib/rate-limit";

export default fp(async function securityPlugin(app: FastifyInstance) {
  await app.register(helmet, {
    // Saf JSON API — HTML sunmuyoruz, CSP burada anlamsız ve istemci entegrasyonlarını kırabilir.
    contentSecurityPolicy: false,
    // helmet'in varsayılanı `same-origin`; ancak /uploads/* altındaki görseller/medya
    // farklı origin/port'taki frontend'den (bkz. plugins/uploads.ts — "herkese açık
    // statik servis") <img> ile yüklenmek üzere tasarlandı. `same-origin` bu cross-origin
    // resource yüklemelerini tarayıcıda sessizce engelliyordu (CORS izin verse bile).
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });

  await app.register(cors, {
    // `.claude/architect-scope-doctor-subdomain.md` §6.4/§7.2 — hekim portalı
    // (`doktor.siteadi.*`) ana site'den (`siteadi.*`) FARKLI bir tarayıcı origin'i olduğu için
    // tek bir string yeterli değil; sabit, env kaynaklı bir allow-list dizisi kullanılır.
    // `DOCTOR_FRONTEND_URL` tanımsızsa `.filter(Boolean)` onu listeden düşürür ve davranış
    // bugünküyle (`FRONTEND_URL` tek origin) BİREBİR AYNI kalır. BAĞLAYICI KISIT (security-agent):
    // wildcard (`*`) veya regex origin YASAK — `credentials: true` ile birlikte
    // `Access-Control-Allow-Origin: *` asla üretilemez; allow-list SABİT ve yalnızca env'den gelir.
    origin: [env.FRONTEND_URL, env.DOCTOR_FRONTEND_URL].filter(
      (value): value is string => Boolean(value),
    ),
    credentials: true, // refresh token httpOnly cookie için gerekli
    // @fastify/cors'un varsayılanı yalnızca "GET,HEAD,POST" — bu API PATCH/PUT/DELETE
    // kullandığı için (ör. içerik düzenleme/silme) açıkça listelenmezse tarayıcı preflight'ı
    // bu metodları reddeder ve gerçek istek hiç gönderilmez (ağ hatası gibi görünür).
    methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE"],
  });

  await app.register(cookie);

  // İç istemci (frontend konteyneri) tanıma — bkz. lib/internal-clients.ts (güven modeli, fail-closed).
  // İlk çözümleme açılışta beklenir ki ilk SSR istekleri de doğru kovaya düşsün.
  const internalClients = createInternalClientResolver(env.INTERNAL_FRONTEND_URL, app.log);
  await internalClients.refresh().catch(() => {});
  app.decorate("internalClients", internalClients);
  app.addHook("onClose", async () => internalClients.close());

  await app.register(rateLimit, {
    global: true,
    // Ziyaretçi: IP başına `RATE_LIMIT_MAX`. İç istemci (SSR + next/image): tek AYRI kova,
    // `INTERNAL_RATE_LIMIT_MAX`. Karar ham soket adresine dayanır, `request.ip`/XFF'ye DEĞİL.
    // Route-özel limitler (auth, iletişim formu…) bu anahtarı miras alır ama kendi `max`'larını korur.
    keyGenerator: (request) =>
      internalClients.isInternal(request.socket.remoteAddress) ? INTERNAL_RATE_LIMIT_KEY : request.ip,
    max: (_request, key) => (key === INTERNAL_RATE_LIMIT_KEY ? INTERNAL_RATE_LIMIT_MAX : env.RATE_LIMIT_MAX),
    timeWindow: env.RATE_LIMIT_WINDOW,
    // `/uploads/*` statik medya API kovasını TÜKETMEZ — kendi ayrı limiti var (plugins/uploads.ts).
    allowList: (request) => request.url.startsWith("/uploads/"),
    // Varsayılan header davranışı korunur (Retry-After dahil x-ratelimit-* header'ları
    // otomatik eklenir, bkz. addHeaders/addHeadersOnExceeding varsayılanları) — burada sadece
    // JSON gövdesini projenin standart hata zarfıyla (`{ error: { code, message, details } }`,
    // bkz. plugins/error-handler.ts::sendError) tutarlı hale getiriyor ve kalan bekleme
    // süresini somut saniye olarak mesaja/gövdeye ekliyoruz. Bu obje `throw` edilip
    // setErrorHandler'a düşer (bkz. error-handler.ts'teki RATE_LIMITED dalı).
    errorResponseBuilder: (_request, context) => {
      const retryAfterSeconds = Math.max(1, Math.ceil(context.ttl / 1000));
      return {
        statusCode: 429,
        retryAfterSeconds,
        message: `Çok fazla istek. ${retryAfterSeconds} saniye sonra tekrar deneyin.`,
      };
    },
  });
});
