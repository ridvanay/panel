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
  | "INTERNAL_ERROR"
  /**
   * `.claude/architect-scope-telehealth-template.md` §4.3/§8/§12 — `POST /appointments` çifte
   * rezervasyon çakışması. `@@unique([doctorId, startsAt])` ikinci savunma hattı (`P2002`) da
   * BU koda çevrilir (bkz. SlotTakenError). 409.
   */
  | "SLOT_TAKEN"
  /**
   * §4.5/§8/§12 — konsültasyon katılım penceresi (`startsAt - 5dk` … `endsAt + 15dk`) dışında
   * token isteği. integration-agent'ın `POST /appointments/{id}/meeting-token` ucu fırlatır
   * (bkz. `modules/telehealth/lib/booking.ts::isWithinJoinWindow` — SAF yardımcı, backend-agent
   * yazar ama bu uçta KULLANMAZ). 409.
   */
  | "APPOINTMENT_NOT_JOINABLE"
  /**
   * §4.4/§8/§12 — LiveKit ortam değişkenleri (`LIVEKIT_URL`/`LIVEKIT_API_KEY`/
   * `LIVEKIT_API_SECRET`) tanımsızken `POST /appointments/{id}/meeting-token`. Kod TÜRÜ burada
   * (paylaşılan dosya) ÖNCEDEN tanımlanır ki integration-agent bu dosyaya DOKUNMAK ZORUNDA
   * KALMASIN (§4.4 — o dosya/uç tamamen integration-agent'ın sahasıdır, backend-agent
   * FIRLATMAZ/KULLANMAZ). 503.
   */
  | "LIVEKIT_NOT_CONFIGURED"
  /**
   * `.claude/architect-scope-telehealth-template.md` §9.7.1/§9.7.10 (bağlayıcı) — booking zaten
   * `PAID`/`CANCELLED`/`EXPIRED` durumundayken tekrar ödeme/fatura/manuel-ödeme talebi (bkz.
   * `GET .../invoice`, `POST /admin/telehealth/bookings/{id}/mark-paid` — backend-agent'ın
   * uçları; integration-agent'ın `checkout-session` ucu da AYNI kodu KULLANIR). 409.
   */
  | "BOOKING_NOT_PAYABLE"
  /**
   * §9.7.5 KARAR J madde 2 (ENGELLEYİCİ, bağlayıcı) — sağlık verisi (şikâyet notu/belge) için
   * AYRI açık rıza (`healthDataConsent`) `true` gönderilmeden `PUT .../intake` veya
   * `POST .../documents`. 422.
   */
  | "HEALTH_CONSENT_REQUIRED"
  /**
   * §9.7.5 madde 4/uygulama kısıtı — beyan edilen `Content-Type` ile sihirli-bayt tespiti
   * uyuşmuyor VEYA MIME whitelist (`application/pdf`/`image/png`/`image/jpeg`) dışı (SVG DAHİL,
   * kesin reddedilir). 422.
   */
  | "UNSUPPORTED_DOCUMENT_TYPE"
  /** §9.7.5 uygulama kısıtı — booking başına en fazla 5 (silinmemiş) belge. 409. */
  | "DOCUMENT_LIMIT_REACHED"
  /**
   * §9.7.7 KARAR K madde 2 (bağlayıcı) — `/doctor/*` uçları `user.twoFactorEnabled !== true`
   * ise bu kodla 403 döner (yeni DB kolonu/2FA ucu YOK, mevcut TOTP kapısı route seviyesinde
   * uygulanır).
   */
  | "TWO_FACTOR_REQUIRED"
  /**
   * §9.7.7 KARAR K madde 1 (bağlayıcı) — `/doctor/*` uçlarına, `DoctorProfile.userId ===
   * user.id` ilişkisi OLMAYAN bir kullanıcı erişirse. 403. `SiteRole.DOCTOR` YOKTUR.
   */
  | "NOT_A_DOCTOR"
  /**
   * §9.7.1 madde 6/§9.7.10 (bağlayıcı, integration-agent) — `STRIPE_SECRET_KEY` boşken
   * `POST /appointments/bookings/{id}/checkout-session`. `LIVEKIT_NOT_CONFIGURED` İLE BİREBİR
   * AYNI dürüst-yapılandırılmamışlık deseni. 503.
   */
  | "PAYMENTS_NOT_CONFIGURED"
  /**
   * §9.7.1/§9.7.3/§9.7.10 (bağlayıcı, integration-agent) — booking'in slot tutma süresi
   * (`expiresAt`) dolmuşken `POST .../checkout-session`. `BOOKING_NOT_PAYABLE`'dan AYRI bir
   * koddur (booking hâlâ `paymentStatus: PENDING` görünebilir, süpürücü henüz çalışmamıştır). 409.
   */
  | "BOOKING_EXPIRED";

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
 * `.claude/architect-scope-telehealth-template.md` §4.3 (bağlayıcı) — "check-then-act" bulgusu
 * VEYA `@@unique([doctorId, startsAt])` (`P2002`) ikinci savunma hattı tarafından yakalanan
 * çifte rezervasyon çakışması. Genel `ConflictError`'dan AYRI bir sınıf: frontend'in
 * `error.code === "SLOT_TAKEN"` ile diğer 409'lardan (ör. genel `CONFLICT`) ayırt edebilmesi
 * ve kullanıcıya "bu saat az önce doldu, takvimi yenileyin" gibi ÖZEL bir mesaj gösterebilmesi
 * için (bkz. `modules/telehealth/lib/booking.ts::bookAppointment`).
 */
