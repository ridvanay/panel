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
  setPasswordUrl?: string;
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

export interface UpdateUserRequest {
  name?: string;
  avatarUrl?: string;
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
}

export interface Page<T> {
  items: T[];
  meta: PageMeta;
}

export type ContentStatus = "DRAFT" | "PUBLISHED";

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
  publishedAt: string | null;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSitePageRequest {
  title: string;
  slug?: string;
  status?: ContentStatus;
  blocks?: Record<string, unknown>[];
  seoTitle?: string;
  seoDescription?: string;
}

export interface UpdateSitePageRequest {
  title?: string;
  slug?: string;
  status?: ContentStatus;
  blocks?: Record<string, unknown>[];
  seoTitle?: string | null;
  seoDescription?: string | null;
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
  publishedAt: string | null;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBlogPostRequest {
  title: string;
  slug?: string;
  excerpt?: string;
  contentHtml?: string;
  coverImageUrl?: string;
  status?: ContentStatus;
  categoryId?: string | null;
}

export interface DailyViewStats {
  date: string;
  pageViews: number;
  postViews: number;
}

export interface Media {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
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
  categoryId?: string | null;
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
