/**
 * ../../../../docs/architecture/shared-types.ts ve openapi.yaml'ın frontend tarafı.
 * Tek doğruluk kaynağı o dosyadır — burada alan adı/tipi değişikliği önce orada yapılmalı.
 */

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Record<string, string[]>;
  };
}

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "RATE_LIMITED"
  // openapi.yaml `#/components/responses/PayloadTooLarge` (413) — İçe aktarma dosya
  // yükleme ucunda kullanılır (bkz. lib/api/import.ts). Önceden bu union'da eksikti.
  | "PAYLOAD_TOO_LARGE"
  // `.claude/architect-scope-page-editor-roles.md` §5 — `backend/src/lib/errors.ts`
  // zaten üretiyordu, openapi.yaml `ApiErrorEnvelope.error.code` enum'ında eksikti;
  // bu turda kontrata eklendi, frontend union'ı burada eşleniyor.
  | "BAD_REQUEST"
  | "EMAIL_DELIVERY_FAILED"
  | "INTERNAL_ERROR"
  | "NETWORK_ERROR";

export type MembershipRole = "OWNER" | "ADMIN" | "MEMBER";
export type MembershipStatus = "ACTIVE" | "INVITED" | "SUSPENDED";
export type InvitationStatus = "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
export type SubscriptionStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "INCOMPLETE";

/**
 * §10.21 (`.claude/architect-scope-rbac-5-tier.md`) — site-geneli rol, azalan ayrıcalık
 * sırasıyla. Panel erişimi olan roller: `ADMIN`, `MANAGER`, `EDITOR`. `CUSTOMER` ve `USER`
 * `/admin/*` altındaki hiçbir uca erişemez (403, iki self-servis güvenlik istisnası hariç:
 * `/admin/settings/security/2fa`, `/admin/settings/security/sessions`). Yeni kayıtların
 * varsayılanı `USER`'dır. **BREAKING:** `VIEWER` KALDIRILDI (migration: `VIEWER → USER`).
 */
export type SiteRole = "ADMIN" | "MANAGER" | "EDITOR" | "CUSTOMER" | "USER";
/**
 * `DELETED` = yumuşak silme (bkz. `DELETE /admin/users/{userId}`). Satır fiziksel olarak
 * silinmez; `POST /admin/users/{userId}/restore` ile geri alınabilir. Bu değer YALNIZCA
 * okuma tarafında (`AdminUser.status`) görülür — durum değiştirme isteğinde KABUL EDİLMEZ
 * (bkz. `UpdateUserStatusRequest`).
 */
export type SiteUserStatus = "ACTIVE" | "SUSPENDED" | "DELETED";

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerifiedAt: string | null;
  role: SiteRole;
  /**
   * §10.21 — bu kullanıcı sayfa bloklarının **YAPISINI** değiştirebilir mi (ekleme/silme/
   * taşıma, `container.settings`, `reveal`, `custom-html`). TÜRETİLMİŞ ve SALT-OKUNUR bir
   * alandır — doğrudan yazılamaz ve ayarlanamaz.
   *
   * `canUseAdvancedBuilder = (role === "ADMIN")`
   *
   * **BREAKING (§10.21):** v1'de bu alan kullanıcı-başı bir bayraktan
   * (`User.advancedBuilderEnabled`) türüyordu. O kolon, o kolonu değiştiren uç
   * (`PATCH /admin/users/{userId}/builder-access`) ve `AdminUser.advancedBuilderEnabled` DTO
   * alanı KALDIRILDI — 5 rollü modelde ADMIN dışında hiçbir rol `true` olamayacağı için bayrak
   * ölü kolona dönüşmüştü.
   *
   * **Bu alan yalnızca UI'ın doğru kontrolleri göstermesi içindir, bir güvenlik kontrolü
   * DEĞİLDİR** — sunucu her yazma isteğinde yeteneği bağımsız olarak yeniden hesaplar.
   */
  readonly canUseAdvancedBuilder: boolean;
  createdAt: string;
  twoFactorEnabled: boolean;
}

/**
 * `/admin/users` uçlarının döndürdüğü kullanıcı kaydı — `User`'dan farklı olarak
 * yönetim listesine özgü `status` ve `lastLoginAt` alanlarını da içerir. Yalnızca
 * SiteRole=ADMIN görebilir (MANAGER dahil hiç kimse).
 */
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerifiedAt: string | null;
  role: SiteRole;
  /** Bkz. `User.canUseAdvancedBuilder` — aynı türetilmiş, salt-okunur alan. */
  readonly canUseAdvancedBuilder: boolean;
  createdAt: string;
  status: SiteUserStatus;
  lastLoginAt: string | null;
  /** Yumuşak silme damgası — `status: "DELETED"` ise dolu, aksi hâlde `null`. */
  deletedAt: string | null;
}

export interface CreateAdminUserRequest {
  name: string;
  email: string;
  /** Verilmezse `EDITOR` — panel rolleri içindeki EN DAR olanı. `CUSTOMER`/`USER` de geçerli hedeflerdir. */
  role?: SiteRole;
}

export interface CreateAdminUserResponse {
  user: AdminUser;
  emailStatus: "sent" | "failed";
}

/**
 * `POST /admin/users/{userId}/reset-password` yanıtı — `CreateAdminUserResponse` ile BİLEREK
 * aynı deseni izler (aynı `createPasswordResetToken` + `sendPasswordResetEmail` akışı
 * paylaşılır). `emailStatus: "failed"` olsa bile token üretilmiş ve hedefin önceki
 * token'ları geçersiz kılınmıştır (yazma işlemi geri alınmaz) — bkz. openapi.yaml
 * `AdminResetPasswordResponse`.
 */
export interface AdminResetPasswordResponse {
  user: AdminUser;
  emailStatus: "sent" | "failed";
  /** Üretilen sıfırlama token'ının son geçerlilik anı (ISO datetime, üretimden +1 saat). */
  expiresAt: string;
}

export interface UpdateUserRoleRequest {
  role: SiteRole;
}

export interface UpdateUserStatusRequest {
  /** `DELETED` BİLEREK dışarıda bırakılmıştır — silme yalnızca `DELETE /admin/users/{userId}` ile yapılır. */
  status: Exclude<SiteUserStatus, "DELETED">;
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
  role: Exclude<MembershipRole, "OWNER">;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
}

export interface Plan {
  id: string;
  name: string;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  currency: string;
  limits: Record<string, number>;
}

export interface Subscription {
  id: string;
  organizationId: string;
  plan: Plan;
  status: SubscriptionStatus;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
}

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
}

export interface AuthSession {
  user: User;
  memberships: Array<Pick<Membership, "organizationId" | "role">>;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface CreateOrganizationRequest {
  name: string;
}

export interface UpdateOrganizationRequest {
  name?: string;
}

/**
 * `PATCH /users/me` — kendi profilini güncelleme. `avatarUrl: null` avatarı kaldırır;
 * boş string `""` geçersizdir (422). Bkz. docs/architecture/shared-types.ts.
 */
export interface UpdateUserRequest {
  name?: string;
  avatarUrl?: string | null;
}

/**
 * `POST /users/me/change-password` — oturum açmış kullanıcının kendi şifresini
 * değiştirmesi. Başarıda 204 döner ve mevcut oturum hariç tüm refresh token'lar
 * iptal edilir. Yeni şifre tekrarı alanı yalnızca istemci tarafı doğrulamasıdır,
 * gövdede gönderilmez.
 */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
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

export interface PageMeta {
  nextCursor: string | null;
  /** Yalnızca `/admin/pages` ve `/admin/blog` yanıtlarında dolu gelir — bkz. `ContentCounts`. */
  counts?: ContentCounts;
  /**
   * Yalnızca `GET /admin/import/jobs/{jobId}/errors` yanıtında dolu gelir (bkz.
   * `ImportJobErrorListMeta` openapi şeması) — iş başına 1.000 satırlık saklama tavanı
   * aşıldığında `true`.
   */
  truncated?: boolean;
}

export interface Page<T> {
  items: T[];
  meta: PageMeta;
}

export type ContentStatus = "DRAFT" | "PUBLISHED" | "SCHEDULED";

/**
 * §10.7 İçerik Yönetim Listesi — Sayfalar/Blog ortak alanları. Bkz.
 * docs/architecture/shared-types.ts::ContentListFields / ContentCounts / TrashedFilter.
 */
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
  code: SeoScoreIssueCode;
  label: string;
}

/** Sekme sayaçları — sunucu hesaplar, istek filtrelerinden etkilenmez. */
export interface ContentCounts {
  all: number;
  published: number;
  draft: number;
  trashed: number;
}

/** `?trashed=` sorgu parametresi; varsayılan "exclude". */
export type TrashedFilter = "exclude" | "include" | "only";

export type BulkContentAction = "trash" | "restore" | "publish" | "draft" | "permanent-delete";

export interface BulkContentActionRequest {
  ids: string[];
  action: BulkContentAction;
}

export interface BulkContentActionResult {
  action: BulkContentAction;
  requestedCount: number;
  affectedCount: number;
  skippedIds: string[];
}

/**
 * `Page`/`BlogPost`/`Product`/`PortfolioItem` çeviri gölgesi — varsayılan dil kanonik
 * kolonlarda kalır, `translations.<locale>` (küçük harf) yalnızca override taşır (kısmi
 * olabilir). Bkz. ARCHITECTURE.md §10.5, `.claude/architect-scope-i18n.md` §1.2.
 */
export type ContentTranslations = Record<string, Record<string, unknown>>;

/**
 * Desteklenen bir dil — VERİ satırıdır, kod sabiti DEĞİLDİR (yeni dil eklemek migration
 * gerektirmez). Bkz. `.claude/architect-scope-i18n.md` §2.1, openapi `Locale` şeması.
 */
export interface Locale {
  /** BCP-47, küçük harf. Birincil anahtar; oluşturulduktan sonra DEĞİŞMEZ. */
  code: string;
  /** Yönetim panelinde gösterilen ad (panel dilinde). */
  label: string;
  /** Dilin kendi adı — site dil değiştiricide BU gösterilir. */
  nativeLabel: string;
  /** Tam olarak BİR locale `true` olabilir. Bu dil URL'de prefix ALMAZ. */
  isDefault: boolean;
  /** `false` ise public `/locales` yanıtında ve `[lang]` rota uzayında YER ALMAZ. */
  enabled: boolean;
  /** Dil değiştiricideki görüntülenme sırası (artan). */
  sortOrder: number;
  /** `hreflang` override — boşsa `code` kullanılır. */
  hreflang: string | null;
  /** YALNIZCA `/admin/locales` yanıtlarında döner. */
  translatedContentCount?: number;
}

