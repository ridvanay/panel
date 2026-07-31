import type {
  User,
  Organization,
  Membership,
  Invitation,
  Plan,
  Subscription,
  Page,
  BlogCategory,
  BlogPost,
  Media,
  SiteSettings,
  AuditLog,
  NavigationItem,
  SocialLink,
  FooterColumn,
  FooterLink,
  ContentRevision,
  EmailTemplate,
  RefreshToken,
} from "@prisma/client";
import type {
  UserDto,
  AdminUserDto,
  AuditLogDto,
  OrganizationDto,
  MembershipDto,
  InvitationDto,
  PlanDto,
  SubscriptionDto,
  PageDto,
  BlogCategoryDto,
  BlogPostDto,
  MediaDto,
  SiteSettingsDto,
  NavigationConfigDto,
  ContentRevisionSummaryDto,
  ContentRevisionDto,
  EmailTemplateDto,
  SessionDto,
} from "../schemas/entities";
import { env } from "../config/env";

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    // §10.4 Güvenlik & 2FA — bkz. ARCHITECTURE.md §10.4.
    twoFactorEnabled: user.twoFactorEnabled,
  };
}

export function toAdminUserDto(user: User): AdminUserDto {
  return {
    ...toUserDto(user),
    status: user.status,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
  };
}

export function toAuditLogDto(log: AuditLog): AuditLogDto {
  return {
    id: log.id,
    actorId: log.actorId,
    actorEmail: log.actorEmail,
    action: log.action,
    status: log.status,
    targetType: log.targetType,
    targetId: log.targetId,
    metadata: (log.metadata as Record<string, unknown> | null) ?? null,
    ipAddress: log.ipAddress,
    createdAt: log.createdAt.toISOString(),
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
    ogTitle: page.ogTitle,
    ogImageUrl: page.ogImageUrl,
    canonicalUrl: page.canonicalUrl,
    noIndex: page.noIndex,
    translations: (page.translations as Record<string, Record<string, unknown>>) ?? {},
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

/** S3/CDN sürücüsü zaten mutlak URL üretir; local sürücü relative `/uploads/...` yolu döner. */
function absolutizeMediaUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `${env.PUBLIC_URL}${url}`;
}

export function toMediaDto(media: Media): MediaDto {
  return {
    id: media.id,
    url: absolutizeMediaUrl(media.url),
    filename: media.filename,
    mimeType: media.mimeType,
    sizeBytes: media.sizeBytes,
    createdAt: media.createdAt.toISOString(),
  };
}

export function toSiteSettingsDto(settings: SiteSettings): SiteSettingsDto {
  return {
    siteName: settings.siteName,
    logoUrl: settings.logoUrl,
    homePageId: settings.homePageId,
  };
}

type FooterColumnWithLinks = FooterColumn & { links: FooterLink[] };

interface NavigationConfigInput {
  settings: SiteSettings | null;
  navigationItems: NavigationItem[];
  socialLinks: SocialLink[];
  footerColumns: FooterColumnWithLinks[];
}

export function toNavigationConfigDto({ settings, navigationItems, socialLinks, footerColumns }: NavigationConfigInput): NavigationConfigDto {
  return {
    headerCtaLabel: settings?.headerCtaLabel ?? null,
    headerCtaHref: settings?.headerCtaHref ?? null,
    footerCopyrightText: settings?.footerCopyrightText ?? null,
    navigationItems: navigationItems.map((item) => ({
      id: item.id,
      label: item.label,
      href: item.href,
      order: item.order,
    })),
    socialLinks: socialLinks.map((link) => ({
      id: link.id,
      platform: link.platform,
      url: link.url,
      order: link.order,
    })),
    footerColumns: footerColumns.map((column) => ({
      id: column.id,
      title: column.title,
      order: column.order,
      links: column.links
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((link) => ({
          id: link.id,
          label: link.label,
          href: link.href,
          order: link.order,
        })),
    })),
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
    seoTitle: post.seoTitle,
    seoDescription: post.seoDescription,
    ogTitle: post.ogTitle,
    ogImageUrl: post.ogImageUrl,
    canonicalUrl: post.canonicalUrl,
    noIndex: post.noIndex,
    translations: (post.translations as Record<string, Record<string, unknown>>) ?? {},
    publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
    viewCount: post.viewCount,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

export function toContentRevisionSummaryDto(revision: ContentRevision): ContentRevisionSummaryDto {
  return {
    id: revision.id,
    editedById: revision.editedById,
    editedByName: revision.editedByName,
    createdAt: revision.createdAt.toISOString(),
  };
}

export function toContentRevisionDto(revision: ContentRevision): ContentRevisionDto {
  return {
    ...toContentRevisionSummaryDto(revision),
    entityType: revision.entityType,
    entityId: revision.entityId,
    snapshot: (revision.snapshot as Record<string, unknown>) ?? {},
  };
}

/** §10.4 Güvenlik & 2FA — GET /admin/settings/security/sessions (bkz. modules/security). */
export function toSessionDto(refreshToken: RefreshToken, isCurrent: boolean): SessionDto {
  return {
    id: refreshToken.id,
    userAgent: refreshToken.userAgent,
    ipAddress: refreshToken.ipAddress,
    createdAt: refreshToken.createdAt.toISOString(),
    expiresAt: refreshToken.expiresAt.toISOString(),
    isCurrent,
  };
}

export function toEmailTemplateDto(template: EmailTemplate): EmailTemplateDto {
  return {
    id: template.id,
    key: template.key,
    name: template.name,
    subject: template.subject,
    bodyHtml: template.bodyHtml,
    availableVariables: (template.availableVariables as string[]) ?? [],
    updatedAt: template.updatedAt.toISOString(),
    createdAt: template.createdAt.toISOString(),
  };
}
