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
  | "INTERNAL_ERROR"
  | "NETWORK_ERROR";

export type MembershipRole = "OWNER" | "ADMIN" | "MEMBER";
export type MembershipStatus = "ACTIVE" | "INVITED" | "SUSPENDED";
export type InvitationStatus = "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
export type SubscriptionStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "INCOMPLETE";

export type SiteRole = "ADMIN" | "EDITOR" | "VIEWER";
export type SiteUserStatus = "ACTIVE" | "SUSPENDED";

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerifiedAt: string | null;
  role: SiteRole;
  createdAt: string;
  twoFactorEnabled: boolean;
}

/**
 * `/admin/users` uçlarının döndürdüğü kullanıcı kaydı — `User`'dan farklı olarak
 * yönetim listesine özgü `status` ve `lastLoginAt` alanlarını da içerir.
 */
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerifiedAt: string | null;
  role: SiteRole;
  createdAt: string;
  status: SiteUserStatus;
  lastLoginAt: string | null;
}

export interface CreateAdminUserRequest {
  name: string;
  email: string;
  role?: SiteRole;
}

export interface CreateAdminUserResponse {
  user: AdminUser;
  emailStatus: "sent" | "failed";
}

export interface UpdateUserRoleRequest {
  role: SiteRole;
}

