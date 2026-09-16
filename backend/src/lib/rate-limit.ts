/**
 * Şifre doğrulaması gerektiren hassas uçlar (brute-force hedefi olabilir) için paylaşılan
 * route-level rate limit sabiti. `env.RATE_LIMIT_MAX` (global limit, admin gezinme trafiğini
 * karşılayacak şekilde gevşetildi) tek başına yeterli değil — bu yüzden `auth.routes.ts::AUTH_RATE_LIMIT`
 * ile aynı pattern (route-level `config.rateLimit`) burada da uygulanır.
 *
 * Kullanan uçlar: `security.routes.ts` (2FA disable/backup-codes regenerate),
 * `users.routes.ts` (`POST /me/change-password`).
 */
export const SENSITIVE_ACTION_RATE_LIMIT = { max: 5, timeWindow: "1 minute" };

/**
 * `/uploads/*` (bkz. plugins/uploads.ts) — auth GEREKTİRMEYEN, herkese açık statik medya
 * servisi. `env.RATE_LIMIT_MAX`'tan (300/dk, admin panel navigasyonu için gevşetildi) daha
 * sıkı bir üst sınır: kimliksiz bir istemci global limitin tamamını tek başına (scraping/
 * kaba-kuvvet dosya keşfi/bant genişliği tüketimi amacıyla) harcayabilir. 60/dk normal bir
 * sayfa yüklemesini (birkaç görsel) rahatça karşılarken otomatize kötüye kullanımı sınırlar.
 */
export const UPLOADS_RATE_LIMIT = { max: 60, timeWindow: "1 minute" };

// ---------------------------------------------------------------------------
// §10.13 Üçüncü Parti Entegrasyon — API Anahtarları + Public API + Giden Webhook'lar.
// Değerler/isimler ARCHITECTURE.md §10.13.6 tablosuyla BAĞLAYICI olarak bire bir eşleşir.
// ---------------------------------------------------------------------------

/**
 * Katman 1 (IP tabanı, atlanamaz) — `/public/*` route-level `config.rateLimit`, VARSAYILAN
 * keyGenerator (IP) ile. `@fastify/rate-limit`'in `onRequest` hook'u `preHandler` tabanlı API
 * anahtarı doğrulamasından ÖNCE çalıştığı için burada anahtar id'sine göre kova ÜRETİLEMEZ
 * (bkz. ARCHITECTURE.md §10.13.6 — bu tuzağa düşülmemesi gerektiği açıkça belgelenmiştir).
 */
export const PUBLIC_API_IP_RATE_LIMIT = { max: 300, timeWindow: "1 minute" };

/** Katman 2 (doğrulanmış `ApiKey.id` başına kota) — bkz. lib/api-key-rate-limit.ts. */
export const PUBLIC_API_KEY_RATE_LIMIT = { max: 120, timeWindow: "1 minute" };

/** Katman 2 ile AYNI kova üzerinde ek ani-yük tavanı (bkz. lib/api-key-rate-limit.ts). */
export const PUBLIC_API_KEY_BURST_RATE_LIMIT = { max: 20, timeWindow: "1 second" };

/** `POST/PATCH/DELETE /admin/settings/api-keys*`, `.../revoke`. */
export const API_KEY_MANAGEMENT_RATE_LIMIT = { max: 10, timeWindow: "1 minute" };

/** `POST/PATCH/DELETE /admin/settings/webhooks*` (her biri DNS çözümlemesi tetikler). */
export const WEBHOOK_MANAGEMENT_RATE_LIMIT = { max: 20, timeWindow: "1 minute" };

/** `POST .../webhooks/{id}/test` — gerçek giden istek üretir, en güçlü kötüye kullanım vektörü. */
export const WEBHOOK_TEST_RATE_LIMIT = { max: 5, timeWindow: "1 minute" };

/** `POST .../deliveries/{id}/redeliver`. */
export const WEBHOOK_REDELIVER_RATE_LIMIT = { max: 10, timeWindow: "1 minute" };

