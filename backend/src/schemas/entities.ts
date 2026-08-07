import { z } from "zod";

/**
 * ../../../docs/architecture/shared-types.ts ve openapi.yaml component şemalarının
 * Zod karşılığı. Alan adları/tipleri iki tarafta da birebir aynı tutulmalıdır.
 */

export const MembershipRoleSchema = z.enum(["OWNER", "ADMIN", "MEMBER"]);
export const MembershipStatusSchema = z.enum(["ACTIVE", "INVITED", "SUSPENDED"]);
export const InvitationStatusSchema = z.enum(["PENDING", "ACCEPTED", "EXPIRED", "REVOKED"]);
export const SubscriptionStatusSchema = z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "INCOMPLETE"]);
export const PageStatusSchema = z.enum(["DRAFT", "PUBLISHED", "SCHEDULED"]);

// `/admin/*` CMS uçları için org'dan bağımsız site-geneli rol/durum (bkz. middleware/site-rbac.ts).
// MembershipRoleSchema (organizasyon bazlı) ile KARIŞTIRILMAMALI.
export const SiteRoleSchema = z.enum(["ADMIN", "EDITOR", "VIEWER"]);
export const SiteUserStatusSchema = z.enum(["ACTIVE", "SUSPENDED"]);
export const AuditStatusSchema = z.enum(["SUCCESS", "FAILURE", "FORBIDDEN"]);

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  emailVerifiedAt: z.string().nullable(),
  role: SiteRoleSchema,
  createdAt: z.string(),
  // §10.4 Güvenlik & 2FA — bkz. ARCHITECTURE.md §10.4.
  twoFactorEnabled: z.boolean(),
});
export type UserDto = z.infer<typeof UserSchema>;

/** `/admin/users` uçlarında dönen genişletilmiş kullanıcı DTO'su — yalnızca ADMIN görebilir. */
export const AdminUserSchema = UserSchema.extend({
  status: SiteUserStatusSchema,
  lastLoginAt: z.string().nullable(),
});
export type AdminUserDto = z.infer<typeof AdminUserSchema>;

export const AuditLogSchema = z.object({
  id: z.string().uuid(),
  actorId: z.string().uuid().nullable(),
  actorEmail: z.string().nullable(),
  action: z.string(),
  status: AuditStatusSchema,
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  ipAddress: z.string().nullable(),
  createdAt: z.string(),
});
export type AuditLogDto = z.infer<typeof AuditLogSchema>;

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

// ---------- §10.7 İçerik Yönetim Listesi (Çöp Kutusu, Yazar, SEO Skoru) ----------

/**
 * Kullanıcının listelerde gösterilen minimum özeti — hassas alan (rol/durum/
 * e-posta doğrulaması) TAŞIMAZ. Yazar sütunu ve yazar dropdown'ı bunu kullanır.
 */
export const UserSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  avatarUrl: z.string().nullable(),
});
export type UserSummaryDto = z.infer<typeof UserSummarySchema>;

/** Kararlı makine-okunur kod — frontend/qa mantığı BUNA bağlanır, `label` yalnızca gösterim içindir. */
export const SeoScoreIssueCodeSchema = z.enum([
  "SEO_TITLE_MISSING",
  "SEO_TITLE_LENGTH",
  "SEO_DESCRIPTION_MISSING",
  "SEO_DESCRIPTION_LENGTH",
  "COVER_IMAGE_MISSING",
  "IMAGE_MISSING",
  "IMAGE_ALT_MISSING",
  "CONTENT_TOO_SHORT",
]);
export type SeoScoreIssueCode = z.infer<typeof SeoScoreIssueCodeSchema>;

export const SeoScoreIssueSchema = z.object({
  code: SeoScoreIssueCodeSchema,
  label: z.string(),
});
export type SeoScoreIssueDto = z.infer<typeof SeoScoreIssueSchema>;

