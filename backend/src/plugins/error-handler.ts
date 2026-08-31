import fp from "fastify-plugin";
import type { FastifyInstance, FastifyError, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { ApiError, ApiErrorCode, SliderInUseError, DemoTemplateAlreadyImportedError } from "../lib/errors";
import { Sentry, sentryEnabled } from "../lib/sentry";

interface ZodLikeIssue {
  path: (string | number)[];
  message: string;
}

function isZodError(err: unknown): err is { name: string; issues: ZodLikeIssue[] } {
  return !!err && typeof err === "object" && (err as { name?: string }).name === "ZodError";
}

function flattenZodIssues(issues: ZodLikeIssue[]): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.join(".") || "_";
    (details[key] ??= []).push(issue.message);
  }
  return details;
}

function sendError(reply: import("fastify").FastifyReply, statusCode: number, code: ApiErrorCode, message: string, details?: Record<string, string[]>) {
  return reply.code(statusCode).send({ error: { code, message, ...(details ? { details } : {}) } });
}

// SADECE bu dosyanın en altındaki "beklenmedik 500" catch-all dalından çağrılır — ApiError,
// ZodError, validation, rate-limit gibi BİLİNEN/ele alınmış hatalar Sentry'ye hiç gitmez
// (aksi halde her 4xx gürültü olarak Sentry kotasını tüketir ve gerçek regresyonları gömer).
// PII sızıntısı olmaması için context'e SADECE user id/role, HTTP method ve route PATTERN'i
// (query string olmadan — query string token/PII taşıyabilir) eklenir; email ASLA gönderilmez.
function reportUnexpectedError(error: Error, request: FastifyRequest): void {
  if (!sentryEnabled) return;

  Sentry.captureException(error, {
    // `request.id` — plugins/request-id.ts tarafından response'a da yansıtılan aynı trace id
    // (bkz. app.ts::genReqId/requestIdHeader). Sentry event'i ile aynı isteğin backend log
    // satırlarını (pino `reqId` alanı) eşleştirmek için `tags` altında tutulur (tags Sentry
    // UI'da aranabilir/filtrelenebilir, `contexts`'in aksine).
    tags: { requestId: request.id },
    contexts: {
      request: {
        method: request.method,
        // `request.routeOptions.url` route TANIMINI verir (örn. "/api/v1/organizations/:orgId"),
        // `request.url` ise gerçek istek yolunu ham query string'iyle birlikte taşır — PII/token
        // sızıntısını önlemek için burada bilerek route pattern'i kullanılıyor.
        route: request.routeOptions?.url ?? request.url.split("?")[0],
      },
    },
    user: request.user?.id ? { id: request.user.id, role: request.user.role } : undefined,
  });
}

