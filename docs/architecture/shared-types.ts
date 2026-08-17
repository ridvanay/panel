/**
 * Frontend ve backend ajanlarının ortak kullandığı JSON veri sözleşmesi.
 * Bu dosya "tek doğruluk kaynağıdır": backend response'ları ve frontend
 * fetch/axios katmanı bu tiplere göre yazılır. Şekil değişirse önce burada
 * ve ../ARCHITECTURE.md içinde güncellenir.
 */

// ---------- Ortak zarf (envelope) ----------

export interface ApiSuccess<T> {
  data: T;
  meta?: PaginationMeta | Record<string, unknown>;
}

export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Record<string, string[]>; // alan adı -> hata mesajları (422 doğrulama)
  };
}

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export interface PaginationMeta {
  nextCursor: string | null;
}

// ---------- Enum'lar ----------

export type MembershipRole = "OWNER" | "ADMIN" | "MEMBER";
export type MembershipStatus = "ACTIVE" | "INVITED" | "SUSPENDED";
export type InvitationStatus = "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
export type SubscriptionStatus =
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED"
  | "INCOMPLETE";

// `/admin/*` CMS uçları (pages, blog, media, settings, users, logs) için org'dan
// bağımsız site-geneli rol/durum. `MembershipRole` (organizasyon bazlı) ile
// KARIŞTIRILMAMALI — tamamen ayrı bir yetkilendirme ekseni.
export type SiteRole = "ADMIN" | "EDITOR" | "VIEWER";
export type SiteUserStatus = "ACTIVE" | "SUSPENDED";
export type AuditStatus = "SUCCESS" | "FAILURE" | "FORBIDDEN";
export type SocialPlatform =
  | "TWITTER"
  | "GITHUB"
  | "LINKEDIN"
  | "INSTAGRAM"
  | "FACEBOOK"
  | "YOUTUBE"
  | "OTHER";

// ---------- Varlıklar (entities) ----------

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerifiedAt: string | null; // ISO 8601
  role: SiteRole;
  createdAt: string;
}

/** `/admin/users` uçlarında dönen genişletilmiş kullanıcı DTO'su — yalnızca ADMIN görebilir. */
export interface AdminUser extends User {
  status: SiteUserStatus;
  lastLoginAt: string | null; // ISO 8601
}

export interface AuditLog {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string; // ör. "auth.login", "user.role_change", "settings.update", "GET /admin/pages"
  status: AuditStatus;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null; // ASLA token/URL/şifre içermez
  ipAddress: string | null;
  createdAt: string; // ISO 8601
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: string;
}

export interface Membership {
  id: string;
  userId: string;
  organizationId: string;
  role: MembershipRole;
  status: MembershipStatus;
  user: Pick<User, "id" | "name" | "email" | "avatarUrl">;
  createdAt: string;
}

export interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  role: MembershipRole;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
}

export interface Plan {
  id: string;
  name: string;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  currency: string; // ISO 4217, ör. "TRY"
  limits: Record<string, number>; // ör. { "maxMembers": 5, "maxProjects": 10 }
}

export interface Subscription {
  id: string;
  organizationId: string;
  plan: Plan;
  status: SubscriptionStatus;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

// ---------- Auth ----------

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresAt: string; // ISO 8601
  // refreshToken response body'de DÖNMEZ; httpOnly cookie olarak set edilir.
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface AuthSession {
  user: User;
  memberships: Array<Pick<Membership, "organizationId" | "role">>;
}

// ---------- Request body tipleri ----------

export interface CreateOrganizationRequest {
  name: string;
}

export interface UpdateOrganizationRequest {
  name?: string;
}

/**
 * `PATCH /users/me` — kendi profilini güncelleme. `email`/`role`/`status` BU UÇTAN
 * DEĞİŞTİRİLEMEZ. `avatarUrl: null` avatarı kaldırır; boş string `""` geçersizdir (422).
 */
export interface UpdateUserRequest {
  name?: string;
  avatarUrl?: string | null;
}

/**
 * `POST /users/me/change-password` — oturum açmış kullanıcının kendi şifresini
 * değiştirmesi. Başarıda 204 döner ve MEVCUT OTURUM HARİÇ tüm refresh token'lar iptal
 * edilir (bkz. ARCHITECTURE.md §10.6). `currentPassword` hatalıysa 401.
 * Yeni şifre tekrarı alanı yalnızca istemci tarafı doğrulamasıdır, gövdede gönderilmez.
 */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string; // min 8 karakter — RegisterRequest.password ile aynı kural
}

export interface CreateInvitationRequest {
  email: string;
  role: Exclude<MembershipRole, "OWNER">;
}

export interface UpdateMembershipRequest {
  role: Exclude<MembershipRole, "OWNER">;
}

