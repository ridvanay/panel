import type { ContentStatus, SeoScoreIssue, UserSummary } from "@/lib/api/types";

/**
 * Sayfalar (`SitePage`) ve Blog Yazıları (`BlogPost`) DTO'larının §10.7 ile paylaştığı
 * ORTAK alan seti — `ContentListTable`/`useContentList` bu minimum sözleşmeye göre çalışır.
 * Her iki entity de bunu genişletir (blog ayrıca `category` taşır).
 */
export interface ContentListEntity {
  id: string;
  title: string;
  slug: string;
  status: ContentStatus;
  deletedAt: string | null;
  authorId: string | null;
  author: UserSummary | null;
  seoScore: number;
  seoScoreIssues: SeoScoreIssue[];
  publishedAt: string | null;
  updatedAt: string;
  viewCount: number;
}

/** 4 filtre sekmesi — sayaçlar her zaman `meta.counts`'tan gelir, client-side hesaplanmaz. */
export type ContentListFilter = "all" | "published" | "draft" | "trashed";

/** Hızlı Düzenle inline formunun taşıdığı alanlar — `PATCH .../:id` kısmi gövdesiyle birebir. */
export interface QuickEditValues {
  title: string;
  slug: string;
  status: ContentStatus;
}
