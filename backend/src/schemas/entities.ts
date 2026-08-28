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
// §10.20 — bkz. `.claude/architect-scope-page-editor-roles.md` §2. `pages.schemas.ts`
// (Create/UpdatePageRequestSchema) BU şemayı import eder — ikinci bir kopya YAZILMAZ.
export const PageEditModeSchema = z.enum(["FREEFORM", "TEMPLATE"]);

// `/admin/*` CMS uçları için org'dan bağımsız site-geneli rol/durum (bkz. middleware/site-rbac.ts).
// MembershipRoleSchema (organizasyon bazlı) ile KARIŞTIRILMAMALI.
// `.claude/architect-scope-rbac-5-tier.md` §1 — 5 kademeli rol (ADMIN → USER, ayrıcalıktan
// azalan sırada; sıra bağlayıcıdır). `VIEWER` KALDIRILDI.
export const SiteRoleSchema = z.enum(["ADMIN", "MANAGER", "EDITOR", "CUSTOMER", "USER"]);
// `PATCH /admin/users/{userId}/status` gövdesi (YAZMA) — BİLİNÇLİ OLARAK `DELETED` içermez,
// silme YALNIZCA `DELETE /admin/users/{userId}` ile yapılır (bkz. AdminUserStatusSchema, OKUMA tarafı).
export const SiteUserStatusSchema = z.enum(["ACTIVE", "SUSPENDED"]);
// `AdminUser.status` (OKUMA) — `DELETED` (yumuşak silme) dahil, `SiteUserStatusSchema`'dan
// DAHA GENİŞTİR. İkisi kasıtlı olarak AYRI tutulur (bkz. openapi.yaml `AdminUser` vs
// `UpdateAdminUserStatusRequest`) — `PATCH /status` gövdesinde `DELETED` kabul edilmemeli.
export const AdminUserStatusSchema = z.enum(["ACTIVE", "SUSPENDED", "DELETED"]);
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
  // `.claude/architect-scope-rbac-5-tier.md` §3 — TÜRETİLMİŞ + SALT-OKUNUR: saf rol türevi,
  // yalnızca `role === "ADMIN"` iken `true` (bkz. lib/builder-capability.ts). Eski
  // `User.advancedBuilderEnabled` bayrağı KALDIRILDI.
  canUseAdvancedBuilder: z.boolean(),
});
export type UserDto = z.infer<typeof UserSchema>;

/** `/admin/users` uçlarında dönen genişletilmiş kullanıcı DTO'su — yalnızca ADMIN görebilir. */
export const AdminUserSchema = UserSchema.extend({
  status: AdminUserStatusSchema,
  lastLoginAt: z.string().nullable(),
  // Yumuşak silme zaman damgası — `status: DELETED` ise dolu, aksi hâlde `null` (bkz.
  // DELETE /admin/users/{userId}, POST /admin/users/{userId}/restore).
  deletedAt: z.string().nullable(),
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

// ---------- §10.5 Çoklu Dil & Yerelleştirme (bkz. .claude/architect-scope-i18n.md, bağlayıcı
// karar dokümanı) — openapi.yaml `Locale`/`ContentLocalization`/`ContentTranslations` şemalarının
// Zod karşılığı.

export const LocaleSchema = z.object({
  code: z.string(),
  label: z.string(),
  nativeLabel: z.string(),
  isDefault: z.boolean(),
  enabled: z.boolean(),
  sortOrder: z.number().int(),
  hreflang: z.string().nullable(),
  // YALNIZCA `/admin/locales` yanıtlarında dolu döner (bkz. openapi.yaml `Locale.translatedContentCount`).
  translatedContentCount: z.number().int().optional(),
});
export type LocaleDto = z.infer<typeof LocaleSchema>;

/**
 * Bir içeriğin TEK bir dildeki yayın durumu/slug'ı — hreflang, sitemap `alternates` ve site
 * dil değiştiricisi TEK bir istekle bu diziden beslenir (N+1 istek YOK, bkz.
 * lib/localization.ts::attachLocalizations).
 */
export const ContentLocalizationSchema = z.object({
  locale: z.string(),
  slug: z.string(),
  translated: z.boolean(),
});
export type ContentLocalizationDto = z.infer<typeof ContentLocalizationSchema>;

export const PageSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  status: PageStatusSchema,
  // §10.20 — sunucu tarafı yapısal kısıt (blok/`data.*` dışı alan değişikliği) YALNIZCA
  // `!user.canUseAdvancedBuilder`'a bağlıdır, `editMode`'dan BAĞIMSIZDIR (2026-08-23
  // sıkılaştırması, bkz. `.claude/architect-scope-page-editor-roles.md`). `editMode` bu DTO'da
  // rozet/ipucu (ör. "Şablon" etiketi) amaçlı, kimin değiştirebileceği ise ADMIN/gelişmiş
  // EDITOR ile sınırlıdır (bkz. openapi.yaml `Page.editMode`).
  editMode: PageEditModeSchema,
  blocks: z.array(z.record(z.unknown())),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  // §10.2 Gelişmiş SEO & Social Card — bkz. ARCHITECTURE.md §10.2.
  ogTitle: z.string().nullable(),
  ogImageUrl: z.string().nullable(),
  canonicalUrl: z.string().nullable(),
  noIndex: z.boolean(),
  // §5.1 hukuki belge istisnası — YALNIZCA SiteRole=ADMIN değiştirebilir (bkz.
  // .claude/architect-scope-i18n.md §5.1, prisma/schema.prisma::Page.isLegalDocument).
  isLegalDocument: z.boolean(),
  // §10.5 Çoklu Dil & Yerelleştirme — TR (kolonlar) kanonik, translations.<locale> yalnızca override.
  translations: z.record(z.string(), z.record(z.string(), z.unknown())),
  // Bu sayfanın TÜM etkin dillerdeki slug/çeviri durumu — public uçlarda HER ZAMAN dolu döner.
  localizations: z.array(ContentLocalizationSchema),
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

// §10.14 Blog Etiketleri — `BlogCategory` ile birebir simetrik, tek fark `postCount`.
// `postCount` YALNIZCA `GET /admin/blog/tags` yanıtında dolu döner; `BlogPost.tags[]`
// içine gömülü etiketlerde TAŞINMAZ (N+1 sorgu doğururdu) — bkz. ARCHITECTURE.md §10.14.3/§10.14.5.
export const BlogTagSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string(),
  postCount: z.number().int().min(0).optional(),
});
export type BlogTagDto = z.infer<typeof BlogTagSchema>;

export const BlogPostSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  excerpt: z.string().nullable(),
  contentHtml: z.string(),
  coverImageUrl: z.string().nullable(),
  status: PageStatusSchema,
  category: BlogCategorySchema.nullable(),
  // §10.14 — bu yazının etiketleri. HER ZAMAN dizi (boşsa `[]`, asla `null`), `seq ASC` sıralı.
  tags: z.array(BlogTagSchema),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  // §10.2 Gelişmiş SEO & Social Card — bkz. ARCHITECTURE.md §10.2.
  ogTitle: z.string().nullable(),
  ogImageUrl: z.string().nullable(),
  canonicalUrl: z.string().nullable(),
  noIndex: z.boolean(),
  // §10.5 Çoklu Dil & Yerelleştirme — TR (kolonlar) kanonik, translations.<locale> yalnızca override.
  translations: z.record(z.string(), z.record(z.string(), z.unknown())),
  // Bu içeriğin TÜM etkin dillerdeki slug/çeviri durumu — public uçlarda HER ZAMAN dolu döner.
  localizations: z.array(ContentLocalizationSchema),
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
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  altText: z.string().nullable(),
  // §10.11 Medya Kütüphanesi — Klasör Sistemi. `null` = "Kategorisiz" (bu bir klasör KAYDI
  // DEĞİLDİR). DTO klasör ADINI TAŞIMAZ (karar) — istemci `GET /admin/media/folders`'ı bir
  // kez çekip id→ad eşlemesini bellekte yapar.
  folderId: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type MediaDto = z.infer<typeof MediaSchema>;