export class SlotTakenError extends ApiError {
  constructor(message = "Bu randevu saati az önce başka biri tarafından alındı.") {
    super(409, "SLOT_TAKEN", message);
  }
}

/**
 * §4.5/§8/§12 (bağlayıcı) — `POST /appointments/{id}/meeting-token` katılım penceresi dışında
 * (`now < startsAt - 5dk` VEYA `now > endsAt + 15dk`) YA DA randevu `SCHEDULED`/`IN_PROGRESS`
 * DIŞINDA bir durumdayken çağrılırsa fırlatılır (bkz.
 * `modules/telehealth/lib/booking.ts::isWithinJoinWindow`). 409.
 */
export class AppointmentNotJoinableError extends ApiError {
  constructor(message = "Bu randevuya şu anda katılım penceresi dışında olduğunuz için katılamazsınız.") {
    super(409, "APPOINTMENT_NOT_JOINABLE", message);
  }
}

/**
 * §4.4/§8/§12 (bağlayıcı) — `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`'ten biri
 * boşken `POST /appointments/{id}/meeting-token`. 503 (istemci hatası DEĞİL, sunucu
 * yapılandırma eksikliği).
 */
export class LiveKitNotConfiguredError extends ApiError {
  constructor(message = "Görüntülü görüşme altyapısı (LiveKit) bu kurulumda yapılandırılmamış.") {
    super(503, "LIVEKIT_NOT_CONFIGURED", message);
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

/**
 * `.claude/architect-scope-telehealth-template.md` §9.7.1/§9.7.10 (bağlayıcı) — booking
 * `paymentStatus` zaten `PAID`/`FAILED`/`EXPIRED`/`REFUNDED` iken ödeme/fatura/manuel-ödeme
 * işlemi denendiğinde. 409.
 */
export class BookingNotPayableError extends ApiError {
  constructor(message = "Bu rezervasyon ödeme kabul edecek/işlem görecek durumda değil.") {
    super(409, "BOOKING_NOT_PAYABLE", message);
  }
}

/**
 * §9.7.5 KARAR J madde 2 (ENGELLEYİCİ, bağlayıcı) — `healthDataConsent: true` gönderilmeden
 * şikâyet notu/belge kabul edilmez. 422. Randevu/ödeme KVKK onayından (`consent`) TAMAMEN AYRI
 * bir rızadır — KARIŞTIRILMAZ.
 */
export class HealthConsentRequiredError extends ApiError {
  constructor(message = "Sağlık verisi paylaşımı için ayrı açık rıza (healthDataConsent) gereklidir.") {
    super(422, "HEALTH_CONSENT_REQUIRED", message, { healthDataConsent: ["Bu alan zorunludur."] });
  }
}

/** §9.7.5 madde 4 — MIME whitelist dışı veya beyan/sihirli-bayt uyuşmazlığı (SVG dahil). 422. */
export class UnsupportedDocumentTypeError extends ApiError {
  constructor(message = "Dosya türü desteklenmiyor veya beyan edilen türle dosya içeriği uyuşmuyor.") {
    super(422, "UNSUPPORTED_DOCUMENT_TYPE", message, { file: [message] });
  }
}

/** §9.7.5 uygulama kısıtı — booking başına en fazla 5 (silinmemiş) belge. 409. */
export class DocumentLimitReachedError extends ApiError {
  constructor(message = "Bu rezervasyon için en fazla 5 belge yüklenebilir.") {
    super(409, "DOCUMENT_LIMIT_REACHED", message);
  }
}

/**
 * §9.7.7 KARAR K madde 2 (bağlayıcı) — `/doctor/*` uçları, oturumun `twoFactorEnabled` alanı
 * `true` OLMADIĞI sürece 403 döner. Yeni bir DB kolonu/2FA ucu YOKTUR — mevcut TOTP kurulum
 * uçları (`/admin/settings/security/2fa/*`) kullanılır.
 */
export class TwoFactorRequiredError extends ApiError {
  constructor(message = "Bu işlem için iki adımlı doğrulamanın (2FA) etkin olması gerekir.") {
    super(403, "TWO_FACTOR_REQUIRED", message);
  }
}

/**
 * §9.7.7 KARAR K madde 1 (bağlayıcı) — `DoctorProfile.userId === user.id` ilişkisi olmayan bir
 * kullanıcı `/doctor/*` uçlarına erişirse. `SiteRole.DOCTOR` EKLENMEZ; doktorluk bir İLİŞKİDİR.
 */
export class NotADoctorError extends ApiError {
  constructor(message = "Bu hesaba bağlı bir doktor profili bulunamadı.") {
    super(403, "NOT_A_DOCTOR", message);
  }
}

/**
 * `.claude/architect-scope-telehealth-template.md` §9.7.1 madde 6 / §9.7.10 (bağlayıcı) —
 * `STRIPE_SECRET_KEY` boşken `POST /appointments/bookings/{id}/checkout-session`.
 * `LiveKitNotConfiguredError` İLE BİREBİR AYNI dürüst-yapılandırılmamışlık deseni — sahte/mock
 * ödeme veya "escrow" ekranı YASAKTIR (§4.4 madde 1). 503 (istemci hatası DEĞİL).
 */
export class PaymentsNotConfiguredError extends ApiError {
  constructor(message = "Ödeme altyapısı (Stripe) bu kurulumda yapılandırılmamış.") {
    super(503, "PAYMENTS_NOT_CONFIGURED", message);
  }
}

/**
 * §9.7.1/§9.7.3/§9.7.10 (bağlayıcı) — `AppointmentBooking.expiresAt < now` (slot tutma süresi
 * dolmuş) iken `POST .../checkout-session` çağrılırsa. `BookingNotPayableError`'dan (zaten
 * PAID/FAILED/CANCELLED) AYRI bir koddur: booking hâlâ `paymentStatus: PENDING` görünüyor
 * olabilir (5 dakikalık süpürücü henüz çalışmamış olabilir) ama slot tutma süresi zaten
 * dolmuştur — istemciye bu ayrım açıkça iletilir. 409.
 */
export class BookingExpiredError extends ApiError {
  constructor(message = "Bu rezervasyonun slot tutma süresi doldu.") {
    super(409, "BOOKING_EXPIRED", message);
  }
}
