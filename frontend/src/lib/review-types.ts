import type { FeaturedReviewItem, FeaturedReviewsResponse, ReviewSummary } from "@/lib/api/types";

/** Paket AE — anasayfa/`/reviews` ortak ülke özeti: en çok yorumlu ilk 6 ülke + kalan ülke sayısı. */
export interface ReviewCountries {
  codes: string[];
  more: number;
}

/** `GET /reviews/featured` — Paket Y yanıtına `countries` eklenmiş hâli (eski yanıtta alan yoktur). */
export interface FeaturedReviewsData extends FeaturedReviewsResponse {
  countries?: ReviewCountries;
}

/** `GET /reviews` — herkese açık, filtreli ve sayfalı yorum listesi. */
export interface ReviewsListResponse {
  summary: ReviewSummary;
  countries: ReviewCountries;
  languages: { code: string; count: number }[];
  doctors: { slug: string; name: string; count: number }[];
  page: number;
  pageSize: number;
  total: number;
  items: FeaturedReviewItem[];
}
