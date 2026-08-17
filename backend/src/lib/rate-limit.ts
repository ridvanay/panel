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
