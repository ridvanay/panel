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
  BlogTag,
  BlogPostTag,
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
  Slider,
  Slide,
  CartItem,
  Order,
  OrderItem,
  Address,
  WishlistItem,
  SiteAppearance,
  SiteCustomCode,
  Locale,
  ApiKey,
  OutboundWebhook,
  WebhookDelivery,
  ContactForm,
  ContactFormField,
  ContactSubmission,
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
  BlogTagDto,
  BlogPostDto,
  MediaDto,
  MediaFolderDto,
  SiteSettingsDto,
  NavigationConfigDto,
  ContentRevisionSummaryDto,
  ContentRevisionDto,
  EmailTemplateDto,
  EmailTemplateSummaryDto,
  EmailVariableDefinitionDto,
  ContactFormDto,
  ContactFormFieldDto,
  ContactSubmissionSummaryDto,
  ContactSubmissionDto,
  PublicContactFormDto,
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
  SliderSummaryDto,
  SliderDto,
  SlideDto,
  PublicSliderDto,
  PublicSlideDto,
  SliderUsageDto,
  CartDto,
  CartItemDto,
  OrderDto,
  OrderItemDto,
  AddressDto,
  WishlistItemDto,
  SiteAppearanceDto,
  PublicSiteAppearanceDto,
  SiteCustomCodeDto,
  LocaleDto,
  ContentLocalizationDto,
  ApiKeyDto,
  OutboundWebhookDto,
  WebhookDeliverySummaryDto,
  WebhookDeliveryDto,
} from "../schemas/entities";
import { env } from "../config/env";
import {
  computeBlogPostSeoScore,
  computePageSeoScore,
  computePortfolioItemSeoScore,
  computeProductSeoScore,
} from "../lib/seo-score";
import { canUseAdvancedBuilder } from "../lib/builder-capability";
import { DUPLICATE_STRATEGY_FROM_PRISMA, SEVERITY_FROM_PRISMA } from "../modules/import/import.constants";
import {
  TRANSITION_EFFECT_FROM_PRISMA,
  HEIGHT_MODE_FROM_PRISMA,
  BACKGROUND_TYPE_FROM_PRISMA,
  NAVIGATION_THEME_FROM_PRISMA,
  WIDTH_MODE_FROM_PRISMA,
  heightModeFromPrisma,
} from "../modules/sliders/lib/enum-maps";
import type { ModuleDefinition } from "../lib/module-registry";
import { buildMaskedKey } from "../lib/api-key";

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
    // `.claude/architect-scope-rbac-5-tier.md` §3 — TÜRETİLMİŞ + SALT-OKUNUR (bkz.
    // lib/builder-capability.ts, TEK türetme kaynağı; saf rol türevi, `advancedBuilderEnabled`
    // bayrağı KALDIRILDI).
    canUseAdvancedBuilder: canUseAdvancedBuilder(user),
  };
}