/** Sekme sayaçları — tablo genelinde hesaplanır, istek filtrelerinden ETKİLENMEZ (bkz. §10.7). */
export const ContentCountsSchema = z.object({
  all: z.number().int(),
  published: z.number().int(),
  draft: z.number().int(),
  trashed: z.number().int(),
});
export type ContentCountsDto = z.infer<typeof ContentCountsSchema>;

/** `GET /admin/pages` ve `GET /admin/blog` yanıtlarının `meta` zarfı. */
export const ContentListMetaSchema = z.object({
  nextCursor: z.string().nullable().optional(),
  counts: ContentCountsSchema,
});
export type ContentListMetaDto = z.infer<typeof ContentListMetaSchema>;

export const BulkContentActionSchema = z.enum(["trash", "restore", "publish", "draft", "permanent-delete"]);
export type BulkContentAction = z.infer<typeof BulkContentActionSchema>;

export const BulkContentActionRequestSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  action: BulkContentActionSchema,
});
export type BulkContentActionRequestDto = z.infer<typeof BulkContentActionRequestSchema>;

export const BulkContentActionResultSchema = z.object({
  action: BulkContentActionSchema,
  requestedCount: z.number().int(),
  affectedCount: z.number().int(),
  skippedIds: z.array(z.string().uuid()),
});
export type BulkContentActionResultDto = z.infer<typeof BulkContentActionResultSchema>;

export const PageSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  status: PageStatusSchema,
  blocks: z.array(z.record(z.unknown())),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  // §10.2 Gelişmiş SEO & Social Card — bkz. ARCHITECTURE.md §10.2.
  ogTitle: z.string().nullable(),
  ogImageUrl: z.string().nullable(),
  canonicalUrl: z.string().nullable(),
  noIndex: z.boolean(),
  // §10.5 Çoklu Dil & Yerelleştirme — TR (kolonlar) kanonik, translations.EN yalnızca override.
  translations: z.record(z.string(), z.record(z.string(), z.unknown())),
  publishedAt: z.string().nullable(),
  // Zamanlanmış yayın hedef tarihi — yalnızca status=SCHEDULED iken anlamlı.
  scheduledAt: z.string().nullable(),
  viewCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // ---- §10.7 İçerik Yönetim Listesi ----
  deletedAt: z.string().nullable(),
  authorId: z.string().uuid().nullable(),
  author: UserSummarySchema.nullable(),
  seoScore: z.number().int().min(0).max(100),
  seoScoreIssues: z.array(SeoScoreIssueSchema),
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
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  // §10.2 Gelişmiş SEO & Social Card — bkz. ARCHITECTURE.md §10.2.
  ogTitle: z.string().nullable(),
  ogImageUrl: z.string().nullable(),
  canonicalUrl: z.string().nullable(),
  noIndex: z.boolean(),
  // §10.5 Çoklu Dil & Yerelleştirme — TR (kolonlar) kanonik, translations.EN yalnızca override.
  translations: z.record(z.string(), z.record(z.string(), z.unknown())),
  publishedAt: z.string().nullable(),
  // Zamanlanmış yayın hedef tarihi — yalnızca status=SCHEDULED iken anlamlı.
  scheduledAt: z.string().nullable(),
  viewCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // ---- §10.7 İçerik Yönetim Listesi ----
  deletedAt: z.string().nullable(),
  authorId: z.string().uuid().nullable(),
  author: UserSummarySchema.nullable(),
  seoScore: z.number().int().min(0).max(100),
  seoScoreIssues: z.array(SeoScoreIssueSchema),
});
export type BlogPostDto = z.infer<typeof BlogPostSchema>;

export const MediaSchema = z.object({
  id: z.string().uuid(),
  url: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  altText: z.string().nullable(),
  createdAt: z.string(),
});
export type MediaDto = z.infer<typeof MediaSchema>;

export const SiteSettingsSchema = z.object({
  siteName: z.string(),
  logoUrl: z.string().nullable(),
  homePageId: z.string().uuid().nullable(),
});
export type SiteSettingsDto = z.infer<typeof SiteSettingsSchema>;