// §10.11 Medya Kütüphanesi — Klasör Sistemi. Düz dizi + `parentId` self-relation
// (`NavigationItem` ile AYNI patern). Maksimum derinlik 2 — bkz. ARCHITECTURE.md §10.11.1.
export const MediaFolderSchema = z.object({
  id: z.string().uuid(),
  name: z.string().max(80),
  parentId: z.string().uuid().nullable(),
  // DOĞRUDAN bu klasördeki medya sayısı — alt klasörlerdekiler DAHİL DEĞİLDİR (rollup YOK,
  // bkz. ARCHITECTURE.md §10.11.1). Tek sorguda `_count` ile hesaplanır, N+1 YASAK.
  mediaCount: z.number().int(),
  createdAt: z.string(),
});
export type MediaFolderDto = z.infer<typeof MediaFolderSchema>;

// `POST /admin/media/move` yanıtı — `BulkContentActionResultSchema` ile AYNI kısmi-başarı
// felsefesi (`skippedIds` + 200, hata DEĞİL). Bkz. ARCHITECTURE.md §10.11.4.
export const MoveMediaResultSchema = z.object({
  folderId: z.string().uuid().nullable(),
  requestedCount: z.number().int(),
  movedCount: z.number().int(),
  skippedIds: z.array(z.string().uuid()),
});
export type MoveMediaResultDto = z.infer<typeof MoveMediaResultSchema>;

// ---------- §10.9.2 Ürünler Modülü (Eklenti/Modül Yönetimi) — BlogCategory/BlogPost paterniyle
// BİREBİR aynı §10.7 çöp kutusu/yazar/SEO skoru alan setine, e-ticaret alanları (fiyat/stok/SKU)
// eklenmiş hâli (bkz. ARCHITECTURE.md, prisma/schema.prisma::Product).

export const ProductCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string(),
});
export type ProductCategoryDto = z.infer<typeof ProductCategorySchema>;

/** Sıralı ürün galerisi öğesi — bu fazda YAZMA ucu YOK (yalnızca okunur, bkz. görev notu). */
export const ProductImageSchema = z.object({
  id: z.string().uuid(),
  media: MediaSchema,
  order: z.number().int(),
});
export type ProductImageDto = z.infer<typeof ProductImageSchema>;

export const ProductSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  excerpt: z.string().nullable(),
  descriptionHtml: z.string(),
  // Para: HER ZAMAN kuruş/cent cinsinden Int — float KESİNLİKLE YOK (bkz. prisma/schema.prisma::Product).
  priceCents: z.number().int(),
  currency: z.string(),
  // KDV fiyata DAHİL — bu alan yalnızca fatura/gösterim amaçlı ayrıştırma içindir.
  taxRatePercent: z.number().nullable(),
  discountPriceCents: z.number().int().nullable(),
  sku: z.string().nullable(),
  stockQuantity: z.number().int(),
  status: PageStatusSchema,
  category: ProductCategorySchema.nullable(),
  coverMedia: MediaSchema.nullable(),
  images: z.array(ProductImageSchema),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  // §10.2 Gelişmiş SEO & Social Card — bkz. ARCHITECTURE.md §10.2.
  ogTitle: z.string().nullable(),
  ogImageUrl: z.string().nullable(),
  canonicalUrl: z.string().nullable(),
  noIndex: z.boolean(),
  // §10.5 Çoklu Dil & Yerelleştirme — TR (kolonlar) kanonik, translations.<locale> yalnızca override.
  translations: z.record(z.string(), z.record(z.string(), z.unknown())),
  // Bu içeriğin TÜM etkin dillerdeki slug/çeviri durumu — public uçlarda HER ZAMAN dolu döner.
  localizations: z.array(ContentLocalizationSchema),
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
export type ProductDto = z.infer<typeof ProductSchema>;

// ---------- §10.9.4 Portföy Modülü (Eklenti/Modül Yönetimi) — `Product`'ın (§10.9.2)
// BİREBİR paterni, ticari alanlar (fiyat/stok/SKU) yerine `clientName`/`projectUrl`/`completedAt`/
// `order` (manuel sıralama, bkz. ARCHITECTURE.md, prisma/schema.prisma::PortfolioItem).

export const PortfolioCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string(),
});
export type PortfolioCategoryDto = z.infer<typeof PortfolioCategorySchema>;

/** Sıralı portföy galerisi öğesi — bu fazda YAZMA ucu YOK (yalnızca okunur, `ProductImageSchema` ile AYNI patern). */
export const PortfolioImageSchema = z.object({
  id: z.string().uuid(),
  media: MediaSchema,
  order: z.number().int(),
});
export type PortfolioImageDto = z.infer<typeof PortfolioImageSchema>;

export const PortfolioItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  summary: z.string().nullable(),
  contentHtml: z.string(),
  clientName: z.string().nullable(),
  projectUrl: z.string().nullable(),
  completedAt: z.string().nullable(),
  // Manuel sıralama (kullanıcı kararı) — `viewCount`/`seq` ile KARIŞTIRILMAMALI.
  order: z.number().int(),
  status: PageStatusSchema,
  category: PortfolioCategorySchema.nullable(),
  coverMedia: MediaSchema.nullable(),
  images: z.array(PortfolioImageSchema),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  // §10.2 Gelişmiş SEO & Social Card — bkz. ARCHITECTURE.md §10.2.
  ogTitle: z.string().nullable(),
  ogImageUrl: z.string().nullable(),
  canonicalUrl: z.string().nullable(),
  noIndex: z.boolean(),
  // §10.5 Çoklu Dil & Yerelleştirme — TR (kolonlar) kanonik, translations.<locale> yalnızca override.
  translations: z.record(z.string(), z.record(z.string(), z.unknown())),
  // Bu içeriğin TÜM etkin dillerdeki slug/çeviri durumu — public uçlarda HER ZAMAN dolu döner.
  localizations: z.array(ContentLocalizationSchema),
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
export type PortfolioItemDto = z.infer<typeof PortfolioItemSchema>;

// ---------- Gelişmiş Slider / Hero Studio — bkz. `.claude/architect-scope-advanced-slider.md`
// (bağlayıcı karar dokümanı) ve openapi.yaml `Sliders` tag'i. `Slider`/`Slide` bir "içerik"
// DEĞİLDİR (§1.1) — `status`/`translations`/`viewCount`/SEO alanları BİLİNÇLİ OLARAK YOKTUR.
//
// Enum DEĞERLERİ openapi.yaml ile BİREBİR (küçük harf/kebab-case) — Prisma tarafındaki
// SCREAMING_SNAKE karşılıkları (`SliderTransitionEffect` vb.) `modules/sliders/lib/enum-maps.ts`
// içinde İKİ YÖNLÜ eşlenir (`import.constants.ts::DUPLICATE_STRATEGY_TO_PRISMA` ile AYNI desen).
// `ContainerJustify`/`ButtonBlock.style` gibi render-motoru varyant tablolarıyla AYNI ilke:
// HAM CSS/Prisma değeri DEĞİL, sabit bir varyant kümesi dışa verilir.

export const SliderTransitionEffectSchema = z.enum(["slide", "fade", "cube", "zoom"]);
export type SliderTransitionEffect = z.infer<typeof SliderTransitionEffectSchema>;

export const SliderHeightModeSchema = z.enum(["full-screen", "custom-px", "aspect-ratio"]);
export type SliderHeightMode = z.infer<typeof SliderHeightModeSchema>;

export const SlideBackgroundTypeSchema = z.enum(["image", "video", "gradient"]);
export type SlideBackgroundType = z.infer<typeof SlideBackgroundTypeSchema>;

export const SliderNavigationThemeSchema = z.enum(["light", "dark"]);
export type SliderNavigationTheme = z.infer<typeof SliderNavigationThemeSchema>;

