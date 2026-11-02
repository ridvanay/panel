import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { NotFoundError } from "../../../lib/errors";
import {
  applyFieldLocalization,
  attachLocalizations,
  getLocaleSet,
  isLocaleTranslated,
  resolveEffectiveLocaleCode,
  resolveEntityIdBySlug,
  type LocaleSet,
} from "../../../lib/localization";
import { doctorDisplayName } from "../../../lib/doctor-display-name";
import { localizedDoctorTitle } from "../../../lib/doctor-email-name";
import { parseVariants } from "../../../lib/image-pipeline";
import { absolutizeMediaUrl } from "../../../mappers";
import { PUBLIC_DOCTOR_WHERE } from "../../telehealth/lib/archive-filters";
import { FaqSchema, KeyTakeawaysSchema, ReferencesSchema } from "../blog.schemas";

/**
 * Paket Z1 — herkese açık blog liste/topics/detay okuma katmanı.
 * Yalnızca PUBLISHED + çöpte olmayan yazılar; seçili dil kanonik değilse yalnızca O DİLDE çevirisi olanlar.
 */

const CARD_INCLUDE = {
  category: true,
  specialty: true,
  reviewerDoctor: { include: { avatarMedia: true } },
} satisfies Prisma.BlogPostInclude;

type CardPost = Prisma.BlogPostGetPayload<{ include: typeof CARD_INCLUDE }>;

export interface PublicReviewer {
  name: string;
  slug: string;
  avatarUrl: string | null;
}

export interface PublicBlogCard {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  coverUrl: string | null;
  category: { name: string; slug: string } | null;
  specialty: { slug: string; name: string } | null;
  reviewer: PublicReviewer | null;
  publishedAt: string | null;
  lastReviewedAt: string | null;
  readingMinutes: number;
}

type DoctorLike = {
  title: string;
  fullName: string;
  publicName: string | null;
  isFounder: boolean;
  translations: unknown;
};

/** Unvan izleyici dilinde + `doctorDisplayName` kuralı. */
export function reviewerDisplayName(doctor: DoctorLike, locale: string | undefined): string {
  return `${localizedDoctorTitle(doctor, locale)} ${doctorDisplayName(doctor)}`.trim();
}

function localizedSpecialty(specialty: { slug: string; name: string; translations: unknown }, locale: string | undefined) {
  const name = locale ? applyFieldLocalization(specialty, locale, ["name"]).name : specialty.name;
  return { slug: specialty.slug, name };
}

function postReadingMinutes(post: { readingMinutes: number | null; translations: unknown }, locale: string | undefined): number {
  if (locale) {
    const override = (post.translations as Record<string, Record<string, unknown> | undefined> | null)?.[locale];
    const minutes = override?.readingMinutes;
    if (typeof minutes === "number" && minutes >= 1) return minutes;
  }
  return post.readingMinutes ?? 1;
}

/** Yayın + dil filtresi. Kanonik olmayan dilde `translations.<dil>.title` dolu olmalı. */
function publicWhere(locale: string | undefined): Prisma.BlogPostWhereInput {
  const base: Prisma.BlogPostWhereInput = { status: "PUBLISHED", deletedAt: null };
  if (!locale) return base;
  return {
    ...base,
    OR: [
      { translations: { path: [locale, "title"], not: "" } },
      { translations: { path: [locale.toUpperCase(), "title"], not: "" } },
    ],
  };
}

/** Paket Z2 — kategori adı izleyicinin dilinde (`translations.<dil>.name`); yoksa kanonik ad. */
export function localizedCategoryName(category: { name: string; translations?: unknown }, locale: string | undefined): string {
  if (!locale) return category.name;
  const map = (category.translations ?? {}) as Record<string, { name?: unknown } | undefined>;
  const value = map[locale.toLowerCase()]?.name;
  return typeof value === "string" && value.trim() ? value.trim() : category.name;
}

