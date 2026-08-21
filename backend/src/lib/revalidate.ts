/**
 * On-demand ISR tetikleyicisi (bkz. config/env.ts::REVALIDATE_SECRET). Backend, frontend'den
 * AYRI bir process/servis olduğu için Next.js'in `revalidatePath()` fonksiyonunu DOĞRUDAN
 * çağıramaz — bunun yerine frontend'deki `POST /api/revalidate` webhook'unu paylaşılan bir
 * sırla imzalayarak tetikler (kontrat: frontend-agent ile ortak, bkz. o taraftaki route
 * handler). Public sitede görünen içeriği DEĞİŞTİREN her admin işleminden (create/update/
 * publish/restore/trash/permanent-delete/bulk/revision-restore) SONRA çağrılmalıdır.
 *
 * DİKKAT — isim çakışması YOK: bu dosyadaki `triggerPublicPageRevalidation`,
 * `pages.routes.ts`'teki `revalidateSnapshotBlocks`/`revalidateSnapshotTranslations` ile
 * İLGİSİZDİR (onlar yalnızca eski revizyon snapshot'ını şema doğrulamasından yeniden geçiren
 * yardımcılardır, Next.js cache revalidation'ı bilmezler).
 *
 * BEST-EFFORT / sessiz degrade — `lib/mail.ts`'teki SMTP toleransıyla AYNI desen:
 *  - `REVALIDATE_SECRET` boşsa (yapılandırılmamışsa) çağrı hiç YAPILMAZ, sessizce döner.
 *  - Ağ hatası / frontend'in 4xx-5xx dönmesi durumunda yalnızca `warn` loglanır — asıl admin
 *    isteğinin (sayfa kaydetme/yayınlama) response'u ASLA bundan etkilenmez/reddedilmez.
 *  - Hassas veri (REVALIDATE_SECRET'ın kendisi) LOGLANMAZ.
 */
import type { FastifyInstance } from "fastify";
import { env } from "../config/env";
import { getLocaleSet } from "./localization";
import { slugify } from "./slug";

/** Revalidation path hesaplaması için ihtiyaç duyulan minimal sayfa alanları. */
export interface RevalidatablePage {
  id: string;
  slug: string;
  translations: unknown;
}

/**
 * `page.translations` JSON'undan `locale` için gerçekten dolu bir çeviri var mı (`title`
 * doluysa "dolu" sayılır) kontrol eder — `lib/localization.ts::syncContentSlugs`'taki
 * `hasTranslation` ile AYNI kural (tek doğrulama kaynağı orası; burada YALNIZCA path
 * hesaplamak için okunuyor, herhangi bir yazma/DB güncellemesi YAPILMAZ).
 */
function resolveTranslatedSlug(translations: unknown, localeCode: string, canonicalSlug: string): string | null {
  const map = (translations ?? {}) as Record<string, unknown>;
  const fields = map[localeCode];
  if (!fields || typeof fields !== "object") return null;

  const title = (fields as Record<string, unknown>).title;
  const hasTranslation = typeof title === "string" && title.trim().length > 0;
  if (!hasTranslation) return null;

  const localeSlugRaw = (fields as Record<string, unknown>).slug;
  return typeof localeSlugRaw === "string" && localeSlugRaw.trim().length > 0 ? slugify(localeSlugRaw) : canonicalSlug;
}

/**
 * Sayfa için etkilenen TÜM public path'leri hesaplar — ana sayfa slug'sız `/${locale}`,
 * diğerleri `/${locale}/${slug}` (bkz. frontend `[lang]/(site)/page.tsx` vs
 * `[lang]/(site)/[slug]/page.tsx` route yapısı). Varsayılan dil için her zaman kanonik
 * `page.slug` kullanılır; diğer etkin diller için YALNIZCA gerçekten dolu bir çeviri varsa bir
 * path üretilir (boş/silinmiş çeviri için path ÜRETİLMEZ — o dilde public'te ayrıca cache'lenmiş
 * bir kanonik varyant yoktur, varsayılan dilin path'i zaten kapsar).
 */
async function resolveAffectedPaths(app: FastifyInstance, page: RevalidatablePage, isHomePage: boolean): Promise<string[]> {
  const { enabled } = await getLocaleSet(app);
  const paths: string[] = [];

  for (const locale of enabled) {
    const slug = locale.isDefault ? page.slug : resolveTranslatedSlug(page.translations, locale.code, page.slug);
    if (slug === null) continue;

    paths.push(isHomePage ? `/${locale.code}` : `/${locale.code}/${slug}`);
  }

  return paths;
}

/**
 * Verilen sayfa için etkilenen path'leri hesaplayıp frontend'in `POST /api/revalidate`
 * ucunu tetikler. `isHomePage`: sayfa `SiteSettings.homePageId` ise ana sayfa (slug'sız
 * `/${locale}`) olarak, değilse `/${locale}/${slug}` olarak revalidate edilir — çağıran taraf
 * bunu belirler (bu fonksiyon `SiteSettings`'i SORGULAMAZ, homepage ilişkisi zaten route
 * seviyesinde biliniyor/erişilebilir, bkz. pages.routes.ts::SETTINGS_ID kullanımı).
 */
export async function triggerPublicPageRevalidation(
  app: FastifyInstance,
  page: RevalidatablePage,
  options?: { isHomePage?: boolean }
): Promise<void> {
  if (!env.REVALIDATE_SECRET) return; // yapılandırılmamış — özellik sessizce devre dışı (bkz. config/env.ts)

  try {
    const paths = await resolveAffectedPaths(app, page, options?.isHomePage ?? false);
    if (paths.length === 0) return;

    const res = await fetch(`${env.FRONTEND_URL}/api/revalidate`, {
      method: "POST",
      headers: { "x-revalidate-secret": env.REVALIDATE_SECRET, "content-type": "application/json" },
      body: JSON.stringify({ paths }),
    });

    if (!res.ok) {
      app.log.warn({ status: res.status, paths }, "Frontend on-demand revalidation isteği başarısız oldu");
    }
  } catch (err) {
    // Asıl admin isteğini ASLA bozmaz — bkz. dosya başlığı (`lib/mail.ts` ile AYNI tolerans deseni).
    app.log.warn({ err, pageId: page.id }, "Frontend on-demand revalidation isteği gönderilemedi");
  }
}