export interface LocaleUpsertRequest {
  code: string;
  label: string;
  nativeLabel: string;
  enabled?: boolean;
  sortOrder?: number;
  hreflang?: string | null;
}

export interface LocaleUpdateRequest {
  label?: string;
  nativeLabel?: string;
  enabled?: boolean;
  isDefault?: boolean;
  sortOrder?: number;
  hreflang?: string | null;
}

/**
 * Bir içeriğin TEK bir dildeki yayın durumu ve slug'ı — hreflang/sitemap/dil değiştirici
 * TEK bir istekle bu diziden beslenir (N+1 istek YOK). Bkz. openapi `ContentLocalization`.
 */
export interface ContentLocalization {
  locale: string;
  /** Bu dildeki slug; çevrilmemişse varsayılan dilin slug'ı döner. */
  slug: string;
  /** `true` = bu dilde gerçek bir çeviri VAR (en azından başlık). */
  translated: boolean;
}

/**
 * §10.20 — sayfanın DÜZENLEME MODU. Bir YAZMA/YETKİLENDİRME kavramıdır; ziyaretçiye giden
 * public çıktıda hiçbir karşılığı YOKTUR (`GET /pages`, `GET /pages/{slug}` bu alandan
 * ETKİLENMEZ).
 *
 * - `FREEFORM` — serbest tasarım. Yapıyı değiştirmek serbesttir. **Varsayılan.**
 * - `TEMPLATE` — şablon. Yapı DONMUŞtur: `canUseAdvancedBuilder: false` olan bir kullanıcı
 *   yalnızca izin verilen İÇERİK alanlarını düzenleyebilir (bkz.
 *   `lib/page-builder/template-fields.ts::TEMPLATE_EDITABLE_FIELDS`).
 *
 * **`TEMPLATE`, sayfa geneli bir KİLİT DEĞİLDİR:** `canUseAdvancedBuilder: true` olan
 * kullanıcılar `TEMPLATE` bir sayfada da kısıtsız çalışır — mod yalnızca standart kullanıcılar
 * için bir politikadır.
 */
export type PageEditMode = "FREEFORM" | "TEMPLATE";

// Not: `Page<T>` yukarıda sayfalama zarfı olarak kullanıldığı için site sayfası
// varlığı çakışmasın diye `SitePage` adlandırıldı.
export interface SitePage {
  id: string;
  title: string;
  slug: string;
  status: ContentStatus;
  /**
   * §10.20 (2026-08-23 sıkılaştırması). İstemci, standart moda geçip geçmeyeceğini yalnızca
   * `!user.canUseAdvancedBuilder` ile türetir — `editMode`'dan bağımsızdır (standart kullanıcı
   * FREEFORM sayfada da asla BuilderCanvas'a erişemez). `editMode` artık yalnızca gelişmiş
   * kullanıcıya gösterilen kozmetik bir rozet/ipucudur.
   */
  editMode: PageEditMode;
  blocks: Record<string, unknown>[];
  seoTitle: string | null;
  seoDescription: string | null;
  ogTitle: string | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
  /**
   * Hukuki belge mi (gizlilik politikası, KVKK aydınlatma metni...) — `true` ise §5
   * sessiz çeviri fallback'i UYGULANMAZ (bkz. `.claude/architect-scope-i18n.md` §5.1).
   * Yalnızca SiteRole=ADMIN değiştirebilir.
   */
  isLegalDocument: boolean;
  translations: ContentTranslations;
  /** Bu sayfanın TÜM etkin dillerdeki slug'ı ve çeviri durumu — hreflang/sitemap için. */
  localizations: ContentLocalization[];
  publishedAt: string | null;
  /** `status === "SCHEDULED"` iken gelecekteki yayın tarihi (ISO datetime); aksi halde `null`. */
  scheduledAt: string | null;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
  // ---- §10.7 İçerik Yönetim Listesi ----
  deletedAt: string | null;
  authorId: string | null;
  author: UserSummary | null;
  seoScore: number;
  seoScoreIssues: SeoScoreIssue[];
}

export interface CreateSitePageRequest {
  title: string;
  slug?: string;
  status?: ContentStatus;
  /**
   * §10.20. Verilmezse `FREEFORM`. Bu ucun TAMAMI zaten `canUseAdvancedBuilder: true` şartına
   * tabidir, bu yüzden burada ek bir alan-bazlı 403 kuralı YOKTUR.
   */
  editMode?: PageEditMode;
  /** `status === "SCHEDULED"` iken ZORUNLU ve gelecekte bir tarih olmalı (backend 422 ile reddeder). */
  scheduledAt?: string | null;
  blocks?: Record<string, unknown>[];
  seoTitle?: string;
  seoDescription?: string;
  ogTitle?: string | null;
  ogImageUrl?: string | null;
  canonicalUrl?: string | null;
  noIndex?: boolean;
  /** Yalnızca SiteRole=ADMIN gönderebilir (EDITOR → 403). */
  isLegalDocument?: boolean;
  translations?: ContentTranslations;
  /** Verilmezse giriş yapmış kullanıcı yazar olur; başka id atamak yalnızca ADMIN'e açıktır. */
  authorId?: string;
}

export interface UpdateSitePageRequest {
  title?: string;
  /**
   * §10.20 (2026-08-23 sıkılaştırması) — `canUseAdvancedBuilder: false` olan bir kullanıcı,
   * sayfanın `editMode`'undan BAĞIMSIZ olarak bu alanı GÖNDEREMEZ (`403 FORBIDDEN`). Sayfanın
   * URL'i yapısal bir özelliktir.
   */
  slug?: string;
  status?: ContentStatus;
  /**
   * §10.20 — bu alanı yalnızca `canUseAdvancedBuilder: true` olan kullanıcılar gönderebilir;
   * aksi halde `403 FORBIDDEN` (`isLegalDocument`/`authorId` ile AYNI alan-bazlı guard deseni).
   * Değeri DEĞİŞTİREN her istek `content.edit_mode_change` audit kaydı üretir.
   */
  editMode?: PageEditMode;
  /** `status === "SCHEDULED"` iken ZORUNLU ve gelecekte bir tarih olmalı (backend 422 ile reddeder). */
  scheduledAt?: string | null;
  /**
   * §10.20 EK KURALI — şablon modu diff'i. Sayfa `editMode: TEMPLATE` VE çağıran
   * `canUseAdvancedBuilder: false` ise, gelen ağaç kayıtlı ağaçla karşılaştırılır (backend
   * `lib/page-template-guard.ts::assertTemplateEditAllowed`): düğüm sayısı/sıra/`type` aynı
   * kalmalı, `container.settings`/`reveal` değişmemeli, içerik bloklarında yalnızca
   * `TEMPLATE_EDITABLE_FIELDS[type]` alanları farklı olabilir. İhlal → `403 FORBIDDEN`.
   */
  blocks?: Record<string, unknown>[];
  seoTitle?: string | null;
  seoDescription?: string | null;
  ogTitle?: string | null;
  ogImageUrl?: string | null;
  canonicalUrl?: string | null;
  noIndex?: boolean;
  /** Yalnızca SiteRole=ADMIN gönderebilir (EDITOR → 403). Değişimde `content.legal_flag_change` audit. */
  isLegalDocument?: boolean;
  translations?: ContentTranslations;
}

export interface BlogCategory {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface CreateBlogCategoryRequest {
  name: string;
  slug?: string;
}

export interface UpdateBlogCategoryRequest {
  name?: string;
  slug?: string;
}

// ---------- §10.14 Blog Etiketleri (Tag) ----------
// Kategori (`BlogCategory`) = TEK birincil sınıflandırma (bire-çok).
// Etiket (`BlogTag`) = ÇOKLU yatay sınıflandırma (çoka-çok, `blog_post_tags`).
export interface BlogTag {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  /**
   * Çöpte OLMAYAN yazı sayısı. YALNIZCA `GET /admin/blog/tags` yanıtında doldurulur;
   * `BlogPost.tags[]` içinde gömülü etiketlerde BULUNMAZ (N+1 sorgu doğururdu).
   */
  postCount?: number;
}

export interface CreateBlogTagRequest {
  name: string;
  /** Verilmezse `slugify(name)`. Çakışırsa 409 CONFLICT. */
  slug?: string;
}

export interface UpdateBlogTagRequest {
  /** `name` değişince `slug` OTOMATİK türetilmez — slug URL kimliğidir. */
  name?: string;
  slug?: string;
}

export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  contentHtml: string;
  coverImageUrl: string | null;
  status: ContentStatus;
  category: BlogCategory | null;
  /** HER ZAMAN dizi (boşsa `[]`, asla `null`). Sıralama deterministik: `seq ASC`. */
  tags: BlogTag[];
  seoTitle: string | null;
  seoDescription: string | null;
  ogTitle: string | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
  translations: ContentTranslations;
  /** Bu yazının TÜM etkin dillerdeki slug'ı ve çeviri durumu — hreflang/sitemap için. */
  localizations: ContentLocalization[];
  publishedAt: string | null;
  /** `status === "SCHEDULED"` iken gelecekteki yayın tarihi (ISO datetime); aksi halde `null`. */
  scheduledAt: string | null;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
  // ---- §10.7 İçerik Yönetim Listesi ----
  deletedAt: string | null;
  authorId: string | null;
  author: UserSummary | null;
  seoScore: number;
  seoScoreIssues: SeoScoreIssue[];
}

