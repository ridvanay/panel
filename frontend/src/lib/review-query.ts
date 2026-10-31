/**
 * Paket AE — `/[lang]/reviews` URL sorgusu. Filtreler paylaşılabilir bağlantıdır; geçersiz değerler
 * sessizce atılır (arka uca ham kullanıcı girdisi gitmez).
 */
export interface ReviewsQuery {
  doctor?: string;
  language?: string;
  minRating?: number;
  page: number;
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,119}$/i;
const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseReviewsQuery(raw: Record<string, string | string[] | undefined>): ReviewsQuery {
  const doctor = first(raw.doctor)?.trim();
  const language = first(raw.language)?.trim();
  const minRating = Number(first(raw.minRating));
  const page = Number(first(raw.page));
  return {
    doctor: doctor && SLUG_PATTERN.test(doctor) ? doctor : undefined,
    language: language && LANGUAGE_PATTERN.test(language) ? language.toLowerCase() : undefined,
    minRating: Number.isInteger(minRating) && minRating >= 1 && minRating <= 5 ? minRating : undefined,
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

export function isReviewsFiltered(query: Pick<ReviewsQuery, "doctor" | "language" | "minRating">): boolean {
  return Boolean(query.doctor || query.language || query.minRating);
}

/** Boş değerler ve `page=1` atılır; sonuç `?` ile başlar ya da boş string'tir. */
export function reviewsQueryString(query: Partial<ReviewsQuery>): string {
  const params = new URLSearchParams();
  if (query.doctor) params.set("doctor", query.doctor);
  if (query.language) params.set("language", query.language);
  if (query.minRating) params.set("minRating", String(query.minRating));
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const text = params.toString();
  return text ? `?${text}` : "";
}
