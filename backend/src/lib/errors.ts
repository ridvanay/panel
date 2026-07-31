export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  statusCode: number;
  code: ApiErrorCode;
  details?: Record<string, string[]>;

  constructor(statusCode: number, code: ApiErrorCode, message: string, details?: Record<string, string[]>) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = "Kimlik doğrulama gerekli.") {
    super(401, "UNAUTHORIZED", message);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = "Bu işlem için yetkiniz yok.") {
    super(403, "FORBIDDEN", message);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "Kaynak bulunamadı.") {
    super(404, "NOT_FOUND", message);
  }
}

export class ConflictError extends ApiError {
  constructor(message = "Kaynak çakışması.") {
    super(409, "CONFLICT", message);
  }
}

export class ValidationError extends ApiError {
  constructor(message = "Girdi doğrulama hatası.", details?: Record<string, string[]>) {
    super(422, "VALIDATION_ERROR", message, details);
  }
}

/** Fastify core'un `FST_ERR_CTP_BODY_TOO_LARGE` (413) hatası için kullanılan zarf — bkz. plugins/error-handler.ts. */
export class PayloadTooLargeError extends ApiError {
  constructor(message = "İstek gövdesi çok büyük.", details?: Record<string, string[]>) {
    super(413, "PAYLOAD_TOO_LARGE", message, details);
  }
}