export interface CreateBlogPostRequest {
  title: string;
  slug?: string;
  excerpt?: string;
  contentHtml?: string;
  coverImageUrl?: string;
  status?: ContentStatus;
  /** `status === "SCHEDULED"` iken ZORUNLU ve gelecekte bir tarih olmalı (backend 422 ile reddeder). */
  scheduledAt?: string | null;
  categoryId?: string | null;
  /**
   * TAM SET (replace, delta DEĞİL). Verilmezse boş. En fazla 50 id; olmayan id → 422.
   * Bkz. `BlogPostTagIdsInput` (§10.14.4).
   */
  tagIds?: string[];
  seoTitle?: string | null;
  seoDescription?: string | null;
  ogTitle?: string | null;
  ogImageUrl?: string | null;
  canonicalUrl?: string | null;
  noIndex?: boolean;
  translations?: ContentTranslations;
  /** Verilmezse giriş yapmış kullanıcı yazar olur; başka id atamak yalnızca ADMIN'e açıktır. */
  authorId?: string;
}

export interface DailyViewStats {
  date: string;
  pageViews: number;
  postViews: number;
}

/**
 * §10.8.10 genişletilmiş analitik uçları (`/admin/stats/summary|top-content|users|revenue` +
 * `/admin/reports/exports/*`) — bkz. backend `stats.schemas.ts`/`reports.schemas.ts` ile
 * BİREBİR alan adı eşleşmesi.
 */
export type StatsGranularity = "day" | "week" | "month";

/** `/admin/stats/summary` `compare:true` olduğunda ÖNCEKİ (bir önceki eşit uzunluktaki) dönemin
 *  ham toplamları — `activeSubscriptions`/`mrrCents` için BİLEREK yok (bkz. backend notu: anlık
 *  durum, geçmişe dönük yeniden inşa edilemez). */
export interface SummaryStatsCompare {
  pageViews: number;
  postViews: number;
  newUsers: number;
}

/** `GET /admin/stats/summary` — YALNIZCA ADMIN. */
export interface SummaryStats {
  from: string;
  to: string;
  granularity: StatsGranularity;
  pageViews: number;
  postViews: number;
  newUsers: number;
  /** ANLIK (şimdiki zaman) durum — dönem sonuna göre DEĞİL. */
  activeSubscriptions: number;
  /** Kuruş cinsinden ANLIK MRR — `÷100` ile TL'ye çevrilir (`Plan.currency` varsayılan TRY). */
  mrrCents: number;
  compare: SummaryStatsCompare | null;
}

export type TopContentType = "page" | "post";

/** `GET /admin/stats/top-content` — EDITOR+ADMIN, cursor sayfalı. */
export interface TopContentItem {
  contentType: TopContentType;
  id: string;
  title: string;
  slug: string;
  views: number;
}

export interface UsersStatsSeriesPoint {
  date: string;
  count: number;
}

export interface UsersStatsRoleDistributionItem {
  role: SiteRole;
  count: number;
}

/** `GET /admin/stats/users` — YALNIZCA ADMIN. */
export interface UsersStats {
  from: string;
  to: string;
  granularity: StatsGranularity;
  series: UsersStatsSeriesPoint[];
  /** Dönemle SINIRLI DEĞİL — kullanıcı tablosunun ANLIK rol dağılımı. */
  roleDistribution: UsersStatsRoleDistributionItem[];
}

export interface RevenueStatsSeriesPoint {
  date: string;
  /** Bucket içinde OLUŞAN aboneliklerin `priceMonthlyCents` toplamı ("yeni MRR"). */
  newMrrCents: number;
  /** Bucket içinde `CANCELED` durumuna geçen (yaklaşık) abonelik sayısı. */
  churnedCount: number;
}

/** `GET /admin/stats/revenue` — YALNIZCA ADMIN. */
export interface RevenueStats {
  from: string;
  to: string;
  granularity: StatsGranularity;
  /** ANLIK toplamlar — bkz. `SummaryStats` üstündeki not. */
  activeSubscriptions: number;
  mrrCents: number;
  series: RevenueStatsSeriesPoint[];
}

export interface Media {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** a11y: editör içeriğine eklenirken zorunlu tutulur; kütüphanede henüz atanmamışsa `null`. */
  altText: string | null;
  /** Piksel cinsinden genişlik/yükseklik — eski kayıtlarda (backend hesaplayamadıysa) `null`. */
  width: number | null;
  height: number | null;
  /**
   * §10.11 Medya Kütüphanesi — Klasör Sistemi. Ait olduğu `MediaFolder`'ın id'si; `null` =
   * "Kategorisiz" — bu bir klasör KAYDI değil, klasörsüzlüğün ta kendisidir. DTO klasör ADINI
   * TAŞIMAZ — istemci `GET /admin/media/folders`'ı bir kez çekip id→ad eşlemesini bellekte yapar.
   */
  folderId: string | null;
  createdAt: string;
}

/**
 * §10.11 Medya Kütüphanesi — Klasör Sistemi. Hiyerarşi DÜZ DİZİ + `parentId` ile ifade edilir
 * (`NavigationItem` ile AYNI patern, iç içe JSON ağacı DEĞİL). Maksimum derinlik 2'dir (kök + bir
 * alt seviye). Sunucu `(parentId NULLS FIRST, name ASC)` sıralı döner. Bkz. ARCHITECTURE.md §10.11.1.
 */
export interface MediaFolder {
  id: string;
  name: string;
  /** Üst klasörün `id`'si; null ise kök seviye klasördür. */
  parentId: string | null;
  /** DOĞRUDAN bu klasördeki medya sayısı — alt klasörlerdekiler DAHİL DEĞİLDİR (rollup YOK). */
  mediaCount: number;
  createdAt: string;
}

/** `POST /admin/media/folders` gövdesi. */
export interface CreateMediaFolderRequest {
  name: string;
  /** Verilmezse/null ise kök seviye. Hedefin KENDİ `parentId`'si null OLMALIDIR (derinlik 2). */
  parentId?: string | null;
}

/**
 * `PATCH /admin/media/folders/{folderId}` gövdesi. Alanın HİÇ gönderilmemesi "değiştirme",
 * `parentId: null` ise "köke taşı" demektir (ikisi FARKLIDIR) — bkz. ARCHITECTURE.md §10.11.1.
 */
export interface UpdateMediaFolderRequest {
  name?: string;
  parentId?: string | null;
}

/** `POST /admin/media/move` gövdesi — tekil taşıma tek elemanlı `mediaIds` dizisidir. */
export interface MoveMediaRequest {
  mediaIds: string[];
  /** Hedef klasör; `null` = "Kategorisiz'e taşı". Alan ZORUNLUDUR (değeri null olabilir). */
  folderId: string | null;
}

export interface MoveMediaResult {
  folderId: string | null;
  requestedCount: number;
  /** Güncellenen kayıt sayısı — zaten hedef klasörde olan medya da DAHİLDİR (idempotent). */
  movedCount: number;
  /** Bulunamayan medya id'leri. Hata DEĞİLDİR (`200` döner). */
  skippedIds: string[];
}

/**
 * §10.9.2 Ürünler Modülü — BlogCategory/BlogPost paterniyle BİREBİR aynı §10.7 çöp kutusu/
 * yazar/SEO skoru alan setine, e-ticaret alanları (fiyat/stok/SKU) eklenmiş hâli. Bkz.
 * backend/src/schemas/entities.ts::ProductSchema (tek doğruluk kaynağı).
 */
