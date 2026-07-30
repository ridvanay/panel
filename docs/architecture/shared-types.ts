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

export interface NavigationItem {
  id: string;
  label: string;
  href: string;
  order: number;
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
 * gönderilen haliyle DB'deki mevcut kayıtların tamamının yerini alır (id istemciden
 * gönderilmez, sunucu yeniden üretir). `href`/`url` alanları yalnızca `http(s)://`,
 * `/` veya `#` ile başlayabilir (bkz. navigation.schemas.ts::HrefSchema).
 */
export interface UpdateNavigationConfigRequest {
  headerCtaLabel?: string | null;
  headerCtaHref?: string | null;
  footerCopyrightText?: string | null;
  navigationItems: Array<Omit<NavigationItem, "id">>;
  socialLinks: Array<Omit<SocialLink, "id">>;
  footerColumns: Array<{
    title: string;
    order: number;
    links: Array<Omit<FooterLink, "id">>;
  }>;
}
