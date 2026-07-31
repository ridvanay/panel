import fp from "fastify-plugin";
import type { FastifyInstance, FastifyError } from "fastify";
import { Prisma } from "@prisma/client";
import { ApiError, ApiErrorCode } from "../lib/errors";

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

export default fp(async function errorHandlerPlugin(app: FastifyInstance) {
  app.setNotFoundHandler((request, reply) => {
    return sendError(reply, 404, "NOT_FOUND", `Uç nokta bulunamadı: ${request.method} ${request.url}`);
  });

  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (error instanceof ApiError) {
      return sendError(reply, error.statusCode, error.code, error.message, error.details);
    }

    if (isZodError(error)) {
      return sendError(reply, 422, "VALIDATION_ERROR", "Girdi doğrulama hatası.", flattenZodIssues(error.issues));
    }

    const fastifyErr = error as FastifyError & { retryAfterSeconds?: number };
    if (fastifyErr.code === "FST_REQ_FILE_TOO_LARGE") {
      return sendError(reply, 422, "VALIDATION_ERROR", "Dosya çok büyük.", { file: ["En fazla 5MB yükleyebilirsiniz."] });
    }

    // Fastify core'un `bodyLimit` kontrolü — multipart parser'a hiç ulaşmadan, ham istek
    // gövdesi (dosya + form alanları + multipart overhead) app.ts'teki `bodyLimit`'i aşınca
    // tetiklenir. `FST_REQ_FILE_TOO_LARGE` (üstteki dal) multipart'ın KENDİ `fileSize`
    // limitine özel; bu dal ise Fastify core seviyesindeki 413'ü yakalar — aksi halde
    // hiçbir branch'e uymayıp anlamsız bir 500'e düşerdi.
    if (fastifyErr.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return sendError(reply, 413, "PAYLOAD_TOO_LARGE", "İstek gövdesi çok büyük.", {
        file: ["En fazla 5MB yükleyebilirsiniz."],
      });
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

    request.log.error(error);
    return sendError(reply, 500, "INTERNAL_ERROR", "Beklenmeyen bir sunucu hatası oluştu.");
  });
});
