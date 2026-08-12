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
  MediaFolder,
  SiteSettings,
  AuditLog,
  NavigationItem,
  SocialLink,
  FooterColumn,
  FooterLink,
  ContentRevision,
  EmailTemplate,
  RefreshToken,
  ImportJob,
  ImportJobError,
  ExportJob,
  SiteModule,
  ProductCategory,
  Product,
  ProductImage,
  PortfolioCategory,
  PortfolioItem,
  PortfolioImage,
  CartItem,
  Order,
  OrderItem,
  SiteAppearance,
  SiteCustomCode,
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
  MediaFolderDto,
  SiteSettingsDto,
  NavigationConfigDto,
  ContentRevisionSummaryDto,
  ContentRevisionDto,
  EmailTemplateDto,
  SessionDto,
  UserSummaryDto,
  ImportJobSummaryDto,
  ImportJobDto,
  ImportJobErrorDto,
  ImportJobPreviewDto,
  ExportJobDto,
  SiteModuleDto,
  ProductCategoryDto,
  ProductDto,
  ProductImageDto,
  PortfolioCategoryDto,
  PortfolioItemDto,
  PortfolioImageDto,
  CartDto,
  CartItemDto,
  OrderDto,
  OrderItemDto,
  SiteAppearanceDto,
  PublicSiteAppearanceDto,
  SiteCustomCodeDto,
} from "../schemas/entities";
import { env } from "../config/env";
import {
  computeBlogPostSeoScore,
  computePageSeoScore,
  computePortfolioItemSeoScore,
  computeProductSeoScore,
} from "../lib/seo-score";
import { DUPLICATE_STRATEGY_FROM_PRISMA, SEVERITY_FROM_PRISMA } from "../modules/import/import.constants";
import type { ModuleDefinition } from "../lib/module-registry";

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

/** Yazar özeti — hassas alan (rol/durum/e-posta doğrulaması) TAŞIMAZ (bkz. ARCHITECTURE.md §10.7). */
export function toUserSummaryDto(user: User): UserSummaryDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
  };
}

type PageWithAuthor = Page & { author?: User | null };

export function toPageDto(page: PageWithAuthor): PageDto {
  const { score, issues } = computePageSeoScore(page);

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
    scheduledAt: page.scheduledAt ? page.scheduledAt.toISOString() : null,
    viewCount: page.viewCount,
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
    // ---- §10.7 İçerik Yönetim Listesi ----
    deletedAt: page.deletedAt ? page.deletedAt.toISOString() : null,
    authorId: page.authorId,
    author: page.author ? toUserSummaryDto(page.author) : null,
    seoScore: score,
    seoScoreIssues: issues,
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

type BlogPostWithCategory = BlogPost & { category: BlogCategory | null; author?: User | null };

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
    width: media.width,
    height: media.height,
    altText: media.altText,
    // §10.11 Medya Kütüphanesi — Klasör Sistemi. `null` = "Kategorisiz".
    folderId: media.folderId,
    createdAt: media.createdAt.toISOString(),
  };
}

// §10.11 Medya Kütüphanesi — Klasör Sistemi. `mediaCount` TEK sorguda `_count` ile gelir
// (bkz. media.routes.ts::GET /admin/media/folders) — N+1 sorgu YASAK.
type MediaFolderWithCount = MediaFolder & { _count: { media: number } };

export function toMediaFolderDto(folder: MediaFolderWithCount): MediaFolderDto {
  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    mediaCount: folder._count.media,
    createdAt: folder.createdAt.toISOString(),
  };
}

export function toSiteSettingsDto(settings: SiteSettings): SiteSettingsDto {
  return {
    siteName: settings.siteName,
    logoUrl: settings.logoUrl,
    tagline: settings.tagline,
    headerLogoHeight: settings.headerLogoHeight,
    headerLogoMaxWidth: settings.headerLogoMaxWidth,
    homePageId: settings.homePageId,
    siteTemplate: settings.siteTemplate,
  };
}

/**
 * §10.9 Eklenti/Modül Yönetimi — statik registry TANIMINI (`ModuleDefinition`) `SiteModule`
 * tablosundaki durum satırıyla (varsa) birleştirir. `row` YOKSA (henüz hiç toggle edilmemiş)
 * `definition.defaultEnabled` fallback olur, `updatedAt`/`updatedBy` `null` döner.
 */