export interface ProductCategory {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface CreateProductCategoryRequest {
  name: string;
  slug?: string;
}

export interface UpdateProductCategoryRequest {
  name?: string;
  slug?: string;
}

/**
 * Sıralı ürün galerisi öğesi — `POST /admin/products/:productId/images` ile eklenir,
 * `DELETE /admin/products/:productId/images/:imageId` ile kaldırılır. Her iki uç da
 * güncellenmiş `Product` DTO'sunu (bu `images` alanı dahil) döner.
 */
export interface ProductImage {
  id: string;
  media: Media;
  order: number;
}

/** `POST /admin/products/:productId/images` gövdesi. */
export interface AddProductImageRequest {
  mediaId: string;
}

export interface Product {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  descriptionHtml: string;
  /** Para: HER ZAMAN kuruş/cent cinsinden Int — float KESİNLİKLE YOK. */
  priceCents: number;
  currency: string;
  /** KDV fiyata DAHİL — bu alan yalnızca fatura/gösterim amaçlı ayrıştırma içindir. */
  taxRatePercent: number | null;
  discountPriceCents: number | null;
  sku: string | null;
  stockQuantity: number;
  status: ContentStatus;
  category: ProductCategory | null;
  coverMedia: Media | null;
  images: ProductImage[];
  seoTitle: string | null;
  seoDescription: string | null;
  ogTitle: string | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
  translations: ContentTranslations;
  /** Bu ürünün TÜM etkin dillerdeki slug'ı ve çeviri durumu — hreflang/sitemap için. */
  localizations: ContentLocalization[];
  publishedAt: string | null;
  /** `status === "SCHEDULED"` iken gelecekteki yayın tarihi (ISO datetime); aksi halde `null`. */
  scheduledAt: string | null;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
  // ---- §10.7 İçerik Yönetim Listesi ----
  deletedAt: string | null;
  authorId: string | null;
  author: UserSummary | null;
  seoScore: number;
  seoScoreIssues: SeoScoreIssue[];
}

export interface CreateProductRequest {
  title: string;
  slug?: string;
  excerpt?: string;
  descriptionHtml?: string;
  priceCents: number;
  currency?: string;
  taxRatePercent?: number | null;
  discountPriceCents?: number | null;
  sku?: string | null;
  stockQuantity?: number;
  status?: ContentStatus;
  categoryId?: string | null;
  coverMediaId?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  ogTitle?: string | null;
  ogImageUrl?: string | null;
  canonicalUrl?: string | null;
  noIndex?: boolean;
  translations?: ContentTranslations;
  /** Verilmezse giriş yapmış kullanıcı yazar olur; başka id atamak yalnızca ADMIN'e açıktır. */
  authorId?: string | null;
  /** `status === "SCHEDULED"` iken ZORUNLU ve gelecekte bir tarih olmalı (backend 422 ile reddeder). */
  scheduledAt?: string | null;
}

export interface UpdateProductRequest {
  title?: string;
  slug?: string;
  excerpt?: string | null;
  descriptionHtml?: string;
  priceCents?: number;
  currency?: string;
  taxRatePercent?: number | null;
  discountPriceCents?: number | null;
  sku?: string | null;
  stockQuantity?: number;
  status?: ContentStatus;
  categoryId?: string | null;
  coverMediaId?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  ogTitle?: string | null;
  ogImageUrl?: string | null;
  canonicalUrl?: string | null;
  noIndex?: boolean;
  translations?: ContentTranslations;
  authorId?: string | null;
  scheduledAt?: string | null;
}

/** Admin'in elle stok düzeltmesi — `PATCH /admin/products/:productId/stock`. */
export interface AdjustProductStockRequest {
  stockQuantity: number;
}

/**
 * §10.9.4 Portföy Modülü — `Product`'ın (§10.9.2) BİREBİR paterni, ticari alanlar
 * (fiyat/stok/SKU) yerine `clientName`/`projectUrl`/`completedAt`/`order` (manuel sıralama).
 * Bkz. backend/src/schemas/entities.ts::PortfolioItemSchema (tek doğruluk kaynağı).
 */
export interface PortfolioCategory {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface CreatePortfolioCategoryRequest {
  name: string;
  slug?: string;
}

export interface UpdatePortfolioCategoryRequest {
  name?: string;
  slug?: string;
}

/**
 * Sıralı portföy galerisi öğesi — `ProductImage` ile AYNI patern:
 * `POST /admin/portfolio/:portfolioItemId/images` ile eklenir,
 * `DELETE /admin/portfolio/:portfolioItemId/images/:imageId` ile kaldırılır.
 */
export interface PortfolioImage {
  id: string;
  media: Media;
  order: number;
}

/** `POST /admin/portfolio/:portfolioItemId/images` gövdesi. */
export interface AddPortfolioImageRequest {
  mediaId: string;
}

export interface PortfolioItem {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  contentHtml: string;
  clientName: string | null;
  projectUrl: string | null;
  completedAt: string | null;
  /** Manuel sıralama (kullanıcı kararı) — düşük sayı önce gösterilir. `viewCount` İLE KARIŞTIRILMAMALI. */
  order: number;
  status: ContentStatus;
  category: PortfolioCategory | null;
  coverMedia: Media | null;
  images: PortfolioImage[];
  seoTitle: string | null;
  seoDescription: string | null;
  ogTitle: string | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
  translations: ContentTranslations;
  /** Bu öğenin TÜM etkin dillerdeki slug'ı ve çeviri durumu — hreflang/sitemap için. */
  localizations: ContentLocalization[];
  publishedAt: string | null;
  /** `status === "SCHEDULED"` iken gelecekteki yayın tarihi (ISO datetime); aksi halde `null`. */
  scheduledAt: string | null;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
  // ---- §10.7 İçerik Yönetim Listesi ----
  deletedAt: string | null;
  authorId: string | null;
  author: UserSummary | null;
  seoScore: number;
  seoScoreIssues: SeoScoreIssue[];
}

export interface CreatePortfolioItemRequest {
  title: string;
  slug?: string;
  summary?: string;
  contentHtml?: string;
  clientName?: string | null;
  projectUrl?: string | null;
  /** ISO-8601 datetime string — tarih-only girişler `new Date(value).toISOString()` ile çevrilir. */
  completedAt?: string | null;
  order?: number;
  status?: ContentStatus;
  categoryId?: string | null;
  coverMediaId?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  ogTitle?: string | null;
  ogImageUrl?: string | null;
  canonicalUrl?: string | null;
  noIndex?: boolean;
  translations?: ContentTranslations;
  /** Verilmezse giriş yapmış kullanıcı yazar olur; başka id atamak yalnızca ADMIN'e açıktır. */
  authorId?: string | null;
  /** `status === "SCHEDULED"` iken ZORUNLU ve gelecekte bir tarih olmalı (backend 422 ile reddeder). */
  scheduledAt?: string | null;
}

export interface UpdatePortfolioItemRequest {
  title?: string;
  slug?: string;
  summary?: string | null;
  contentHtml?: string;
  clientName?: string | null;
  projectUrl?: string | null;
  completedAt?: string | null;
  order?: number;
  status?: ContentStatus;
  categoryId?: string | null;
  coverMediaId?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  ogTitle?: string | null;
  ogImageUrl?: string | null;
  canonicalUrl?: string | null;
  noIndex?: boolean;
  translations?: ContentTranslations;
  authorId?: string | null;
  scheduledAt?: string | null;
}

/**
 * Sepet/Checkout/Sipariş — bkz. görev notu "Backend kontratı (kesinleşti, DOĞRULANMIŞ)".
 * Sepet kimliği `cart_token` httpOnly cookie ile taşınır; frontend cookie'yi ELLE OKUMAZ/YAZMAZ,
 * `apiFetch`'in `credentials:"include"` ayarı yeterlidir.
 */
export interface CartProduct {
  id: string;
  title: string;
  slug: string;
  coverImageUrl: string | null;
  stockQuantity: number;
}

export interface CartItem {
  id: string;
  productId: string;
  product: CartProduct;
  quantity: number;
  /** Sepete eklendiği andaki birim fiyat — güncel fiyattan (`currentPriceCents`) farklıysa UI uyarı gösterir. */
  frozenUnitPriceCents: number;
  currentPriceCents: number;
  lineTotalCents: number;
}

export interface Cart {
  items: CartItem[];
  /** Sepet boşken `null` olabilir. */
  currency: string | null;
  subtotalCents: number;
}

export interface AddCartItemRequest {
  productId: string;
  /** 1-99 aralığı — backend `AddCartItemSchema.quantity`. */
  quantity: number;
}

export interface UpdateCartItemRequest {
  quantity: number;
}

/** `POST /checkout/session` — sepetten Stripe Checkout oturumu başlatır. */
export interface CreateCartCheckoutSessionRequest {
  customerEmail: string;
  customerName?: string;
}

/**
 * §customer-portal §6 — `PENDING` → `PAID` → `SHIPPED` (admin kargo takip no'suyla işaretler) →
 * `FULFILLED` (`PAID`'den DOĞRUDAN da ulaşılabilir — dijital/kargosuz ürün akışı). `DELIVERED`
 * BİLİNÇLİ OLARAK YOKTUR (bkz. `.claude/architect-scope-customer-portal.md` §6).
 */
export type OrderStatus = "PENDING" | "PAID" | "SHIPPED" | "FAILED" | "CANCELLED" | "EXPIRED" | "REFUNDED" | "FULFILLED";

export interface OrderItem {
  id: string;
  productId: string;
  productTitle: string;
  productSku: string | null;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  /** `GET /admin/orders` liste ucunda MASKELİ, `GET /admin/orders/:orderId` tekil ucunda MASKESİZ döner. */
  customerEmail: string;
  customerName: string | null;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  errorSummary: string | null;
  paidAt: string | null;
  /** Kargo takip numarası — `status: SHIPPED`'a geçişte ZORUNLU doldurulur (uygulama katmanı). */
  trackingNumber: string | null;
  /** ör. "Yurtiçi Kargo" — serbest metin, enum v1'de AÇILMAZ. */
  shippingCarrier: string | null;
  /** `SHIPPED`'e İLK geçişte otomatik doldurulur (`paidAt` ile AYNI desen). */
  shippedAt: string | null;
  /** `FULFILLED`'a İLK geçişte otomatik doldurulur. */
  deliveredAt: string | null;
  createdAt: string;
  items: OrderItem[];
}

/**
 * `PATCH /admin/orders/:orderId/status` — hedef durum olarak `SHIPPED`/`FULFILLED`/`CANCELLED`
 * kabul edilir (bkz. `ALLOWED_TRANSITIONS`, `.claude/architect-scope-customer-portal.md` §6).
 */
export interface UpdateOrderStatusRequest {
  status: OrderStatus;
  /** `status: SHIPPED` iken ZORUNLU (eksikse 422). */
  trackingNumber?: string;
  shippingCarrier?: string;
}

/** `POST /admin/orders/:orderId/refund` — sadece `PAID`/`SHIPPED`/`FULFILLED` siparişler için, aksi halde 409. */
export interface RefundOrderRequest {
  reason?: string;
}

/**
 * §customer-portal §2.2/§5.1 — `/users/me/addresses*` DTO'su. Sahiplik `userId = me` ile
 * korunur; rol/modül guard'ı YOK ("her zaman açık" sekme). `Order` ile FK ile BAĞLI DEĞİLDİR
 * (checkout adresi Stripe tarafından toplanır, v1'de bu model onu ETKİLEMEZ — bkz.
 * `.claude/architect-scope-customer-portal.md` §5.1).
 */
export interface Address {
  id: string;
  title: string;
  fullName: string;
  phone: string;
  /** İki harfli ülke kodu, varsayılan "TR". */
  country: string;
  city: string;
  district: string;
  neighborhood: string | null;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string | null;
  /** Kullanıcının en fazla BİR varsayılan adresi olabilir. */
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** `POST /users/me/addresses` gövdesi — `country` verilmezse backend "TR" varsayar. */
export interface CreateAddressRequest {
  title: string;
  fullName: string;
  phone: string;
  country?: string;
  city: string;
  district: string;
  neighborhood?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  postalCode?: string | null;
  /** İlk adres bu alan gönderilmese de OTOMATİK varsayılan olur. */
  isDefault?: boolean;
}

/** `PATCH /users/me/addresses/{addressId}` gövdesi — kısmi güncelleme, TÜM alanlar opsiyonel. */
export interface UpdateAddressRequest {
  title?: string;
  fullName?: string;
  phone?: string;
  country?: string;
  city?: string;
  district?: string;
  neighborhood?: string | null;
  addressLine1?: string;
  addressLine2?: string | null;
  postalCode?: string | null;
  isDefault?: boolean;
}

/**
 * §customer-portal §2.3 — `CartItem.product` ile AYNI hafif özet; tam `Product` DEĞİLDİR
 * (`author`/`seoScore`/`translations` gibi yönetim alanları favori kartında gerekmez).
 */
export interface WishlistItemProduct {
  id: string;
  title: string;
  slug: string;
  coverImageUrl: string | null;
  priceCents: number;
  discountPriceCents: number | null;
  currency: string;
  stockQuantity: number;
}

/**
 * §customer-portal §2.3 — `/users/me/wishlist*` DTO'su. Sahiplik `userId = me`,
 * `requireModuleEnabled("products")` ile korunur (modül kapalıyken 404).
 */
export interface WishlistItem {
  id: string;
  productId: string;
  product: WishlistItemProduct;
  createdAt: string;
}

/** `POST /users/me/wishlist` gövdesi. */
export interface AddWishlistItemRequest {
  productId: string;
}

/**
 * §Faz 4 Site Şablonu — SADECE ÖNERİ niteliğinde, hiçbir modülü otomatik açıp kapatmaz,
 * hiçbir CSS/layout dallanmasına yol açmaz. Bkz. `SiteModule.recommendedFor`.
 */
export type SiteTemplate = "SHOWCASE" | "COMMERCE" | "PORTFOLIO";

export interface SiteSettings {
  siteName: string;
  logoUrl: string | null;
  tagline: string | null;
  homePageId: string | null;
  siteTemplate: SiteTemplate;
  /** px, 16-96. `null` ise render sırasında `DEFAULT_HEADER_LOGO_HEIGHT` (32) kullanılır. */
  headerLogoHeight: number | null;
  /** px, 40-400. `null` ise genişlik sınırsızdır (yalnızca doğal en-boy oranı geçerlidir). */
  headerLogoMaxWidth: number | null;
}

export interface UpdateSiteSettingsRequest {
  siteName?: string;
  logoUrl?: string | null;
  tagline?: string | null;
  homePageId?: string | null;
  siteTemplate?: SiteTemplate;
  headerLogoHeight?: number | null;
  headerLogoMaxWidth?: number | null;
}

export interface UpdateBlogPostRequest {
  title?: string;
  slug?: string;
  excerpt?: string | null;
  contentHtml?: string;
  coverImageUrl?: string | null;
  status?: ContentStatus;
  /** `status === "SCHEDULED"` iken ZORUNLU ve gelecekte bir tarih olmalı (backend 422 ile reddeder). */
  scheduledAt?: string | null;
  categoryId?: string | null;
  /**
   * TAM SET (replace, delta DEĞİL). `[]` tüm etiketleri kaldırır; `undefined` (alan hiç
   * gönderilmemişse) etiketlere DOKUNMAZ. En fazla 50 id; olmayan id → 422.
   * Bkz. `BlogPostTagIdsInput` (§10.14.4).
   */
  tagIds?: string[];
  seoTitle?: string | null;
  seoDescription?: string | null;
  ogTitle?: string | null;
  ogImageUrl?: string | null;
  canonicalUrl?: string | null;
  noIndex?: boolean;
  translations?: ContentTranslations;
}

/**
 * İçerik sürüm kontrolü (Revision History) — bkz. ARCHITECTURE.md §10.1.
 * `/admin/{pages,blog,products,portfolio}/{id}/revisions` uçları — dördü de tam parite
 * (mimar kararı, faz sınırı KALDIRILDI).
 */
export type ContentEntityType = "PAGE" | "BLOG_POST" | "PRODUCT" | "PORTFOLIO_ITEM";

export interface ContentRevisionSummary {
  id: string;
  editedById: string | null;
  editedByName: string;
  createdAt: string;
}

export interface ContentRevision extends ContentRevisionSummary {
  entityType: ContentEntityType;
  entityId: string;
  snapshot: Record<string, unknown>;
}

export type AuditStatus = "SUCCESS" | "FAILURE" | "FORBIDDEN";

export interface AuditLog {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  status: AuditStatus;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

/**
 * `/admin/settings/permissions` salt-okunur rol izin matrisi — backend'de kod
 * seviyesinde sabittir, bu ekrandan düzenlenemez, yalnızca görüntülenir.
 */
export interface PermissionsMatrix {
  roles: SiteRole[];
  modules: {
    module: string;
    label: string;
    actions: Record<string, SiteRole[]>;
  }[];
}

/**
 * Header/footer navigasyon yönetimi — `/admin/navigation` (Navigasyon Builder).
 * `href`/`url` alanları backend'de `^(https?:\/\/|\/|#)` regex'iyle valide edilir
 * (mailto:/tel: reddedilir).
 */
export type SocialPlatform = "TWITTER" | "GITHUB" | "LINKEDIN" | "INSTAGRAM" | "FACEBOOK" | "YOUTUBE" | "OTHER";

/**
 * Hiyerarşik (iç içe geçebilen) menü öğesi — düz dizi + `parentId` ile ifade edilir (nested
 * JSON DEĞİL). Maksimum derinlik 2'dir: `parentId` dolu olan bir öğe YALNIZCA `parentId`'si
 * null olan (kök) bir öğeyi işaret edebilir. `order` KARDEŞ-KAPSAMLIDIR (aynı `parentId`
 * grubu içinde 0'dan artar). Sunucu diziyi `(parentId NULLS FIRST, order)` ile döner — kök
 * öğeler her zaman alt öğelerden önce gelir. Bkz. ARCHITECTURE.md §10.10.1.
 */
export interface NavigationItemDto {
  id: string;
  label: string;
  href: string;
  order: number;
  /** Üst öğenin `id`'si; null ise kök seviye öğedir. */
  parentId: string | null;
}

export interface SocialLinkDto {
  id: string;
  platform: SocialPlatform;
  url: string;
  order: number;
}

export interface FooterLinkDto {
  id: string;
  label: string;
  href: string;
  order: number;
}

export interface FooterColumnDto {
  id: string;
  title: string;
  order: number;
  links: FooterLinkDto[];
}

export interface NavigationConfigDto {
  headerCtaLabel: string | null;
  headerCtaHref: string | null;
  footerCopyrightText: string | null;
  navigationItems: NavigationItemDto[];
  socialLinks: SocialLinkDto[];
  footerColumns: FooterColumnDto[];
}

/**
 * PUT body. `socialLinks`/`footerColumns` için `id` alanları YOK — id'ler yalnızca form
 * state/React key amaçlı, backend'e gönderilmeden önce strip edilir. `navigationItems` bunun
 * İSTİSNASIDIR: hiyerarşi (`parentId`) aynı payload içinde çözülebilsin diye istemci her öğe
 * için ürettiği bir UUID'yi (`crypto.randomUUID()`) `id` olarak gönderir ve bu değer gerçek
 * `NavigationItem.id` olarak yazılır (geçici→kalıcı id eşleme adımı yoktur). `id` opsiyoneldir
 * ancak BAŞKA BİR ÖĞENİN `parentId`'si tarafından işaret edilen bir öğe için ZORUNLUDUR — bu
 * yüzden istemci pratikte her öğe için her zaman `id` gönderir. Bkz. ARCHITECTURE.md §10.10.2.
 */
export interface UpdateNavigationConfigRequest {
  headerCtaLabel?: string | null;
  headerCtaHref?: string | null;
  footerCopyrightText?: string | null;
  navigationItems: { id?: string; label: string; href: string; order: number; parentId?: string | null }[];
  socialLinks: { platform: SocialPlatform; url: string; order: number }[];
  footerColumns: { title: string; order: number; links: { label: string; href: string; order: number }[] }[];
}

/**
 * Canlı analytics ve sistem sağlığı — `/admin/stats/live-visitors`, `/admin/stats/breakdown`,
 * `/admin/health`. Bkz. mimari kararı: bu ekranlar dürüstlük ilkesiyle tasarlanır — backend
 * "UNKNOWN"/null döndürdüğünde UI bunu asla sahte bir varsayılanla gizlemez.
 */
export interface LiveVisitorsDto {
  count: number;
}

export type DeviceType = "MOBILE" | "DESKTOP" | "TABLET" | "UNKNOWN";

export interface DeviceBreakdownItem {
  type: DeviceType;
  count: number;
}

/** `country` "UNKNOWN" veya "OTHER" olabilir, ama asla `null` değildir. */
export interface CountryBreakdownItem {
  country: string;
  count: number;
}

export interface BreakdownDto {
  devices: DeviceBreakdownItem[];
  countries: CountryBreakdownItem[];
}

export interface SystemHealthDto {
  dbPingMs: number;
  dbSizeBytes: number;
  dbQuotaBytes: number | null;
  mediaStorageBytes: number;
  mediaStorageQuotaBytes: number | null;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  processMemoryBytes: number;
  loadAverage: [number, number, number];
  platform: string;
  uptimeSeconds: number;
  checkedAt: string;
}

/**
 * Güvenlik & 2FA (TOTP) + Aktif Oturumlar — bkz. ARCHITECTURE.md §10.4.
 * `POST /auth/login` artık `AuthResponse` yerine `LoginResult` döner: 2FA kapalıysa
 * doğrudan token çifti, açıksa `{ requiresTwoFactor: true, challengeToken }`.
 */
export interface LoginRequiresTwoFactorResponse {
  requiresTwoFactor: true;
  challengeToken: string;
}
export type LoginResult = AuthResponse | LoginRequiresTwoFactorResponse;

export interface VerifyTwoFactorRequest {
  challengeToken: string;
  code: string;
}

export interface TwoFactorSetupResponse {
  otpauthUrl: string;
  qrCodeDataUrl: string;
  setupToken: string;
}
export interface EnableTwoFactorRequest {
  setupToken: string;
  code: string;
}
export interface EnableTwoFactorResponse {
  backupCodes: string[];
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

/**
 * E-posta Şablonu Blok Editörü + İletişim Formu — bkz. ARCHITECTURE.md §10.16,
 * openapi.yaml tag: EmailTemplates / ContactForms. `docs/architecture/shared-types.ts`
 * tek doğruluk kaynağıdır — burada alan adı/tipi değişikliği önce orada yapılmalı.
 *
 * BREAKING (§10.16.6): şablonlar artık `{templateId}` (uuid) ile adreslenir, eski `{key}`
 * DEĞİL. `EmailTemplateKey` union'ı KALDIRILDI.
 *
 * KRİTİK KISIT (§10.16.4): e-posta gövde HTML'i istemciden ASLA kabul edilmez — istemci
 * yalnızca yapısal `EmailBlock[]` gönderir, HTML'i sunucu üretir. Önizleme
 * `dangerouslySetInnerHTML` ile BASILMAZ; `<iframe sandbox="" srcDoc={html}>` kullanılır.
 */
export type EmailTemplatePurpose =
  | "WELCOME"
  | "PASSWORD_RESET"
  | "SYSTEM_ANNOUNCEMENT"
  | "ORDER_CONFIRMATION"
  | "ORG_INVITATION"
  | "CONTACT_FORM_NOTIFICATION"
  | "CUSTOM";

/**
 * RAW = §10.3'ten devralınan ham HTML şablonu (seed'lenmiş 5 sistem şablonu). BLOCKS = §10.16
 * blok editörü. Yeni şablonlar HER ZAMAN BLOCKS olarak oluşturulur; mod sonradan DEĞİŞTİRİLEMEZ.
 */
export type EmailTemplateEditorMode = "RAW" | "BLOCKS";

export type EmailBlockType = "logo-header" | "heading" | "text" | "button" | "image" | "divider" | "footer";

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
  data: { useSiteLogo: boolean; logoUrl: string | null; height: number };
}

export interface EmailHeadingBlock extends EmailBlockBase {
  type: "heading";
  data: { text: string; level: 1 | 2 | 3 };
}

export interface EmailTextBlock extends EmailBlockBase {
  type: "text";
  data: { html: string };
}

export interface EmailButtonBlock extends EmailBlockBase {
  type: "button";
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
  data: { mediaId: string | null; url: string; alt: string; width: number | null };
}

export interface EmailDividerBlock extends EmailBlockBase {
  type: "divider";
  data: { thickness: 1 | 2 | 4; color: string | null };
}

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
 * `lib/email-variables.ts` statik registry'si — frontend değişken listesini HARDCODE ETMEZ,
 * API'den okur. `key` İngilizce snake_case, `label` Türkçe ve UI'da BİRİNCİL gösterilir.
 */
export interface EmailVariableDefinition {
  key: string;
  label: string;
  sampleValue: string;
  /** `contact-field` = iletişim formu alanından TÜRETİLDİ (otomatik). */
  source: "system" | "custom" | "contact-field";
}

/**
 * Kullanıcı tanımlı değişken (şablon başına en fazla 20). Doğrulama: ^[a-z][a-z0-9_]{0,39}$
 * (`EMAIL_CUSTOM_VARIABLE_KEY_PATTERN`) — Türkçe karakterli bir anahtar SESSİZCE render EDİLMEZ.
 */
export interface EmailCustomVariable {
  key: string;
  label: string;
  sampleValue: string;
}

export interface EmailTemplateSummary {
  id: string;
  /** Yalnızca `isSystem` satırlarda dolu; kullanıcı şablonlarında null. */
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
  /** Yalnızca editorMode=RAW için anlamlı; BLOCKS'ta "" (render ÖNBELLEKLENMEZ). */
  bodyHtml: string;
  blocks: EmailBlock[];
  /** Salt bilgi amaçlı; istemciden ARTIK KABUL EDİLMEZ. */
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
  /** YALNIZCA editorMode=RAW şablonlarda kabul edilir. */
  bodyHtml?: string;
  /** YALNIZCA editorMode=BLOCKS şablonlarda kabul edilir. */
  blocks?: EmailBlock[];
  customVariables?: EmailCustomVariable[];
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
  /** Satır-içi stilli e-posta HTML'i — `<iframe sandbox="" srcDoc>` içinde gösterilir. */
  renderedHtml: string;
}

/** `to` alanı BİLİNÇLİ OLARAK YOKTUR — alıcı her zaman `request.user.email` (§10.16.6). */
export interface TestSendEmailTemplateRequest {
  sampleValues?: Record<string, string>;
}

export interface TestSendEmailTemplateResponse {
  sentTo: string;
  messageId: string;
  /** Yalnızca dev (Ethereal) ortamında dolu. */
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
  /** `Page.isLegalDocument` olan bir sayfa. */
  consentLegalPageId: string | null;
  /** Varsayılan 180; 0 = süresiz. */
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
 * TAM DEĞİŞTİRME (`PUT /admin/navigation` deseni) — `order` dizideki indekstir. Üç sistem
 * anahtarının (name/email/message) HEPSİ bulunmalı ve `type`'ları değişmemiş olmalıdır.
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
  /** 30 gün sonra null'lanır. */
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
  /** HONEYPOT — CSS ile gizli, tabindex=-1, autocomplete=off. Dolu gelirse yanıt yine 201. */
  website?: string;
}

export interface CreateContactSubmissionResponse {
  id: string;
  /** `ContactForm.successMessage`. */
  message: string;
}

/**
 * Toplu İçe Aktarma (Import) — bkz. ARCHITECTURE.md §10.8, openapi.yaml `Import` tag'i.
 * `/admin/import/*` uçları — yalnızca ADMIN.
 */

/**
 * İçe aktarmanın HEDEFİ (dosya formatı değil — o `ImportSourceFormat`'tır). `PRODUCTS`
 * (WooCommerce/WXR) `WORDPRESS`'ten BİLEREK ayrı bir tiptir — bkz. openapi.yaml
 * `ImportJobType` açıklaması / ARCHITECTURE.md §10.8.9 (mimar kararı 2A).
 */
export type ImportJobType = "PAGES" | "BLOG" | "WORDPRESS" | "PRODUCTS" | "USERS" | "MEDIA";

/** Sunucunun dosya İÇERİĞİNDEN türettiği format — istemci göndermez, göndersede yok sayılır. */
export type ImportSourceFormat = "CSV" | "JSON" | "XML" | "ZIP";

export type ImportJobStatus = "PENDING" | "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";

/**
 * Var olan bir kayıtla çakışma bulunduğunda ne yapılacağı. `USERS` için yalnızca `skip`
 * kabul edilir (`overwrite`/`createNew` → 422, yetki yükseltme vektörü).
 */
export type ImportDuplicateStrategy = "skip" | "overwrite" | "createNew";

/**
 * Kaynak alan adı → hedef şema alanı eşlemesi. Değer `null` ise o sütun yok sayılır.
 * `WORDPRESS`/`MEDIA` için anlamsızdır ve yok sayılır.
 */
export type ImportFieldMapping = Record<string, string | null>;

export type ImportPreviewFieldStatus = "matched" | "unmatched" | "ignored" | "missingRequired";

export interface ImportPreviewField {
  sourceField: string;
  /** Otomatik eşleşen hedef şema alanı; eşleşmediyse `null`. */
  targetField: string | null;
  status: ImportPreviewFieldStatus;
}

export type ImportJobWarningCode =
  | "WP_MEDIA_NOT_DOWNLOADED"
  | "WP_TAGS_UNSUPPORTED"
  | "WP_AUTHOR_UNMATCHED"
  | "WP_PRIVATE_AS_DRAFT"
  | "WP_SCHEDULED_AS_DRAFT"
  | "HTML_WILL_BE_SANITIZED"
  | "SLUG_COLLISION"
  | "MEDIA_SVG_REJECTED"
  | "UNMAPPED_COLUMNS"
  // §10.8.9 WooCommerce (`PRODUCTS`) uyarıları — `WC_*` kodları YALNIZCA `PRODUCTS`
  // tipinde, `WP_PRODUCTS_SKIPPED` ise YALNIZCA `WORDPRESS` tipinde üretilir.
  | "WP_PRODUCTS_SKIPPED"
  | "WC_TAX_NOT_IMPORTED"
  | "WC_STOCK_NOT_MANAGED"
  | "WC_VARIATIONS_UNSUPPORTED"
  | "WC_GALLERY_NOT_IMPORTED"
  | "WC_ORDERS_IGNORED";

export interface ImportJobWarning {
  code: ImportJobWarningCode;
  /** Gösterime hazır Türkçe metin — mantık İÇİN `code` kullanılır, bu yalnızca gösterimdir. */
  message: string;
  count?: number;
}

/**
 * Yalnızca XML (WXR) tabanlı tipler — `WORDPRESS` ve `PRODUCTS` — için: `wp:post_type`
 * kırılımı. Her iki tipte de AYNI şema döner; ilgisiz alanlar `0`'dır (bkz. openapi.yaml
 * `ImportJobPreview.breakdown`).
 */
export interface ImportJobBreakdown {
  pages?: number;
  posts?: number;
  attachments?: number;
  categories?: number;
  /**
   * `wp:post_type: product` sayısı (WooCommerce). `PRODUCTS` tipinde işlenecek kayıt
   * sayısıdır; `WORDPRESS` tipinde yalnızca bilgi amaçlıdır (bu item'lar ATLANIR —
   * `WP_PRODUCTS_SKIPPED`). Ürün varyasyonları (`product_variation`) buraya DAHİL DEĞİLDİR.
   */
  products?: number;
  skipped?: number;
}

/** `POST /admin/import/jobs` sonrası dönen, ONAY EKRANINI besleyen özet. */
export interface ImportJobPreview {
  totalCount: number;
  /** `false` ise `POST .../start` 422 döner — UI onay butonunu bu alana göre pasifleştirir. */
  canStart: boolean;
  fields: ImportPreviewField[];
  /** Bu `type` için atanabilecek hedef şema alanları — eşleştirme dropdown'ını besler. */
  targetFields: string[];
  /** Otomatik eşleşmenin sonucu — `StartImportJobRequest.fieldMapping` gönderilmezse bu kullanılır. */
  suggestedMapping: ImportFieldMapping;
  /** Dosyanın ilk 5 kaydı, eşleştirme uygulanmış hâliyle. */
  samples: Record<string, unknown>[];
  breakdown?: ImportJobBreakdown;
  warnings: ImportJobWarning[];
}

export interface ImportJobSummary {
  id: string;
  type: ImportJobType;
  format: ImportSourceFormat;
  status: ImportJobStatus;
  /** `PENDING` işlerde `null` (henüz seçilmedi). */
  duplicateStrategy: ImportDuplicateStrategy | null;
  /** Kullanıcının yüklediği ORİJİNAL dosya adı — yalnızca gösterim içindir. */
  filename: string;
  sizeBytes: number;
  totalCount: number;
  /** İşlenmiş kayıt = success + error + skipped. İlerleme çubuğu: processedCount / totalCount. */
  processedCount: number;
  successCount: number;
  errorCount: number;
  skippedCount: number;
  /** İşin TAMAMINI başarısız kılan hata (`FAILED`); satır hataları burada DEĞİL `.../errors`'tadır. */
  errorSummary: string | null;
  createdById: string | null;
  createdBy: UserSummary | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Tekil iş DTO'su — `ImportJobSummary` + `preview`. */
export interface ImportJob extends ImportJobSummary {
  /** İş sonlandıktan sonra da korunur (rapor ekranı geçmişte de açılabilsin diye). */
  preview: ImportJobPreview | null;
}

/** Onay ekranının seçimleri — gövde hiç gönderilmezse tüm varsayılanlar uygulanır. */
export interface StartImportJobRequest {
  /** Verilmezse `preview.suggestedMapping` kullanılır. `WORDPRESS`/`PRODUCTS`/`MEDIA`'da yok sayılır. */
  fieldMapping?: ImportFieldMapping;
  /** Varsayılan `skip`. */
  duplicateStrategy?: ImportDuplicateStrategy;
  /**
   * `PAGES`/`BLOG` içe aktarımında kaynakta `status` yoksa uygulanacak varsayılan
   * (varsayılanın varsayılanı `DRAFT`). `PRODUCTS`'ta anlamı GENİŞTİR (karar 2C): yalnızca
   * "boş durum" için değil TÜM ürünler için tavan olarak uygulanır — WooCommerce'te
   * `publish` olan bir ürün dahi varsayılan olarak `DRAFT` açılır.
   */
  defaultStatus?: ContentStatus;
  /** Yazarı çözümlenemeyen kayıtlara atanacak kullanıcı. İçe aktarma HİÇBİR KOŞULDA kendiliğinden kullanıcı oluşturmaz. */
  defaultAuthorId?: string | null;
  /** `BLOG` (CSV/JSON) için kategorisi çözümlenemeyen yazılara atanacak kategori. */
  defaultCategoryId?: string | null;
  /**
   * YALNIZCA `PRODUCTS` için — WooCommerce WXR'ı para birimini item düzeyinde TAŞIMAZ.
   * ISO-4217 3 harfli kod, verilmezse `TRY`. Diğer tiplerde yok sayılır.
   */
  defaultCurrency?: string;
}

export type ImportJobErrorCode =
  | "REQUIRED_FIELD_MISSING"
  | "INVALID_VALUE"
  | "INVALID_EMAIL"
  | "INVALID_ROLE"
  | "INVALID_DATE"
  | "INVALID_URL"
  | "DUPLICATE_SKIPPED"
  | "TARGET_TRASHED"
  | "SLUG_CONFLICT"
  | "UNSUPPORTED_POST_TYPE"
  | "UNSUPPORTED_STATUS"
  | "CATEGORY_UNRESOLVED"
  | "AUTHOR_UNRESOLVED"
  | "UNSUPPORTED_MIME"
  | "FILE_TOO_LARGE"
  | "EMAIL_DELIVERY_FAILED"
  | "DB_ERROR";

/**
 * Tek bir kaydın başarısız olma/atlanma nedeni. Atlama (`skipped`) da burada raporlanır —
 * `severity` alanı ikisini ayırır.
 */
export interface ImportJobError {
  id: string;
  /** KAYNAK DOSYADAKİ 1-tabanlı sıra (CSV'de başlık satırı hariç, ilk veri satırı = 1). */
  rowNumber: number;
  code: ImportJobErrorCode;
  /** Gösterime hazır Türkçe açıklama. */
  message: string;
  severity: "error" | "skipped";
  field: string | null;
  /** Kaynaktaki tanımlayıcı — WXR'da `wp:post_id`, ZIP'te arşiv içi dosya adı, CSV/JSON'da slug/email. */
  sourceRef: string | null;
  /** Satırın ham hâli (8 KB'a kırpılır). KİŞİSEL VERİ İÇEREBİLİR (bkz. ARCHITECTURE.md §10.8.8). */
  rawData: Record<string, unknown> | null;
  createdAt: string;
}

/**
 * Eklenti/Modül Yönetimi (Faz 1) — bkz. ARCHITECTURE.md, `/admin/modules` (tüm roller
 * okuyabilir, yalnızca ADMIN `PATCH` edebilir) ve `/modules` (public, auth gerektirmez) uçları.
 * `MODULE_REGISTRY` backend'de bu turda BOŞ — Products/Portfolio gibi somut modüller
 * sonraki fazlarda eklenecek; burada kurulan UI/altyapı bu yüzden GENEL olmalı.
 */
export interface SiteModule {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: UserSummary | null;
  /**
   * §Faz 4 Site Şablonu — bu modülün hangi site şablon(lar)ı için ÖNERİLDİĞİ (yalnızca görsel
   * ipucu, davranışı etkilemez). SHOWCASE için özel önerilen modül yoktur, bu yüzden boş/undefined
   * olabilir.
   */
  recommendedFor?: SiteTemplate[];
}

export interface UpdateSiteModuleRequest {
  enabled: boolean;
}

/** `GET /modules` (public) — site ziyaretçi tarafında hangi modüllerin açık olduğunu görmek için. */
export interface PublicModule {
  key: string;
  enabled: boolean;
}

/**
 * Analitik Rapor Dışa Aktarma (Export) — bkz. ARCHITECTURE.md §10.8.10, openapi.yaml `Reports`
 * tag'i. `/admin/reports/exports/*` uçları — TÜMÜ yalnızca ADMIN.
 */
export type ExportJobType = "VIEWS" | "BREAKDOWN" | "SUMMARY" | "TOP_CONTENT" | "USERS" | "REVENUE";
export type ExportFileFormat = "CSV" | "PDF";
export type ExportJobStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

/** `USERS` için `role`, `REVENUE` için `subscriptionStatus` — diğer tiplerde yok sayılır. */
export interface ExportJobTypeFilters {
  role?: SiteRole;
  subscriptionStatus?: SubscriptionStatus;
}

export interface CreateExportJobRequest {
  type: ExportJobType;
  format: ExportFileFormat;
  /** ISO-8601, `to` ile BİRLİKTE. */
  from: string;
  /** ISO-8601, `from` ile BİRLİKTE. */
  to: string;
  /** Verilmezse backend varsayılanı `"day"`. */
  granularity?: StatsGranularity;
  filters?: ExportJobTypeFilters;
  /**
   * `true` ise dosya ham/maskesiz kişisel veri içerir — compliance-agent kararı: varsayılan
   * `false` (maskeli), ayrı bir onay akışı YOK ama backend `reports.export.unmasked_pii` audit
   * kaydı yazar ve maskesiz dosyalar çok daha kısa saklanır.
   */
  unmaskPii?: boolean;
}

/** `ExportJob.filters` — backend `POST` gövdesinin TAMAMINI (from/to/granularity/filters/
 *  unmaskPii) saklar, geriye `Record<string, unknown>` olarak döner (bkz. backend `z.record`). */
export type ExportJobStoredFilters = Partial<CreateExportJobRequest> & Record<string, unknown>;

export interface ExportJob {
  id: string;
  type: ExportJobType;
  format: ExportFileFormat;
  status: ExportJobStatus;
  filters: ExportJobStoredFilters;
  /** Ham/maskelenmemiş PII içeriyorsa `true` — bkz. `unmaskPii`. */
  containsPii: boolean;
  errorSummary: string | null;
  createdById: string | null;
  createdBy: UserSummary | null;
  /** İndirme linkinin süre sonu — bu tarihten sonra `.../download` 404 döner. */
  expiresAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * §10.12 Site Özelleştirme (Görünüm) — openapi.yaml `Appearance` tag'i. İSİMLENDİRME KURALI
 * (bağlayıcı): bu bloktaki HER alan YALNIZCA ziyaretçi (public) sitesini etkiler; alan adlarında
 * `site` ön eki KULLANILMAZ — ayrım RENDER katmanında zorlanır (bkz. ARCHITECTURE.md §10.12.4,
 * `--site-*` CSS değişkenleri + `.site-scope`). Admin panelinin kendi teması (`--primary` vb.)
 * bu tiplerden ASLA türetilmez.
 */
export type SiteFont =
  | "SYSTEM"
  | "INTER"
  | "ROBOTO"
  | "OPEN_SANS"
  | "MONTSERRAT"
  | "POPPINS"
  | "LORA"
  | "PLAYFAIR_DISPLAY"
  | "SOURCE_SERIF_4"
  | "PLUS_JAKARTA_SANS"
  | "OUTFIT";

export type PageHeaderStyle = "PLAIN" | "BANNER" | "HIDDEN";

/**
 * Sayfa başlığı bloğunun iç düzeni — `pageHeaderStyle`'dan BAĞIMSIZ bir alandır, sadece
 * `pageHeaderStyle: BANNER` iken sitede etkilidir. Bu iş kuralı BİLİNÇLİ olarak backend'de
 * ZORLANMAZ (frontend uygular).
 */
export type PageHeaderLayout = "CENTERED" | "LEFT_OVERLAY" | "MINIMAL_LINE" | "SPLIT";

/** Buton/kart köşe yarıçapı — `SITE_BORDER_RADIUS_PX` (lib/site-settings/site-radius.ts) enum→px eşlemesini kullanır. */
export type SiteBorderRadius = "NONE" | "SM" | "MD" | "LG" | "FULL";

/** `.site-scope` içindeki CTA/buton render noktalarının yapısal varyantı — CSS custom property DEĞİLDİR. */
export type SiteButtonStyle = "SOLID" | "OUTLINE" | "SOFT";

/**
 * Yazı/sayfa altındaki paylaşım butonları — `SocialPlatform`'dan (site kimliğinin KENDİ hesap
 * linkleri, bkz. yukarıdaki `SocialLinkDto`) BİLEREK AYRIDIR ve onunla BİRLEŞTİRİLMEZ.
 */
export type SocialShareNetwork = "TWITTER" | "FACEBOOK" | "LINKEDIN" | "WHATSAPP" | "EMAIL" | "COPY_LINK";

/** `GET /admin/appearance` ve `PATCH /admin/appearance` yanıtı — tekil (singleton) görünüm ayarları. */
export interface SiteAppearance {
  /** En son uygulanan ön ayarın anahtarı; `null` = özel (kullanıcı alanları elle değiştirdi). CANLI BİR BAĞ DEĞİLDİR. */
  presetKey: string | null;
  pageHeaderStyle: PageHeaderStyle;
  /** Sadece `pageHeaderStyle=BANNER` iken sitede etkilidir. */
  pageHeaderLayout: PageHeaderLayout;
  pageHeaderBackgroundColor: string | null;
  /** Medya kütüphanesinden seçilir (mevcut `coverMediaId` paterni) — serbest URL alanı DEĞİL. */
  pageHeaderBackgroundMediaId: string | null;
  /** Yanıta özel, YAZILAMAZ alan — `pageHeaderBackgroundMediaId`'nin sunucuda çözümlenmiş URL'i. */
  pageHeaderBackgroundUrl: string | null;
  pageHeaderOverlayOpacity: number;
  primaryColor: string;
  secondaryColor: string;
  buttonColor: string;
  buttonTextColor: string;
  linkColor: string;
  accentColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  mutedTextColor: string;
  headingFont: SiteFont;
  bodyFont: SiteFont;
  baseFontSize: number;
  borderRadius: SiteBorderRadius;
  buttonStyle: SiteButtonStyle;
  socialShareEnabled: boolean;
  socialShareNetworks: SocialShareNetwork[];
  backToTopEnabled: boolean;
  stickyHeaderEnabled: boolean;
  cookieBannerEnabled: boolean;
  cookieBannerText: string | null;
  cookieBannerPolicyHref: string | null;
  maintenanceModeEnabled: boolean;
  maintenanceMessage: string | null;
  notFoundTitle: string | null;
  notFoundMessage: string | null;
  notFoundButtonLabel: string | null;
  notFoundButtonHref: string | null;
  /** Hiç kaydedilmemişse (DEFAULTS) `null`. */
  updatedAt: string | null;
}

/**
 * `GET /appearance` (public) yanıtı. `SiteAppearance`'tan FARKLARI: `presetKey`,
 * `pageHeaderBackgroundMediaId`, `updatedAt` TAŞIMAZ; `customCss`/`customJs` İÇERİR — `(site)`
 * layout'u bu iki değeri her SSR render'ında ihtiyaç duyar.
 */
export interface PublicSiteAppearance {
  pageHeaderStyle: PageHeaderStyle;
  /** Sadece `pageHeaderStyle=BANNER` iken sitede etkilidir. */
  pageHeaderLayout: PageHeaderLayout;
  pageHeaderBackgroundColor: string | null;
  pageHeaderBackgroundUrl: string | null;
  pageHeaderOverlayOpacity: number;
  primaryColor: string;
  secondaryColor: string;
  buttonColor: string;
  buttonTextColor: string;
  linkColor: string;
  accentColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  mutedTextColor: string;
  headingFont: SiteFont;
  bodyFont: SiteFont;
  baseFontSize: number;
  borderRadius: SiteBorderRadius;
  buttonStyle: SiteButtonStyle;
  socialShareEnabled: boolean;
  socialShareNetworks: SocialShareNetwork[];
  backToTopEnabled: boolean;
  stickyHeaderEnabled: boolean;
  cookieBannerEnabled: boolean;
  cookieBannerText: string | null;
  cookieBannerPolicyHref: string | null;
  maintenanceModeEnabled: boolean;
  maintenanceMessage: string | null;
  notFoundTitle: string | null;
  notFoundMessage: string | null;
  notFoundButtonLabel: string | null;
  notFoundButtonHref: string | null;
  /** `(site)` layout'unda `<style>` olarak gömülür — ASLA kök `app/layout.tsx`'te DEĞİL. */
  customCss: string | null;
  /** `CUSTOM_CODE_ENABLED=false` iken HER ZAMAN `null` (kill switch). */
  customJs: string | null;
}

/**
 * `PATCH /admin/appearance` gövdesi — TÜM alanlar opsiyoneldir, yalnızca gönderilenler yazılır.
 * `customCss`/`customJs`/`pageHeaderBackgroundUrl` bu gövdede KASITLI olarak YOKTUR.
 */
export interface UpdateSiteAppearanceRequest {
  presetKey?: string | null;
  pageHeaderStyle?: PageHeaderStyle;
  /** Sadece `pageHeaderStyle=BANNER` iken sitede etkilidir. */
  pageHeaderLayout?: PageHeaderLayout;
  pageHeaderBackgroundColor?: string | null;
  pageHeaderBackgroundMediaId?: string | null;
  pageHeaderOverlayOpacity?: number;
  primaryColor?: string;
  secondaryColor?: string;
  buttonColor?: string;
  buttonTextColor?: string;
  linkColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  surfaceColor?: string;
  textColor?: string;
  mutedTextColor?: string;
  headingFont?: SiteFont;
  bodyFont?: SiteFont;
  baseFontSize?: number;
  borderRadius?: SiteBorderRadius;
  buttonStyle?: SiteButtonStyle;
  socialShareEnabled?: boolean;
  /** Tam değiştirme (replace) semantiği — gönderilen dizi mevcut seçimin YERİNE geçer. */
  socialShareNetworks?: SocialShareNetwork[];
  backToTopEnabled?: boolean;
  stickyHeaderEnabled?: boolean;
  cookieBannerEnabled?: boolean;
  cookieBannerText?: string | null;
  cookieBannerPolicyHref?: string | null;
  maintenanceModeEnabled?: boolean;
  maintenanceMessage?: string | null;
  notFoundTitle?: string | null;
  notFoundMessage?: string | null;
  notFoundButtonLabel?: string | null;
  notFoundButtonHref?: string | null;
}

export interface ResetAppearanceRequest {
  /** Verilirse o ön ayarın değerlerine, verilmezse/`null` ise fabrika `DEFAULTS`'una dönülür. */
  presetKey?: string | null;
}

/** `GET /admin/appearance/presets` öğesi — kod içi statik registry (DB tablosu YOKTUR). */
export interface AppearancePreset {
  key: string;
  label: string;
  description: string;
  /** `PATCH /admin/appearance` gövdesine OLDUĞU GİBİ gönderilebilecek alanlar (yalnızca renk/tipografi). */
  values: UpdateSiteAppearanceRequest;
}

/** `GET /admin/appearance/custom-code` ve iki PUT ucunun yanıtı. */
export interface SiteCustomCode {
  css: string | null;
  /** `CUSTOM_CODE_ENABLED=false` iken saklanan değer bu yönetim ucunda GÖRÜNMEYE devam eder. */
  js: string | null;
  cssUpdatedAt: string | null;
  cssUpdatedBy: UserSummary | null;
  jsUpdatedAt: string | null;
  jsUpdatedBy: UserSummary | null;
  /** Ortamın kill switch durumu (`CUSTOM_CODE_ENABLED`). */
  customCodeEnabled: boolean;
}

export interface UpdateCustomCssRequest {
  /** Belgenin TAMAMI (PUT). `null`/`""` = özel CSS'i kaldır. */
  css: string | null;
  /** `css` boş değilse `true` OLMAK ZORUNDADIR (sunucu `422` ile zorlar). */
  acknowledged: boolean;
}

export interface UpdateCustomJsRequest {
  js: string | null;
  acknowledged: boolean;
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

/**
 * 1 Tıkla Hazır Demo / Şablon İçe Aktarıcı — bkz. `.claude/architect-scope-demo-template-import.md`
 * ve `openapi.yaml` `DemoTemplates` tag'i (tek doğruluk kaynağı). Şablonun TAM içeriği (blok ağacı,
 * katmanlar, metinler) backend'de kod içi statik bir registry'dedir ve HİÇBİR API yanıtında dönmez —
 * bu tipler yalnızca panel kartı + içe aktarma sonucu için gereken ÖZET şekli yansıtır.
 */
export type DemoTemplateReplacesField = "appearance" | "siteSettings" | "navigation" | "footer" | "socialLinks" | "homePage";

export interface DemoTemplateContents {
  pages: number;
  sliders: number;
  slides: number;
  portfolioCategories: number;
  portfolioItems: number;
  navigationItems: number;
  footerColumns: number;
  mediaAssets: number;
}

/** `GET /admin/demo-templates` öğesi. */
export interface DemoTemplateSummary {
  key: string;
  version: string;
  name: string;
  description: string;
  /** Frontend statiği (`Media` DEĞİL) — göreli yol, frontend kendi origin'iyle çözer. */
  previewImageUrl: string;
  tags: string[];
  /** Kartta gösterilecek renk örnekleri (hex) — yalnızca SUNUM amaçlı. */
  palette: string[];
  /** Şablon uygulandığında OLUŞACAK kayıt sayıları — onay diyaloğunda gösterilir. */
  contents: DemoTemplateContents;
  /** Yıkıcılık matrisi — bu şablon uygulandığında ÜZERİNE YAZILACAK/SİLİNECEK alanlar. Onay
   *  diyaloğunda madde madde gösterilmesi ZORUNLUDUR. */
  replaces?: DemoTemplateReplacesField[];
  /** `null` = bu şablon hiç uygulanmadı. */
  appliedAt: string | null;
  appliedVersion?: string | null;
  appliedById?: string | null;
  appliedByName?: string | null;
  appliedPageId?: string | null;
}

export interface ImportDemoTemplateRequest {
  /** ZORUNLU ve `true` olmak ZORUNDA (aksi hâlde `422`). */
  confirm: true;
  /** Şablon daha önce uygulanmışsa `409`'u geçer. Varsayılan: `false`. */
  force?: boolean;
  /** `true` iken oluşturulan sayfa `SiteSettings.homePageId` olur. Varsayılan: `true`. */
  setAsHomePage?: boolean;
}

export interface DemoTemplateImportCounts {
  media: number;
  portfolioCategories: number;
  portfolioItems: number;
  navigationItems: number;
  footerColumns: number;
  footerLinks: number;
  socialLinks: number;
  slides: number;
}

/** `POST /admin/demo-templates/{templateKey}/import` (`201`) yanıtı. */
export interface DemoTemplateImportResult {
  templateKey: string;
  version: string;
  importedAt: string;
  pageId: string;
  /** Slug çakışması nedeniyle benzersizleştirilmiş OLABİLİR (bkz. `warnings`). */
  pageSlug?: string;
  setAsHomePage?: boolean;
  /** Şablon slider getirmiyorsa `null`. */
  sliderId?: string | null;
  counts: DemoTemplateImportCounts;
  /** ENGELLEMEYEN uyarılar — başarısızlık DEĞİLDİR, yanıt yine `201`'dir. */
  warnings: string[];
}

/** `409 CONFLICT` gövdesindeki `error.details` şekli (bkz. openapi.yaml §6.4). */
export interface DemoTemplateConflictDetails {
  templateKey: string;
  importedAt: string;
  importedBy: string | null;
  version: string;
  pageId: string | null;
}
