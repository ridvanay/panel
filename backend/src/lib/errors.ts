export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "EMAIL_DELIVERY_FAILED"
  /**
   * Fastify core'un (veya content-type-parser/multipart gibi altyapı pluginlerinin) kendisinin
   * zaten geçerli bir 4xx `statusCode` ile ürettiği ama daha spesifik bir ApiError/VALIDATION_ERROR/
   * PAYLOAD_TOO_LARGE/CONFLICT/RATE_LIMITED dalına uymayan hatalar için genel fallback — bkz.
   * plugins/error-handler.ts (ör. FST_ERR_CTP_INVALID_CONTENT_LENGTH: bozuk/uyumsuz Content-Length
   * header'ı, statusCode 400). Bu tür hatalar birer istemci hatasıdır, 500'e düşürülmemelidir.
   */
  | "BAD_REQUEST"
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
  /**
   * §10.20 — `details` opsiyonel olarak eklendi (`ValidationError` ile AYNI şekil) çünkü
   * `page-template-guard.ts::assertTemplateEditAllowed` ihlal eden `nodeId`/alan listesini
   * `error.details.blocks` altında taşımak zorunda (bkz.
   * `.claude/architect-scope-page-editor-roles.md` §3.4). Diğer tüm `ForbiddenError` kullanım
   * yerleri `details` GEÇMEZ ve davranış DEĞİŞMEZ (parametre opsiyonel).
   */
  constructor(message = "Bu işlem için yetkiniz yok.", details?: Record<string, string[]>) {
    super(403, "FORBIDDEN", message, details);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "Kaynak bulunamadı.") {
    super(404, "NOT_FOUND", message);
  }
}

export class ConflictError extends ApiError {
  constructor(message = "Kaynak çakışması.", details?: Record<string, string[]>) {
    super(409, "CONFLICT", message, details);
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

/**
 * `DELETE /admin/sliders/{sliderId}` referans koruması (§4.3, bağlayıcı) — openapi.yaml bu
 * ucun 409 gövdesinde `error.details.usedBy: SliderUsage[]` (ZENGİN nesne dizisi) taşır.
 * Genel `ConflictError`/`ApiError.details` alanı `Record<string, string[]>`e SABİTTİR (diğer
 * TÜM 30+ kullanım yerini etkileyecek bir genişletme YAPILMAZ) — bu yüzden BU TEK uç için
 * `usedBy` AYRI, tip-güvenli bir alanda taşınır ve `plugins/error-handler.ts` bunu özel bir
 * dalda (`instanceof SliderInUseError`) serileştirir.
 */
export class SliderInUseError extends ApiError {
  usedBy: unknown[];

  constructor(message: string, usedBy: unknown[]) {
    super(409, "CONFLICT", message);
    this.usedBy = usedBy;
  }
}

/**
 * `POST /admin/demo-templates/{templateKey}/import` idempotency çakışması (§6.4, bağlayıcı) —
 * openapi.yaml `error.details = { templateKey, importedAt, importedBy, version, pageId }`
 * genel `ApiError.details` (`Record<string, string[]>`) şekline SIĞMAZ, bu yüzden
 * `SliderInUseError` ile AYNI desende AYRI serileştirilir (bkz. plugins/error-handler.ts).
 */
export class DemoTemplateAlreadyImportedError extends ApiError {
  templateKey: string;
  importedAt: string;
  importedBy: string | null;
  version: string;
  pageId: string | null;

  constructor(info: { templateKey: string; importedAt: string; importedBy: string | null; version: string; pageId: string | null }) {
    super(409, "CONFLICT", "Bu demo şablonu daha önce uygulanmış. Yeniden uygulamak için `force: true` gönderin.");
    this.templateKey = info.templateKey;
    this.importedAt = info.importedAt;
    this.importedBy = info.importedBy;
    this.version = info.version;
    this.pageId = info.pageId;
  }
}

/**
 * SMTP gönderimi (bkz. lib/mail.ts::sendMail) başarısız olduğunda fırlatılır — 502 (Bad Gateway):
 * istemcinin isteği geçersiz değil, bizim upstream bağımlılığımız (SMTP sağlayıcısı) başarısız oldu.
 * `forgotPassword` gibi akışlarda kullanıcı bulunamadığında hâlâ sessizce 202 dönülür (e-posta
 * enumeration koruması bozulmaz) — bu hata SADECE kullanıcı var ama gerçek gönderim başarısız
 * olduğunda fırlatılır, böylece backend hatayı sessizce yutmaz.
 */
export class EmailDeliveryError extends ApiError {
  constructor(message = "E-posta gönderilemedi.") {
    super(502, "EMAIL_DELIVERY_FAILED", message);
  }
}