/** Slider seviyesi davranış/görünüm ayarları — `SliderSchema` ve `PublicSliderSchema` PAYLAŞIR. */
export const SliderSettingsSchema = z.object({
  autoplay: z.boolean(),
  intervalMs: z.number().int(),
  loop: z.boolean(),
  pauseOnHover: z.boolean(),
  transitionEffect: SliderTransitionEffectSchema,
  transitionDurationMs: z.number().int(),
  heightMode: SliderHeightModeSchema,
  heightPx: z.number().int().nullable(),
  aspectRatioWidth: z.number().int(),
  aspectRatioHeight: z.number().int(),
  mobileHeightMode: SliderHeightModeSchema.nullable(),
  mobileHeightPx: z.number().int().nullable(),
  mobileAspectRatioWidth: z.number().int().nullable(),
  mobileAspectRatioHeight: z.number().int().nullable(),
  showArrows: z.boolean(),
  showBullets: z.boolean(),
  showProgressBar: z.boolean(),
  navigationTheme: SliderNavigationThemeSchema,
});
export type SliderSettingsDto = z.infer<typeof SliderSettingsSchema>;

/** Liste/seçici DTO — `slides` YOKTUR (bkz. `GET /admin/sliders`). */
export const SliderSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  slideCount: z.number().int(),
  // İlk aktif slaytın arka plan görseli — seçicide küçük önizleme için türetilir (DB kolonu DEĞİL).
  previewImageUrl: z.string().nullable(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SliderSummaryDto = z.infer<typeof SliderSummarySchema>;

/**
 * Bir slaytın arka planı + KATMANLARI. `layers` DTO'da (Page.blocks ile AYNI model, bkz.
 * `PageSchema.blocks`) BİLİNÇLİ OLARAK gevşek (`z.record(z.unknown())`) doğrulanır — asıl
 * katman-şekli doğrulaması YAZMA anında `modules/sliders/lib/layers.ts::parseSlideLayers`
 * ile yapılır; response DTO'su ikinci/ayrışabilir bir kopya TAŞIMAZ.
 */
export const SlideSchema = z.object({
  id: z.string().uuid(),
  order: z.number().int(),
  isActive: z.boolean(),
  // Yalnızca PANEL İÇİ tanımlayıcı — public yanıtta YOK (bkz. PublicSlideSchema).
  label: z.string().nullable(),
  bgType: SlideBackgroundTypeSchema,
  bgMedia: MediaSchema.nullable(),
  bgVideoUrl: z.string().nullable(),
  bgVideoPosterMedia: MediaSchema.nullable(),
  bgPositionX: z.number().int(),
  bgPositionY: z.number().int(),
  bgOverlayColor: z.string().nullable(),
  bgOverlayOpacity: z.number().int(),
  bgGradientFrom: z.string().nullable(),
  bgGradientTo: z.string().nullable(),
  bgGradientAngle: z.number().int(),
  bgKenBurns: z.boolean(),
  durationMs: z.number().int().nullable(),
  linkHref: z.string().nullable(),
  linkNewTab: z.boolean(),
  layers: z.array(z.record(z.unknown())),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SlideDto = z.infer<typeof SlideSchema>;

/** `Slide` ile AYNI şekil EKSİ `label`/`isActive` (bkz. `GET /sliders/{sliderId}`). */
export const PublicSlideSchema = SlideSchema.omit({ label: true, isActive: true });
export type PublicSlideDto = z.infer<typeof PublicSlideSchema>;

/** Admin detay DTO — ayarlar + TÜM slaytlar (pasifler dahil), bkz. `GET /admin/sliders/{sliderId}`. */
export const SliderSchema = SliderSummarySchema.merge(SliderSettingsSchema).extend({
  slides: z.array(SlideSchema),
});
export type SliderDto = z.infer<typeof SliderSchema>;

/** `GET /sliders/{sliderId}` yanıtı — render için gereken MİNİMUM veri. */
export const PublicSliderSchema = SliderSettingsSchema.extend({
  id: z.string().uuid(),
  // `aria-label` olarak kullanılır (`role="region"` + `aria-roledescription="carousel"`).
  name: z.string(),
  slides: z.array(PublicSlideSchema),
});
export type PublicSliderDto = z.infer<typeof PublicSliderSchema>;

/** `GET /admin/sliders/{sliderId}/usage` ve `409` gövdesindeki `error.details.usedBy` öğesi. */
export const SliderUsageSchema = z.object({
  pageId: z.string().uuid(),
  pageTitle: z.string(),
  pageSlug: z.string(),
  // Sayfa ağacındaki `advanced-slider` düğümünün `id`'si.
  blockId: z.string(),
  // `SiteSettings.homePageId` bu sayfayı gösteriyorsa `true` — uyarı metnini sertleştirmek için.
  isHomePage: z.boolean(),
  pageDeletedAt: z.string().nullable(),
});
export type SliderUsageDto = z.infer<typeof SliderUsageSchema>;

/** `GET /admin/sliders` `meta` zarfı — `SliderListMeta` (openapi.yaml). */
export const SliderListMetaSchema = z.object({
  nextCursor: z.string().nullable(),
  counts: z.object({ active: z.number().int(), trashed: z.number().int() }),
});
export type SliderListMetaDto = z.infer<typeof SliderListMetaSchema>;

export const SiteTemplateSchema = z.enum(["SHOWCASE", "COMMERCE", "PORTFOLIO"]);
export type SiteTemplate = z.infer<typeof SiteTemplateSchema>;

export const SiteSettingsSchema = z.object({
  siteName: z.string(),
  logoUrl: z.string().nullable(),
  tagline: z.string().nullable(),
  // Header logo boyutu — null ise frontend varsayılanı (yükseklik 32px, genişlik sınırsız) kullanır.
  headerLogoHeight: z.number().nullable(),
  headerLogoMaxWidth: z.number().nullable(),
  homePageId: z.string().uuid().nullable(),
  // §Faz 4 Site Şablonu — bkz. prisma/schema.prisma::SiteSettings.siteTemplate (db-agent).
  siteTemplate: SiteTemplateSchema,
});
export type SiteSettingsDto = z.infer<typeof SiteSettingsSchema>;

// ---------- §10.9 Eklenti/Modül Yönetimi — modül TANIMI lib/module-registry.ts'te statik, burada
// SADECE aktif/pasif durum + kim/ne zaman değiştirdiği görünür (bkz. prisma/schema.prisma::SiteModule).

export const SiteModuleSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  updatedAt: z.string().nullable(),
  updatedBy: UserSummarySchema.nullable(),
  // §Faz 4 Site Şablonu — hangi site şablon(lar)ı için önerilen modül olduğu (frontend kurulum
  // sihirbazında öneri göstermek için okur, backend davranışını ETKİLEMEZ). SHOWCASE için özel
  // önerilen modül yok, bu yüzden boş/undefined olabilir.
  recommendedFor: z.array(SiteTemplateSchema).optional(),
});
export type SiteModuleDto = z.infer<typeof SiteModuleSchema>;

/** `GET /modules` (public) yanıtı — label/description/updatedBy TAŞIMAZ, sadece nav/layout kararı için. */
export const PublicSiteModuleSchema = z.object({
  key: z.string(),
  enabled: z.boolean(),
});
export type PublicSiteModuleDto = z.infer<typeof PublicSiteModuleSchema>;

export const SocialPlatformSchema = z.enum(["TWITTER", "GITHUB", "LINKEDIN", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "OTHER"]);

export const NavigationItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  href: z.string(),
  order: z.number(),
  parentId: z.string().nullable(),
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

export const ContentEntityTypeSchema = z.enum(["PAGE", "BLOG_POST", "PRODUCT", "PORTFOLIO_ITEM"]);

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

// ---------- §10.3 / §10.16 E-posta & Bildirim Şablonu Yöneticisi + Blok Editörü ----------
// bkz. ARCHITECTURE.md §10.16, openapi.yaml tag: EmailTemplates. §10.3'teki RAW/ham-HTML
// şablon yöneticisi devralınır (`bodyHtml`, `editorMode=RAW`); bu bölüm `blocks`/`editorMode=BLOCKS`
// ile GENİŞLETİR.

export const EmailTemplatePurposeSchema = z.enum([
  "WELCOME",
  "PASSWORD_RESET",
  "SYSTEM_ANNOUNCEMENT",
  "ORDER_CONFIRMATION",
  "ORG_INVITATION",
  "CONTACT_FORM_NOTIFICATION",
  "CUSTOM",
]);
export type EmailTemplatePurpose = z.infer<typeof EmailTemplatePurposeSchema>;

export const EmailTemplateEditorModeSchema = z.enum(["RAW", "BLOCKS"]);
export type EmailTemplateEditorMode = z.infer<typeof EmailTemplateEditorModeSchema>;

export const EMAIL_HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const EMAIL_CUSTOM_VARIABLE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export const EmailBlockTypeSchema = z.enum(["logo-header", "heading", "text", "button", "image", "divider", "footer"]);

/**
 * YANIT (response) şeması — TÜM alanlar ZORUNLUDUR (bkz. shared-types.ts::EmailBlockStyle, TÜM
 * alanlar non-optional). Yazma (request) tarafında `modules/email-templates/email-templates.schemas.ts`
 * AYRI, `.default(...)` uygulayan daha esnek bir sürüm tanımlar — `buildEmailBlockSchema` bu iki
 * sürümü de aynı `data` şekillerinden üretir (kod tekrarını önler).
 */
export const EmailBlockStyleSchema = z.object({
  align: z.enum(["left", "center", "right"]),
  backgroundColor: z.string().regex(EMAIL_HEX_COLOR_PATTERN).nullable(),
  textColor: z.string().regex(EMAIL_HEX_COLOR_PATTERN).nullable(),
  paddingY: z.enum(["none", "sm", "md", "lg"]),
  paddingX: z.enum(["none", "sm", "md", "lg"]),
});
export type EmailBlockStyleDto = z.infer<typeof EmailBlockStyleSchema>;

const EMAIL_BUTTON_HREF_VARIABLE_ONLY_PATTERN = /^\{\{[a-zA-Z0-9_]+\}\}$/;

/** `button.href` — http(s)/mailto olmalı YA DA TAMAMEN tek bir değişken olmalıdır (§10.16.4). */
export function isValidEmailButtonHref(href: string): boolean {
  if (EMAIL_BUTTON_HREF_VARIABLE_ONLY_PATTERN.test(href)) return true;
  return /^https?:\/\//i.test(href) || /^mailto:/i.test(href);
}

const EmailLogoHeaderDataSchema = z.object({
  useSiteLogo: z.boolean(),
  logoUrl: z.string().nullable(),
  height: z.number().int().min(16).max(120),
});
const EmailHeadingDataSchema = z.object({
  text: z.string().min(1).max(200),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});
const EmailTextDataSchema = z.object({ html: z.string().max(20000) });
const EmailButtonDataSchema = z
  .object({
    label: z.string().min(1).max(80),
    href: z.string().min(1),
    backgroundColor: z.string().regex(EMAIL_HEX_COLOR_PATTERN).nullable(),
    textColor: z.string().regex(EMAIL_HEX_COLOR_PATTERN).nullable(),
    radius: z.enum(["none", "sm", "full"]),
  })
  .superRefine((data, ctx) => {
    if (!isValidEmailButtonHref(data.href)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["href"],
        message: "href http(s)/mailto ile başlamalı ya da tamamen tek bir değişken ({{key}}) olmalıdır.",
      });
    }
  });