export interface UpdateUserStatusRequest {
  status: SiteUserStatus;
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
 * `Page`/`BlogPost` çeviri gölgesi — TR kanonik kolonlar, `translations.EN` yalnızca
 * override taşır (kısmi olabilir). Bkz. ARCHITECTURE.md §10.5.
 */
export type ContentTranslations = Record<string, Record<string, unknown>>;

// Not: `Page<T>` yukarıda sayfalama zarfı olarak kullanıldığı için site sayfası
// varlığı çakışmasın diye `SitePage` adlandırıldı.
export interface SitePage {
  id: string;
  title: string;
  slug: string;
  status: ContentStatus;
  blocks: Record<string, unknown>[];
  seoTitle: string | null;
  seoDescription: string | null;
  ogTitle: string | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
  translations: ContentTranslations;
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
  /** `status === "SCHEDULED"` iken ZORUNLU ve gelecekte bir tarih olmalı (backend 422 ile reddeder). */
  scheduledAt?: string | null;
  blocks?: Record<string, unknown>[];
  seoTitle?: string;
  seoDescription?: string;
  ogTitle?: string | null;
  ogImageUrl?: string | null;
  canonicalUrl?: string | null;
  noIndex?: boolean;
  translations?: ContentTranslations;
  /** Verilmezse giriş yapmış kullanıcı yazar olur; başka id atamak yalnızca ADMIN'e açıktır. */
  authorId?: string;
}

export interface UpdateSitePageRequest {
  title?: string;
  slug?: string;
  status?: ContentStatus;
  /** `status === "SCHEDULED"` iken ZORUNLU ve gelecekte bir tarih olmalı (backend 422 ile reddeder). */
  scheduledAt?: string | null;
  blocks?: Record<string, unknown>[];
  seoTitle?: string | null;
  seoDescription?: string | null;
  ogTitle?: string | null;
  ogImageUrl?: string | null;
  canonicalUrl?: string | null;
  noIndex?: boolean;
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

export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  contentHtml: string;
  coverImageUrl: string | null;
  status: ContentStatus;
  category: BlogCategory | null;
  seoTitle: string | null;
  seoDescription: string | null;
  ogTitle: string | null;
  ogImageUrl: string | null;
  canonicalUrl: string | null;
  noIndex: boolean;
  translations: ContentTranslations;
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
  createdAt: string;
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

/** Sıralı ürün galerisi öğesi — bu fazda YAZMA ucu YOK (yalnızca okunur, bkz. görev notu). */
export interface ProductImage {
  id: string;
  media: Media;
  order: number;
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

/** Sıralı portföy galerisi öğesi — bu fazda YAZMA ucu YOK, `ProductImage` ile AYNI patern. */
export interface PortfolioImage {
  id: string;
  media: Media;
  order: number;
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

export type OrderStatus = "PENDING" | "PAID" | "FAILED" | "CANCELLED" | "EXPIRED" | "REFUNDED" | "FULFILLED";

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
  createdAt: string;
  items: OrderItem[];
}

/** `PATCH /admin/orders/:orderId/status` — sadece `PENDING→CANCELLED`, `PAID→FULFILLED` izinli. */
export interface UpdateOrderStatusRequest {
  status: OrderStatus;
}

export interface SiteSettings {
  siteName: string;
  logoUrl: string | null;
  homePageId: string | null;
}

export interface UpdateSiteSettingsRequest {
  siteName?: string;
  logoUrl?: string | null;
  homePageId?: string | null;
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
 * `/admin/pages/{id}/revisions` ve `/admin/blog/{id}/revisions` uçları.
 */
export type ContentEntityType = "PAGE" | "BLOG_POST";

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

export interface NavigationItemDto {
  id: string;
  label: string;
  href: string;
  order: number;
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

/** PUT body: `id` alanları yok — id'ler yalnızca form state/React key amaçlı, backend'e gönderilmeden önce strip edilir. */
export interface UpdateNavigationConfigRequest {
  headerCtaLabel?: string | null;
  headerCtaHref?: string | null;
  footerCopyrightText?: string | null;
  navigationItems: { label: string; href: string; order: number }[];
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
 * E-posta & Bildirim Şablonu Yöneticisi — bkz. ARCHITECTURE.md §10.3.
 * `/admin/notifications/templates` uçları.
 */
export type EmailTemplateKey = "WELCOME" | "PASSWORD_RESET" | "SYSTEM_ANNOUNCEMENT";

export interface EmailTemplate {
  id: string;
  key: EmailTemplateKey;
  name: string;
  subject: string;
  bodyHtml: string;
  availableVariables: string[];
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

/**
 * Toplu İçe Aktarma (Import) — bkz. ARCHITECTURE.md §10.8, openapi.yaml `Import` tag'i.
 * `/admin/import/*` uçları — yalnızca ADMIN.
 */

/** İçe aktarmanın HEDEFİ (dosya formatı değil — o `ImportSourceFormat`'tır). */
export type ImportJobType = "PAGES" | "BLOG" | "WORDPRESS" | "USERS" | "MEDIA";

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
  | "UNMAPPED_COLUMNS";

export interface ImportJobWarning {
  code: ImportJobWarningCode;
  /** Gösterime hazır Türkçe metin — mantık İÇİN `code` kullanılır, bu yalnızca gösterimdir. */
  message: string;
  count?: number;
}

/** Yalnızca `WORDPRESS` için: WXR `wp:post_type` kırılımı. */
export interface ImportJobBreakdown {
  pages?: number;
  posts?: number;
  attachments?: number;
  categories?: number;
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
  /** Verilmezse `preview.suggestedMapping` kullanılır. `WORDPRESS`/`MEDIA`'da yok sayılır. */
  fieldMapping?: ImportFieldMapping;
  /** Varsayılan `skip`. */
  duplicateStrategy?: ImportDuplicateStrategy;
  /** `PAGES`/`BLOG` içe aktarımında kaynakta `status` yoksa uygulanacak varsayılan (varsayılanın varsayılanı `DRAFT`). */
  defaultStatus?: ContentStatus;
  /** Yazarı çözümlenemeyen kayıtlara atanacak kullanıcı. İçe aktarma HİÇBİR KOŞULDA kendiliğinden kullanıcı oluşturmaz. */
  defaultAuthorId?: string | null;
  /** `BLOG` (CSV/JSON) için kategorisi çözümlenemeyen yazılara atanacak kategori. */
  defaultCategoryId?: string | null;
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
