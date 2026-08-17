export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
// Sunucu tarafı (Server Component/proxy.ts) fetch'leri için — prod Docker'da frontend ve backend
// AYRI container'lar, "localhost" frontend container'ının KENDİ portunu işaret eder, backend'e
// ulaşamaz. devops-agent docker-compose.yml'de yalnızca frontend servisine (runtime `environment:`,
// build arg DEĞİL) `INTERNAL_API_URL=http://backend:4000/api/v1` (Docker network servis adı) set
// eder. Docker DIŞINDA (örn. `npm run dev`) bu değişken tanımlı olmaz, `API_BASE_URL`'e (localhost)
// fallback edilir — mevcut lokal geliştirme davranışı BOZULMAZ.
export const SERVER_API_BASE_URL = process.env.INTERNAL_API_URL ?? API_BASE_URL;
// sitemap.ts/robots.ts gibi mutlak URL üretmesi gereken dosyalar için — sitenin kendi origin'i.
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
