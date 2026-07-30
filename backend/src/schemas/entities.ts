import { z } from "zod";

/**
 * ../../../docs/architecture/shared-types.ts ve openapi.yaml component şemalarının
 * Zod karşılığı. Alan adları/tipleri iki tarafta da birebir aynı tutulmalıdır.
 */

export const MembershipRoleSchema = z.enum(["OWNER", "ADMIN", "MEMBER"]);
export const MembershipStatusSchema = z.enum(["ACTIVE", "INVITED", "SUSPENDED"]);
export const InvitationStatusSchema = z.enum(["PENDING", "ACCEPTED", "EXPIRED", "REVOKED"]);
export const SubscriptionStatusSchema = z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "INCOMPLETE"]);
export const PageStatusSchema = z.enum(["DRAFT", "PUBLISHED"]);

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  emailVerifiedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type UserDto = z.infer<typeof UserSchema>;

export const OrganizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  ownerId: z.string().uuid(),
  createdAt: z.string(),
});
export type OrganizationDto = z.infer<typeof OrganizationSchema>;

export const MembershipSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  organizationId: z.string().uuid(),
  role: MembershipRoleSchema,
  status: MembershipStatusSchema,
  user: z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().email(),
    avatarUrl: z.string().nullable(),
  }),
  createdAt: z.string(),
});
export type MembershipDto = z.infer<typeof MembershipSchema>;

export const InvitationSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(["ADMIN", "MEMBER"]),
  status: InvitationStatusSchema,
  expiresAt: z.string(),
  createdAt: z.string(),
});
export type InvitationDto = z.infer<typeof InvitationSchema>;

export const PlanSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  priceMonthlyCents: z.number().int(),
  priceYearlyCents: z.number().int(),
  currency: z.string(),
  limits: z.record(z.number()),
});
export type PlanDto = z.infer<typeof PlanSchema>;

export const SubscriptionSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  plan: PlanSchema,
  status: SubscriptionStatusSchema,
  currentPeriodEnd: z.string(),
  cancelAtPeriodEnd: z.boolean(),
});
export type SubscriptionDto = z.infer<typeof SubscriptionSchema>;

export const PageSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  status: PageStatusSchema,
  blocks: z.array(z.record(z.unknown())),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  publishedAt: z.string().nullable(),
  viewCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PageDto = z.infer<typeof PageSchema>;

export const BlogCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string(),
});
export type BlogCategoryDto = z.infer<typeof BlogCategorySchema>;

export const BlogPostSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  excerpt: z.string().nullable(),
  contentHtml: z.string(),
  coverImageUrl: z.string().nullable(),
  status: PageStatusSchema,
  category: BlogCategorySchema.nullable(),
  publishedAt: z.string().nullable(),
  viewCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BlogPostDto = z.infer<typeof BlogPostSchema>;

export const MediaSchema = z.object({
  id: z.string().uuid(),
  url: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  createdAt: z.string(),
});
export type MediaDto = z.infer<typeof MediaSchema>;

export const SiteSettingsSchema = z.object({
  siteName: z.string(),
  logoUrl: z.string().nullable(),
});
export type SiteSettingsDto = z.infer<typeof SiteSettingsSchema>;

export const AuthTokensSchema = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.string(),
});
export type AuthTokensDto = z.infer<typeof AuthTokensSchema>;

export const AuthSessionSchema = z.object({
  user: UserSchema,
  memberships: z.array(
    z.object({
      organizationId: z.string().uuid(),
      role: MembershipRoleSchema,
    })
  ),
});
export type AuthSessionDto = z.infer<typeof AuthSessionSchema>;

export const AuthResponseSchema = z.object({
  user: UserSchema,
  tokens: AuthTokensSchema,
});
export type AuthResponseDto = z.infer<typeof AuthResponseSchema>;