export const SocialPlatformSchema = z.enum(["TWITTER", "GITHUB", "LINKEDIN", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "OTHER"]);

export const NavigationItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  href: z.string(),
  order: z.number(),
});
export type NavigationItemDto = z.infer<typeof NavigationItemSchema>;

export const SocialLinkSchema = z.object({
  id: z.string(),
  platform: SocialPlatformSchema,
  url: z.string(),
  order: z.number(),
});
export type SocialLinkDto = z.infer<typeof SocialLinkSchema>;

export const FooterLinkSchema = z.object({
  id: z.string(),
  label: z.string(),
  href: z.string(),
  order: z.number(),
});
export type FooterLinkDto = z.infer<typeof FooterLinkSchema>;

export const FooterColumnSchema = z.object({
  id: z.string(),
  title: z.string(),
  order: z.number(),
  links: z.array(FooterLinkSchema),
});
export type FooterColumnDto = z.infer<typeof FooterColumnSchema>;

export const NavigationConfigSchema = z.object({
  headerCtaLabel: z.string().nullable(),
  headerCtaHref: z.string().nullable(),
  footerCopyrightText: z.string().nullable(),
  navigationItems: z.array(NavigationItemSchema),
  socialLinks: z.array(SocialLinkSchema),
  footerColumns: z.array(FooterColumnSchema),
});
export type NavigationConfigDto = z.infer<typeof NavigationConfigSchema>;

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

/** §10.4 Güvenlik & 2FA — POST /auth/login başarılı ama 2FA açıksa döner (token YOK). */
export const LoginRequiresTwoFactorSchema = z.object({
  requiresTwoFactor: z.literal(true),
  challengeToken: z.string(),
});
export type LoginRequiresTwoFactorDto = z.infer<typeof LoginRequiresTwoFactorSchema>;

/** §10.4 Güvenlik & 2FA — GET /admin/settings/security/sessions. */
export const SessionSchema = z.object({
  id: z.string().uuid(),
  userAgent: z.string().nullable(),
  ipAddress: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  isCurrent: z.boolean(),
});
export type SessionDto = z.infer<typeof SessionSchema>;

// ---------- §10.1 İçerik Sürüm Kontrolü (Revision History) ----------

export const ContentEntityTypeSchema = z.enum(["PAGE", "BLOG_POST"]);

export const ContentRevisionSummarySchema = z.object({
  id: z.string().uuid(),
  editedById: z.string().uuid().nullable(),
  editedByName: z.string(),
  createdAt: z.string(),
});
export type ContentRevisionSummaryDto = z.infer<typeof ContentRevisionSummarySchema>;

export const ContentRevisionSchema = ContentRevisionSummarySchema.extend({
  entityType: ContentEntityTypeSchema,
  entityId: z.string(),
  snapshot: z.record(z.string(), z.unknown()),
});
export type ContentRevisionDto = z.infer<typeof ContentRevisionSchema>;

// ---------- §10.3 E-posta & Bildirim Şablonu Yöneticisi ----------

export const EmailTemplateSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  subject: z.string(),
  bodyHtml: z.string(),
  availableVariables: z.array(z.string()),
  updatedAt: z.string(),
  createdAt: z.string(),
});
export type EmailTemplateDto = z.infer<typeof EmailTemplateSchema>;

// ---------- §10.8 Toplu İçe Aktarma (Import) — openapi.yaml Import tag ile birebir ----------
// NOT: `ImportDuplicateStrategy`/`ImportErrorSeverity` API sözleşmesinde lowerCamel string
// olarak tanımlıdır (`skip`/`overwrite`/`createNew`, `error`/`skipped`) — Prisma enum'ları
// (`SKIP`/`OVERWRITE`/`CREATE_NEW`, `ERROR`/`SKIPPED`) İLE KARIŞTIRILMAMALI. Dönüşüm
// `modules/import/import.constants.ts`'te tek noktadan yapılır.