function buildCard(post: CardPost, locale: string | undefined, slugOf: (locale: string | undefined) => string): PublicBlogCard {
  const localized = locale ? applyFieldLocalization(post, locale, ["title", "excerpt"]) : post;
  const approved = post.medicalReviewStatus === "approved" && post.reviewerDoctor;
  return {
    id: post.id,
    slug: slugOf(locale),
    title: localized.title,
    excerpt: localized.excerpt,
    coverUrl: post.coverImageUrl,
    category: post.category ? { name: localizedCategoryName(post.category, locale), slug: post.category.slug } : null,
    specialty: post.specialty ? localizedSpecialty(post.specialty, locale) : null,
    reviewer: approved
      ? {
          name: reviewerDisplayName(post.reviewerDoctor!, locale),
          slug: post.reviewerDoctor!.slug,
          avatarUrl: post.reviewerDoctor!.avatarMedia ? absolutizeMediaUrl(post.reviewerDoctor!.avatarMedia.url) : null,
        }
      : null,
    publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
    lastReviewedAt: post.lastReviewedAt ? post.lastReviewedAt.toISOString() : null,
    readingMinutes: postReadingMinutes(post, locale),
  };
}

async function toCards(app: FastifyInstance, rows: CardPost[], locale: string | undefined, localeSet: LocaleSet): Promise<PublicBlogCard[]> {
  const localizations = await attachLocalizations(app, "BLOG_POST", rows, localeSet);
  return rows.map((row) => {
    const list = localizations.get(row.id) ?? [];
    return buildCard(row, locale, (loc) => (loc ? (list.find((l) => l.locale === loc)?.slug ?? row.slug) : row.slug));
  });
}

async function resolveTopicFilter(app: FastifyInstance, topic: string): Promise<Prisma.BlogPostWhereInput> {
  const [specialty, careTopic] = await Promise.all([
    app.prisma.specialty.findUnique({ where: { slug: topic }, select: { id: true } }),
    app.prisma.careTopic.findUnique({ where: { slug: topic }, select: { id: true } }),
  ]);
  const ors: Prisma.BlogPostWhereInput[] = [];
  if (specialty) ors.push({ specialtyId: specialty.id });
  if (careTopic) ors.push({ careTopicIds: { has: careTopic.id } });
  // Bilinmeyen konu: boş sonuç (hata değil).
  return ors.length > 0 ? { OR: ors } : { id: { in: [] } };
}