const EmailImageDataSchema = z.object({
  mediaId: z.string().nullable(),
  url: z.string().min(1),
  alt: z.string().min(1).max(200),
  width: z.number().int().positive().nullable(),
});
const EmailDividerDataSchema = z.object({
  thickness: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  color: z.string().regex(EMAIL_HEX_COLOR_PATTERN).nullable(),
});
const EmailFooterDataSchema = z.object({ text: z.string().max(1000) });

/**
 * `styleSchema` parametreli fabrika — YANIT (`EmailBlockSchema`, tüm style alanları zorunlu) ve
 * İSTEK (`email-templates.schemas.ts::EmailBlockInputSchema`, style alanları `.default(...)`'lı)
 * şemalarını AYNI 7 `data` şeklinden üretir; iki tarafın da elle senkronize edilmiş bir kopyası
 * OLMAZ.
 */
export function buildEmailBlockSchema<StyleSchema extends z.ZodTypeAny>(styleSchema: StyleSchema) {
  return z.discriminatedUnion("type", [
    z.object({ id: z.string().min(1), type: z.literal("logo-header"), style: styleSchema, data: EmailLogoHeaderDataSchema }),
    z.object({ id: z.string().min(1), type: z.literal("heading"), style: styleSchema, data: EmailHeadingDataSchema }),
    z.object({ id: z.string().min(1), type: z.literal("text"), style: styleSchema, data: EmailTextDataSchema }),
    z.object({ id: z.string().min(1), type: z.literal("button"), style: styleSchema, data: EmailButtonDataSchema }),
    z.object({ id: z.string().min(1), type: z.literal("image"), style: styleSchema, data: EmailImageDataSchema }),
    z.object({ id: z.string().min(1), type: z.literal("divider"), style: styleSchema, data: EmailDividerDataSchema }),
    z.object({ id: z.string().min(1), type: z.literal("footer"), style: styleSchema, data: EmailFooterDataSchema }),
  ]);
}

/** Şablon başına en fazla 50 blok (§10.16.4) — İÇ İÇE BLOK YOKTUR (§10.17'nin `columns`'uyla KARIŞTIRILMAMALI). */
export const EMAIL_BLOCKS_MAX = 50;

export const EmailBlockSchema = buildEmailBlockSchema(EmailBlockStyleSchema);
export type EmailBlockDto = z.infer<typeof EmailBlockSchema>;

export const EmailVariableSourceSchema = z.enum(["system", "custom", "contact-field"]);

export const EmailVariableDefinitionSchema = z.object({
  key: z.string().regex(EMAIL_CUSTOM_VARIABLE_KEY_PATTERN),
  label: z.string(),
  sampleValue: z.string(),
  source: EmailVariableSourceSchema,
});
export type EmailVariableDefinitionDto = z.infer<typeof EmailVariableDefinitionSchema>;

export const EmailCustomVariableSchema = z.object({
  key: z.string().regex(EMAIL_CUSTOM_VARIABLE_KEY_PATTERN),
  label: z.string().min(1).max(80),
  sampleValue: z.string().max(200),
});
export type EmailCustomVariableDto = z.infer<typeof EmailCustomVariableSchema>;

/** Liste (`GET /admin/notifications/templates`) yanıtı — `blocks`/`bodyHtml`/`variables` DÖNMEZ. */
export const EmailTemplateSummarySchema = z.object({
  id: z.string().uuid(),
  key: z.string().nullable(),
  name: z.string(),
  purpose: EmailTemplatePurposeSchema,
  editorMode: EmailTemplateEditorModeSchema,
  isSystem: z.boolean(),
  isActive: z.boolean(),
  subject: z.string(),
  updatedAt: z.string(),
  createdAt: z.string(),
});
export type EmailTemplateSummaryDto = z.infer<typeof EmailTemplateSummarySchema>;

export const EmailTemplateSchema = EmailTemplateSummarySchema.extend({
  bodyHtml: z.string(),
  blocks: z.array(EmailBlockSchema),
  availableVariables: z.array(z.string()),
  customVariables: z.array(EmailCustomVariableSchema),
  variables: z.array(EmailVariableDefinitionSchema),
});
export type EmailTemplateDto = z.infer<typeof EmailTemplateSchema>;

// ---------- §10.16.7 İletişim Formu — bkz. openapi.yaml tag: ContactForms ----------

export const ContactFieldTypeSchema = z.enum(["TEXT", "EMAIL", "PHONE", "TEXTAREA", "SELECT", "CHECKBOX"]);
export type ContactFieldType = z.infer<typeof ContactFieldTypeSchema>;

export const ContactSubmissionStatusSchema = z.enum(["NEW", "READ", "ARCHIVED", "SPAM"]);
export type ContactSubmissionStatus = z.infer<typeof ContactSubmissionStatusSchema>;

