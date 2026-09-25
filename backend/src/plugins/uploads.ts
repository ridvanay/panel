import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import path from "node:path";
import fs from "node:fs";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { INTERNAL_RATE_LIMIT_KEY, INTERNAL_RATE_LIMIT_MAX, UPLOADS_RATE_LIMIT } from "../lib/rate-limit";
import { IMAGE_EXTENSIONS } from "../lib/mime-detect";

export const UPLOAD_DIR = path.join(process.cwd(), "uploads");
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // 12 MB

/**
 * `lib/storage/local.storage.ts` her dosyayı `crypto.randomUUID()` + uzantı adıyla yazar ve ASLA
 * üzerine yazmaz — aynı URL'in içeriği hiç değişmediği için tarayıcı 1 yıl yeniden sormadan kullanabilir
 * (compliance-agent koşullu onayı: bkz. INFRA.md "/uploads önbellek"). UUID olmayan adlar 1 gün.
 */
const UUID_FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/i;
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const DEFAULT_UPLOAD_CACHE_CONTROL = "public, max-age=86400";

export function uploadCacheControl(filePath: string): string {
  return UUID_FILE_NAME.test(path.basename(filePath)) ? IMMUTABLE_CACHE_CONTROL : DEFAULT_UPLOAD_CACHE_CONTROL;
}

export default fp(async function uploadsPlugin(app: FastifyInstance) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  });

  // /uploads/* herkese açık statik servis — görseller siteyi ziyaret eden herkes tarafından
  // görülebilmeli (auth YOK). Bu yüzden kendi ENCAPSULATED alt-context'inde register edilir:
  // `@fastify/static` route'ları kendi `fastify.route()` çağrısını yapar ve bizim dışarıdan
  // `config: { rateLimit: {...} }` geçmemize izin vermez (diğer route'larda kullanılan pattern,
  // bkz. auth.routes.ts::AUTH_RATE_LIMIT, media.routes.ts::MEDIA_LIST_RATE_LIMIT). Bu yüzden
  // aynı sonucu `@fastify/rate-limit`'in `fastify.rateLimit(options)` decorator'ını (route-level
  // config.rateLimit'in altında kullandığı AYNI mekanizma) bu alt-context'e özel bir `onRequest`
  // hook'u olarak ekleyerek elde ediyoruz — global limit (env.RATE_LIMIT_MAX, plugins/security.ts)
  // `/uploads/*` global (API) kovasını TÜKETMEZ (bkz. plugins/security.ts `allowList`) — yalnızca
  // bu ayrı kovaya tabidir: ziyaretçi IP'si başına `UPLOADS_RATE_LIMIT`, iç istemci (frontend'in
  // `next/image` optimizasyonu, bkz. lib/internal-clients.ts) için tek ortak kova.
  await app.register(async function uploadsStaticScope(scope) {
    scope.addHook(
      "onRequest",
      scope.rateLimit({
        ...UPLOADS_RATE_LIMIT,
        // Global limiter'ın `allowList`'i (tüm /uploads) buraya miras kalmasın — bu kova GERÇEKTEN işlemeli.
        allowList: () => false,
        max: (_request, key) => (key === INTERNAL_RATE_LIMIT_KEY ? INTERNAL_RATE_LIMIT_MAX : UPLOADS_RATE_LIMIT.max),
      })
    );

    await scope.register(fastifyStatic, {
      root: UPLOAD_DIR,
      prefix: "/uploads/",
      // §2.2 madde 3 (.claude/architect-scope-ecommerce-pro-template.md, bağlayıcı) — görsel
      // OLMAYAN türler (şu an yalnızca PDF) tarayıcı içinde satır içi AÇILMAZ: `Content-
      // Disposition: attachment` indirmeye zorlar, `X-Content-Type-Options: nosniff` MIME
      // sniffing'i kapatır. Gerekçe: PDF JavaScript taşıyabilir; API origin'inde satır içi açılan
      // bir dosya phishing/içerik yürütme yüzeyi üretir (security-agent politikası). Diskteki
      // dosya adının uzantısı `local.storage.ts`'te DAİMA `extensionForMimeType` (tespit edilen
      // gerçek tür) ile yazıldığı için burada uzantıya bakmak beyan edilen değil TESPİT EDİLEN
      // türe güvenmek demektir.
      // `@fastify/static`'in kendi `public, max-age=0` başlığı yerine `setHeaders`'taki değer kullanılır.
      cacheControl: false,
      setHeaders: (reply, filePath) => {
        reply.header("Cache-Control", uploadCacheControl(filePath));
        const ext = path.extname(filePath).toLowerCase();
        if (!IMAGE_EXTENSIONS.has(ext)) {
          reply.header("Content-Disposition", "attachment");
          reply.header("X-Content-Type-Options", "nosniff");
        }
      },
    });
  });
});
