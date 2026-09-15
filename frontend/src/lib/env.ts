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

/**
 * `.claude/architect-scope-doctor-subdomain.md` §6.4 — hekim portalının izole subdomain'i
 * (`http://doktor.siteadi.localhost:3000` dev, `https://doktor.siteadi.com` prod). Tanımsız
 * KALABİLİR (tek-domain kurulumlar, geriye dönük uyumluluk — §3.4) — bu durumda `null`. Gerçek
 * "subdomain modu açık mı" hesaplaması (`SITE_URL` ile aynı hostname'e çözülme döngü koruması
 * dahil) BURADA DEĞİL, `lib/doctor-host.ts::DOCTOR_ORIGIN`'dedir; bu sabit yalnızca ham env
 * okumasıdır.
 */
export const DOCTOR_SITE_URL = process.env.NEXT_PUBLIC_DOCTOR_URL || null;

/**
 * `.claude/architect-scope-demo-payment-doctor-counters.md` §1.5 (bağlayıcı) — dev-only demo
 * ödeme butonunun (`booking-payment-step.tsx`) tek görünürlük anahtarı. **Statik**
 * `process.env.NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS === "true"` üye erişimi ZORUNLU (`DOCTOR_SITE_URL`
 * gibi bir değişkene atayıp sonra karşılaştırmak DEĞİL) — Next.js yalnızca bu statik deseni
 * build-time'da inline edip dead-code elimination uygulayabilir; bu sayede prod build'de değer
 * `false`'a sabitlenir ve butonu saran kod bloğu bundle'dan TAMAMEN düşer (yalnızca "render
 * edilmiyor" değil, bundle'a hiç girmiyor).
 */
export const DEMO_PAYMENTS_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS === "true";

const PUBLIC_MEDIA_ORIGIN = (() => {
  try {
    return new URL(API_BASE_URL).origin;
  } catch {
    return null;
  }
})();

/**
 * `SERVER_API_BASE_URL`'deki AYNI Docker ağı sorunu (satır 2-7), API JSON gövdesinin İÇİNDEKİ
 * medya URL'leri için de geçerli — ama farklı bir katmanda ortaya çıkıyor: backend `Media.url`'i
 * TARAYICIYA göre mutlaklaştırır (`mappers/index.ts::absolutizeMediaUrl`, `env.PUBLIC_URL` —
 * `NEXT_PUBLIC_API_URL` ile AYNI host, `http://localhost:4000`). Bu URL bir Server Component'e
 * `next/image` `src`'i olarak ulaştığında, GÖRSELİ TARAYICI DEĞİL, Next'in KENDİ `/_next/image`
 * optimize edici route'u (yine frontend container'ının İÇİNDE, sunucu tarafında) fetch eder —
 * `SERVER_API_BASE_URL`'in çözdüğü AYNI "container kendi localhost'una bakıyor, backend'e değil"
 * sorunu burada da patlıyor (`ECONNREFUSED`), `/_next/image` 500 döner, `SafeImage`'in `onError`'ı
 * tetiklenir → "Görsel yüklenemedi". Halbuki `/uploads/...` dosyasının kendisi backend'de sorunsuz
 * servis ediliyor (tarayıcı doğrudan `http://localhost:4000/uploads/...`'a gidebiliyor) — 404/dosya
 * eksikliği DEĞİL, optimize edicinin erişemediği bir host.
 *
 * Çözüm `INTERNAL_API_URL` ile AYNI desen: devops-agent docker-compose.yml'de frontend'e (BUILD ARG
 * olarak, bkz. Dockerfile) `NEXT_PUBLIC_INTERNAL_MEDIA_URL=http://backend:4000` set eder. `next/image`
 * `remotePatterns` doğrulaması hem SUNUCUDA (gerçek optimize istek) hem TARAYICIDA (`image-hosts.ts`
 * SafeImage'in next/image mi düz <img> mi kullanacağına karar verirken) AYNI statik değeri görmesi
 * GEREKİR (aksi halde SSR/CSR arası hydration mismatch — bkz. `image-hosts.ts` başlık yorumu) — bu
 * yüzden `INTERNAL_API_URL`'in aksine bu bir `NEXT_PUBLIC_*` build-arg'ıdır, sunucu-özel bir runtime
 * env DEĞİL. Tarayıcının "backend" host'unu HİÇBİR ZAMAN doğrudan çözmeye çalışmayacağından endişe
 * edilmez: next/image optimize edilen bir `src` için tarayıcı DAİMA aynı-origin `/_next/image?url=...`
 * isteği atar, ham `url` değerini yalnızca SUNUCU (bu route handler) fetch eder.
 *
 * Docker DIŞINDA (`npm run dev`) bu değişken tanımsız kalır — `toInternalMediaUrl` no-op'tur, mevcut
 * davranış (frontend ve backend AYNI localhost'u paylaşıyor, sorun yok) BOZULMAZ.
 */
export const INTERNAL_MEDIA_ORIGIN = process.env.NEXT_PUBLIC_INTERNAL_MEDIA_URL || null;

/** Sunucu tarafında fetch edilen ham API JSON metnindeki medya host'unu (varsa) `INTERNAL_MEDIA_ORIGIN`'e
 *  çevirir — bkz. yukarıdaki `INTERNAL_MEDIA_ORIGIN` yorumu. JSON'u parse ETMEDEN ÖNCE, ham metin
 *  üzerinde düz bir alt-dize değişimi yeterli (Media DTO'ların HEPSİ `absolutizeMediaUrl` üzerinden
 *  AYNI `PUBLIC_MEDIA_ORIGIN` önekiyle serialize edilir) — `Product`/`ProductListItem` tipindeki HER
 *  medya alanını (`coverMedia.url`, `images[].media.url`, `variants[].media.url`, `documents[].media.url`,
 *  `ogImageUrl` vb.) tek tek dolaşmak yerine tek noktadan, yeni bir alan eklendiğinde GÜNCELLENMESİ
 *  GEREKMEYEN bir çözüm. */
export function toInternalMediaUrl(rawJsonText: string): string {
  if (!INTERNAL_MEDIA_ORIGIN || !PUBLIC_MEDIA_ORIGIN) return rawJsonText;
  return rawJsonText.split(PUBLIC_MEDIA_ORIGIN).join(INTERNAL_MEDIA_ORIGIN);
}