async function searchIds(app: FastifyInstance, q: string, locale: string | undefined): Promise<string[]> {
  const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const rows = await app.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM blog_posts
    WHERE status = 'PUBLISHED'::"PageStatus" AND "deletedAt" IS NULL
      AND (
        COALESCE(NULLIF(translations -> (${locale ?? null}::text) ->> 'title', ''), title) ILIKE ${pattern}
        OR COALESCE(NULLIF(translations -> (${locale ?? null}::text) ->> 'excerpt', ''), excerpt, '') ILIKE ${pattern}
      )`);
  return rows.map((row) => row.id);
}

export interface PublicListParams {
  locale?: string | undefined;
  page: number;
  pageSize: number;
  topic?: string | undefined;
  q?: string | undefined;
}

export async function listPublicPosts(app: FastifyInstance, params: PublicListParams) {
  const localeSet = await getLocaleSet(app);
  const locale = resolveEffectiveLocaleCode(localeSet, params.locale);

  const and: Prisma.BlogPostWhereInput[] = [publicWhere(locale)];
  if (params.topic) and.push(await resolveTopicFilter(app, params.topic));
  if (params.q) and.push({ id: { in: await searchIds(app, params.q, locale) } });
  const where: Prisma.BlogPostWhereInput = { AND: and };

  const orderBy: Prisma.BlogPostOrderByWithRelationInput[] = [{ publishedAt: "desc" }, { seq: "desc" }];
  const [total, rows] = await Promise.all([
    app.prisma.blogPost.count({ where }),
    app.prisma.blogPost.findMany({ where, orderBy, skip: (params.page - 1) * params.pageSize, take: params.pageSize, include: CARD_INCLUDE }),
  ]);

  let featuredRow: CardPost | null = null;
  if (params.page === 1) {
    featuredRow =
      (await app.prisma.blogPost.findFirst({ where: { AND: [...and, { isFeatured: true }] }, orderBy, include: CARD_INCLUDE })) ??
      rows[0] ??
      null;
  }

  const cards = await toCards(app, featuredRow && !rows.some((r) => r.id === featuredRow!.id) ? [...rows, featuredRow] : rows, locale, localeSet);
  const items = cards.slice(0, rows.length);
  const featured = featuredRow ? (cards.find((c) => c.id === featuredRow!.id) ?? null) : null;

  return { items, total, page: params.page, pageSize: params.pageSize, featured };
}

function careTopicLabel(translations: unknown, locale: string | undefined): string {
  const map = (translations ?? {}) as Record<string, { label?: unknown } | undefined>;
  const pick = (key: string | undefined) => (key && typeof map[key]?.label === "string" && (map[key]!.label as string).trim() ? (map[key]!.label as string) : null);
  return pick(locale) ?? pick("en") ?? Object.values(map).map((v) => (typeof v?.label === "string" ? v.label : "")).find(Boolean) ?? "";
}

export async function listPublicTopics(app: FastifyInstance, localeRaw: string | undefined) {
  const localeSet = await getLocaleSet(app);
  const locale = resolveEffectiveLocaleCode(localeSet, localeRaw);

  const posts = await app.prisma.blogPost.findMany({
    where: { ...publicWhere(locale), specialtyId: { not: null } },
    select: { specialtyId: true, careTopicIds: true },
  });
  if (posts.length === 0) return [];

  const specialtyIds = Array.from(new Set(posts.map((p) => p.specialtyId!)));
  const topicIds = Array.from(new Set(posts.flatMap((p) => p.careTopicIds)));
  const [specialties, topics] = await Promise.all([
    app.prisma.specialty.findMany({ where: { id: { in: specialtyIds } }, orderBy: [{ order: "asc" }, { seq: "asc" }] }),
    topicIds.length > 0 ? app.prisma.careTopic.findMany({ where: { id: { in: topicIds }, isActive: true } }) : Promise.resolve([]),
  ]);
  const topicById = new Map(topics.map((t) => [t.id, t]));

  return specialties.map((specialty) => {
    const inSpecialty = posts.filter((p) => p.specialtyId === specialty.id);
    const counts = new Map<string, number>();
    for (const post of inSpecialty) {
      for (const id of new Set(post.careTopicIds)) {
        if (topicById.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return {
      specialty: localizedSpecialty(specialty, locale),
      count: inSpecialty.length,
      topics: [...counts.entries()]
        .map(([id, count]) => ({ slug: topicById.get(id)!.slug, label: careTopicLabel(topicById.get(id)!.translations, locale), count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    };
  });
}

/**
 * Paket Z1-ek — "İnceleyen hekimler" ızgarası: en az bir yazıyı onaylamış (approved, çöpte değil) VE şu an
 * herkese açık (PUBLIC_DOCTOR_WHERE) hekimler. Kişisel iletişim verisi (e-posta/telefon) DÖNMEZ.
 */
export async function listPublicReviewers(app: FastifyInstance, localeRaw: string | undefined) {
  const localeSet = await getLocaleSet(app);
  const locale = resolveEffectiveLocaleCode(localeSet, localeRaw);

  const groups = await app.prisma.blogPost.groupBy({
    by: ["reviewerDoctorId"],
    where: { medicalReviewStatus: "approved", deletedAt: null, reviewerDoctorId: { not: null } },
    _count: { _all: true },
  });
  if (groups.length === 0) return { items: [] };
  const countById = new Map(groups.map((g) => [g.reviewerDoctorId!, g._count._all]));

  const doctors = await app.prisma.doctorProfile.findMany({
    where: { ...PUBLIC_DOCTOR_WHERE, id: { in: [...countById.keys()] } },
    include: { avatarMedia: true, specialty: true },
  });

  const items = doctors
    .map((d) => ({
      slug: d.slug,
      name: reviewerDisplayName(d, locale),
      title: localizedDoctorTitle(d, locale),
      avatarUrl: d.avatarMedia ? absolutizeMediaUrl(d.avatarMedia.url) : null,
      specialty: d.specialty ? localizedSpecialty(d.specialty, locale) : null,
      approvedCount: countById.get(d.id) ?? 0,
    }))
    .sort((a, b) => b.approvedCount - a.approvedCount || a.name.localeCompare(b.name, locale ?? "en"));
  return { items };
}

async function resolveCoverCompatUrl(app: FastifyInstance, coverImageUrl: string | null): Promise<string | null> {
  if (!coverImageUrl) return null;
  const candidates = [coverImageUrl];
  try {
    if (/^https?:\/\//i.test(coverImageUrl)) {
      const u = new URL(coverImageUrl);
      candidates.push(u.pathname);
    }
  } catch {
    // geçersiz URL: yalnızca ham değer aranır
  }
  const media = await app.prisma.media.findFirst({ where: { url: { in: candidates } }, select: { variants: true } });
  const jpeg = media ? parseVariants(media.variants).find((v) => v.format === "jpeg") : undefined;
  return absolutizeMediaUrl(jpeg ? jpeg.url : coverImageUrl);
}

/** Aynı uzmanlık, sonra ortak care topic, sonra en yeniler — en çok 3. */
async function findRelated(
  app: FastifyInstance,
  post: { id: string; specialtyId: string | null; careTopicIds: string[] },
  locale: string | undefined,
  localeSet: LocaleSet
): Promise<PublicBlogCard[]> {
  const base = publicWhere(locale);
  const picked: CardPost[] = [];
  const take = async (extra: Prisma.BlogPostWhereInput) => {
    if (picked.length >= 3) return;
    const rows = await app.prisma.blogPost.findMany({
      where: { AND: [base, extra, { id: { notIn: [post.id, ...picked.map((p) => p.id)] } }] },
      orderBy: [{ publishedAt: "desc" }, { seq: "desc" }],
      take: 3 - picked.length,
      include: CARD_INCLUDE,
    });
    picked.push(...rows);
  };
  if (post.specialtyId) await take({ specialtyId: post.specialtyId });
  if (post.careTopicIds.length > 0) await take({ careTopicIds: { hasSome: post.careTopicIds } });
  await take({});
  return toCards(app, picked, locale, localeSet);
}

async function findConsultDoctors(app: FastifyInstance, specialtyId: string | null, locale: string | undefined) {
  if (!specialtyId) return [];
  const doctors = await app.prisma.doctorProfile.findMany({
    where: {
      ...PUBLIC_DOCTOR_WHERE,
      OR: [{ specialtyId }, { additionalSpecialties: { some: { specialtyId } } }],
    },
    orderBy: [{ order: "asc" }, { seq: "asc" }],
    take: 2,
    include: { avatarMedia: true, specialty: true },
  });
  return doctors.map((d) => ({
    slug: d.slug,
    name: reviewerDisplayName(d, locale),
    title: localizedDoctorTitle(d, locale),
    avatarUrl: d.avatarMedia ? absolutizeMediaUrl(d.avatarMedia.url) : null,
    specialty: d.specialty ? localizedSpecialty(d.specialty, locale) : null,
  }));
}

function parseOr<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } }, value: unknown, fallback: T): T {
  const parsed = schema.safeParse(value);
  return parsed.success ? (parsed.data as T) : fallback;
}

export async function getPublicPostDetail(app: FastifyInstance, slug: string, localeRaw: string | undefined) {
  const localeSet = await getLocaleSet(app);
  const locale = resolveEffectiveLocaleCode(localeSet, localeRaw);

  const entityId = await resolveEntityIdBySlug(app, "BLOG_POST", slug, locale);
  const where = entityId ? { id: entityId } : { slug };
  const post = await app.prisma.blogPost.findFirst({
    where: { ...where, status: "PUBLISHED", deletedAt: null },
    include: { ...CARD_INCLUDE },
  });
  if (!post) throw new NotFoundError("Yazı bulunamadı.");
  // Kanonik olmayan dilde çevirisi yoksa 404 (taslak çeviri/boş başlık yayına çıkmaz).
  if (locale && !isLocaleTranslated(post.translations, locale)) throw new NotFoundError("Yazı bu dilde bulunamadı.");

  return buildPostDetail(app, post, locale, localeSet, false);
}

type DetailPost = Prisma.BlogPostGetPayload<{ include: typeof CARD_INCLUDE }>;

/**
 * Detay DTO'su (herkese açık ve önizleme için ortak). `preview=true`: `reviewer` DAİMA null (onaylı görünüm yok) ve
 * `lastReviewedAt` null; yayın/inceleme durumu hiçbir şekilde okunmaz-değiştirilmez.
 */
async function buildPostDetail(app: FastifyInstance, post: DetailPost, locale: string | undefined, localeSet: LocaleSet, preview: boolean) {
  const [card] = await toCards(app, [post], locale, localeSet);
  const localized = locale ? applyFieldLocalization(post, locale, ["contentHtml", "seoTitle", "seoDescription"]) : post;
  const override = locale ? ((post.translations as Record<string, Record<string, unknown> | undefined> | null)?.[locale] ?? {}) : {};

  const keyTakeaways = parseOr<string[]>(KeyTakeawaysSchema, locale && Array.isArray(override.keyTakeaways) ? override.keyTakeaways : post.keyTakeaways, []);
  const faq = parseOr<{ question: string; answer: string }[]>(FaqSchema, locale && Array.isArray(override.faq) ? override.faq : post.faq, []);
  const references = parseOr<{ title: string; publisher: string; url: string; accessedAt: string }[]>(ReferencesSchema, post.references, []);

  const topicRows =
    post.careTopicIds.length > 0 ? await app.prisma.careTopic.findMany({ where: { id: { in: post.careTopicIds }, isActive: true } }) : [];
  const localizationsAll = (await attachLocalizations(app, "BLOG_POST", [post], localeSet)).get(post.id) ?? [];

  const doctor = !preview && post.medicalReviewStatus === "approved" ? post.reviewerDoctor : null;
  const reviewerSpecialty = doctor?.specialtyId
    ? (post.specialty && post.specialty.id === doctor.specialtyId
        ? post.specialty
        : await app.prisma.specialty.findUnique({ where: { id: doctor.specialtyId } }))
    : null;

  const [relatedPosts, consultDoctors, coverCompatUrl] = await Promise.all([
    findRelated(app, post, locale, localeSet),
    findConsultDoctors(app, post.specialtyId, locale),
    resolveCoverCompatUrl(app, post.coverImageUrl),
  ]);

  return {
    ...card!,
    ...(preview ? { lastReviewedAt: null } : {}),
    contentHtml: localized.contentHtml,
    seoTitle: localized.seoTitle,
    seoDescription: localized.seoDescription,
    ogTitle: post.ogTitle,
    ogImageUrl: post.ogImageUrl,
    canonicalUrl: post.canonicalUrl,
    noIndex: post.noIndex,
    keyTakeaways,
    faq,
    references,
    updatedAt: post.updatedAt.toISOString(),
    reviewer: doctor
      ? {
          name: reviewerDisplayName(doctor, locale),
          title: localizedDoctorTitle(doctor, locale),
          slug: doctor.slug,
          avatarUrl: doctor.avatarMedia ? absolutizeMediaUrl(doctor.avatarMedia.url) : null,
          specialty: reviewerSpecialty ? localizedSpecialty(reviewerSpecialty, locale) : null,
        }
      : null,
    careTopics: topicRows.map((t) => ({ slug: t.slug, label: careTopicLabel(t.translations, locale) })),
    relatedPosts,
    consultDoctors,
    coverCompatUrl,
    localizations: localizationsAll.filter((l) => l.translated).map((l) => ({ locale: l.locale, slug: l.slug })),
  };
}

/**
 * Taslak önizleme detayı: yayındaki detayla AYNI şekil + `preview: true`, `pendingReviewer`, `reviewApproved`.
 * Her durumdaki (DRAFT/SCHEDULED/PUBLISHED) çöpte olmayan yazı; yetkilendirme (belirteç) çağıranda yapılır.
 * Dil: çeviri varsa o dil, yoksa kanonik.
 */
export async function getPreviewPostDetail(app: FastifyInstance, postId: string, localeRaw: string | undefined) {
  const post = await app.prisma.blogPost.findFirst({ where: { id: postId, deletedAt: null }, include: { ...CARD_INCLUDE } });
  if (!post) throw new NotFoundError("Yazı bulunamadı.");
  const localeSet = await getLocaleSet(app);
  let locale = resolveEffectiveLocaleCode(localeSet, localeRaw);
  if (locale && !isLocaleTranslated(post.translations, locale)) locale = undefined;

  const detail = await buildPostDetail(app, post, locale, localeSet, true);
  const doctor = post.reviewerDoctor;
  return {
    ...detail,
    preview: true as const,
    reviewApproved: post.medicalReviewStatus === "approved",
    pendingReviewer: doctor
      ? {
          name: reviewerDisplayName(doctor, locale),
          title: localizedDoctorTitle(doctor, locale),
          slug: doctor.slug,
          avatarUrl: doctor.avatarMedia ? absolutizeMediaUrl(doctor.avatarMedia.url) : null,
        }
      : null,
  };
}
