import type { Locale, PackageCardData, PublicBlogCard, PublicBlogDetail, PublicBlogTopicGroup } from "@/lib/api/types";

/** Paket Z1 testleri için ortak veri üreticileri (test dosyası değildir). */
export function makeCard(over: Partial<PublicBlogCard> = {}): PublicBlogCard {
  return {
    id: "p1",
    slug: "knee-pain-guide",
    title: "Knee pain guide",
    excerpt: "What to know about knee pain.",
    coverUrl: null,
    category: { name: "Orthopaedics", slug: "orthopaedics" },
    specialty: { slug: "orthopaedics", name: "Orthopaedics" },
    reviewer: { name: "Prof. Dr. H. Sofu", slug: "hakan-sofu", avatarUrl: null },
    publishedAt: "2026-10-01T10:00:00.000Z",
    lastReviewedAt: "2026-10-20T10:00:00.000Z",
    readingMinutes: 6,
    ...over,
  };
}

export function makeDetail(over: Partial<PublicBlogDetail> = {}): PublicBlogDetail {
  return {
    ...makeCard(),
    contentHtml: "<p>Intro</p><h2>Causes</h2><p>a</p><h3>Wear</h3><p>b</p><h2>Treatment</h2><p>c</p><h2>When to call</h2><p>d</p>",
    seoTitle: null,
    seoDescription: null,
    ogTitle: null,
    ogImageUrl: null,
    canonicalUrl: null,
    noIndex: false,
    keyTakeaways: ["Rest helps", "See a doctor if swelling persists"],
    faq: [{ question: "Is surgery needed?", answer: "Rarely." }],
    references: [{ title: "Knee guideline", publisher: "Society", url: "https://example.org/guide", accessedAt: "2026-09-30" }],
    updatedAt: "2026-10-25T10:00:00.000Z",
    reviewer: { name: "Prof. Dr. H. Sofu", title: "Prof. Dr.", slug: "hakan-sofu", avatarUrl: null, specialty: { slug: "orthopaedics", name: "Orthopaedics" } },
    careTopics: [{ slug: "knee-pain", label: "Knee pain" }],
    relatedPosts: [makeCard({ id: "r1", slug: "hip-guide", title: "Hip guide" })],
    consultDoctors: [
      { slug: "hakan-sofu", name: "Prof. Dr. H. Sofu", title: "Prof. Dr.", avatarUrl: null, specialty: { slug: "orthopaedics", name: "Orthopaedics" } },
      { slug: "ayse-demir", name: "Dr. A. Demir", title: "Dr.", avatarUrl: null, specialty: { slug: "orthopaedics", name: "Orthopaedics" } },
    ],
    coverCompatUrl: null,
    localizations: [
      { locale: "en", slug: "knee-pain-guide" },
      { locale: "tr", slug: "diz-agrisi-rehberi" },
    ],
    ...over,
  };
}

export const GROUPS: PublicBlogTopicGroup[] = [
  {
    specialty: { slug: "orthopaedics", name: "Orthopaedics" },
    count: 9,
    topics: [
      { slug: "knee-pain", label: "Knee pain", count: 4 },
      { slug: "hip", label: "Hip", count: 3 },
      { slug: "shoulder", label: "Shoulder", count: 2 },
      { slug: "spine", label: "Spine", count: 2 },
      { slug: "foot", label: "Foot", count: 1 },
      { slug: "wrist", label: "Wrist", count: 1 },
      { slug: "elbow", label: "Elbow", count: 1 },
      { slug: "ankle", label: "Ankle", count: 1 },
    ],
  },
  { specialty: { slug: "cardiology", name: "Cardiology" }, count: 3, topics: [{ slug: "palpitations", label: "Palpitations", count: 3 }] },
];

export const LOCALES: Locale[] = [
  { code: "en", label: "English", nativeLabel: "English", isDefault: true, enabled: true, sortOrder: 0, hreflang: null },
  { code: "tr", label: "Türkçe", nativeLabel: "Türkçe", isDefault: false, enabled: true, sortOrder: 1, hreflang: null },
  { code: "ar", label: "Arabic", nativeLabel: "العربية", isDefault: false, enabled: true, sortOrder: 2, hreflang: null },
];

export const PACKAGE: PackageCardData = {
  id: "pk1",
  slug: "executive-check-up",
  category: "check-up",
  title: "Executive Check-up",
  summary: "A full-day check-up.",
  duration: "1 day",
  contentLocale: "en",
  isFeatured: true,
  cover: null,
  price: null,
};