export default fp(async function errorHandlerPlugin(app: FastifyInstance) {
  app.setNotFoundHandler((request, reply) => {
    return sendError(reply, 404, "NOT_FOUND", `Uç nokta bulunamadı: ${request.method} ${request.url}`);
  });

  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    // `sliders` modülü — `usedBy: SliderUsage[]` genel `ApiError.details` (`Record<string,
    // string[]>`) şekline SIĞMAZ, bu yüzden AYRI serileştirilir (bkz. lib/errors.ts::SliderInUseError).
    // `instanceof ApiError` dalından ÖNCE gelmelidir (SliderInUseError onun bir alt sınıfıdır).
    if (error instanceof SliderInUseError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: { usedBy: error.usedBy } } });
    }

    // `demo-templates` idempotency çakışması — bkz. lib/errors.ts::DemoTemplateAlreadyImportedError
    // yorumu. `instanceof ApiError` dalından ÖNCE gelmelidir (alt sınıfı).
    if (error instanceof DemoTemplateAlreadyImportedError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: {
            templateKey: error.templateKey,
            importedAt: error.importedAt,
            importedBy: error.importedBy,
            version: error.version,
            pageId: error.pageId,
          },
        },
      });
    }

    if (error instanceof ApiError) {
      return sendError(reply, error.statusCode, error.code, error.message, error.details);
    }

    if (isZodError(error)) {
      return sendError(reply, 422, "VALIDATION_ERROR", "Girdi doğrulama hatası.", flattenZodIssues(error.issues));
    }

    // `@fastify/multipart`'ın KENDİ `fileSize` limitine özel (bkz. plugins/uploads.ts global
    // 5MB VE modules/import/import.routes.ts route-level `request.parts({ limits: { fileSize
    // } })` override'ı — limit route'a göre değişir, bu yüzden burada limit'e özgü bir mesaj
    // (ör. "5MB") HARDCODE EDİLMEZ; her route kendi spesifik mesajını zaten kendi hata
    // yakalama/kontrol mantığında verir — bkz. import.routes.ts::PayloadTooLargeError). Bu dal
    // yalnızca son bir güvenlik ağıdır (ör. `request.file()` kullanan diğer route'lar için).
    // `@fastify/multipart` bu hatayı orijinalde 413 statüsüyle üretir (bkz. node_modules/
    // @fastify/multipart/index.js::RequestFileTooLargeError) — burada da 413 döndürülür.
    const fastifyErr = error as FastifyError & { retryAfterSeconds?: number };
    if (fastifyErr.code === "FST_REQ_FILE_TOO_LARGE") {
      return sendError(reply, 413, "PAYLOAD_TOO_LARGE", "Yüklenen dosya bu uç için izin verilen boyut sınırını aşıyor.");
    }

    // Fastify core'un `bodyLimit` kontrolü — multipart parser'a hiç ulaşmadan, ham istek
    // gövdesi (dosya + form alanları + multipart overhead) app.ts'teki (veya route-level
    // override'ı varsa onun) `bodyLimit`'i aşınca tetiklenir. `FST_REQ_FILE_TOO_LARGE` (üstteki
    // dal) multipart'ın KENDİ `fileSize` limitine özel; bu dal ise Fastify core seviyesindeki
    // 413'ü yakalar — aksi halde hiçbir branch'e uymayıp anlamsız bir 500'e düşerdi. Limit
    // route'a göre değiştiği için burada da spesifik bir boyut HARDCODE EDİLMEZ.
    if (fastifyErr.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return sendError(reply, 413, "PAYLOAD_TOO_LARGE", "İstek gövdesi bu uç için izin verilen boyut sınırını aşıyor.");
    }

    if (fastifyErr.validation) {
      const details: Record<string, string[]> = {};
      for (const v of fastifyErr.validation) {
        const key = (v.instancePath || v.params?.["missingProperty"] || "_").toString().replace(/^\//, "") || "_";
        (details[key] ??= []).push(v.message ?? "Geçersiz değer.");
      }
      return sendError(reply, 422, "VALIDATION_ERROR", "Girdi doğrulama hatası.", details);
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return sendError(reply, 409, "CONFLICT", "Bu kayıt zaten mevcut.");
    }

    // Serializable transaction write-conflict (bkz. admin-users.routes.ts::runSerializable) —
    // birkaç retry'dan sonra hâlâ çakışıyorsa istemciye 500 yerine anlamlı bir 409 dönülür.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return sendError(reply, 409, "CONFLICT", "İşlem başka bir eşzamanlı değişiklikle çakıştı. Lütfen tekrar deneyin.");
    }

    if (fastifyErr.statusCode === 429) {
      // `retryAfterSeconds` — plugins/security.ts::errorResponseBuilder tarafından hesaplanıp
      // throw edilen objeden gelir (Retry-After HTTP header'ı zaten @fastify/rate-limit
      // tarafından otomatik set edilir; burada aynı bilgiyi JSON gövdesine de somut olarak ekliyoruz).
      const retryAfterSeconds = fastifyErr.retryAfterSeconds;
      const message =
        typeof retryAfterSeconds === "number"
          ? `Çok fazla istek. ${retryAfterSeconds} saniye sonra tekrar deneyin.`
          : "Çok fazla istek. Lütfen birazdan tekrar deneyin.";
      return sendError(
        reply,
        429,
        "RATE_LIMITED",
        message,
        typeof retryAfterSeconds === "number" ? { retryAfterSeconds: [String(retryAfterSeconds)] } : undefined
      );
    }

    // Fastify core'un (veya content-type-parser/multipart gibi altyapı pluginlerinin) kendisinin
    // zaten geçerli bir 4xx `statusCode` ile ürettiği ama yukarıdaki hiçbir spesifik dala (ApiError,
    // Zod, validation, Prisma, 429) uymayan hatalar için genel bir ağ. Örn.
    // `FST_ERR_CTP_INVALID_CONTENT_LENGTH` (bozuk/uyumsuz Content-Length header'ı) Fastify
    // tarafından `statusCode: 400` ile bir FastifyError olarak fırlatılır — bu aslında bir istemci
    // hatasıdır ve aşağıdaki catch-all'a düşüp anlamsız bir 500'e dönüştürülmemelidir. Fastify'ın
    // verdiği statusCode korunur (spesifik bir ApiErrorCode karşılığı olmadığından "BAD_REQUEST"
    // ile sarılır); böylece gelecekte ortaya çıkabilecek benzer content-type-parser/multipart hata
    // kodları da yeni bir dal eklemeye gerek kalmadan otomatik doğru eşlenir. Yalnızca gerçekten
    // statusCode'u olmayan/beklenmeyen hatalar aşağıdaki 500 catch-all'a düşer.
    if (typeof fastifyErr.statusCode === "number" && fastifyErr.statusCode >= 400 && fastifyErr.statusCode < 500) {
      return sendError(reply, fastifyErr.statusCode, "BAD_REQUEST", error.message || "Geçersiz istek.");
    }

    request.log.error(error);
    reportUnexpectedError(error, request);
    return sendError(reply, 500, "INTERNAL_ERROR", "Beklenmeyen bir sunucu hatası oluştu.");
  });
});