// ---------------------------------------------------------------------------
// §10.16 E-posta Şablonu Blok Editörü + İletişim Formu — değerler/isimler
// ARCHITECTURE.md §10.16.6/§10.16.9 tablosuyla BAĞLAYICI olarak bire bir eşleşir.
// ---------------------------------------------------------------------------

/**
 * `POST /contact/submissions` — PUBLIC, kimlik doğrulama YOK, IP tabanlı (route-level
 * `config.rateLimit`, varsayılan keyGenerator). Honeypot (`website` alanı) ile BİRLİKTE
 * kullanılır — ikisi de tek başına yeterli değildir (§10.16.9 savunma derinliği).
 */
export const CONTACT_SUBMIT_RATE_LIMIT = { max: 5, timeWindow: "1 minute" };

/**
 * `POST /admin/notifications/templates/{templateId}/test-send` — ADMIN arkasında bile gerçek
 * bir SMTP gönderimi tetiklediği için (spam-relay/itibar riski, bkz. §10.16.6) diğer admin
 * uçlarından daha sıkı bir tavan.
 */
export const EMAIL_TEST_SEND_RATE_LIMIT = { max: 3, timeWindow: "1 minute" };

/**
 * `POST /admin/notifications/templates/preview` — güvenlik denetimi bulgusu (security-agent):
 * bu uç önceden hiçbir route-level `config.rateLimit`'e sahip değildi, yalnızca global
 * `env.RATE_LIMIT_MAX` (varsayılan 300/dk, TÜM `/admin/*` trafiğiyle PAYLAŞILAN bir kova) ile
 * korunuyordu. Uç DB'ye yazmasa da (durumsuz render) her çağrıda `siteSettings` + yayınlanmış
 * `Page` (KVKK footer) sorgusu çalıştırır ve editör 500ms debounce ile bunu ÇOK sık tetikler
 * (§10.16.6) — ADMIN oturumu ele geçirilmiş/kötü niyetli bir istemci bunu döngüye sokup DB'ye
 * gereksiz yük bindirebilir ve aynı kovayı paylaşan diğer admin uçlarını (dashboard, liste
 * sayfaları) da etkileyebilir (bir "gürültülü komşu" DoS'u). ADMIN arkasında olduğu için
 * `test-send`/`CONTACT_SUBMIT` kadar sıkı tutulmaz — editördeki gerçek kullanım paternini
 * (500ms debounce ≈ dakikada en fazla ~120 çağrı, insan tuş vuruşu hızıyla sınırlı) rahatça
 * karşılayacak, ama otomatize bir döngüyü sınırlayacak bir tavan.
 */
export const EMAIL_TEMPLATE_PREVIEW_RATE_LIMIT = { max: 120, timeWindow: "1 minute" };

/**
 * `POST /admin/settings/email/test` — `.claude/architect-scope-smtp-settings.md` §4.3.4 +
 * `.claude/security-review-smtp-settings.md` KARAR 3 (bağlayıcı). `EMAIL_TEST_SEND_RATE_LIMIT`
 * İLE AYNI değer/gerekçe (ADMIN arkasında bile gerçek bir SMTP bağlantısı/gönderimi tetikler);
 * KARAR 3'e göre TEK BAŞINA yeterli değildir — asıl kapatan katman test ucunun kaba hata
 * sınıflandırmasıdır (bkz. lib/mail.ts::classifyEmailTestError), bu yalnızca ek bir savunma katmanı.
 */
export const EMAIL_SMTP_TEST_RATE_LIMIT = { max: 3, timeWindow: "1 minute" };

// ---------------------------------------------------------------------------
// [TCT] §9.7 TADİLAT TURU 2 — booking (çoklu slot) + ödeme + sağlık verisi + portal.
// Değerler `.claude/architect-scope-telehealth-template.md` §9.7.10/§9.7.5 tablosuyla
// BAĞLAYICI olarak bire bir eşleşir.
// ---------------------------------------------------------------------------

