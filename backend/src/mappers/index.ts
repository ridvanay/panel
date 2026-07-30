import type { User, Organization, Membership, Invitation, Plan, Subscription, Page, BlogCategory, BlogPost, Media } from "@prisma/client";
import type {
  UserDto,
  OrganizationDto,
  MembershipDto,
  InvitationDto,
  PlanDto,
  SubscriptionDto,
  PageDto,
  BlogCategoryDto,
  BlogPostDto,
  MediaDto,
} from "../schemas/entities";
import { env } from "../config/env";

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toOrganizationDto(org: Organization): OrganizationDto {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    ownerId: org.ownerId,
    createdAt: org.createdAt.toISOString(),
  };
}

type MembershipWithUser = Membership & {
  user: Pick<User, "id" | "name" | "email" | "avatarUrl">;
};

export function toMembershipDto(membership: MembershipWithUser): MembershipDto {
  return {
    id: membership.id,
    userId: membership.userId,
    organizationId: membership.organizationId,
    role: membership.role,
    status: membership.status,
    user: {
      id: membership.user.id,
      name: membership.user.name,
      email: membership.user.email,
      avatarUrl: membership.user.avatarUrl,
    },
    createdAt: membership.createdAt.toISOString(),
  };
}

export function toInvitationDto(invitation: Invitation): InvitationDto {
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: invitation.role as "ADMIN" | "MEMBER",
    status: invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
  };
}

export function toPlanDto(plan: Plan): PlanDto {
  return {
    id: plan.id,
    name: plan.name,
    priceMonthlyCents: plan.priceMonthlyCents,
    priceYearlyCents: plan.priceYearlyCents,
    currency: plan.currency,
    limits: (plan.limits as Record<string, number>) ?? {},
  };
}

type SubscriptionWithPlan = Subscription & { plan: Plan };

export function toSubscriptionDto(subscription: SubscriptionWithPlan): SubscriptionDto {
  return {
    id: subscription.id,
    organizationId: subscription.organizationId,
    plan: toPlanDto(subscription.plan),
    status: subscription.status,
    currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
  };
}

export function toPageDto(page: Page): PageDto {
  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    status: page.status,
    blocks: (page.blocks as Record<string, unknown>[]) ?? [],
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    publishedAt: page.publishedAt ? page.publishedAt.toISOString() : null,
    viewCount: page.viewCount,
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  };
}

export function toBlogCategoryDto(category: BlogCategory): BlogCategoryDto {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    createdAt: category.createdAt.toISOString(),
  };
}

type BlogPostWithCategory = BlogPost & { category: BlogCategory | null };

export function toMediaDto(media: Media): MediaDto {
  return {
    id: media.id,
    url: `${env.PUBLIC_URL}${media.url}`,
    filename: media.filename,
    mimeType: media.mimeType,
    sizeBytes: media.sizeBytes,
    createdAt: media.createdAt.toISOString(),
  };
}

export function toBlogPostDto(post: BlogPostWithCategory): BlogPostDto {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    contentHtml: post.contentHtml,
    coverImageUrl: post.coverImageUrl,
    status: post.status,
    category: post.category ? toBlogCategoryDto(post.category) : null,
    publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
    viewCount: post.viewCount,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}
