import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import path from "node:path";
import fs from "node:fs";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { UPLOADS_RATE_LIMIT } from "../lib/rate-limit";

export const UPLOAD_DIR = path.join(process.cwd(), "uploads");
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

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
  // yine ayrıca uygulanır, bu SADECE ek/daha sıkı bir savunma katmanıdır, onu DEĞİŞTİRMEZ.
  await app.register(async function uploadsStaticScope(scope) {
    scope.addHook("onRequest", scope.rateLimit(UPLOADS_RATE_LIMIT));

    await scope.register(fastifyStatic, {
      root: UPLOAD_DIR,
      prefix: "/uploads/",
    });
  });
});
