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

export type EmailTemplateKey = "WELCOME" | "PASSWORD_RESET" | "SYSTEM_ANNOUNCEMENT";

export interface EmailTemplate {
  id: string;
  key: EmailTemplateKey;
  name: string;
  subject: string;
  bodyHtml: string;
  availableVariables: string[]; // ör. ["user_name", "reset_link"]
  updatedAt: string;
  createdAt: string;
}

export interface UpdateEmailTemplateRequest {
  subject?: string;
  bodyHtml?: string;
}

export interface PreviewEmailTemplateRequest {
  sampleValues: Record<string, string>;
}

export interface PreviewEmailTemplateResponse {
  renderedSubject: string;
  renderedHtml: string;
}

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