export interface CreateCheckoutSessionRequest {
  planId: string;
  billingCycle: "monthly" | "yearly";
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSessionResponse {
  checkoutUrl: string;
}

export interface BillingPortalResponse {
  portalUrl: string;
}

// ---------- Admin: Kullanıcı Yönetimi / RBAC / Audit Log ----------

export interface CreateAdminUserRequest {
  name: string;
  email: string;
  role?: SiteRole; // varsayılan: EDITOR
}

export interface CreateAdminUserResponse {
  user: AdminUser;
  // MVP/dev-only: gerçek e-posta sağlayıcısı entegre edilene kadar şifre belirleme
  // bağlantısı response'ta döner (bkz. ARCHITECTURE.md §5).
  setPasswordUrl: string;
}

export interface UpdateAdminUserRoleRequest {
  role: SiteRole;
}

export interface UpdateAdminUserStatusRequest {
  status: SiteUserStatus;
}

export interface PermissionsMatrix {
  roles: readonly SiteRole[];
  modules: ReadonlyArray<{
    module: string;
    label: string;
    actions: Record<string, readonly SiteRole[]>;
  }>;
}

// ---------- Navigasyon / Header / Footer Yönetimi ----------
// Backend: modules/navigation/*, mappers/index.ts::toNavigationConfigDto.
// Public: GET /navigation. Admin: GET/PUT /admin/navigation (PUT yalnızca SiteRole=ADMIN).

/**
 * Hiyerarşik menü öğesi. Yapı DÜZ DİZİ + `parentId` ile ifade edilir (nested JSON ağacı
 * değil). Maksimum derinlik 2: `parentId` dolu bir öğe yalnızca `parentId === null` olan
 * bir kök öğeyi işaret edebilir. `order` kardeş-kapsamlıdır (aynı `parentId` grubu içinde
 * 0'dan artar). Sunucu diziyi `(parentId NULLS FIRST, order)` ile döner.
 */
export interface NavigationItem {
  id: string;
  label: string;
  href: string;
  /** Kardeşler arası sıra — global sıra DEĞİL. */
  order: number;
  /** Üst öğenin id'si; null = kök seviye. */
  parentId: string | null;
}

export interface SocialLink {
  id: string;
  platform: SocialPlatform;
  url: string;
  order: number;
}

export interface FooterLink {
  id: string;
  label: string;
  href: string;
  order: number;
}

export interface FooterColumn {
  id: string;
  title: string;
  order: number;
  links: FooterLink[];
}

export interface NavigationConfig {
  headerCtaLabel: string | null;
  headerCtaHref: string | null;
  footerCopyrightText: string | null;
  navigationItems: NavigationItem[];
  socialLinks: SocialLink[];
  footerColumns: FooterColumn[];
}

/**
 * PUT /admin/navigation body'si — tam değiştirme (replace) semantiği: dizi alanları
 * gönderilen haliyle DB'deki mevcut kayıtların tamamının yerini alır. `socialLinks`/
 * `footerColumns` için id istemciden gönderilmez (sunucu üretir); `navigationItems`
 * istisnadır — hiyerarşi aynı payload içinde çözülebilsin diye istemci UUID'yi `id`
 * olarak gönderir ve bu değer gerçek `NavigationItem.id` olur. `id` verilmezse sunucu
 * üretir, ancak bir `parentId` tarafından işaret edilen öğede zorunludur.
 * `href`/`url` alanları yalnızca `http(s)://`, `/` veya `#` ile başlayabilir
 * (bkz. navigation.schemas.ts::HrefSchema).
 */
export interface UpdateNavigationConfigRequest {
  headerCtaLabel?: string | null;
  headerCtaHref?: string | null;
  footerCopyrightText?: string | null;
  /** Tüm seviyelerin toplamı en fazla 20 öğe. Derinlik en fazla 2. */
  navigationItems: Array<Omit<NavigationItem, "id" | "parentId"> & { id?: string; parentId?: string | null }>;
  socialLinks: Array<Omit<SocialLink, "id">>;
  footerColumns: Array<{
    title: string;
    order: number;
    links: Array<Omit<FooterLink, "id">>;
  }>;
}

// ---------- §10.1 İçerik Sürüm Kontrolü (Revision History) ----------
// Backend: modules/revisions/*. Bkz. ARCHITECTURE.md §10.1.

export type ContentEntityType = "PAGE" | "BLOG_POST";

export interface ContentRevisionSummary {
  id: string;
  editedById: string | null;
  editedByName: string;
  createdAt: string; // ISO 8601
}

export interface ContentRevision extends ContentRevisionSummary {
  entityType: ContentEntityType;
  entityId: string;
  snapshot: Record<string, unknown>; // Page ya da BlogPost alan seti, bkz. §10.1
}

// ---------- §10.2 SEO & Social Card — Page/BlogPost'a eklenen alanlar ----------

export interface SeoFields {
  seoTitle: string | null;
  seoDescription: string | null;
  ogTitle: string | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
}

// ---------- §10.3 E-posta & Bildirim Şablonu Yöneticisi ----------
// Backend: modules/email-templates/*. Bkz. ARCHITECTURE.md §10.3.
//
// DİKKAT — bu bölümün tipleri §10.16 (E-posta Şablonu Blok Editörü) tarafından
// DEVRALINDI ve bu dosyanın SONUNDA yeniden tanımlandı. Buradaki eski tanımlar
// KALDIRILDI (TypeScript'te aynı adla iki `interface` bildirimi sessizce BİRLEŞİR
// (declaration merging) ve çelişkili modifier'lar derleme hatası verirdi):
//
//   - `EmailTemplateKey`   → KALDIRILDI. Şablonlar artık `id` ile adreslenir; `key`
//                            nullable'dır (yalnızca sistem şablonlarında dolu). Ayrıca
//                            bu union ZATEN HATALIYDI: `ORDER_CONFIRMATION` ve
//                            `ORG_INVITATION` seed'de var ama union'da yoktu.
//   - `EmailTemplate`      → §10.16 bölümüne taşındı (purpose/editorMode/blocks/… ile).
//   - `UpdateEmailTemplateRequest`   → §10.16 bölümüne taşındı.
//   - `PreviewEmailTemplateRequest`  → §10.16'da DURUMSUZ taslak önizleme gövdesi oldu.
//   - `PreviewEmailTemplateResponse` → §10.16 bölümüne taşındı.

// ---------- §10.4 Güvenlik & 2FA + Aktif Oturumlar ----------
// Backend: modules/security/*, auth.service.ts (login akışı). Bkz. ARCHITECTURE.md §10.4.

/** POST /auth/login başarılı ama 2FA açıksa döner (token YOK). */
export interface LoginRequiresTwoFactorResponse {
  requiresTwoFactor: true;
  challengeToken: string;
}

export interface VerifyTwoFactorRequest {
  challengeToken: string;
  code: string; // 6 haneli TOTP veya "XXXX-XXXX" backup kodu
}

export interface TwoFactorSetupResponse {
  otpauthUrl: string;
  qrCodeDataUrl: string; // data:image/png;base64,...
  setupToken: string; // 5 dk ömürlü, henüz DB'ye yazılmamış secret'ı taşır
}

export interface EnableTwoFactorRequest {
  setupToken: string;
  code: string;
}

export interface EnableTwoFactorResponse {
  backupCodes: string[]; // düz metin, YALNIZCA bu response'ta bir kez döner
}

export interface DisableTwoFactorRequest {
  password: string;
}

export interface RegenerateBackupCodesRequest {
  password: string;
}

export interface RegenerateBackupCodesResponse {
  backupCodes: string[];
}

export interface Session {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

// ---------- §10.5 Çoklu Dil & Yerelleştirme (i18n) ----------

export type ContentLocale = "EN"; // TR kanonik/varsayılan; şimdilik tek ek dil

export interface PageTranslation {
  title?: string;
  seoTitle?: string;
  seoDescription?: string;
  ogTitle?: string;
  canonicalUrl?: string;
  blocks?: unknown[];
}

export interface BlogPostTranslation {
  title?: string;
  seoTitle?: string;
  seoDescription?: string;
  ogTitle?: string;
  canonicalUrl?: string;
  excerpt?: string;
  contentHtml?: string;
}

export type PageTranslations = Partial<Record<ContentLocale, PageTranslation>>;
export type BlogPostTranslations = Partial<Record<ContentLocale, BlogPostTranslation>>;

// ---------- §10.7 İçerik Yönetim Listesi (Sayfalar & Blog ortak tablosu) ----------
// Bkz. ARCHITECTURE.md §10.7 + openapi.yaml tag Pages/Blog.
// Page ve BlogPost DTO'ları için ORTAK ek alanlar — iki varlıkta da birebir aynıdır.

/** Listelerde gösterilen minimum kullanıcı özeti (hassas alan taşımaz). */
export interface UserSummary {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export type SeoScoreIssueCode =
  | "SEO_TITLE_MISSING"
  | "SEO_TITLE_LENGTH"
  | "SEO_DESCRIPTION_MISSING"
  | "SEO_DESCRIPTION_LENGTH"
  | "COVER_IMAGE_MISSING"
  | "IMAGE_MISSING"
  | "IMAGE_ALT_MISSING"
  | "CONTENT_TOO_SHORT";

export interface SeoScoreIssue {
  /** Kararlı anahtar — frontend mantığı ve testler BUNA bağlanır. */
  code: SeoScoreIssueCode;
  /** Kullanıcıya gösterilecek Türkçe açıklama; metni değişebilir. */
  label: string;
}

/** Page ve BlogPost DTO'larına §10.7 ile eklenen alanlar. */
export interface ContentListFields {
  deletedAt: string | null; // ISO 8601; dolu = ÇÖPTE
  authorId: string | null;
  author: UserSummary | null;
  seoScore: number; // 0..100 — backend hesaplar, persist edilmez
  seoScoreIssues: SeoScoreIssue[];
}

/** Sekme sayaçları — sunucu hesaplar, istek filtrelerinden etkilenmez. */
export interface ContentCounts {
  all: number; // deletedAt IS NULL (çöp HARİÇ) = published + draft
  published: number;
  draft: number;
  trashed: number;
}

export interface ContentListMeta {
  nextCursor?: string | null;
  counts: ContentCounts;
}

/** `?trashed=` sorgu parametresi; varsayılan "exclude". */
export type TrashedFilter = "exclude" | "include" | "only";

export type BulkContentAction = "trash" | "restore" | "publish" | "draft" | "permanent-delete";

export interface BulkContentActionRequest {
  ids: string[]; // 1..100, sunucuda teklenir
  action: BulkContentAction;
}

export interface BulkContentActionResult {
  action: BulkContentAction;
  requestedCount: number;
  affectedCount: number;
  /** Uygulanamayan id'ler — kısmi başarı HATA DEĞİLDİR (yanıt yine 200). */
  skippedIds: string[];
}

// ---------- §10.13 Üçüncü Parti Entegrasyon: API Anahtarları ----------
// Backend: modules/api-keys/*, middleware/api-key-auth.ts, lib/api-key.ts.
// Bkz. ARCHITECTURE.md §10.13.3/§10.13.4 + openapi.yaml tag `ApiKeys`.

/**
 * `READ_WRITE` v1'de public katmanda gözlemlenebilir bir fark yaratmaz (yazma ucu
 * YOK) — enum ve scope kontrol hattı, ileride yazma eklendiğinde yeni bir yetki
 * ekseni icat edilmesin diye ŞİMDİDEN tanımlıdır.
 */
export type ApiKeyScope = "READ" | "READ_WRITE";

/** `REVOKED` SOFT iptaldir: satır silinmez, denetim izi korunur. */
export type ApiKeyStatus = "ACTIVE" | "REVOKED";

/**
 * `/admin/settings/api-keys` DTO'su. **Ham anahtarı ASLA içermez** — DB'de yalnızca
 * `sha256(rawKey)` saklanır. Ham değer YALNIZCA `CreateApiKeyResponse.plainKey`
 * içinde, bir kez döner.
 */
export interface ApiKey {
  id: string;
  name: string;
  description: string | null;
  /** Gizli OLMAYAN tanıtıcı parça: `cmsk_` + 12 hex. Doğrulamada indeks araması buna göre yapılır. */
  keyPrefix: string;
  /** Ham anahtarın son 4 karakteri. */
  last4: string;
  /** Sunucuda türetilen hazır gösterim: `${keyPrefix}…${last4}` — istemci kendi maskesini yazmaz. */
  maskedKey: string;
  scope: ApiKeyScope;
  status: ApiKeyStatus;
  lastUsedAt: string | null; // ISO 8601
  /** MASKELENMİŞ IP (lib/pii-mask.ts::maskIp) — ham IP DB'ye YAZILMAZ. */
  lastUsedIp: string | null;
  expiresAt: string | null; // null = süresiz
  revokedAt: string | null;
  createdById: string | null;
  /** Oluşturanın ADI. E-posta BİLİNÇLİ olarak dönmez. */
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateApiKeyRequest {
  name: string; // 1..100
  description?: string | null; // <=500
  scope?: ApiKeyScope; // varsayılan: "READ"
  expiresAt?: string | null; // verilirse GELECEKTE olmalı (422)
}

/**
 * `plainKey` YALNIZCA burada, BİR KEZ döner (`POST /admin/settings/api-keys`, 201).
 * İstemci bu değeri kalıcı state'e/localStorage'a YAZMAZ; kullanıcıya kopyalatıp
 * ekrandan kaldırır.
 */
export interface CreateApiKeyResponse {
  apiKey: ApiKey;
  /** `cmsk_<12hex>_<64hex>` (82 karakter). `X-Api-Key` header'ında aynen kullanılır. */
  plainKey: string;
}

/** Anahtarın KENDİSİ değiştirilemez — rotasyon = yeni anahtar + eskisini iptal. */
export interface UpdateApiKeyRequest {
  name?: string;
  description?: string | null;
  scope?: ApiKeyScope;
  expiresAt?: string | null;
}

// ---------- §10.13 Üçüncü Parti Entegrasyon: Giden (Outbound) Webhook'lar ----------
// Backend: modules/outbound-webhooks/*, lib/webhook-signature.ts, lib/ssrf-guard.ts.
// Bkz. ARCHITECTURE.md §10.13.7/§10.13.8/§10.13.9 + openapi.yaml tag `OutboundWebhooks`.
//
// DİKKAT: bu, `POST /webhooks/stripe` (BİZE GELEN, inbound) sisteminden TAMAMEN
// AYRIDIR. Çıplak `Webhook` adı hiçbir tipte kullanılmaz — belirsizdir.

/**
 * Wire gösterimi Prisma enum adıyla BİREBİR aynıdır (SCREAMING_SNAKE); ikinci bir
 * nokta-notasyonu (`blog_post.published`) gösterim BİLİNÇLİ olarak tanımlanmadı.
 *
 * `PING` gerçek bir olay değildir — yalnızca `POST .../test` üretir.
 * `*_PUBLISHED` olayları YALNIZCA duruma GEÇİŞTE tetiklenir (zaten yayındaki
 * içeriğin tekrar kaydedilmesi tetiklemez; onun için `*_UPDATED` vardır).
 */
export type WebhookEvent =
  | "PING"
  | "PAGE_PUBLISHED"
  | "BLOG_POST_PUBLISHED"
  | "BLOG_POST_UPDATED"
  | "PRODUCT_CREATED"
  | "PRODUCT_UPDATED"
  | "PRODUCT_DELETED"
  | "PORTFOLIO_ITEM_PUBLISHED"
  | "ORDER_CREATED"
  | "ORDER_PAID"
  | "ORDER_STATUS_CHANGED";

/** `DISABLED` = SİSTEM otomatik kapattı (20 art arda başarısızlık); elle geri açılır. */
export type OutboundWebhookStatus = "ACTIVE" | "PAUSED" | "DISABLED";

export type WebhookDeliveryStatus = "PENDING" | "SENDING" | "RETRYING" | "SUCCEEDED" | "FAILED";

/** Makine-okunur teslimat hata sınıfı — `errorMessage` (insan metni) İLE karıştırılmamalı. */
export type WebhookDeliveryErrorCode =
  | "timeout"
  | "dns_failure"
  | "connection_refused"
  | "tls_error"
  | "redirect_not_followed"
  | "ssrf_blocked"
  | "http_error"
  | "unknown";

/**
 * `GET /admin/settings/webhooks/events` öğesi — statik kod registry'sinden gelir
 * (`lib/webhook-events.ts`), DB'den DEĞİL. `PermissionsMatrix` ile aynı desen:
 * frontend olay listesini/etiketleri HARDCODE ETMEZ.
 */
export interface WebhookEventDefinition {
  event: WebhookEvent;
  label: string; // Türkçe, ör. "Blog yazısı yayınlandı"
  description: string;
  /** ör. `ORDER_*` → true. Arayüz bu bayrağa göre KVKK uyarısı gösterir. */
  containsPii: boolean;
  /** `data` şemasının referans adı (ör. "PublicBlogPost") — dokümantasyon amaçlı. */
  payloadSchema: string | null;
}

/** Secret ASLA dönmez — yalnızca `secretLast4`. */
export interface OutboundWebhook {
  id: string;
  name: string;
  description: string | null;
  url: string;
  secretLast4: string;
  events: WebhookEvent[];
  status: OutboundWebhookStatus;
  /** İlk başarılı gönderimde 0'lanır; 20'ye ulaşınca `status: "DISABLED"`. */
  consecutiveFailureCount: number;
  autoDisabledAt: string | null;
  lastTriggeredAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * `url` SSRF kurallarının TAMAMINDAN geçer (ARCHITECTURE.md §10.13.7): yalnızca
 * `https`, yalnızca port 443, literal IP yasak, iç/özel isim yasak, DNS'in
 * döndürdüğü TÜM adresler public unicast olmalı. İhlalde 422 + `details.url`.
 */
export interface CreateOutboundWebhookRequest {
  name: string; // 1..100
  description?: string | null;
  url: string; // <=2048
  events: WebhookEvent[]; // en az 1, boş dizi 422
  /** Oluştururken "DISABLED" GÖNDERİLEMEZ (422) — o değeri yalnızca sistem üretir. */
  status?: Exclude<OutboundWebhookStatus, "DISABLED">;
}

/** `plainSecret` YALNIZCA burada (ve rotasyonda), BİR KEZ döner. */
export interface CreateOutboundWebhookResponse {
  webhook: OutboundWebhook;
  /** `whsec_<64hex>`. DB'de AES-256-GCM ile ŞİFRELİ saklanır (hash DEĞİL — HMAC için geri çözülebilir olmak zorunda). */
  plainSecret: string;
}

/** `status: "ACTIVE"` göndermek otomatik kapatılmış bir webhook'u açar ve sayacı 0'lar. */
export interface UpdateOutboundWebhookRequest {
  name?: string;
  description?: string | null;
  url?: string;
  events?: WebhookEvent[];
  status?: Exclude<OutboundWebhookStatus, "DISABLED">;
}

export interface RotateWebhookSecretResponse {
  webhook: OutboundWebhook;
  /** Eski secret ANINDA geçersizdir — grace period YOKTUR. */
  plainSecret: string;
}

/** `POST .../test` ve `POST .../deliveries/{id}/redeliver` ortak yanıtı (202, asenkron). */
export interface EnqueueWebhookDeliveryResponse {
  deliveryId: string;
}

/** Liste DTO'su — `payload`/`responseBodySnippet` TAŞIMAZ (detay ucunda döner). */
export interface WebhookDeliverySummary {
  /** `X-Webhook-Delivery` header'ında gönderilen değer — alıcının idempotency anahtarı. */
  id: string;
  event: WebhookEvent;
  status: WebhookDeliveryStatus;
  attemptCount: number;
  maxAttempts: number; // 5
  nextAttemptAt: string | null;
  responseStatus: number | null;
  errorCode: WebhookDeliveryErrorCode | null;
  errorMessage: string | null;
  durationMs: number | null;
  containsPii: boolean;
  redeliveryOfId: string | null;
  firstAttemptAt: string | null;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface WebhookDelivery extends WebhookDeliverySummary {
  /** Redakte edilmişse (`containsPii` + 7 gün) `{ redacted: true }` olur; redeliver 409 döner. */
  payload: WebhookPayloadEnvelope<unknown> | { redacted: true };
  /** Alıcı yanıtının İLK 512 karakteri — tam gövde ASLA saklanmaz. */
  responseBodySnippet: string | null;
}

/**
 * Giden POST gövdesi — TÜM olaylarda aynı zarf.
 *
 * İmza (ARCHITECTURE.md §10.13.9, bağlayıcı):
 *   signedPayload = `${timestamp}.${rawBody}`
 *   X-Webhook-Signature: `sha256=${HMAC_SHA256(secret, signedPayload) as lowercase hex}`
 * `rawBody`, gönderilen baytlarla BİREBİR aynı dize olmalıdır (tek `JSON.stringify`).
 */
export interface WebhookPayloadEnvelope<TData = unknown> {
  /** = `WebhookDelivery.id` = `X-Webhook-Delivery`. Alıcı bunu idempotency anahtarı olarak kullanır. */
  id: string;
  event: WebhookEvent;
  apiVersion: "v1";
  createdAt: string;
  /** Public API DTO'suyla AYNI şekil — istisnalar: ORDER_* / PRODUCT_DELETED / PING. */
  data: TData;
}

/**
 * `ORDER_*` olaylarının `data`'sı. `Order` (admin DTO) İLE KARIŞTIRILMAMALI:
 * burada `customerEmail` MASKELENMEZ — alıcının siparişi kendi sisteminde
 * eşleştirmesi bu olayın varlık sebebidir. `containsPii: true` işaretlenir.
 */
export interface WebhookOrderPayload {
  id: string;
  orderNumber: string;
  status: string; // OrderStatus
  /** Yalnızca ORDER_STATUS_CHANGED olayında dolar. */
  previousStatus: string | null;
  customerEmail: string;
  customerName: string | null;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  paidAt: string | null;
  createdAt: string;
  items: Array<{
    productSlug: string | null;
    productTitle: string;
    productSku: string | null;
    unitPriceCents: number;
    quantity: number;
    lineTotalCents: number;
  }>;
}

// ---------- §10.13.5 Public API (`/api/v1/public/*`) DTO'ları ----------
// Backend: modules/public-api/*. Bkz. ARCHITECTURE.md §10.13.5 + openapi.yaml tag `PublicApi`.
//
// ORTAK KURAL (ihlali bir GÜVENLİK BULGUSUDUR): bu tiplerin HİÇBİRİ `author`,
// `authorId`, `seoScore`, `seoScoreIssues`, `deletedAt`, `viewCount`, `translations`
// ya da `localizations` alanı TAŞIMAZ. Sebep: (1) admin DTO'larındaki `author`
// (`UserSummary`) PERSONEL E-POSTASI içerir ve üçüncü parti bir entegratöre
// gönderilemez, (2) dış kontrat iç refactor'lardan yalıtılmalıdır.
//
// Kimlik doğrulama: `X-Api-Key: cmsk_…` (TEK biçim; `Authorization: Bearer` 401).

export interface PublicApiKeyInfo {
  name: string;
  scope: ApiKeyScope;
  expiresAt: string | null;
  /** Katman 2 (anahtar başına kota) — `x-ratelimit-*` header'larıyla AYNI değerler. */
  rateLimit: {
    limit: number; // 120/dk
    remaining: number;
    resetSeconds: number;
  };
}

export interface PublicCategory {
  id: string;
  name: string;
  slug: string;
}

/** Tüm public içerik DTO'larında birebir aynı SEO alan kümesi (§10.2). */
export interface PublicSeoFields {
  seoTitle: string | null;
  seoDescription: string | null;
  ogTitle: string | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
}

export interface PublicImage {
  url: string;
  altText: string | null;
  order: number;
}

export interface PublicPage extends PublicSeoFields {
  id: string;
  title: string;
  slug: string;
  blocks: unknown[];
  /** true + istenen dilde çeviri yoksa `blocks` BOŞ döner (KVKK m.10 / GDPR m.12). */
  isLegalDocument: boolean;
  publishedAt: string | null;
  updatedAt: string;
}

export interface PublicBlogPost extends PublicSeoFields {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  contentHtml: string; // sunucuda sanitize edilmiş
  coverImageUrl: string | null;
  category: PublicCategory | null;
  publishedAt: string | null;
  updatedAt: string;
}

export interface PublicProduct extends PublicSeoFields {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  descriptionHtml: string;
  priceCents: number; // HER ZAMAN kuruş — float YOK
  discountPriceCents: number | null;
  currency: string;
  /** Decimal(5,2) string olarak serileştirilir. KDV fiyata DAHİL. */
  taxRatePercent: string | null;
  sku: string | null;
  /**
   * `stockQuantity` YERİNE türetilmiş boolean (bağlayıcı, §10.13.5): ham stok adedi
   * ticari bir bilgidir; entegratörün ihtiyacı "satılabilir mi?" sorusudur.
   */
  inStock: boolean;
  coverImageUrl: string | null;
  images: PublicImage[];
  category: PublicCategory | null;
  publishedAt: string | null;
  updatedAt: string;
}

export interface PublicPortfolioItem extends PublicSeoFields {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  contentHtml: string;
  clientName: string | null;
  projectUrl: string | null;
  completedAt: string | null;
  /** Manuel sıra — liste ucu BUNA göre `asc` sıralar (§10.9.4). */
  order: number;
  coverImageUrl: string | null;
  images: PublicImage[];
  category: PublicCategory | null;
  publishedAt: string | null;
  updatedAt: string;
}

// ---------- §10.14 Blog Etiketleri (Tag) ----------
// Backend: modules/blog/*. Bkz. ARCHITECTURE.md §10.14 + openapi.yaml tag `Blog`.
//
// Kategori (`BlogCategory`) = TEK birincil sınıflandırma (bire-çok).
// Etiket (`BlogTag`)        = ÇOKLU yatay sınıflandırma (çoka-çok, `blog_post_tags`).
// İkisi birbirinin yerine geçmez; UI'da da ayrı alan/ayrı sütundur.

export interface BlogTag {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  /**
   * Bu etiketi taşıyan, ÇÖPTE OLMAYAN (`deletedAt: null`) yazı sayısı. `0` = yetim
   * etiket; yetimler OTOMATİK SİLİNMEZ (§10.14.2) — bu alan onları görünür kılar.
   *
   * YALNIZCA `GET /admin/blog/tags` yanıtında doldurulur. `BlogPost.tags[]` içinde
   * gömülü gelen etiketlerde BULUNMAZ (yazı başına N+1 sorgu doğururdu).
   */
  postCount?: number;
}

export interface CreateBlogTagRequest {
  name: string;
  /** Verilmezse `slugify(name)`. Çakışırsa 409 CONFLICT (global P2002 işleyicisi). */
  slug?: string;
}

export interface UpdateBlogTagRequest {
  /** `name` değişince `slug` OTOMATİK türetilmez — slug URL kimliğidir. */
  name?: string;
  slug?: string;
}

/**
 * `BlogPost` DTO'suna eklenen alan. HER ZAMAN dizi (`[]` olabilir, `null` OLAMAZ),
 * sıra deterministik: `seq ASC`.
 */
export interface BlogPostTagsField {
  tags: BlogTag[];
}

/**
 * `CreateBlogPostRequest` / `UpdateBlogPostRequest` gövdelerine eklenen alan.
 *
 * SEMANTİK (bağlayıcı, §10.14.4): TAM SET (replace), delta DEĞİL.
 *   `tagIds: ["a","b"]` → yazının etiketleri tam olarak {a,b} olur, diğerleri kalkar.
 *   `tagIds: []`        → tüm etiketler kaldırılır.
 *   `tagIds: undefined` → etiketlere DOKUNULMAZ (alan hiç gönderilmemiş demektir).
 * `[]` ile `undefined` arasındaki bu fark, Hızlı Düzenle'nin kısmi gövde
 * sözleşmesinin dayandığı noktadır — ikisi AYNI ŞEY DEĞİLDİR.
 *
 * En fazla 50 id. Var olmayan id → 422. Tekrarlar sunucuda tekilleştirilir.
 */
export interface BlogPostTagIdsInput {
  tagIds?: string[];
}

// ---------- §10.7.2 Hızlı Düzenle — entity'ye özgü genişletme ----------
// ORTAK tip DEĞİŞMEZ; genişletme generic parametreyle yapılır ki `Page`/`Product`/
// `PortfolioItem` hiç var olmayan alanları tipte taşımasın.
//
//   useContentList<T extends ContentListEntity, Q extends QuickEditValues = QuickEditValues>
//   ContentListTable<T extends ContentListEntity, Q extends QuickEditValues = QuickEditValues>
//
// Varsayılan `QuickEditValues` olduğu için mevcut çağrı yerleri DEĞİŞMEZ.

/** Tüm içerik listelerinin paylaştığı Hızlı Düzenle alanları — DEĞİŞTİRİLMEZ. */
export interface QuickEditValuesBase {
  title: string;
  slug: string;
  status: "DRAFT" | "PUBLISHED" | "SCHEDULED";
}

/** YALNIZCA blog listesi kullanır. `Page` bu tipi ASLA görmez. */
export interface BlogQuickEditValues extends QuickEditValuesBase {
  /** `""` DEĞİL `null` — `PATCH /admin/blog/{postId}` gövdesiyle birebir. */
  categoryId: string | null;
  /** TAM set (bkz. `BlogPostTagIdsInput`). */
  tagIds: string[];
}

// ---------- §10.15 İçerik editörü Galeri bloğu ----------
// YENİ PRISMA ALANI YOKTUR — galeri, `BlogPost.contentHtml` içindeki bir TipTap
// node'udur (bkz. ARCHITECTURE.md §10.15.1).
//
// KRİTİK: `lib/html-sanitize.ts` global öznitelik izin listesi ["id","class"]'tır;
// `data-*` öznitelikleri DB'ye yazılmadan ÖNCE SESSİZCE SİLİNİR. Bu yüzden galeri
// `data-*` ile DEĞİL, SINIF tabanlı semantik HTML olarak serileşir:
//
//   <div class="blog-gallery blog-gallery--grid">
//     <figure class="blog-gallery__item"><img src="…" alt="…" loading="lazy" /></figure>
//   </div>
//
// Kullanılan etiket/öznitelerin tamamı mevcut allow-list'te ZATEN vardır → sanitizer
// DEĞİŞTİRİLMEZ, `data-*` AÇILMAZ. Sınıf adları kontratın parçasıdır (TipTap
// `parseHTML` eşleşmesi bunlara bağlıdır) ve ui-designer tarafından değiştirilemez.

/** v1'de yalnızca "grid" — carousel reddedildi (§10.15.2), alan ileriye dönük tutuldu. */
export type BlogGalleryLayout = "grid";

/** TipTap node attrs — YALNIZCA bellekte; HTML'e sınıf+`img` olarak serileşir. */
export interface BlogGalleryNodeAttrs {
  /** Medya id'si TAŞINMAZ (`data-*` sanitize edilir) — kimlik URL'dir. */
  items: { src: string; alt: string }[];
  layout: BlogGalleryLayout;
}

// ---------------------------------------------------------------------------
// §10.16 E-posta Şablonu Blok Editörü + İletişim Formu
// (bkz. ARCHITECTURE.md §10.16, openapi.yaml tag: EmailTemplates / ContactForms)
// ---------------------------------------------------------------------------

// KRİTİK KISIT (§10.16.4 — §10.15.2 ile AYNI SINIF hata):
// `lib/html-sanitize.ts` global öznitelik izin listesi ["id","class"]'tır; `style`
// özniteliği allow-list DIŞIDIR ve DB'ye yazılmadan ÖNCE SESSİZCE SİLİNİR. E-posta
// HTML'i ise satır-içi `style` OLMADAN çalışmaz (Gmail `<style>`ı, Outlook `class`ı
// güvenilir şekilde desteklemez). Sonuç:
//   1. E-posta gövde HTML'i İSTEMCİDEN ASLA KABUL EDİLMEZ — istemci yalnızca yapısal
//      `EmailBlock[]` gönderir, HTML'i sunucu üretir (`lib/email-renderer.ts`).
//   2. `sanitizeRichHtml` bu iş için GEVŞETİLMEZ (`style` açmak tüm blog/sayfa içeriği
//      için CSS enjeksiyon yüzeyi açardı). Blok içi zengin metin AYRI ve DAHA DAR bir
//      allow-list'ten geçer: `sanitizeEmailRichText()`.
//   3. Satır-içi stiller kullanıcı girdisinden DEĞİL, doğrulanmış token'lardan üretilir
//      (enum hizalama, `^#[0-9a-fA-F]{6}$` renk, `none|sm|md|lg` boşluk).

export type EmailTemplatePurpose =
  | "WELCOME"
  | "PASSWORD_RESET"
  | "SYSTEM_ANNOUNCEMENT"
  | "ORDER_CONFIRMATION"
  | "ORG_INVITATION"
  | "CONTACT_FORM_NOTIFICATION"
  | "CUSTOM";

/**
 * RAW = §10.3'ten devralınan ham HTML şablonu (seed'lenmiş 5 sistem şablonu; davranış
 * BİT DÜZEYİNDE korunur). BLOCKS = §10.16 blok editörü. Yeni şablonlar HER ZAMAN
 * BLOCKS olarak oluşturulur; mod sonradan DEĞİŞTİRİLEMEZ.
 */
export type EmailTemplateEditorMode = "RAW" | "BLOCKS";

export type EmailBlockType =
  | "logo-header"
  | "heading"
  | "text"
  | "button"
  | "image"
  | "divider"
  | "footer";

export type EmailBlockAlign = "left" | "center" | "right";
export type EmailBlockSpacing = "none" | "sm" | "md" | "lg";

export interface EmailBlockStyle {
  align: EmailBlockAlign;
  /** ^#[0-9a-fA-F]{6}$ */
  backgroundColor: string | null;
  /** ^#[0-9a-fA-F]{6}$ */
  textColor: string | null;
  paddingY: EmailBlockSpacing;
  paddingX: EmailBlockSpacing;
}

interface EmailBlockBase {
  /** İstemcinin ürettiği uuid — dnd-kit sıralama anahtarı. */
  id: string;
  type: EmailBlockType;
  style: EmailBlockStyle;
}

export interface EmailLogoHeaderBlock extends EmailBlockBase {
  type: "logo-header";
  /** `useSiteLogo` iken `SiteSettings.logoUrl` render anında okunur; logo yoksa blok HİÇ render edilmez. */
  data: { useSiteLogo: boolean; logoUrl: string | null; height: number };
}

export interface EmailHeadingBlock extends EmailBlockBase {
  type: "heading";
  /** `text` değişken (`{{...}}`) kabul eder. */
  data: { text: string; level: 1 | 2 | 3 };
}

export interface EmailTextBlock extends EmailBlockBase {
  type: "text";
  /** `sanitizeEmailRichText()` ile temizlenir; değişken kabul eder. */
  data: { html: string };
}

export interface EmailButtonBlock extends EmailBlockBase {
  type: "button";
  /**
   * `label` ve `href` değişken kabul eder. `href` ya http(s)/mailto olmalı ya da
   * TAMAMEN tek bir değişken olmalıdır (`^\{\{\w+\}\}$`); javascript:/data: reddedilir.
   */
  data: {
    label: string;
    href: string;
    backgroundColor: string | null;
    textColor: string | null;
    radius: "none" | "sm" | "full";
  };
}

export interface EmailImageBlock extends EmailBlockBase {
  type: "image";
  /** `alt` ZORUNLU — e-posta istemcileri görselleri varsayılan olarak engeller, alt metin tek okunabilir içeriktir. */
  data: { mediaId: string | null; url: string; alt: string; width: number | null };
}

export interface EmailDividerBlock extends EmailBlockBase {
  type: "divider";
  data: { thickness: 1 | 2 | 4; color: string | null };
}

/**
 * Kullanıcının EK footer'ı (adres/imza). Zorunlu KVKK footer'ının YERİNE GEÇMEZ:
 * `renderEmailTemplate()` bu bloktan BAĞIMSIZ olarak çıktının en sonuna site adı +
 * yayınlanan `Page.isLegalDocument` sayfalarının bağlantılarını ekler. Kullanıcı
 * bunu silemez/kapatamaz (§10.16.4, compliance kancası).
 */
export interface EmailFooterBlock extends EmailBlockBase {
  type: "footer";
  data: { text: string };
}

/** E-posta blok listesi DÜZDÜR — iç içe blok YOKTUR (§10.17'nin `columns`'u ile karıştırılmamalı). */
export type EmailBlock =
  | EmailLogoHeaderBlock
  | EmailHeadingBlock
  | EmailTextBlock
  | EmailButtonBlock
  | EmailImageBlock
  | EmailDividerBlock
  | EmailFooterBlock;

/**
 * `lib/email-variables.ts` statik registry'si (permissions-matrix/module-registry ile
 * AYNI desen). Frontend değişken listesini HARDCODE ETMEZ.
 *
 * MİMAR HAKEMLİĞİ (§10.16.1): `key` İngilizce snake_case'tir (mevcut seed + çağrı
 * yerleriyle uyum ZORUNLU — `user_name`/`reset_link` değiştirilirse üretimdeki şifre
 * sıfırlama akışı sessizce bozulur). `label` Türkçedir ve UI'da BİRİNCİL gösterilir.
 */
export interface EmailVariableDefinition {
  key: string;
  label: string;
  sampleValue: string;
  /** `contact-field` = iletişim formu alanından TÜRETİLDİ (otomatik, ek işlem gerekmez). */
  source: "system" | "custom" | "contact-field";
}

/**
 * Kullanıcı tanımlı değişken (şablon başına en fazla 20).
 * `key` ASCII OLMAK ZORUNDA: `lib/template-render.ts` kalıbı `/\{\{(\w+)\}\}/g`, JS `\w`
 * = [A-Za-z0-9_]. `{{kullanici_adi}}` ÇALIŞIR, `{{calisan_adi}}` çalışır ama Türkçe
 * karakterli bir anahtar (ör. ç/ş/ı içeren) SESSİZCE render EDİLMEZ.
 * Doğrulama: ^[a-z][a-z0-9_]{0,39}$
 */
export interface EmailCustomVariable {
  key: string;
  label: string;
  sampleValue: string;
}

export interface EmailTemplateSummary {
  id: string;
  /** Yalnızca `isSystem` satırlarda dolu (seed idempotency'si); kullanıcı şablonlarında null. */
  key: string | null;
  name: string;
  purpose: EmailTemplatePurpose;
  editorMode: EmailTemplateEditorMode;
  /** Seed'lenmiş çekirdek şablon — SİLİNEMEZ (403). */
  isSystem: boolean;
  /** `purpose !== "CUSTOM"` için amaç başına EN FAZLA BİR true (§10.16.3). */
  isActive: boolean;
  subject: string;
  updatedAt: string;
  createdAt: string;
}

export interface EmailTemplate extends EmailTemplateSummary {
  /** Yalnızca editorMode=RAW için anlamlı; BLOCKS'ta "" (render ÖNBELLEKLENMEZ, §10.16.2). */
  bodyHtml: string;
  blocks: EmailBlock[];
  /** Salt bilgi amaçlı; istemciden ARTIK KABUL EDİLMEZ, registry'den türetilir. */
  availableVariables: string[];
  customVariables: EmailCustomVariable[];
  /** HESAPLANMIŞ (DB'de yok): sistem + global + custom + contact-field. Değişken panelinin TEK kaynağı. */
  variables: EmailVariableDefinition[];
}

export interface CreateEmailTemplateRequest {
  name: string;
  purpose: EmailTemplatePurpose;
  subject?: string;
  blocks?: EmailBlock[];
}

export interface UpdateEmailTemplateRequest {
  name?: string;
  subject?: string;
  /** YALNIZCA editorMode=RAW şablonlarda kabul edilir (aksi halde 422). */
  bodyHtml?: string;
  /** YALNIZCA editorMode=BLOCKS şablonlarda kabul edilir (aksi halde 422). */
  blocks?: EmailBlock[];
  customVariables?: EmailCustomVariable[];
  /**
   * YALNIZCA purpose=CUSTOM şablonlarda kabul edilir (aksi halde 422) — CUSTOM'da amaç
   * başına tek-aktif kuralı UYGULANMAZ, bu yüzden burada doğrudan değiştirilebilir.
   * purpose != CUSTOM şablonlarda aktiflik YALNIZCA POST .../activate ile değişir
   * (§10.16.3 teklik kuralı). Bu alan olmadan bir CUSTOM şablon bir kez aktif
   * edildikten sonra deaktif/silinemez hale gelirdi (qa-agent bulgusu, 2026-08-17).
   */
  isActive?: boolean;
}

/** DURUMSUZ taslak önizleme — kaydedilmemiş editör durumunu taşır (500 ms debounce). */
export interface PreviewEmailTemplateRequest {
  purpose: EmailTemplatePurpose;
  editorMode: EmailTemplateEditorMode;
  subject: string;
  blocks?: EmailBlock[];
  bodyHtml?: string;
  customVariables?: EmailCustomVariable[];
  /** Verilmeyen değişkenler için registry'deki `sampleValue` kullanılır. */
  sampleValues?: Record<string, string>;
}

export interface PreviewEmailTemplateResponse {
  renderedSubject: string;
  /**
   * Satır-içi stilli e-posta HTML'i — `sanitizeRichHtml`'den GEÇMEZ (geçemez).
   * İstemci bunu `dangerouslySetInnerHTML` ile BASMAZ; `<iframe sandbox="" srcDoc>`
   * içinde gösterir (savunma derinliği + admin CSS bağlamından yalıtım).
   */
  renderedHtml: string;
}

/** `to` alanı BİLİNÇLİ OLARAK YOKTUR — alıcı her zaman `request.user.email` (§10.16.6). */
export interface TestSendEmailTemplateRequest {
  sampleValues?: Record<string, string>;
}

export interface TestSendEmailTemplateResponse {
  sentTo: string;
  messageId: string;
  /** Yalnızca dev (Ethereal) ortamında dolu — bkz. lib/mail.ts. */
  previewUrl?: string | null;
}

// ---- İletişim Formu ----

export type ContactFieldType = "TEXT" | "EMAIL" | "PHONE" | "TEXTAREA" | "SELECT" | "CHECKBOX";
export type ContactSubmissionStatus = "NEW" | "READ" | "ARCHIVED" | "SPAM";

export interface ContactFormFieldOption {
  value: string;
  label: string;
}

export interface ContactFormField {
  id: string;
  order: number;
  /** ^[a-z][a-z0-9_]{0,39}$ — şablonda `{{key}}` olarak OTOMATİK değişken olur. */
  key: string;
  label: string;
  type: ContactFieldType;
  required: boolean;
  placeholder: string | null;
  helpText: string | null;
  /** Yalnızca SELECT için dolu. */
  options: ContactFormFieldOption[];
  maxLength: number | null;
  /** name/email/message — SİLİNEMEZ, `key`/`type` DEĞİŞTİRİLEMEZ. */
  isSystem: boolean;
}

/** Tek (singleton) kayıt — SiteSettings/SiteAppearance ile AYNI id="singleton" + lazy-upsert deseni. */
export interface ContactForm {
  id: string;
  title: string;
  description: string | null;
  submitLabel: string;
  successMessage: string;
  isEnabled: boolean;
  /** null ise bildirim GÖNDERİLMEZ — gönderim yine de kaydedilir. */
  notifyEmail: string | null;
  /** null ise purpose=CONTACT_FORM_NOTIFICATION olan AKTİF şablona düşülür. */
  notificationTemplateId: string | null;
  consentRequired: boolean;
  consentText: string;
  /** `Page.isLegalDocument` olan bir sayfa — mevcut "hukuki belge" ayarının tüketicisi. */
  consentLegalPageId: string | null;
  /** Varsayılan 180; 0 = süresiz (compliance-agent onayı). PII redaksiyonu bundan BAĞIMSIZ 30 gün. */
  retentionDays: number;
  fields: ContactFormField[];
  updatedAt: string;
}

export interface UpdateContactFormRequest {
  title?: string;
  description?: string | null;
  submitLabel?: string;
  successMessage?: string;
  isEnabled?: boolean;
  notifyEmail?: string | null;
  notificationTemplateId?: string | null;
  consentRequired?: boolean;
  consentText?: string;
  consentLegalPageId?: string | null;
  retentionDays?: number;
}

/**
 * TAM DEĞİŞTİRME (`PUT /admin/navigation` deseni) — `order` dizideki indekstir.
 * Üç sistem anahtarının (name/email/message) HEPSİ bulunmalı ve `type`'ları
 * değişmemiş olmalıdır; aksi halde 422 (sessizce yok sayılmaz).
 */
export interface ReplaceContactFormFieldsRequest {
  fields: Array<Omit<ContactFormField, "id" | "order" | "isSystem">>;
}

export interface ContactSubmissionSummary {
  id: string;
  name: string;
  /** Admin listesinde MASKELENMEZ (iş gereği — admin cevap yazacak). */
  email: string;
  status: ContactSubmissionStatus;
  notifiedAt: string | null;
  /** Dolu ise bildirim e-postası GİTMEDİ — arayüz görünür uyarı gösterir. */
  notificationError: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface ContactSubmission extends ContactSubmissionSummary {
  /** Gönderim ANINDAKİ tüm alanların anlık görüntüsü — alan silinse bile veri korunur. */
  data: Record<string, string>;
  consentAt: string | null;
  /** KVKK ispat yükümlülüğü — gönderim anındaki onay metninin birebir kopyası. */
  consentTextSnapshot: string | null;
  /** 30 gün sonra null'lanır (§10.16.10). */
  ipAddress: string | null;
  /** 30 gün sonra null'lanır. */
  userAgent: string | null;
  piiRedactedAt: string | null;
}

export interface UpdateContactSubmissionRequest {
  status: ContactSubmissionStatus;
}

/** PUBLIC — `notifyEmail`/`notificationTemplateId`/`retentionDays` BİLİNÇLİ OLARAK YOK. */
export interface PublicContactForm {
  title: string;
  description: string | null;
  submitLabel: string;
  consentRequired: boolean;
  consentText: string;
  consentLegalPage: { title: string; slug: string } | null;
  fields: ContactFormField[];
}

export interface CreateContactSubmissionRequest {
  /** Alan key → değer. TANIMSIZ anahtarlar SESSİZCE ATILIR. Serileştirilmiş boyut en fazla 32 KB. */
  values: Record<string, string>;
  consent?: boolean;
  /**
   * HONEYPOT — CSS ile gizli, tabindex=-1, autocomplete=off. Dolu gelirse yanıt yine
   * 201 (sahte başarı), kayıt status=SPAM, e-posta GÖNDERİLMEZ.
   */
  website?: string;
}

export interface CreateContactSubmissionResponse {
  id: string;
  /** `ContactForm.successMessage`. */
  message: string;
}

// ---------------------------------------------------------------------------
// §10.17 Sayfa içerik bloklarında Grid / Kolon düzeni
// (bkz. ARCHITECTURE.md §10.17, openapi.yaml `PageBlock`/`PageColumnsBlockData`)
// ---------------------------------------------------------------------------

// KAPSAM DÜZELTMESİ: bu YALNIZCA `Page.blocks` içindir. `BlogPost`'un blok sistemi
// YOKTUR (blog içeriği `contentHtml` TipTap zengin metnidir) — §10.17.1.
//
// db-agent İÇİN: YAPILACAK HİÇBİR ŞEY YOK. `Page.blocks` zaten `Json @default("[]")`;
// yeni tablo/kolon/migration GEREKMEZ.
//
// KRİTİK GÜVENLİK (§10.17.4): `modules/pages/lib/sanitize-blocks.ts` bugün yalnızca ÜST
// SEVİYEYİ dolaşır. Sütun içine konan bir `text` bloğu `sanitizeRichHtml`'i ATLAR ve
// public sayfada `dangerouslySetInnerHTML` ile basılır → STORED XSS. `sanitizePageBlocks`
// bir seviye ÖZYİNELEMELİ olmak ZORUNDADIR. Aynı şekilde `lib/seo-score.ts` de
// `flattenPageBlocks()` üzerinden çalışmalıdır, aksi halde sütuna taşınan içerik SEO
// skorunda sessizce yok sayılır.

export type PageBlockType =
  | "hero"
  | "text"
  | "image"
  | "gallery"
  | "cta"
  | "featured-products"
  | "featured-portfolio"
  | "columns";

export type PageColumnCount = 2 | 3;
/** columnCount=2 → "1-1"|"2-1"|"1-2"; columnCount=3 → yalnızca "1-1-1". Uyumsuzluk 422. */
export type PageColumnRatio = "1-1" | "2-1" | "1-2" | "1-1-1";
export type PageBlockGap = "none" | "sm" | "md" | "lg";
export type PageColumnVerticalAlign = "top" | "center" | "bottom";

/** Bir sütunun İÇİNE konabilen bloklar — `columns` (derinlik en fazla 1) ve `hero` (tam-bleed) HARİÇ. */
export type PageLeafBlockType = Exclude<PageBlockType, "columns" | "hero">;

export interface PageColumn {
  id: string;
  /** En fazla 20 blok; `type` "columns"/"hero" OLAMAZ (422). */
  blocks: Array<{ id: string; type: PageLeafBlockType; data: Record<string, unknown> }>;
}

/**
 * "Tam Genişlik" bir DEĞER DEĞİL, bu bloğun YOKLUĞUDUR. UI'daki "Düzen" seçicisi bir
 * sarmalama/sarmalamayı-kaldırma işlemidir (§10.17.3).
 *
 * VERİ KAYBI TUZAĞI: `2 → full` veya `3 → 2` geçişinde kaybolan sütunlardaki bloklar
 * ATILMAZ — soldan sağa, sütun içi sırayla düzleştirilip hedefe taşınır ve kullanıcıya
 * onay diyaloğu gösterilir. Sessizce silmek YASAK.
 *
 * Mobil yığılma bir VERİ ALANI DEĞİLDİR — tamamen CSS (`grid-cols-1` tabanı + `md:`).
 */
export interface PageColumnsBlockData {
  columnCount: PageColumnCount;
  ratio: PageColumnRatio;
  gap: PageBlockGap;
  verticalAlign: PageColumnVerticalAlign;
  /** Uzunluğu `columnCount` ile EŞİT olmalıdır (422). */
  columns: PageColumn[];
}

export interface PageColumnsBlock {
  id: string;
  type: "columns";
  data: PageColumnsBlockData;
}

/**
 * dnd-kit çok-konteynerli sürükle-bırak için konteyner kimliği SÖZLEŞMESİ:
 * kök liste "root", her sütun "col:<column.id>" (§10.17.6).
 */
export type PageBuilderContainerId = "root" | `col:${string}`;
