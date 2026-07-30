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

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
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
}

export interface UpdateSiteSettingsRequest {
  siteName?: string;
  logoUrl?: string | null;
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
