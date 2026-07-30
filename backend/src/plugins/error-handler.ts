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

    const fastifyErr = error as FastifyError;
    if (fastifyErr.code === "FST_REQ_FILE_TOO_LARGE") {
      return sendError(reply, 422, "VALIDATION_ERROR", "Dosya çok büyük.", { file: ["En fazla 5MB yükleyebilirsiniz."] });
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
      return sendError(reply, 429, "RATE_LIMITED", "Çok fazla istek. Lütfen birazdan tekrar deneyin.");
    }

    request.log.error(error);
    return sendError(reply, 500, "INTERNAL_ERROR", "Beklenmeyen bir sunucu hatası oluştu.");
  });
});