export const ContactFormFieldOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
});

export const ContactFormFieldSchema = z.object({
  id: z.string().uuid(),
  order: z.number().int(),
  key: z.string().regex(EMAIL_CUSTOM_VARIABLE_KEY_PATTERN),
  label: z.string().min(1).max(120),
  type: ContactFieldTypeSchema,
  required: z.boolean(),
  placeholder: z.string().nullable(),
  helpText: z.string().nullable(),
  options: z.array(ContactFormFieldOptionSchema),
  maxLength: z.number().int().nullable(),
  isSystem: z.boolean(),
});
export type ContactFormFieldDto = z.infer<typeof ContactFormFieldSchema>;

export const ContactFormSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  submitLabel: z.string(),
  successMessage: z.string(),
  isEnabled: z.boolean(),
  notifyEmail: z.string().nullable(),
  notificationTemplateId: z.string().nullable(),
  consentRequired: z.boolean(),
  consentText: z.string(),
  consentLegalPageId: z.string().nullable(),
  retentionDays: z.number().int(),
  fields: z.array(ContactFormFieldSchema),
  updatedAt: z.string(),
});
export type ContactFormDto = z.infer<typeof ContactFormSchema>;

export const ContactSubmissionSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string(),
  status: ContactSubmissionStatusSchema,
  notifiedAt: z.string().nullable(),
  notificationError: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ContactSubmissionSummaryDto = z.infer<typeof ContactSubmissionSummarySchema>;

export const ContactSubmissionSchema = ContactSubmissionSummarySchema.extend({
  data: z.record(z.string()),
  consentAt: z.string().nullable(),
  consentTextSnapshot: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  piiRedactedAt: z.string().nullable(),
});
export type ContactSubmissionDto = z.infer<typeof ContactSubmissionSchema>;

/** PUBLIC — `notifyEmail`/`notificationTemplateId`/`retentionDays` BİLİNÇLİ OLARAK YOK (§10.16.8). */
export const PublicContactFormSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  submitLabel: z.string(),
  consentRequired: z.boolean(),
  consentText: z.string(),
  consentLegalPage: z.object({ title: z.string(), slug: z.string() }).nullable(),
  fields: z.array(ContactFormFieldSchema),
});
export type PublicContactFormDto = z.infer<typeof PublicContactFormSchema>;

export const CreateContactSubmissionResponseSchema = z.object({
  id: z.string().uuid(),
  message: z.string(),
});
export type CreateContactSubmissionResponseDto = z.infer<typeof CreateContactSubmissionResponseSchema>;

// ---------- §10.8 Toplu İçe Aktarma (Import) — openapi.yaml Import tag ile birebir ----------
// NOT: `ImportDuplicateStrategy`/`ImportErrorSeverity` API sözleşmesinde lowerCamel string
// olarak tanımlıdır (`skip`/`overwrite`/`createNew`, `error`/`skipped`) — Prisma enum'ları
// (`SKIP`/`OVERWRITE`/`CREATE_NEW`, `ERROR`/`SKIPPED`) İLE KARIŞTIRILMAMALI. Dönüşüm
// `modules/import/import.constants.ts`'te tek noktadan yapılır.

export const ImportJobTypeSchema = z.enum(["PAGES", "BLOG", "WORDPRESS", "PRODUCTS", "USERS", "MEDIA"]);
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
  "WP_PRODUCTS_SKIPPED",
  "WC_TAX_NOT_IMPORTED",
  "WC_STOCK_NOT_MANAGED",
  "WC_VARIATIONS_UNSUPPORTED",
  "WC_GALLERY_NOT_IMPORTED",
  "WC_ORDERS_IGNORED",
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
    products: z.number().int(),
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

// ---------- §10.9.3 Sepet + Stripe Checkout (Eklenti/Modül Yönetimi) — bkz. ARCHITECTURE.md,
// prisma/schema.prisma::Cart/CartItem/Order/OrderItem. openapi.yaml'a bu fazda DOKUNULMADI
// (bkz. görev notu) — bu şemalar backend-agent'ın kararıyla tanımlandı.

/** `GET /cart` yanıtındaki her satır — dondurulmuş fiyat (`frozenUnitPriceCents`, sepete eklenme
 * anındaki `CartItem.unitPriceCents`) ile DB'den taze okunan `currentPriceCents` AYRI dönülür,
 * ikisi farklıysa frontend uyarı gösterebilir (bkz. cart.routes.ts). */
export const CartItemSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  product: z.object({
    id: z.string().uuid(),
    title: z.string(),
    slug: z.string(),
    coverImageUrl: z.string().nullable(),
    stockQuantity: z.number().int(),
  }),
  quantity: z.number().int(),
  frozenUnitPriceCents: z.number().int(),
  currentPriceCents: z.number().int(),
  lineTotalCents: z.number().int(),
});
export type CartItemDto = z.infer<typeof CartItemSchema>;

/** Cookie yoksa/geçersizse (henüz hiçbir şey eklenmemiş) boş sepet döner — `currency: null`. */
export const CartSchema = z.object({
  items: z.array(CartItemSchema),
  currency: z.string().nullable(),
  // Dondurulmuş fiyatlar (`frozenUnitPriceCents * quantity`) üzerinden toplam — checkout'un
  // hesaplayacağı nihai tutarla AYNI mantık, ama checkout DB'den TEKRAR taze okuyup kendi
  // hesabını yapar (bkz. checkout.routes.ts) — burası yalnızca gösterim amaçlıdır.
  subtotalCents: z.number().int(),
});
export type CartDto = z.infer<typeof CartSchema>;

// `.claude/architect-scope-customer-portal.md` §6 — `SHIPPED` eklendi (`PAID -> SHIPPED -> FULFILLED`).
// `DELIVERED` BİLİNÇLİ OLARAK eklenmedi: `FULFILLED` zaten terminal başarı durumudur, ikisini
// birlikte tutmak "hangisi bitmiş?" belirsizliği üretirdi (bkz. plan §6).
export const OrderStatusSchema = z.enum(["PENDING", "PAID", "SHIPPED", "FAILED", "CANCELLED", "EXPIRED", "REFUNDED", "FULFILLED"]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const OrderItemSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid().nullable(),
  // Ürün silinse/değişse bile sipariş geçmişi bozulmasın diye SNAPSHOT (bkz. prisma/schema.prisma::OrderItem).
  productTitle: z.string(),
  productSku: z.string().nullable(),
  unitPriceCents: z.number().int(),
  quantity: z.number().int(),
  lineTotalCents: z.number().int(),
});
export type OrderItemDto = z.infer<typeof OrderItemSchema>;

export const OrderSchema = z.object({
  id: z.string().uuid(),
  orderNumber: z.string(),
  status: OrderStatusSchema,
  customerEmail: z.string(),
  customerName: z.string().nullable(),
  currency: z.string(),
  subtotalCents: z.number().int(),
  discountCents: z.number().int(),
  taxCents: z.number().int(),
  totalCents: z.number().int(),
  errorSummary: z.string().nullable(),
  paidAt: z.string().nullable(),
  // `.claude/architect-scope-customer-portal.md` §5.3/§2.4 — kargo alanları. `trackingNumber`
  // `status: SHIPPED` iken ZORUNLU olarak dolar (uygulama katmanı, DB'de CHECK YOK).
  // `shippingCarrier` serbest metin (enum v1'de açılmaz). `shippedAt`/`deliveredAt` `paidAt`
  // ile AYNI desen — ilgili duruma geçişte route handler tarafından otomatik doldurulur.
  trackingNumber: z.string().nullable(),
  shippingCarrier: z.string().nullable(),
  shippedAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  createdAt: z.string(),
  items: z.array(OrderItemSchema),
});
export type OrderDto = z.infer<typeof OrderSchema>;

// ---------- Müşteri & E-Ticaret Alanı (Customer Portal) — bkz.
// `.claude/architect-scope-customer-portal.md` §2.2/§2.3 (bağlayıcı karar dokümanı).

