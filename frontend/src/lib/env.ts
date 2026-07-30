export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
// sitemap.ts/robots.ts gibi mutlak URL üretmesi gereken dosyalar için — sitenin kendi origin'i.
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