export function toSiteModuleDto(
  definition: ModuleDefinition,
  row: (SiteModule & { updatedBy: User | null }) | null
): SiteModuleDto {
  return {
    key: definition.key,
    label: definition.label,
    description: definition.description,
    enabled: row ? row.enabled : definition.defaultEnabled,
    updatedAt: row ? row.updatedAt.toISOString() : null,
    updatedBy: row?.updatedBy ? toUserSummaryDto(row.updatedBy) : null,
    recommendedFor: definition.recommendedFor,
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
      parentId: item.parentId,
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
  const { score, issues } = computeBlogPostSeoScore(post);

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
    scheduledAt: post.scheduledAt ? post.scheduledAt.toISOString() : null,
    viewCount: post.viewCount,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    // ---- §10.7 İçerik Yönetim Listesi ----
    deletedAt: post.deletedAt ? post.deletedAt.toISOString() : null,
    authorId: post.authorId,
    author: post.author ? toUserSummaryDto(post.author) : null,
    seoScore: score,
    seoScoreIssues: issues,
  };
}

export function toProductCategoryDto(category: ProductCategory): ProductCategoryDto {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    createdAt: category.createdAt.toISOString(),
  };
}

type ProductImageWithMedia = ProductImage & { media: Media };

function toProductImageDto(image: ProductImageWithMedia): ProductImageDto {
  return {
    id: image.id,
    media: toMediaDto(image.media),
    order: image.order,
  };
}

type ProductWithRelations = Product & {
  category: ProductCategory | null;
  coverMedia: Media | null;
  author?: User | null;
  images?: ProductImageWithMedia[];
};

export function toProductDto(product: ProductWithRelations): ProductDto {
  const { score, issues } = computeProductSeoScore({
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    ogImageUrl: product.ogImageUrl,
    descriptionHtml: product.descriptionHtml,
    coverMediaUrl: product.coverMedia ? absolutizeMediaUrl(product.coverMedia.url) : null,
  });

  return {
    id: product.id,
    title: product.title,
    slug: product.slug,
    excerpt: product.excerpt,
    descriptionHtml: product.descriptionHtml,
    priceCents: product.priceCents,
    currency: product.currency,
    taxRatePercent: product.taxRatePercent !== null && product.taxRatePercent !== undefined ? Number(product.taxRatePercent) : null,
    discountPriceCents: product.discountPriceCents,
    sku: product.sku,
    stockQuantity: product.stockQuantity,
    status: product.status,
    category: product.category ? toProductCategoryDto(product.category) : null,
    coverMedia: product.coverMedia ? toMediaDto(product.coverMedia) : null,
    images: (product.images ?? []).map(toProductImageDto),
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    ogTitle: product.ogTitle,
    ogImageUrl: product.ogImageUrl,
    canonicalUrl: product.canonicalUrl,
    noIndex: product.noIndex,
    translations: (product.translations as Record<string, Record<string, unknown>>) ?? {},
    publishedAt: product.publishedAt ? product.publishedAt.toISOString() : null,
    scheduledAt: product.scheduledAt ? product.scheduledAt.toISOString() : null,
    viewCount: product.viewCount,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
    // ---- §10.7 İçerik Yönetim Listesi ----
    deletedAt: product.deletedAt ? product.deletedAt.toISOString() : null,
    authorId: product.authorId,
    author: product.author ? toUserSummaryDto(product.author) : null,
    seoScore: score,
    seoScoreIssues: issues,
  };
}

export function toPortfolioCategoryDto(category: PortfolioCategory): PortfolioCategoryDto {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    createdAt: category.createdAt.toISOString(),
  };
}

type PortfolioImageWithMedia = PortfolioImage & { media: Media };

function toPortfolioImageDto(image: PortfolioImageWithMedia): PortfolioImageDto {
  return {
    id: image.id,
    media: toMediaDto(image.media),
    order: image.order,
  };
}

type PortfolioItemWithRelations = PortfolioItem & {
  category: PortfolioCategory | null;
  coverMedia: Media | null;
  author?: User | null;
  images?: PortfolioImageWithMedia[];
};