/** `GET/POST/PATCH/DELETE /users/me/addresses*` DTO'su — sahiplik `userId = me` ile korunur. */
export const AddressSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  fullName: z.string(),
  phone: z.string(),
  country: z.string(),
  city: z.string(),
  district: z.string(),
  neighborhood: z.string().nullable(),
  addressLine1: z.string(),
  addressLine2: z.string().nullable(),
  postalCode: z.string().nullable(),
  isDefault: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AddressDto = z.infer<typeof AddressSchema>;

/**
 * `WishlistItem.product` gömülü özeti — `CartItemSchema.product` İLE AYNI hafif şekil
 * (tam `ProductSchema` DEĞİL: `author`/`seoScore`/`translations` gibi yönetim alanları
 * favori kartında GEREKMEZ). Fiyat alanları burada DOĞRUDAN taşınır (cart'ın aksine favori
 * bir fiyat DONDURMAZ — `CartItem.frozenUnitPriceCents` benzeri bir alan YOKTUR).
 */
export const WishlistItemProductSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  coverImageUrl: z.string().nullable(),
  priceCents: z.number().int(),
  discountPriceCents: z.number().int().nullable(),
  currency: z.string(),
  stockQuantity: z.number().int(),
});
export type WishlistItemProductDto = z.infer<typeof WishlistItemProductSchema>;

/** `GET/POST /users/me/wishlist`, `DELETE /users/me/wishlist/{productId}` DTO'su. */
export const WishlistItemSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  product: WishlistItemProductSchema,
  createdAt: z.string(),
});
export type WishlistItemDto = z.infer<typeof WishlistItemSchema>;

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

// ---------- §10.12 Site Özelleştirme (Görünüm) — openapi.yaml `Appearance` tag'i ile birebir.
// İSİMLENDİRME KURALI (bağlayıcı, bkz. ARCHITECTURE.md §10.12.4): bu bölümdeki HER alan YALNIZCA
// ziyaretçi (public) sitesini etkiler. Alan adlarında `site` ön eki KULLANILMAZ — ayrım RENDER
// katmanında (`--site-*` CSS değişkenleri + `.site-scope`) zorlanır, admin panelinin kendi
// `--primary`/`AccentProvider` token'larıyla ASLA karışmaz.

export const SiteFontSchema = z.enum([
  "SYSTEM",
  "INTER",
  "ROBOTO",
  "OPEN_SANS",
  "MONTSERRAT",
  "POPPINS",
  "LORA",
  "PLAYFAIR_DISPLAY",
  "SOURCE_SERIF_4",
  "PLUS_JAKARTA_SANS",
  "OUTFIT",
]);
export type SiteFont = z.infer<typeof SiteFontSchema>;

export const PageHeaderStyleSchema = z.enum(["PLAIN", "BANNER", "HIDDEN"]);
export type PageHeaderStyle = z.infer<typeof PageHeaderStyleSchema>;

// `pageHeaderStyle`'dan BAĞIMSIZ bir alandır — yalnızca `pageHeaderStyle=BANNER` iken sitede
// etkilidir, ama bu iş kuralı BİLİNÇLİ olarak backend'de ZORLANMAZ (frontend uygular): BANNER→PLAIN
// geçişinde kullanıcının seçtiği düzeni kaybetmemesi gerekir.
export const PageHeaderLayoutSchema = z.enum(["CENTERED", "LEFT_OVERLAY", "MINIMAL_LINE", "SPLIT"]);
export type PageHeaderLayout = z.infer<typeof PageHeaderLayoutSchema>;

// --- Bileşen Stilleri (§10.12.2 genişlemesi, bkz. .claude/architect-scope-theme-typography.md) ---
export const SiteBorderRadiusSchema = z.enum(["NONE", "SM", "MD", "LG", "FULL"]);
export type SiteBorderRadius = z.infer<typeof SiteBorderRadiusSchema>;

export const SiteButtonStyleSchema = z.enum(["SOLID", "OUTLINE", "SOFT"]);
export type SiteButtonStyle = z.infer<typeof SiteButtonStyleSchema>;

// `SocialPlatformSchema`'dan (sitenin KENDİ hesap linkleri) BİLİNÇLİ olarak AYRIDIR — bkz.
// ARCHITECTURE.md §10.12.1, iki liste zamanla farklı yönlere evrilir.
export const SocialShareNetworkSchema = z.enum(["TWITTER", "FACEBOOK", "LINKEDIN", "WHATSAPP", "EMAIL", "COPY_LINK"]);
export type SocialShareNetwork = z.infer<typeof SocialShareNetworkSchema>;