/**
 * `POST /appointments/bookings` — public, kimlik doğrulamasız YAZMA ucu (§9.7.2). Mevcut
 * (tek slot, deprecated) `POST /appointments`'ın 5/dk route-level limitiyle AYNI — çoklu slot
 * olması hız sınırını DEĞİŞTİRMEZ (tek istekte en fazla 4 slot zaten kendi tavanıyla sınırlı).
 */
export const BOOKING_CREATE_RATE_LIMIT = { max: 5, timeWindow: "1 minute" };

/** `POST /appointments/bookings/{id}/documents` — §9.7.5 uygulama kısıtı. */
export const BOOKING_DOCUMENT_UPLOAD_RATE_LIMIT = { max: 10, timeWindow: "1 minute" };

/**
 * `POST /appointments/bookings/{id}/resend-link` — §9.7.7 madde 4. E-posta numaralandırma/
 * kaba-kuvvet yüzeyini sınırlamak için ÇOK sıkı (booking var olsun olmasın yanıt hep 202 döner,
 * ama gönderim tetikleyicisinin kendisi hâlâ sınırlanmalı).
 */
export const BOOKING_RESEND_LINK_RATE_LIMIT = { max: 1, timeWindow: "1 minute" };

/**
 * `POST /appointments/bookings/{id}/checkout-session` (integration-agent, §9.7.9/§9.7.10) —
 * gerçek bir Stripe API çağrısı tetikler (`checkout.routes.ts::CHECKOUT_RATE_LIMIT` İLE AYNI
 * değer/gerekçe: kaba kuvvet/otomatik Stripe session spam'ine karşı route-level sıkı tavan).
 */
export const BOOKING_CHECKOUT_SESSION_RATE_LIMIT = { max: 10, timeWindow: "1 minute" };

// ---------------------------------------------------------------------------
// [ASD] Canlı Destek (Support) — değerler `.claude/architect-scope-support-desk-and-reminders.md`
// §3.5/§3.6 madde 4 tablosuyla BAĞLAYICI olarak bire bir eşleşir.
// ---------------------------------------------------------------------------

/** `POST /support/sessions` — public, kimliksiz YAZMA ucu. Oturum+ilk mesajı BİRLİKTE açar. */
export const SUPPORT_SESSION_CREATE_RATE_LIMIT = { max: 3, timeWindow: "1 minute" };

/** `POST /support/sessions/{id}/messages` VE `POST /admin/support/sessions/{id}/messages`. */
export const SUPPORT_MESSAGE_RATE_LIMIT = { max: 10, timeWindow: "1 minute" };

/** `GET /support/sessions/{id}/messages` — ziyaretçi POLLING ucu (IP tabanı). */
export const SUPPORT_POLL_RATE_LIMIT = { max: 60, timeWindow: "1 minute" };

// ---------------------------------------------------------------------------
// E-posta OTP Doğrulaması + Misafir Randevudan Hesap Oluşturma — değer
// `.claude/architect-scope-guest-account-otp.md` §3.6 / `.claude/security-review-guest-account-otp.md`
// KARAR 6 (değişiklik gerekmiyor, ONAYLANDI) ile BAĞLAYICI olarak bire bir eşleşir.
// ---------------------------------------------------------------------------

/**
 * `POST /auth/resend-verification-code` — IP tabanlı (route-level `config.rateLimit`). **TEK
 * BAŞINA YETERSİZDİR** (bu uç, saldırganın IP'sinden bağımsız olarak KURBANIN posta kutusuna
 * e-posta göndertir) — asıl kapatan katman `lib/otp.ts::issueVerificationCode`'un HEDEF-BAŞINA
 * (userId+purpose) 60 sn cooldown + 24 saatte 5 kod tavanıdır; bu yalnızca IP seviyesinde
 * TAMAMLAYICI bir ek savunma katmanıdır.
 */
export const VERIFICATION_CODE_RESEND_RATE_LIMIT = { max: 2, timeWindow: "1 minute" };