export function toPortfolioItemDto(item: PortfolioItemWithRelations): PortfolioItemDto {
  const { score, issues } = computePortfolioItemSeoScore({
    seoTitle: item.seoTitle,
    seoDescription: item.seoDescription,
    ogImageUrl: item.ogImageUrl,
    contentHtml: item.contentHtml,
    coverMediaUrl: item.coverMedia ? absolutizeMediaUrl(item.coverMedia.url) : null,
  });

  return {
    id: item.id,
    title: item.title,
    slug: item.slug,
    summary: item.summary,
    contentHtml: item.contentHtml,
    clientName: item.clientName,
    projectUrl: item.projectUrl,
    completedAt: item.completedAt ? item.completedAt.toISOString() : null,
    order: item.order,
    status: item.status,
    category: item.category ? toPortfolioCategoryDto(item.category) : null,
    coverMedia: item.coverMedia ? toMediaDto(item.coverMedia) : null,
    images: (item.images ?? []).map(toPortfolioImageDto),
    seoTitle: item.seoTitle,
    seoDescription: item.seoDescription,
    ogTitle: item.ogTitle,
    ogImageUrl: item.ogImageUrl,
    canonicalUrl: item.canonicalUrl,
    noIndex: item.noIndex,
    translations: (item.translations as Record<string, Record<string, unknown>>) ?? {},
    publishedAt: item.publishedAt ? item.publishedAt.toISOString() : null,
    scheduledAt: item.scheduledAt ? item.scheduledAt.toISOString() : null,
    viewCount: item.viewCount,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    // ---- §10.7 İçerik Yönetim Listesi ----
    deletedAt: item.deletedAt ? item.deletedAt.toISOString() : null,
    authorId: item.authorId,
    author: item.author ? toUserSummaryDto(item.author) : null,
    seoScore: score,
    seoScoreIssues: issues,
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

type ImportJobWithCreator = ImportJob & { createdBy?: User | null };

export function toImportJobSummaryDto(job: ImportJobWithCreator): ImportJobSummaryDto {
  return {
    id: job.id,
    type: job.type,
    format: job.format,
    status: job.status,
    duplicateStrategy: job.duplicateStrategy ? DUPLICATE_STRATEGY_FROM_PRISMA[job.duplicateStrategy] : null,
    filename: job.filename,
    sizeBytes: job.sizeBytes,
    totalCount: job.totalCount,
    processedCount: job.processedCount,
    successCount: job.successCount,
    errorCount: job.errorCount,
    skippedCount: job.skippedCount,
    errorSummary: job.errorSummary,
    createdById: job.createdById,
    createdBy: job.createdBy ? toUserSummaryDto(job.createdBy) : null,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
  };
}

export function toImportJobDto(job: ImportJobWithCreator): ImportJobDto {
  return {
    ...toImportJobSummaryDto(job),
    preview: (job.preview as ImportJobPreviewDto | null) ?? null,
  };
}

export function toImportJobErrorDto(row: ImportJobError): ImportJobErrorDto {
  return {
    id: row.id,
    rowNumber: row.rowNumber,
    code: row.code as ImportJobErrorDto["code"],
    message: row.message,
    severity: SEVERITY_FROM_PRISMA[row.severity],
    field: row.field,
    sourceRef: row.sourceRef,
    rawData: (row.rawData as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

type ExportJobWithCreator = ExportJob & { createdBy?: User | null };

/** §10.8.10 — `storagePath` BİLEREK dönmez (bkz. schemas/entities.ts::ExportJobSchema notu). */
export function toExportJobDto(job: ExportJobWithCreator): ExportJobDto {
  return {
    id: job.id,
    type: job.type,
    format: job.format,
    status: job.status,
    filters: (job.filters as Record<string, unknown>) ?? {},
    containsPii: job.containsPii,
    errorSummary: job.errorSummary,
    createdById: job.createdById,
    createdBy: job.createdBy ? toUserSummaryDto(job.createdBy) : null,
    expiresAt: job.expiresAt ? job.expiresAt.toISOString() : null,
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

// ---------- §10.9.3 Sepet + Stripe Checkout ----------

type CartItemWithProduct = CartItem & {
  product: Pick<Product, "id" | "title" | "slug" | "stockQuantity" | "priceCents" | "discountPriceCents"> & {
    coverMedia: Media | null;
  };
};

/** `frozenUnitPriceCents` (sepete eklenme anı) ile `currentPriceCents` (DB'den taze, indirimliyse
 * indirim fiyatı) AYRI döner — bkz. schemas/entities.ts::CartItemSchema notu. */
export function toCartItemDto(item: CartItemWithProduct): CartItemDto {
  const currentPriceCents = item.product.discountPriceCents ?? item.product.priceCents;

  return {
    id: item.id,
    productId: item.productId,
    product: {
      id: item.product.id,
      title: item.product.title,
      slug: item.product.slug,
      coverImageUrl: item.product.coverMedia ? absolutizeMediaUrl(item.product.coverMedia.url) : null,
      stockQuantity: item.product.stockQuantity,
    },
    quantity: item.quantity,
    frozenUnitPriceCents: item.unitPriceCents,
    currentPriceCents,
    lineTotalCents: item.unitPriceCents * item.quantity,
  };
}

export function toCartDto(items: CartItemWithProduct[], currency: string | null): CartDto {
  const mapped = items.map(toCartItemDto);
  return {
    items: mapped,
    currency,
    subtotalCents: mapped.reduce((sum, item) => sum + item.lineTotalCents, 0),
  };
}

export function toOrderItemDto(item: OrderItem): OrderItemDto {
  return {
    id: item.id,
    productId: item.productId,
    productTitle: item.productTitle,
    productSku: item.productSku,
    unitPriceCents: item.unitPriceCents,
    quantity: item.quantity,
    lineTotalCents: item.lineTotalCents,
  };
}

type OrderWithItems = Order & { items: OrderItem[] };

export function toOrderDto(order: OrderWithItems): OrderDto {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    customerEmail: order.customerEmail,
    customerName: order.customerName,
    currency: order.currency,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
    errorSummary: order.errorSummary,
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map(toOrderItemDto),
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

// ---------- §10.12 Site Özelleştirme (Görünüm) ----------

type SiteAppearanceWithMedia = SiteAppearance & { pageHeaderBackgroundMedia: Media | null };

/**
 * `GET /admin/appearance` ve `PATCH /admin/appearance` yanıtı. `pageHeaderBackgroundUrl` —
 * türetilmiş/salt-okunur alan — `pageHeaderBackgroundMediaId`'nin sunucuda çözümlenmiş URL'idir
 * (bkz. ARCHITECTURE.md §10.12.2, mevcut `coverMediaId` paterniyle AYNI).
 */
export function toSiteAppearanceDto(appearance: SiteAppearanceWithMedia): SiteAppearanceDto {
  return {
    presetKey: appearance.presetKey,
    pageHeaderStyle: appearance.pageHeaderStyle,
    pageHeaderBackgroundColor: appearance.pageHeaderBackgroundColor,
    pageHeaderBackgroundMediaId: appearance.pageHeaderBackgroundMediaId,
    pageHeaderBackgroundUrl: appearance.pageHeaderBackgroundMedia ? absolutizeMediaUrl(appearance.pageHeaderBackgroundMedia.url) : null,
    pageHeaderOverlayOpacity: appearance.pageHeaderOverlayOpacity,
    primaryColor: appearance.primaryColor,
    secondaryColor: appearance.secondaryColor,
    buttonColor: appearance.buttonColor,
    buttonTextColor: appearance.buttonTextColor,
    linkColor: appearance.linkColor,
    headingFont: appearance.headingFont,
    bodyFont: appearance.bodyFont,
    baseFontSize: appearance.baseFontSize,
    socialShareEnabled: appearance.socialShareEnabled,
    socialShareNetworks: appearance.socialShareNetworks,
    backToTopEnabled: appearance.backToTopEnabled,
    stickyHeaderEnabled: appearance.stickyHeaderEnabled,
    cookieBannerEnabled: appearance.cookieBannerEnabled,
    cookieBannerText: appearance.cookieBannerText,
    cookieBannerPolicyHref: appearance.cookieBannerPolicyHref,
    maintenanceModeEnabled: appearance.maintenanceModeEnabled,
    maintenanceMessage: appearance.maintenanceMessage,
    notFoundTitle: appearance.notFoundTitle,
    notFoundMessage: appearance.notFoundMessage,
    notFoundButtonLabel: appearance.notFoundButtonLabel,
    notFoundButtonHref: appearance.notFoundButtonHref,
    updatedAt: appearance.updatedAt.toISOString(),
  };
}

/**
 * `GET /appearance` (public) yanıtı — `SiteAppearanceDto`'dan `presetKey`/
 * `pageHeaderBackgroundMediaId`/`updatedAt`'i (yalnızca yönetim ekranını ilgilendirir) ÇIKARIR,
 * `customCss`/`customJs`'İ EKLER (bkz. ARCHITECTURE.md §10.12.6 — kill switch uygulaması
 * ÇAĞIRAN TARAFTA yapılır, bu fonksiyon yalnızca ZATEN çözülmüş değerleri taşır).
 */
export function toPublicSiteAppearanceDto(appearance: SiteAppearanceDto, customCss: string | null, customJs: string | null): PublicSiteAppearanceDto {
  return {
    pageHeaderStyle: appearance.pageHeaderStyle,
    pageHeaderBackgroundColor: appearance.pageHeaderBackgroundColor,
    pageHeaderBackgroundUrl: appearance.pageHeaderBackgroundUrl,
    pageHeaderOverlayOpacity: appearance.pageHeaderOverlayOpacity,
    primaryColor: appearance.primaryColor,
    secondaryColor: appearance.secondaryColor,
    buttonColor: appearance.buttonColor,
    buttonTextColor: appearance.buttonTextColor,
    linkColor: appearance.linkColor,
    headingFont: appearance.headingFont,
    bodyFont: appearance.bodyFont,
    baseFontSize: appearance.baseFontSize,
    socialShareEnabled: appearance.socialShareEnabled,
    socialShareNetworks: appearance.socialShareNetworks,
    backToTopEnabled: appearance.backToTopEnabled,
    stickyHeaderEnabled: appearance.stickyHeaderEnabled,
    cookieBannerEnabled: appearance.cookieBannerEnabled,
    cookieBannerText: appearance.cookieBannerText,
    cookieBannerPolicyHref: appearance.cookieBannerPolicyHref,
    maintenanceModeEnabled: appearance.maintenanceModeEnabled,
    maintenanceMessage: appearance.maintenanceMessage,
    notFoundTitle: appearance.notFoundTitle,
    notFoundMessage: appearance.notFoundMessage,
    notFoundButtonLabel: appearance.notFoundButtonLabel,
    notFoundButtonHref: appearance.notFoundButtonHref,
    customCss,
    customJs,
  };
}

type SiteCustomCodeWithUpdaters = SiteCustomCode & { cssUpdatedBy: User | null; jsUpdatedBy: User | null };

/**
 * `row` `null` olabilir (hiç kaydedilmemiş, henüz satır yok) — bu durumda `DEFAULTS` gibi tüm
 * alanlar `null` döner (`GET /settings` ile AYNI lazy-upsert paterni, 404 DÖNMEZ). `customCodeEnabled`
 * — ortamın kill switch durumu (`CUSTOM_CODE_ENABLED`) — ÇAĞIRAN TARAFTAN gelir, bu tabloda bir
 * kolon DEĞİLDİR.
 */
export function toSiteCustomCodeDto(row: SiteCustomCodeWithUpdaters | null, customCodeEnabled: boolean): SiteCustomCodeDto {
  return {
    css: row?.customCss ?? null,
    js: row?.customJs ?? null,
    cssUpdatedAt: row?.cssUpdatedAt ? row.cssUpdatedAt.toISOString() : null,
    cssUpdatedBy: row?.cssUpdatedBy ? toUserSummaryDto(row.cssUpdatedBy) : null,
    jsUpdatedAt: row?.jsUpdatedAt ? row.jsUpdatedAt.toISOString() : null,
    jsUpdatedBy: row?.jsUpdatedBy ? toUserSummaryDto(row.jsUpdatedBy) : null,
    customCodeEnabled,
  };
}