export function toAdminUserDto(user: User): AdminUserDto {
  return {
    ...toUserDto(user),
    status: user.status,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    deletedAt: user.deletedAt ? user.deletedAt.toISOString() : null,
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

/**
 * §10.5 Çoklu Dil & Yerelleştirme — `localizations` çağıran tarafta TEK bir toplu sorguyla
 * (bkz. lib/localization.ts::attachLocalizations, N+1 YASAK) hesaplanır ve buraya geçirilir;
 * bu fonksiyon DB'ye ERİŞMEZ (saf/senkron kalır, `computePageSeoScore` ile AYNI ilke).
 */
export function toPageDto(page: PageWithAuthor, localizations: ContentLocalizationDto[] = []): PageDto {
  const { score, issues } = computePageSeoScore(page);

  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    status: page.status,
    // §10.20 — bkz. schemas/entities.ts::PageSchema, `.claude/architect-scope-page-editor-roles.md` §2.
    editMode: page.editMode,
    blocks: (page.blocks as Record<string, unknown>[]) ?? [],
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    ogTitle: page.ogTitle,
    ogImageUrl: page.ogImageUrl,
    canonicalUrl: page.canonicalUrl,
    noIndex: page.noIndex,
    isLegalDocument: page.isLegalDocument,
    translations: (page.translations as Record<string, Record<string, unknown>>) ?? {},
    localizations,
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

// §10.14 Blog Etiketleri — `_count.posts` YALNIZCA `GET /admin/blog/tags` sorgusunda (tek
// sorguda `_count` ile, N+1 YASAK) geçirilir; `BlogPost.tags[]` içine gömülü etiketlerde
// `_count` YOKTUR, bu yüzden `postCount` o bağlamda `undefined` kalır (bkz. ARCHITECTURE.md §10.14.3/§10.14.5).
type BlogTagWithCount = BlogTag & { _count?: { posts: number } };

export function toBlogTagDto(tag: BlogTagWithCount): BlogTagDto {
  return {
    id: tag.id,
    name: tag.name,
    slug: tag.slug,
    createdAt: tag.createdAt.toISOString(),
    ...(tag._count ? { postCount: tag._count.posts } : {}),
  };
}

type BlogPostTagWithTag = BlogPostTag & { tag: BlogTag };

type BlogPostWithCategory = BlogPost & {
  category: BlogCategory | null;
  author?: User | null;
  tags?: BlogPostTagWithTag[];
};

/** S3/CDN sürücüsü zaten mutlak URL üretir; local sürücü relative `/uploads/...` yolu döner. */
export function absolutizeMediaUrl(url: string): string {
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

export function toBlogPostDto(post: BlogPostWithCategory, localizations: ContentLocalizationDto[] = []): BlogPostDto {
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
    // §10.14 — `seq ASC` sırası çağıran tarafın `include`'undaki `orderBy: { tag: { seq: "asc" } }`
    // ile garanti edilir; burada AYRICA sıralama yapılmaz (çağıran taraf tek doğruluk kaynağı).
    tags: (post.tags ?? []).map((postTag) => toBlogTagDto(postTag.tag)),
    seoTitle: post.seoTitle,
    seoDescription: post.seoDescription,
    ogTitle: post.ogTitle,
    ogImageUrl: post.ogImageUrl,
    canonicalUrl: post.canonicalUrl,
    noIndex: post.noIndex,
    translations: (post.translations as Record<string, Record<string, unknown>>) ?? {},
    localizations,
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

export function toProductDto(product: ProductWithRelations, localizations: ContentLocalizationDto[] = []): ProductDto {
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
    localizations,
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

export function toPortfolioItemDto(item: PortfolioItemWithRelations, localizations: ContentLocalizationDto[] = []): PortfolioItemDto {
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
    localizations,
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
    trackingNumber: order.trackingNumber,
    shippingCarrier: order.shippingCarrier,
    shippedAt: order.shippedAt ? order.shippedAt.toISOString() : null,
    deliveredAt: order.deliveredAt ? order.deliveredAt.toISOString() : null,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map(toOrderItemDto),
  };
}

// ---------- Müşteri & E-Ticaret Alanı (Customer Portal) — bkz.
// `.claude/architect-scope-customer-portal.md` §2.2/§2.3.

export function toAddressDto(address: Address): AddressDto {
  return {
    id: address.id,
    title: address.title,
    fullName: address.fullName,
    phone: address.phone,
    country: address.country,
    city: address.city,
    district: address.district,
    neighborhood: address.neighborhood,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    postalCode: address.postalCode,
    isDefault: address.isDefault,
    createdAt: address.createdAt.toISOString(),
    updatedAt: address.updatedAt.toISOString(),
  };
}

type WishlistItemWithProduct = WishlistItem & {
  product: {
    id: string;
    title: string;
    slug: string;
    coverMedia: Media | null;
    priceCents: number;
    discountPriceCents: number | null;
    currency: string;
    stockQuantity: number;
  };
};

/** `WishlistItemProductSchema` ile AYNI hafif seçim — `toCartItemDto`'daki `coverImageUrl` çözümlemesiyle AYNI desen. */
export function toWishlistItemDto(item: WishlistItemWithProduct): WishlistItemDto {
  return {
    id: item.id,
    productId: item.productId,
    product: {
      id: item.product.id,
      title: item.product.title,
      slug: item.product.slug,
      coverImageUrl: item.product.coverMedia ? absolutizeMediaUrl(item.product.coverMedia.url) : null,
      priceCents: item.product.priceCents,
      discountPriceCents: item.product.discountPriceCents,
      currency: item.product.currency,
      stockQuantity: item.product.stockQuantity,
    },
    createdAt: item.createdAt.toISOString(),
  };
}

/** §10.16.6 — liste yanıtı (`GET /admin/notifications/templates`): `blocks`/`bodyHtml`/`variables` DÖNMEZ. */
export function toEmailTemplateSummaryDto(template: EmailTemplate): EmailTemplateSummaryDto {
  return {
    id: template.id,
    key: template.key,
    name: template.name,
    purpose: template.purpose,
    editorMode: template.editorMode,
    isSystem: template.isSystem,
    isActive: template.isActive,
    subject: template.subject,
    updatedAt: template.updatedAt.toISOString(),
    createdAt: template.createdAt.toISOString(),
  };
}

/**
 * §10.16.6 — tam DTO (`GET/POST/PATCH .../{templateId}` vb.). `variables` DB'de TUTULMAZ —
 * çağıran taraf `lib/email-variables.ts::resolveTemplateVariables` ile HESAPLAYIP buraya geçirir
 * (bu fonksiyon DB'ye ERİŞMEZ, `toPageDto`/`localizations` paterniyle AYNI ilke).
 */
export function toEmailTemplateDto(template: EmailTemplate, variables: EmailVariableDefinitionDto[]): EmailTemplateDto {
  return {
    ...toEmailTemplateSummaryDto(template),
    bodyHtml: template.bodyHtml,
    blocks: (template.blocks as EmailTemplateDto["blocks"]) ?? [],
    availableVariables: (template.availableVariables as string[]) ?? [],
    customVariables: (template.customVariables as EmailTemplateDto["customVariables"]) ?? [],
    variables,
  };
}

// ---------- §10.16.7 İletişim Formu ----------

export function toContactFormFieldDto(field: ContactFormField): ContactFormFieldDto {
  return {
    id: field.id,
    order: field.order,
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    placeholder: field.placeholder,
    helpText: field.helpText,
    options: (field.options as ContactFormFieldDto["options"]) ?? [],
    maxLength: field.maxLength,
    isSystem: field.isSystem,
  };
}

type ContactFormWithFields = ContactForm & { fields: ContactFormField[] };

export function toContactFormDto(form: ContactFormWithFields): ContactFormDto {
  return {
    id: form.id,
    title: form.title,
    description: form.description,
    submitLabel: form.submitLabel,
    successMessage: form.successMessage,
    isEnabled: form.isEnabled,
    notifyEmail: form.notifyEmail,
    notificationTemplateId: form.notificationTemplateId,
    consentRequired: form.consentRequired,
    consentText: form.consentText,
    consentLegalPageId: form.consentLegalPageId,
    retentionDays: form.retentionDays,
    fields: form.fields.map(toContactFormFieldDto),
    updatedAt: form.updatedAt.toISOString(),
  };
}

/** PUBLIC — `notifyEmail`/`notificationTemplateId`/`retentionDays` BİLİNÇLİ OLARAK YOK (§10.16.8). */
export function toPublicContactFormDto(
  form: ContactFormWithFields,
  consentLegalPage: { title: string; slug: string } | null
): PublicContactFormDto {
  return {
    title: form.title,
    description: form.description,
    submitLabel: form.submitLabel,
    consentRequired: form.consentRequired,
    consentText: form.consentText,
    consentLegalPage,
    fields: form.fields.map(toContactFormFieldDto),
  };
}

/** Liste yanıtı — `data`/`consentTextSnapshot`/`userAgent` DÖNMEZ (§10.16.8). */
export function toContactSubmissionSummaryDto(submission: ContactSubmission): ContactSubmissionSummaryDto {
  return {
    id: submission.id,
    name: submission.name,
    email: submission.email,
    status: submission.status,
    notifiedAt: submission.notifiedAt ? submission.notifiedAt.toISOString() : null,
    notificationError: submission.notificationError,
    readAt: submission.readAt ? submission.readAt.toISOString() : null,
    createdAt: submission.createdAt.toISOString(),
  };
}

export function toContactSubmissionDto(submission: ContactSubmission): ContactSubmissionDto {
  return {
    ...toContactSubmissionSummaryDto(submission),
    data: (submission.data as Record<string, string>) ?? {},
    consentAt: submission.consentAt ? submission.consentAt.toISOString() : null,
    consentTextSnapshot: submission.consentTextSnapshot,
    ipAddress: submission.ipAddress,
    userAgent: submission.userAgent,
    piiRedactedAt: submission.piiRedactedAt ? submission.piiRedactedAt.toISOString() : null,
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
    pageHeaderLayout: appearance.pageHeaderLayout,
    pageHeaderBackgroundColor: appearance.pageHeaderBackgroundColor,
    pageHeaderBackgroundMediaId: appearance.pageHeaderBackgroundMediaId,
    pageHeaderBackgroundUrl: appearance.pageHeaderBackgroundMedia ? absolutizeMediaUrl(appearance.pageHeaderBackgroundMedia.url) : null,
    pageHeaderOverlayOpacity: appearance.pageHeaderOverlayOpacity,
    primaryColor: appearance.primaryColor,
    secondaryColor: appearance.secondaryColor,
    buttonColor: appearance.buttonColor,
    buttonTextColor: appearance.buttonTextColor,
    linkColor: appearance.linkColor,
    accentColor: appearance.accentColor,
    backgroundColor: appearance.backgroundColor,
    surfaceColor: appearance.surfaceColor,
    textColor: appearance.textColor,
    mutedTextColor: appearance.mutedTextColor,
    headingFont: appearance.headingFont,
    bodyFont: appearance.bodyFont,
    baseFontSize: appearance.baseFontSize,
    borderRadius: appearance.borderRadius,
    buttonStyle: appearance.buttonStyle,
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
    pageHeaderLayout: appearance.pageHeaderLayout,
    pageHeaderBackgroundColor: appearance.pageHeaderBackgroundColor,
    pageHeaderBackgroundUrl: appearance.pageHeaderBackgroundUrl,
    pageHeaderOverlayOpacity: appearance.pageHeaderOverlayOpacity,
    primaryColor: appearance.primaryColor,
    secondaryColor: appearance.secondaryColor,
    buttonColor: appearance.buttonColor,
    buttonTextColor: appearance.buttonTextColor,
    linkColor: appearance.linkColor,
    accentColor: appearance.accentColor,
    backgroundColor: appearance.backgroundColor,
    surfaceColor: appearance.surfaceColor,
    textColor: appearance.textColor,
    mutedTextColor: appearance.mutedTextColor,
    headingFont: appearance.headingFont,
    bodyFont: appearance.bodyFont,
    baseFontSize: appearance.baseFontSize,
    borderRadius: appearance.borderRadius,
    buttonStyle: appearance.buttonStyle,
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
// ---------- §10.5 Çoklu Dil & Yerelleştirme ----------

/**
 * `translatedContentCount` YALNIZCA `/admin/locales` yanıtlarında dolu döner (bkz.
 * openapi.yaml `Locale.translatedContentCount`) — public `/locales` çağıran taraf bu
 * parametreyi vermez.
 */
export function toLocaleDto(locale: Locale, translatedContentCount?: number): LocaleDto {
  return {
    code: locale.code,
    label: locale.label,
    nativeLabel: locale.nativeLabel,
    isDefault: locale.isDefault,
    enabled: locale.enabled,
    sortOrder: locale.sortOrder,
    hreflang: locale.hreflang,
    ...(translatedContentCount !== undefined ? { translatedContentCount } : {}),
  };
}

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

// ---------------------------------------------------------------------------
// §10.13 Üçüncü Parti Entegrasyon — API Anahtarları + Giden Webhook'lar (bkz. ARCHITECTURE.md
// §10.13, modules/api-keys/*, modules/outbound-webhooks/*). `Public*` DTO mapper'ları BİLİNÇLİ
// olarak BURADA DEĞİL, `modules/public-api/public-api.mappers.ts`'te AYRI tutulur (§10.13.5 —
// bu admin mapper'ları PII taşır, dış kontrata asla verilmez).
// ---------------------------------------------------------------------------

type ApiKeyWithCreator = ApiKey & { createdBy?: User | null };

export function toApiKeyDto(key: ApiKeyWithCreator): ApiKeyDto {
  return {
    id: key.id,
    name: key.name,
    description: key.description,
    keyPrefix: key.keyPrefix,
    last4: key.last4,
    maskedKey: buildMaskedKey(key.keyPrefix, key.last4),
    scope: key.scope,
    status: key.status,
    lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
    lastUsedIp: key.lastUsedIp,
    expiresAt: key.expiresAt ? key.expiresAt.toISOString() : null,
    revokedAt: key.revokedAt ? key.revokedAt.toISOString() : null,
    createdById: key.createdById,
    createdByName: key.createdBy?.name ?? null,
    createdAt: key.createdAt.toISOString(),
    updatedAt: key.updatedAt.toISOString(),
  };
}

type OutboundWebhookWithCreator = OutboundWebhook & { createdBy?: User | null };

export function toOutboundWebhookDto(webhook: OutboundWebhookWithCreator): OutboundWebhookDto {
  return {
    id: webhook.id,
    name: webhook.name,
    description: webhook.description,
    url: webhook.url,
    secretLast4: webhook.secretLast4,
    events: webhook.events,
    status: webhook.status,
    consecutiveFailureCount: webhook.consecutiveFailureCount,
    autoDisabledAt: webhook.autoDisabledAt ? webhook.autoDisabledAt.toISOString() : null,
    lastTriggeredAt: webhook.lastTriggeredAt ? webhook.lastTriggeredAt.toISOString() : null,
    lastSuccessAt: webhook.lastSuccessAt ? webhook.lastSuccessAt.toISOString() : null,
    lastFailureAt: webhook.lastFailureAt ? webhook.lastFailureAt.toISOString() : null,
    createdById: webhook.createdById,
    createdByName: webhook.createdBy?.name ?? null,
    createdAt: webhook.createdAt.toISOString(),
    updatedAt: webhook.updatedAt.toISOString(),
  };
}

export function toWebhookDeliverySummaryDto(delivery: WebhookDelivery): WebhookDeliverySummaryDto {
  return {
    id: delivery.id,
    event: delivery.event,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    maxAttempts: delivery.maxAttempts,
    nextAttemptAt: delivery.nextAttemptAt ? delivery.nextAttemptAt.toISOString() : null,
    responseStatus: delivery.responseStatus,
    errorCode: delivery.errorCode as WebhookDeliverySummaryDto["errorCode"],
    errorMessage: delivery.errorMessage,
    durationMs: delivery.durationMs,
    containsPii: delivery.containsPii,
    redeliveryOfId: delivery.redeliveryOfId,
    firstAttemptAt: delivery.firstAttemptAt ? delivery.firstAttemptAt.toISOString() : null,
    lastAttemptAt: delivery.lastAttemptAt ? delivery.lastAttemptAt.toISOString() : null,
    deliveredAt: delivery.deliveredAt ? delivery.deliveredAt.toISOString() : null,
    createdAt: delivery.createdAt.toISOString(),
  };
}

export function toWebhookDeliveryDto(delivery: WebhookDelivery): WebhookDeliveryDto {
  return {
    ...toWebhookDeliverySummaryDto(delivery),
    payload: delivery.payload as WebhookDeliveryDto["payload"],
    responseBodySnippet: delivery.responseBodySnippet,
  };
}

// ---------------------------------------------------------------------------
// Gelişmiş Slider / Hero Studio — bkz. .claude/architect-scope-advanced-slider.md
// (bağlayıcı karar dokümanı) ve modules/sliders/*. `Slider` bir "içerik" DEĞİLDİR (§1.1) —
// `Product`/`PortfolioItem` mapper'larının aksine SEO skoru/yayın/çeviri alanı TAŞIMAZ.
// ---------------------------------------------------------------------------

type SlideWithRelations = Slide & { bgMedia: Media | null; bgVideoPosterMedia: Media | null };

/** `SliderSchema`/`PublicSliderSchema`'nın PAYLAŞTIĞI ayar alanları (bkz. schemas/entities.ts::SliderSettingsSchema). */
function toSliderSettingsFields(slider: Slider) {
  return {
    autoplay: slider.autoplay,
    intervalMs: slider.intervalMs,
    loop: slider.loop,
    pauseOnHover: slider.pauseOnHover,
    transitionEffect: TRANSITION_EFFECT_FROM_PRISMA[slider.transitionEffect],
    transitionDurationMs: slider.transitionDurationMs,
    heightMode: HEIGHT_MODE_FROM_PRISMA[slider.heightMode],
    heightPx: slider.heightPx,
    aspectRatioWidth: slider.aspectRatioWidth,
    aspectRatioHeight: slider.aspectRatioHeight,
    mobileHeightMode: heightModeFromPrisma(slider.mobileHeightMode),
    mobileHeightPx: slider.mobileHeightPx,
    mobileAspectRatioWidth: slider.mobileAspectRatioWidth,
    mobileAspectRatioHeight: slider.mobileAspectRatioHeight,
    widthMode: WIDTH_MODE_FROM_PRISMA[slider.widthMode],
    showArrows: slider.showArrows,
    showBullets: slider.showBullets,
    showProgressBar: slider.showProgressBar,
    navigationTheme: NAVIGATION_THEME_FROM_PRISMA[slider.navigationTheme],
  };
}

export function toSlideDto(slide: SlideWithRelations): SlideDto {
  return {
    id: slide.id,
    order: slide.order,
    isActive: slide.isActive,
    label: slide.label,
    bgType: BACKGROUND_TYPE_FROM_PRISMA[slide.bgType],
    bgMedia: slide.bgMedia ? toMediaDto(slide.bgMedia) : null,
    bgVideoUrl: slide.bgVideoUrl,
    bgVideoPosterMedia: slide.bgVideoPosterMedia ? toMediaDto(slide.bgVideoPosterMedia) : null,
    bgPositionX: slide.bgPositionX,
    bgPositionY: slide.bgPositionY,
    bgOverlayColor: slide.bgOverlayColor,
    bgOverlayOpacity: slide.bgOverlayOpacity,
    bgGradientFrom: slide.bgGradientFrom,
    bgGradientTo: slide.bgGradientTo,
    bgGradientAngle: slide.bgGradientAngle,
    bgKenBurns: slide.bgKenBurns,
    durationMs: slide.durationMs,
    linkHref: slide.linkHref,
    linkNewTab: slide.linkNewTab,
    // §2.2 — `layers` bilinçli olarak Json'dur; yazma anında `lib/layers.ts::parseSlideLayers`
    // ile doğrulanmış hâliyle DB'ye yazılır, burada olduğu gibi geri döner.
    layers: Array.isArray(slide.layers) ? (slide.layers as Record<string, unknown>[]) : [],
    createdAt: slide.createdAt.toISOString(),
    updatedAt: slide.updatedAt.toISOString(),
  };
}

/** `Slide` ile AYNI şekil EKSİ `label`/`isActive` (bkz. `GET /sliders/{sliderId}`). */
function toPublicSlideDto(slide: SlideWithRelations): PublicSlideDto {
  const { label: _label, isActive: _isActive, ...rest } = toSlideDto(slide);
  return rest;
}

/**
 * `İlk aktif slaytın arka plan görseli` — seçicide küçük önizleme için türetilir (DB kolonu
 * DEĞİL, bkz. openapi.yaml `SliderSummary.previewImageUrl`). Yalnızca `bgType: image` VE
 * `bgMedia` dolu olan İLK (`order asc`) aktif slayt dikkate alınır.
 */
function computePreviewImageUrl(slides: SlideWithRelations[]): string | null {
  const first = slides.find((slide) => slide.isActive && slide.bgType === "IMAGE" && slide.bgMedia);
  return first?.bgMedia ? absolutizeMediaUrl(first.bgMedia.url) : null;
}

/** `GET /admin/sliders` satırı — `slides` TAŞIMAZ, `slideCount`/`previewImageUrl` çağıran tarafta hesaplanır. */
export function toSliderSummaryDto(slider: Slider, slideCount: number, previewImageUrl: string | null): SliderSummaryDto {
  return {
    id: slider.id,
    name: slider.name,
    slug: slider.slug,
    slideCount,
    previewImageUrl,
    deletedAt: slider.deletedAt ? slider.deletedAt.toISOString() : null,
    createdAt: slider.createdAt.toISOString(),
    updatedAt: slider.updatedAt.toISOString(),
  };
}

type SliderWithSlides = Slider & { slides: SlideWithRelations[] };

/** Admin detay DTO — ayarlar + TÜM slaytlar (pasifler dahil, `order asc` sıralı beklenir). */
export function toSliderDto(slider: SliderWithSlides): SliderDto {
  return {
    ...toSliderSummaryDto(slider, slider.slides.length, computePreviewImageUrl(slider.slides)),
    ...toSliderSettingsFields(slider),
    slides: slider.slides.map(toSlideDto),
  };
}

/**
 * `GET /sliders/{sliderId}` yanıtı — çağıran taraf `slides`'ı ZATEN `isActive: true` VE
 * `order asc` filtresiyle sorgulamış olmalıdır (bkz. sliders.routes.ts::publicSlidersRoutes).
 */
export function toPublicSliderDto(slider: SliderWithSlides): PublicSliderDto {
  return {
    id: slider.id,
    name: slider.name,
    ...toSliderSettingsFields(slider),
    slides: slider.slides.map(toPublicSlideDto),
  };
}

/** `GET /admin/sliders/{sliderId}/usage` ve `409` gövdesindeki `error.details.usedBy`. */
export function toSliderUsageDto(entry: {
  pageId: string;
  pageTitle: string;
  pageSlug: string;
  blockId: string;
  usageType: "block" | "shortcode";
  isHomePage: boolean;
  pageDeletedAt: string | null;
}): SliderUsageDto {
  return { ...entry };
}