// Kanonik 6 haneli hex renk — kısaltma/alfa kanalı/isimli renk/oklch() KABUL EDİLMEZ (bkz.
// openapi.yaml `HexColor`): tek kanonik biçim, kaçış (escape) uygulamadan CSS değişkenine
// güvenle gömülmesini sağlar.
export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Geçerli bir 6 haneli hex renk olmalıdır (örn. #4f46e5).");

export const SiteAppearanceSchema = z.object({
  presetKey: z.string().nullable(),
  // --- Sayfa Başlığı Düzeni ---
  pageHeaderStyle: PageHeaderStyleSchema,
  pageHeaderLayout: PageHeaderLayoutSchema,
  pageHeaderBackgroundColor: HexColorSchema.nullable(),
  pageHeaderBackgroundMediaId: z.string().uuid().nullable(),
  pageHeaderBackgroundUrl: z.string().nullable(),
  pageHeaderOverlayOpacity: z.number().int().min(0).max(100),
  // --- Renkler (SADECE ziyaretçi sitesi) ---
  primaryColor: HexColorSchema,
  secondaryColor: HexColorSchema,
  buttonColor: HexColorSchema,
  buttonTextColor: HexColorSchema,
  linkColor: HexColorSchema,
  accentColor: HexColorSchema,
  backgroundColor: HexColorSchema,
  surfaceColor: HexColorSchema,
  textColor: HexColorSchema,
  mutedTextColor: HexColorSchema,
  // --- Yazı Tipi ---
  headingFont: SiteFontSchema,
  bodyFont: SiteFontSchema,
  baseFontSize: z.number().int().min(14).max(20),
  // --- Bileşen Stilleri ---
  borderRadius: SiteBorderRadiusSchema,
  buttonStyle: SiteButtonStyleSchema,
  // --- Sosyal Medya Paylaşımı (hesap LİNKLERİ burada DEĞİL — bkz. SocialLink/Navigation) ---
  socialShareEnabled: z.boolean(),
  socialShareNetworks: z.array(SocialShareNetworkSchema),
  // --- Görünüm anahtarları ---
  backToTopEnabled: z.boolean(),
  stickyHeaderEnabled: z.boolean(),
  cookieBannerEnabled: z.boolean(),
  cookieBannerText: z.string().nullable(),
  cookieBannerPolicyHref: z.string().nullable(),
  maintenanceModeEnabled: z.boolean(),
  maintenanceMessage: z.string().nullable(),
  // --- 404 Sayfası ---
  notFoundTitle: z.string().nullable(),
  notFoundMessage: z.string().nullable(),
  notFoundButtonLabel: z.string().nullable(),
  notFoundButtonHref: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type SiteAppearanceDto = z.infer<typeof SiteAppearanceSchema>;

/**
 * `GET /appearance` (public) yanıtı. `SiteAppearance`'tan FARKLARI: `presetKey`,
 * `pageHeaderBackgroundMediaId` ve `updatedAt` TAŞIMAZ; buna karşılık `customCss`/`customJs`
 * İÇERİR (`(site)` layout'u ikinci bir istek atmadan SSR'da ihtiyaç duyar, bkz. §10.12.6).
 */
export const PublicSiteAppearanceSchema = z.object({
  pageHeaderStyle: PageHeaderStyleSchema,
  pageHeaderLayout: PageHeaderLayoutSchema,
  pageHeaderBackgroundColor: HexColorSchema.nullable(),
  pageHeaderBackgroundUrl: z.string().nullable(),
  pageHeaderOverlayOpacity: z.number().int().min(0).max(100),
  primaryColor: HexColorSchema,
  secondaryColor: HexColorSchema,
  buttonColor: HexColorSchema,
  buttonTextColor: HexColorSchema,
  linkColor: HexColorSchema,
  accentColor: HexColorSchema,
  backgroundColor: HexColorSchema,
  surfaceColor: HexColorSchema,
  textColor: HexColorSchema,
  mutedTextColor: HexColorSchema,
  headingFont: SiteFontSchema,
  bodyFont: SiteFontSchema,
  baseFontSize: z.number().int().min(14).max(20),
  borderRadius: SiteBorderRadiusSchema,
  buttonStyle: SiteButtonStyleSchema,
  socialShareEnabled: z.boolean(),
  socialShareNetworks: z.array(SocialShareNetworkSchema),
  backToTopEnabled: z.boolean(),
  stickyHeaderEnabled: z.boolean(),
  cookieBannerEnabled: z.boolean(),
  cookieBannerText: z.string().nullable(),
  cookieBannerPolicyHref: z.string().nullable(),
  maintenanceModeEnabled: z.boolean(),
  maintenanceMessage: z.string().nullable(),
  notFoundTitle: z.string().nullable(),
  notFoundMessage: z.string().nullable(),
  notFoundButtonLabel: z.string().nullable(),
  notFoundButtonHref: z.string().nullable(),
  // `(site)` layout'unda `<style>` olarak gömülür — kök `app/layout.tsx`'te ASLA (admin panelini
  // de sarmalar, bkz. §10.12.6).
  customCss: z.string().nullable(),
  // `CUSTOM_CODE_ENABLED=false` iken HER ZAMAN `null` (kill switch).
  customJs: z.string().nullable(),
});
export type PublicSiteAppearanceDto = z.infer<typeof PublicSiteAppearanceSchema>;

/**
 * `GET /admin/appearance/custom-code` ve iki PUT ucunun yanıtı — §10.12.6 kontrattaki EN YÜKSEK
 * RİSKLİ yüzey. `js`, `CUSTOM_CODE_ENABLED=false` iken bu yönetim ucunda YİNE GÖRÜNÜR (yönetici ne
 * kaydedildiğini görebilmelidir); yalnızca public `GET /appearance` `null` döner.
 */
export const SiteCustomCodeSchema = z.object({
  css: z.string().nullable(),
  js: z.string().nullable(),
  cssUpdatedAt: z.string().nullable(),
  cssUpdatedBy: UserSummarySchema.nullable(),
  jsUpdatedAt: z.string().nullable(),
  jsUpdatedBy: UserSummarySchema.nullable(),
  customCodeEnabled: z.boolean(),
});
export type SiteCustomCodeDto = z.infer<typeof SiteCustomCodeSchema>;

// ---------------------------------------------------------------------------
// §10.13 Üçüncü Parti Entegrasyon — API Anahtarları (bkz. ARCHITECTURE.md §10.13.3/§10.13.4,
// openapi.yaml tag `ApiKeys`). Modül: modules/api-keys/*.
// ---------------------------------------------------------------------------

export const ApiKeyScopeSchema = z.enum(["READ", "READ_WRITE"]);
export type ApiKeyScope = z.infer<typeof ApiKeyScopeSchema>;

/** `REVOKED` SOFT iptaldir — satır silinmez, denetim izi korunur (§10.13.4). */
export const ApiKeyStatusSchema = z.enum(["ACTIVE", "REVOKED"]);
export type ApiKeyStatus = z.infer<typeof ApiKeyStatusSchema>;

/** `/admin/settings/api-keys` DTO'su. Ham anahtarı ASLA içermez. */
export const ApiKeySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  keyPrefix: z.string(),
  last4: z.string().min(4).max(4),
  maskedKey: z.string(),
  scope: ApiKeyScopeSchema,
  status: ApiKeyStatusSchema,
  lastUsedAt: z.string().nullable(),
  lastUsedIp: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdById: z.string().uuid().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ApiKeyDto = z.infer<typeof ApiKeySchema>;

/** `plainKey` YALNIZCA `POST /admin/settings/api-keys` (201) yanıtında, bir kez döner. */
export const CreateApiKeyResponseSchema = z.object({
  apiKey: ApiKeySchema,
  plainKey: z.string(),
});
export type CreateApiKeyResponseDto = z.infer<typeof CreateApiKeyResponseSchema>;

/** `GET /public/me` yanıtı — anahtarın kendisini/hash'ini/ön ekini DÖNMEZ. */
export const PublicApiKeyInfoSchema = z.object({
  name: z.string(),
  scope: ApiKeyScopeSchema,
  expiresAt: z.string().nullable(),
  rateLimit: z.object({
    limit: z.number().int(),
    remaining: z.number().int(),
    resetSeconds: z.number().int(),
  }),
});
export type PublicApiKeyInfoDto = z.infer<typeof PublicApiKeyInfoSchema>;

// ---------------------------------------------------------------------------
// §10.13 Üçüncü Parti Entegrasyon — Giden (Outbound) Webhook'lar (bkz. ARCHITECTURE.md
// §10.13.7/§10.13.8/§10.13.9, openapi.yaml tag `OutboundWebhooks`). Modül: modules/outbound-webhooks/*.
//
// DİKKAT: `POST /webhooks/stripe` (GELEN/inbound, modules/webhooks/*) İLE TAMAMEN AYRIDIR.
// Çıplak `Webhook` adı hiçbir şemada kullanılmaz (belirsizdir).
// ---------------------------------------------------------------------------

/**
 * Wire gösterimi Prisma enum adıyla BİREBİR AYNIDIR (SCREAMING_SNAKE). `PING` gerçek bir olay
 * değildir — yalnızca `POST .../test` üretir. `*_PUBLISHED` olayları YALNIZCA duruma GEÇİŞTE
 * tetiklenir (§10.13.8).
 */
export const WebhookEventSchema = z.enum([
  "PING",
  "PAGE_PUBLISHED",
  "BLOG_POST_PUBLISHED",
  "BLOG_POST_UPDATED",
  "PRODUCT_CREATED",
  "PRODUCT_UPDATED",
  "PRODUCT_DELETED",
  "PORTFOLIO_ITEM_PUBLISHED",
  "ORDER_CREATED",
  "ORDER_PAID",
  "ORDER_STATUS_CHANGED",
]);
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

/** `GET /admin/settings/webhooks/events` öğesi — statik kod registry'sinden gelir (bkz. lib/webhook-events.ts). */
export const WebhookEventDefinitionSchema = z.object({
  event: WebhookEventSchema,
  label: z.string(),
  description: z.string(),
  containsPii: z.boolean(),
  payloadSchema: z.string().nullable(),
});
export type WebhookEventDefinitionDto = z.infer<typeof WebhookEventDefinitionSchema>;

/** `DISABLED` = SİSTEM otomatik kapattı; yeniden etkinleştirme ELLEdir (§10.13.8). */
export const OutboundWebhookStatusSchema = z.enum(["ACTIVE", "PAUSED", "DISABLED"]);
export type OutboundWebhookStatus = z.infer<typeof OutboundWebhookStatusSchema>;

/** `/admin/settings/webhooks` DTO'su. Secret ASLA dönmez — yalnızca `secretLast4`. */
export const OutboundWebhookSchema = z.object({
  id: z.string().uuid(),
  name: z.string().max(100),
  description: z.string().nullable(),
  url: z.string(),
  secretLast4: z.string().min(4).max(4),
  events: z.array(WebhookEventSchema).min(1),
  status: OutboundWebhookStatusSchema,
  consecutiveFailureCount: z.number().int(),
  autoDisabledAt: z.string().nullable(),
  lastTriggeredAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastFailureAt: z.string().nullable(),
  createdById: z.string().uuid().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OutboundWebhookDto = z.infer<typeof OutboundWebhookSchema>;

/** `plainSecret` YALNIZCA oluşturma/rotasyon yanıtında, bir kez döner. */
export const CreateOutboundWebhookResponseSchema = z.object({
  webhook: OutboundWebhookSchema,
  plainSecret: z.string(),
});
export type CreateOutboundWebhookResponseDto = z.infer<typeof CreateOutboundWebhookResponseSchema>;

export const RotateWebhookSecretResponseSchema = z.object({
  webhook: OutboundWebhookSchema,
  plainSecret: z.string(),
});
export type RotateWebhookSecretResponseDto = z.infer<typeof RotateWebhookSecretResponseSchema>;

/** `POST .../test` ve `POST .../deliveries/{id}/redeliver` ortak yanıtı (202, asenkron). */
export const EnqueueWebhookDeliveryResponseSchema = z.object({
  deliveryId: z.string().uuid(),
});
export type EnqueueWebhookDeliveryResponseDto = z.infer<typeof EnqueueWebhookDeliveryResponseSchema>;

export const WebhookDeliveryStatusSchema = z.enum(["PENDING", "SENDING", "RETRYING", "SUCCEEDED", "FAILED"]);
export type WebhookDeliveryStatus = z.infer<typeof WebhookDeliveryStatusSchema>;

export const WebhookDeliveryErrorCodeSchema = z.enum([
  "timeout",
  "dns_failure",
  "connection_refused",
  "tls_error",
  "redirect_not_followed",
  "ssrf_blocked",
  "http_error",
  "unknown",
]);
export type WebhookDeliveryErrorCode = z.infer<typeof WebhookDeliveryErrorCodeSchema>;

/** Liste DTO'su — `payload`/`responseBodySnippet` TAŞIMAZ (bkz. §10.13.10). */
export const WebhookDeliverySummarySchema = z.object({
  id: z.string().uuid(),
  event: WebhookEventSchema,
  status: WebhookDeliveryStatusSchema,
  attemptCount: z.number().int(),
  maxAttempts: z.number().int(),
  nextAttemptAt: z.string().nullable(),
  responseStatus: z.number().int().nullable(),
  errorCode: WebhookDeliveryErrorCodeSchema.nullable(),
  errorMessage: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  containsPii: z.boolean(),
  redeliveryOfId: z.string().uuid().nullable(),
  firstAttemptAt: z.string().nullable(),
  lastAttemptAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  createdAt: z.string(),
});
export type WebhookDeliverySummaryDto = z.infer<typeof WebhookDeliverySummarySchema>;

/** Giden POST gövdesi — TÜM olaylarda AYNI zarf (§10.13.9). */
export const WebhookPayloadEnvelopeSchema = z.object({
  id: z.string().uuid(),
  event: WebhookEventSchema,
  apiVersion: z.literal("v1"),
  createdAt: z.string(),
  data: z.record(z.unknown()),
});
export type WebhookPayloadEnvelopeDto = z.infer<typeof WebhookPayloadEnvelopeSchema>;

/** Detay DTO'su — `GET .../deliveries/{deliveryId}`. Redakte edilmişse `payload: { redacted: true }`. */
export const WebhookDeliverySchema = WebhookDeliverySummarySchema.extend({
  payload: z.union([WebhookPayloadEnvelopeSchema, z.object({ redacted: z.literal(true) })]),
  responseBodySnippet: z.string().nullable(),
});
export type WebhookDeliveryDto = z.infer<typeof WebhookDeliverySchema>;

/** `ORDER_*` olaylarının `data` alanı — `Order` (admin DTO) İLE KARIŞTIRILMAMALI, `customerEmail` MASKELENMEZ. */
export const WebhookOrderPayloadSchema = z.object({
  id: z.string().uuid(),
  orderNumber: z.string(),
  status: OrderStatusSchema,
  previousStatus: OrderStatusSchema.nullable(),
  customerEmail: z.string().email(),
  customerName: z.string().nullable(),
  currency: z.string(),
  subtotalCents: z.number().int(),
  discountCents: z.number().int(),
  taxCents: z.number().int(),
  totalCents: z.number().int(),
  paidAt: z.string().nullable(),
  // `.claude/architect-scope-customer-portal.md` §2.4 — kargo bilgisi giden webhook
  // sözleşmesine eklendi (`ORDER_STATUS_CHANGED` alıcıları kargo takip no'sunu görebilsin diye).
  trackingNumber: z.string().nullable(),
  shippingCarrier: z.string().nullable(),
  createdAt: z.string(),
  items: z.array(
    z.object({
      productSlug: z.string().nullable(),
      productTitle: z.string(),
      productSku: z.string().nullable(),
      unitPriceCents: z.number().int(),
      quantity: z.number().int(),
      lineTotalCents: z.number().int(),
    })
  ),
});
export type WebhookOrderPayloadDto = z.infer<typeof WebhookOrderPayloadSchema>;

// ---------------------------------------------------------------------------
// §10.13.5 Public API DTO'ları — admin DTO'larından AYRI ve DONDURULMUŞ kontrat (bkz.
// ARCHITECTURE.md §10.13.5, openapi.yaml tag `PublicApi`). Modül: modules/public-api/*.
//
// ORTAK KURAL (ihlali GÜVENLİK BULGUSUDUR): bu şemaların HİÇBİRİ `author`, `authorId`,
// `seoScore`, `seoScoreIssues`, `deletedAt`, `viewCount`, `translations` ya da `localizations`
// alanı TAŞIMAZ — admin DTO'larındaki `author` (`UserSummary`) PERSONEL E-POSTASI içerir.
// ---------------------------------------------------------------------------

export const PublicCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
});
export type PublicCategoryDto = z.infer<typeof PublicCategorySchema>;

export const PublicSeoFieldsSchema = z.object({
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  ogTitle: z.string().nullable(),
  ogImageUrl: z.string().nullable(),
  canonicalUrl: z.string().nullable(),
  noIndex: z.boolean(),
});
export type PublicSeoFieldsDto = z.infer<typeof PublicSeoFieldsSchema>;

export const PublicImageSchema = z.object({
  url: z.string(),
  altText: z.string().nullable(),
  order: z.number().int(),
});
export type PublicImageDto = z.infer<typeof PublicImageSchema>;

export const PublicPageSchema = PublicSeoFieldsSchema.extend({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  blocks: z.array(z.record(z.unknown())),
  isLegalDocument: z.boolean(),
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type PublicPageDto = z.infer<typeof PublicPageSchema>;

export const PublicBlogPostSchema = PublicSeoFieldsSchema.extend({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  excerpt: z.string().nullable(),
  contentHtml: z.string(),
  coverImageUrl: z.string().nullable(),
  category: PublicCategorySchema.nullable(),
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type PublicBlogPostDto = z.infer<typeof PublicBlogPostSchema>;

export const PublicProductSchema = PublicSeoFieldsSchema.extend({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  excerpt: z.string().nullable(),
  descriptionHtml: z.string(),
  priceCents: z.number().int(),
  discountPriceCents: z.number().int().nullable(),
  currency: z.string(),
  taxRatePercent: z.string().nullable(),
  sku: z.string().nullable(),
  /** `stockQuantity` YERİNE türetilmiş boolean (bağlayıcı, §10.13.5) — ham stok adedi DÖNMEZ. */
  inStock: z.boolean(),
  coverImageUrl: z.string().nullable(),
  images: z.array(PublicImageSchema),
  category: PublicCategorySchema.nullable(),
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type PublicProductDto = z.infer<typeof PublicProductSchema>;

export const PublicPortfolioItemSchema = PublicSeoFieldsSchema.extend({
  id: z.string().uuid(),
  title: z.string(),
  slug: z.string(),
  summary: z.string().nullable(),
  contentHtml: z.string(),
  clientName: z.string().nullable(),
  projectUrl: z.string().nullable(),
  completedAt: z.string().nullable(),
  order: z.number().int(),
  coverImageUrl: z.string().nullable(),
  images: z.array(PublicImageSchema),
  category: PublicCategorySchema.nullable(),
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type PublicPortfolioItemDto = z.infer<typeof PublicPortfolioItemSchema>;
export type ExportJobDto = z.infer<typeof ExportJobSchema>;
