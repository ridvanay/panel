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
import type { FastifyInstance, FastifyRequest } from "fastify";
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

    // `pages`: header/footer'daki yayınlanmış sayfa listesi (layout) — başlık/slug/yayın durumu
    // değişikliği her sayfanın menüsüne yansısın. Sayfanın kendi içeriği `paths` ile yenilenir.
    const res = await fetch(`${env.INTERNAL_FRONTEND_URL ?? env.FRONTEND_URL}/api/revalidate`, {
      method: "POST",
      headers: { "x-revalidate-secret": env.REVALIDATE_SECRET, "content-type": "application/json" },
      body: JSON.stringify({ paths, tags: [CACHE_TAGS.pages] }),
    });

    if (!res.ok) {
      app.log.warn({ status: res.status, paths }, "Frontend on-demand revalidation isteği başarısız oldu");
    }
  } catch (err) {
    // Asıl admin isteğini ASLA bozmaz — bkz. dosya başlığı (`lib/mail.ts` ile AYNI tolerans deseni).
    app.log.warn({ err, pageId: page.id }, "Frontend on-demand revalidation isteği gönderilemedi");
  }
}

/**
 * TÜM public siteyi etkileyen toplu işlemlerden (demo şablon içe aktarma) sonra çağrılır. Tek bir
 * alanı değiştiren admin kayıtları bunu DEĞİL `triggerTagRevalidation`'ı kullanır (yalnızca ilgili
 * veri yenilenir). `triggerPublicPageRevalidation`'ın AKSİNE burada path hesaplaması
 * YOK — hangi sayfaların etkilendiğini tek tek çıkarmak yerine sabit `{ paths: ["/"], type:
 * "layout" }` gönderilir; frontend tarafı `revalidatePath("/", "layout")` çağırır ki bu Next.js'in
 * "tüm cache'i temizle" paterni olduğundan her locale/route otomatik kapsanır (bkz. frontend
 * `src/app/api/revalidate/route.ts`). Guard/try-catch/log deseni `triggerPublicPageRevalidation`
 * ile BİREBİR aynıdır (tek doğrulama kaynağı orası — bkz. dosya başlığı).
 */
export async function triggerGlobalRevalidation(app: FastifyInstance): Promise<void> {
  if (!env.REVALIDATE_SECRET) return; // yapılandırılmamış — özellik sessizce devre dışı (bkz. config/env.ts)

  try {
    const res = await fetch(`${env.INTERNAL_FRONTEND_URL ?? env.FRONTEND_URL}/api/revalidate`, {
      method: "POST",
      headers: { "x-revalidate-secret": env.REVALIDATE_SECRET, "content-type": "application/json" },
      body: JSON.stringify({ paths: ["/"], type: "layout" }),
    });

    if (!res.ok) {
      app.log.warn({ status: res.status }, "Frontend global (layout) on-demand revalidation isteği başarısız oldu");
    }
  } catch (err) {
    // Asıl admin isteğini ASLA bozmaz — bkz. dosya başlığı (`lib/mail.ts` ile AYNI tolerans deseni).
    app.log.warn({ err }, "Frontend global (layout) on-demand revalidation isteği gönderilemedi");
  }
}

/**
 * Açılışta BİR KEZ çağrılır (bkz. app.ts `onReady`) — sır yoksa tetikleyiciler sessizce hiçbir şey
 * göndermez; operatör bunu ancak "admin değişikliği ~60 sn gecikiyor" belirtisinden anlayabilirdi.
 */
export function warnIfRevalidationDisabled(app: FastifyInstance): void {
  if (env.REVALIDATE_SECRET) return;
  app.log.warn(
    "REVALIDATE_SECRET tanımsız/boş — admin kayıtlarından sonra frontend önbellek yenilemesi GÖNDERİLMEZ, değişiklikler sitede ~60 sn sonra görünür. Frontend ile AYNI değeri backend/.env'e ekleyin (bkz. INFRA.md)."
  );
}

/**
 * Sunucu tarafı veri fetch'lerinin önbellek etiketleri — frontend `src/lib/cache-tags.ts` ile
 * BİREBİR aynı olmalı (frontend `tests/unit/cache-tags.test.ts` bu dosyayı metin olarak okuyup
 * kaymayı yakalar).
 */
export const CACHE_TAGS = {
  settings: "settings",
  appearance: "appearance",
  navigation: "navigation",
  locales: "locales",
  modules: "modules",
  pages: "pages",
  specialties: "specialties",
  doctors: "doctors",
  contactPage: "contact-page",
  blog: "blog",
  telehealthTheme: "telehealth-theme",
} as const;

/** Slider başına etiket — frontend `sliderCacheTag` ile aynı biçim. */
export function sliderCacheTag(sliderId: string): string {
  return `slider:${sliderId}`;
}

/**
 * Admin kaydından sonra YALNIZCA etkilenen verinin etiketlerini yeniler (`{ tags }` →
 * frontend `revalidateTag(tag, { expire: 0 })`) — o veriyi kullanan sayfalar bir sonraki
 * ziyarette taze render edilir, tüm site DEĞİL (`triggerGlobalRevalidation`'ın aksine).
 * Guard/try-catch/log deseni `triggerPublicPageRevalidation` ile BİREBİR aynıdır (best-effort,
 * asıl admin isteğini ASLA etkilemez).
 */
export async function triggerTagRevalidation(app: FastifyInstance, tags: string[]): Promise<void> {
  if (!env.REVALIDATE_SECRET) return; // yapılandırılmamış — özellik sessizce devre dışı (bkz. config/env.ts)
  const unique = [...new Set(tags)];
  if (unique.length === 0) return;

  try {
    const res = await fetch(`${env.INTERNAL_FRONTEND_URL ?? env.FRONTEND_URL}/api/revalidate`, {
      method: "POST",
      headers: { "x-revalidate-secret": env.REVALIDATE_SECRET, "content-type": "application/json" },
      body: JSON.stringify({ tags: unique }),
    });

    if (!res.ok) {
      app.log.warn({ status: res.status, tags: unique }, "Frontend etiket (tag) revalidation isteği başarısız oldu");
    }
  } catch (err) {
    // Asıl admin isteğini ASLA bozmaz — bkz. dosya başlığı.
    app.log.warn({ err, tags: unique }, "Frontend etiket (tag) revalidation isteği gönderilemedi");
  }
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Bir admin route plugin'inin TÜM başarılı yazma isteklerinden (POST/PUT/PATCH/DELETE, 2xx) sonra
 * `resolveTags(request)`'in döndürdüğü etiketleri yeniler — her handler'a tek tek çağrı eklemek
 * yerine plugin seviyesinde; yeni eklenen bir yazma ucu da otomatik kapsanır. `onSend`: yanıt
 * gönderilmeden ÖNCE (inline `await trigger...(); return reply.send(...)` deseniyle aynı sıra),
 * best-effort (`triggerTagRevalidation` asla fırlatmaz). `null`/boş dizi → tetiklenmez.
 */
export function revalidateTagsOnWrite(
  app: FastifyInstance,
  resolveTags: (request: FastifyRequest) => string[] | null
): void {
  app.addHook("onSend", async (request, reply, payload) => {
    if (!WRITE_METHODS.has(request.method) || reply.statusCode >= 400) return payload;
    const tags = resolveTags(request);
    if (tags && tags.length > 0) await triggerTagRevalidation(app, tags);
    return payload;
  });
}