export const ImportJobTypeSchema = z.enum(["PAGES", "BLOG", "WORDPRESS", "USERS", "MEDIA"]);
export type ImportJobType = z.infer<typeof ImportJobTypeSchema>;

export const ImportSourceFormatSchema = z.enum(["CSV", "JSON", "XML", "ZIP"]);
export type ImportSourceFormat = z.infer<typeof ImportSourceFormatSchema>;

export const ImportJobStatusSchema = z.enum(["PENDING", "QUEUED", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"]);
export type ImportJobStatus = z.infer<typeof ImportJobStatusSchema>;

export const ImportDuplicateStrategySchema = z.enum(["skip", "overwrite", "createNew"]);
export type ImportDuplicateStrategy = z.infer<typeof ImportDuplicateStrategySchema>;

export const ImportFieldMappingSchema = z.record(z.string(), z.string().nullable());
export type ImportFieldMapping = z.infer<typeof ImportFieldMappingSchema>;

export const ImportPreviewFieldStatusSchema = z.enum(["matched", "unmatched", "ignored", "missingRequired"]);

export const ImportPreviewFieldSchema = z.object({
  sourceField: z.string(),
  targetField: z.string().nullable(),
  status: ImportPreviewFieldStatusSchema,
});
export type ImportPreviewFieldDto = z.infer<typeof ImportPreviewFieldSchema>;

export const ImportJobPreviewWarningCodeSchema = z.enum([
  "WP_MEDIA_NOT_DOWNLOADED",
  "WP_TAGS_UNSUPPORTED",
  "WP_AUTHOR_UNMATCHED",
  "WP_PRIVATE_AS_DRAFT",
  "WP_SCHEDULED_AS_DRAFT",
  "HTML_WILL_BE_SANITIZED",
  "SLUG_COLLISION",
  "MEDIA_SVG_REJECTED",
  "UNMAPPED_COLUMNS",
]);

export const ImportJobPreviewWarningSchema = z.object({
  code: ImportJobPreviewWarningCodeSchema,
  message: z.string(),
  count: z.number().int().optional(),
});
export type ImportJobPreviewWarningDto = z.infer<typeof ImportJobPreviewWarningSchema>;

export const ImportJobPreviewBreakdownSchema = z
  .object({
    pages: z.number().int(),
    posts: z.number().int(),
    attachments: z.number().int(),
    categories: z.number().int(),
    skipped: z.number().int(),
  })
  .partial();
export type ImportJobPreviewBreakdownDto = z.infer<typeof ImportJobPreviewBreakdownSchema>;

export const ImportJobPreviewSchema = z.object({
  totalCount: z.number().int(),
  canStart: z.boolean(),
  fields: z.array(ImportPreviewFieldSchema),
  targetFields: z.array(z.string()),
  suggestedMapping: ImportFieldMappingSchema,
  samples: z.array(z.record(z.string(), z.unknown())).max(5),
  breakdown: ImportJobPreviewBreakdownSchema.optional(),
  warnings: z.array(ImportJobPreviewWarningSchema),
});
export type ImportJobPreviewDto = z.infer<typeof ImportJobPreviewSchema>;

export const ImportJobSummarySchema = z.object({
  id: z.string().uuid(),
  type: ImportJobTypeSchema,
  format: ImportSourceFormatSchema,
  status: ImportJobStatusSchema,
  duplicateStrategy: ImportDuplicateStrategySchema.nullable(),
  filename: z.string(),
  sizeBytes: z.number().int(),
  totalCount: z.number().int(),
  processedCount: z.number().int(),
  successCount: z.number().int(),
  errorCount: z.number().int(),
  skippedCount: z.number().int(),
  errorSummary: z.string().nullable(),
  createdById: z.string().uuid().nullable(),
  createdBy: UserSummarySchema.nullable().optional(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type ImportJobSummaryDto = z.infer<typeof ImportJobSummarySchema>;

export const ImportJobSchema = ImportJobSummarySchema.extend({
  preview: ImportJobPreviewSchema.nullable(),
});
export type ImportJobDto = z.infer<typeof ImportJobSchema>;

export const ImportJobErrorCodeSchema = z.enum([
  "REQUIRED_FIELD_MISSING",
  "INVALID_VALUE",
  "INVALID_EMAIL",
  "INVALID_ROLE",
  "INVALID_DATE",
  "INVALID_URL",
  "DUPLICATE_SKIPPED",
  "TARGET_TRASHED",
  "SLUG_CONFLICT",
  "UNSUPPORTED_POST_TYPE",
  "UNSUPPORTED_STATUS",
  "UNSUPPORTED_MIME",
  "FILE_TOO_LARGE",
  "EMAIL_DELIVERY_FAILED",
  "DB_ERROR",
]);
export type ImportJobErrorCode = z.infer<typeof ImportJobErrorCodeSchema>;

export const ImportJobErrorSeveritySchema = z.enum(["error", "skipped"]);
export type ImportJobErrorSeverity = z.infer<typeof ImportJobErrorSeveritySchema>;

export const ImportJobErrorSchema = z.object({
  id: z.string().uuid(),
  rowNumber: z.number().int(),
  code: ImportJobErrorCodeSchema,
  message: z.string(),
  severity: ImportJobErrorSeveritySchema,
  field: z.string().nullable(),
  sourceRef: z.string().nullable(),
  rawData: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});
export type ImportJobErrorDto = z.infer<typeof ImportJobErrorSchema>;

export const ImportJobErrorListMetaSchema = z.object({
  nextCursor: z.string().nullable().optional(),
  truncated: z.boolean(),
});
export type ImportJobErrorListMetaDto = z.infer<typeof ImportJobErrorListMetaSchema>;

// ---------- §10.8.10 Analitik Rapor Dışa Aktarma (Export) — openapi.yaml Reports tag ile birebir ----------
// NOT: `ImportJobType`'ın aksine burada API ↔ Prisma dönüşümü YOK — üç enum de (Type/Format/
// Status) API sözleşmesinde de UPPER_SNAKE (bkz. db-agent şeması, ARCHITECTURE.md §10.8.10).

export const ExportJobTypeSchema = z.enum(["VIEWS", "BREAKDOWN", "SUMMARY", "TOP_CONTENT", "USERS", "REVENUE"]);
export type ExportJobType = z.infer<typeof ExportJobTypeSchema>;

export const ExportFileFormatSchema = z.enum(["CSV", "PDF"]);
export type ExportFileFormat = z.infer<typeof ExportFileFormatSchema>;

export const ExportJobStatusSchema = z.enum(["PENDING", "PROCESSING", "COMPLETED", "FAILED"]);
export type ExportJobStatus = z.infer<typeof ExportJobStatusSchema>;

export const ExportJobSchema = z.object({
  id: z.string().uuid(),
  type: ExportJobTypeSchema,
  format: ExportFileFormatSchema,
  status: ExportJobStatusSchema,
  // İstek parametrelerinin (from/to/granularity/filters/unmaskPii) tamamı — bkz.
  // modules/reports/reports.schemas.ts::CreateExportJobRequestSchema.
  filters: z.record(z.string(), z.unknown()),
  // Ham/maskelenmemiş PII içeriyorsa true (bkz. reports.worker.ts) — compliance-agent
  // audit/erişim kararında kullanır (ARCHITECTURE.md §10.8.10 ile §10.8.8 aynı desen).
  containsPii: z.boolean(),
  errorSummary: z.string().nullable(),
  createdById: z.string().uuid().nullable(),
  createdBy: UserSummarySchema.nullable().optional(),
  // İndirme linkinin/dosyanın süre sonu — `storagePath` gibi ASLA dönmez YOK, bu alan
  // (`ImportJob`'ın aksine) BİLEREK API'de dönülür: istemcinin "ne zamana kadar indirilebilir"
  // bilgisine ihtiyacı var.
  expiresAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ExportJobDto = z.infer<typeof ExportJobSchema>;
