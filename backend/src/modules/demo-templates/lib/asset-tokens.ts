/**
 * §3.4 — `asset:`/`ref:` token tarama + çözümleme. Tek üretim/ayrıştırma noktası (bkz. dosya
 * başlığındaki gerekçe — `sliders/shortcode.ts::buildSliderShortcode` ile AYNI "tek üretim
 * noktası" disiplini).
 *
 * TASARIM NOTU (mimari doküman §3.4'ün genellemesi): karar dokümanının token tablosu dört somut
 * alanı sayar (`image.data.url`, `gallery.data.images[].url`, `testimonial…avatarUrl`,
 * `logo-marquee…url`) ama ui-designer'ın somut `modern-architecture` tasarımı BEŞİNCİ bir yeri
 * kullanıyor: `container.settings.background.value` (tip `"image"` iken, bkz. DESIGN-NOTES.md
 * §6.6 CTA banner). Alan-bazlı bir "izin listesi" yazmak (her blok tipi için elle bir yol
 * tanımlamak) bu beşinci kullanım gibi gelecekteki her yeni yeri de elle eklemeyi gerektirirdi —
 * kırılgan ve DRY değil. Bunun yerine çözümleyici, `page.blocks` ağacındaki HER string YAPRAK
 * değerini (herhangi bir derinlikte, herhangi bir alan adında) tarar ve tam olarak
 * `asset:<key>` veya `ref:slider` kalıbıyla EŞLEŞEN (kısmi eşleşme/alt-dize DEĞİL) değerleri
 * değiştirir. Bu, §3.4 madde 1'in "ağaç üzerinde iteratif, özyineleme YOK" kuralına
 * `lib/page-blocks.ts::scanPageNodeStructure`/`flattenPageBlocks` ile AYNI disiplinle
 * (explicit stack) uyar; yalnızca dolaşım kapsamı (yalnızca `container.children` değil, HER
 * nesne/dizi alanı) kasıtlı olarak genelleştirilmiştir — aksi hâlde her yeni token-taşıyan alan
 * için bu dosyada elle bir dal eklemek gerekirdi, bu da §3.4 madde 4'ün "tek üretim noktası"
 * disiplinini ZAYIFLATIRDI.
 *
 * GÜVENLİK: girdi (`page.blocks`) YALNIZCA bu paketin kendi statik `templates/*.ts`
 * tanımlarından gelir (kullanıcı girdisi DEĞİLDİR) — yine de savunma derinliği için
 * `ABSOLUTE_VISIT_CAP` ile sınırlı, özyinelemesiz (explicit stack) bir dolaşım kullanılır.
 */

export const ASSET_TOKEN_PREFIX = "asset:";
export const SLIDER_REF_TOKEN = "ref:slider";
// `.claude/architect-scope-ecommerce-pro-template.md` §4.2 — YENİ token ailesi (bağlayıcı,
// [DTI] §3.4'e ek): `ref:product-category:<slug>` → import sırasında oluşturulan
// `ProductCategory.id`. AYNI çözümleyici, AYNI dosya (§3.4 madde 4 — tek üretim noktası).
export const PRODUCT_CATEGORY_REF_PREFIX = "ref:product-category:";
// Bugfix (§4.3 revizyonu, `.claude/architect-scope-ecommerce-pro-template.md`) — ÜÇÜNCÜ token
// ailesi: `ref:product-category-slug:<templateSlug>` → `PRODUCT_CATEGORY_REF_PREFIX`'in AKSİNE
// ham bir id'ye DEĞİL, doğrudan KULLANILABİLİR bir `href`'e (`/products?category=<gerçek-slug>`)
// çözülür. Kök neden: "Keşfet" butonlarının `href`'i şablon yazım anındaki HAM slug'ı
// (`input.slug`) taşıyordu; ama `resolveSlugPlan` (§4.4, DEĞİŞTİRİLEMEZ) force-reapply'de
// kategori slug çakışmasını `depolama` → `depolama-2` gibi otomatik benzersizleştirir — bu
// yüzden buton her zaman İLK import'un slug'ına işaret ediyor, reapply sonrası 0 ürün dönüyordu.
// Çözüm `ref:product-category:` ile AYNI iki-fazlı erteleme desenini kullanır, tek fark: harita
// `id` değil `resolvedSlug` taşır ve çözümleyici URL'i kendisi inşa eder (`ref:slider`'ın alana
// doğrudan kullanılabilir `sliderId` koyması ile AYNI desen).
export const PRODUCT_CATEGORY_SLUG_REF_PREFIX = "ref:product-category-slug:";

// `.claude/architect-scope-telehealth-template.md` §6.2 — DÖRDÜNCÜ token ailesi:
// `ref:specialty-slug:<slug>` → `PRODUCT_CATEGORY_SLUG_REF_PREFIX` ile BİREBİR AYNI iki-fazlı
// erteleme deseni (ham bir id'ye DEĞİL, doğrudan KULLANILABİLİR bir `href`'e çözülür), TEK fark
// hedef varlık ve inşa edilen yol: `Specialty.slug` → `/doctors?specialty=<gerçek-slug>`. AYNI
// çözümleyici, AYNI dosya (§3.4/[EPT] §4.2 madde 4 — tek üretim noktası disiplini).
export const SPECIALTY_SLUG_REF_PREFIX = "ref:specialty-slug:";

const ABSOLUTE_VISIT_CAP = 100_000;

export function buildAssetToken(key: string): string {
  return `${ASSET_TOKEN_PREFIX}${key}`;
}

export function buildProductCategoryRefToken(slug: string): string {
  return `${PRODUCT_CATEGORY_REF_PREFIX}${slug}`;
}

/** `templateSlug` — şablonun statik tanımındaki HAM (henüz benzersizleştirilmemiş) kategori slug'ı. */
export function buildProductCategorySlugHrefRefToken(templateSlug: string): string {
  return `${PRODUCT_CATEGORY_SLUG_REF_PREFIX}${templateSlug}`;
}

/** `templateSlug` — şablonun statik tanımındaki HAM (henüz benzersizleştirilmemiş) uzmanlık slug'ı. */
export function buildSpecialtySlugHrefRefToken(templateSlug: string): string {
  return `${SPECIALTY_SLUG_REF_PREFIX}${templateSlug}`;
}

function isAssetToken(value: string): value is `asset:${string}` {
  return value.startsWith(ASSET_TOKEN_PREFIX) && value.length > ASSET_TOKEN_PREFIX.length;
}

function assetKeyFromToken(value: string): string {
  return value.slice(ASSET_TOKEN_PREFIX.length);
}

function isProductCategoryRefToken(value: string): value is `ref:product-category:${string}` {
  return value.startsWith(PRODUCT_CATEGORY_REF_PREFIX) && value.length > PRODUCT_CATEGORY_REF_PREFIX.length;
}

function productCategorySlugFromToken(value: string): string {
  return value.slice(PRODUCT_CATEGORY_REF_PREFIX.length);
}

function isProductCategorySlugHrefRefToken(value: string): value is `ref:product-category-slug:${string}` {
  return value.startsWith(PRODUCT_CATEGORY_SLUG_REF_PREFIX) && value.length > PRODUCT_CATEGORY_SLUG_REF_PREFIX.length;
}

function productCategorySlugHrefTemplateSlugFromToken(value: string): string {
  return value.slice(PRODUCT_CATEGORY_SLUG_REF_PREFIX.length);
}

function isSpecialtySlugHrefRefToken(value: string): value is `ref:specialty-slug:${string}` {
  return value.startsWith(SPECIALTY_SLUG_REF_PREFIX) && value.length > SPECIALTY_SLUG_REF_PREFIX.length;
}

function specialtySlugHrefTemplateSlugFromToken(value: string): string {
  return value.slice(SPECIALTY_SLUG_REF_PREFIX.length);
}

export interface ResolveTokensResult {
  /** Token'ları çözülmüş, DERİN KOPYA ağaç (girdi mutasyona uğratılmaz). */
  blocks: unknown[];
  /** Çözülemeyen token'lar (assets'te olmayan `asset:<key>` VEYA slider `null` iken `ref:slider`). Boşsa hepsi çözüldü. */
  unresolvedTokens: string[];
}

interface StackFrame {
  /** İçinde bulunulan konteyner (obje veya dizi) — yerinde (in place) güncellenir. */
  container: Record<string, unknown> | unknown[];
  /** `container`'ın anahtarları/indeksleri — bu çerçevede kalan iş. */
  keys: (string | number)[];
  index: number;
}

/**
 * `page.blocks` ağacındaki (herhangi bir derinlikteki) HER string yaprağını tarar; tam olarak
 * `asset:<key>`'e eşitse `assetUrlByKey`'den çözer, tam olarak `ref:slider`'a eşitse VE
 * `sliderId` bir string İSE ondan çözer. Kısmi eşleşme/gömülü token (ör. bir cümlenin İÇİNDE
 * `asset:x`) KASITLI OLARAK DEĞİŞTİRİLMEZ — token'lar her zaman bir alanın TAM değeridir (§3.4
 * tablosu: FK slotları zaten ayrı, tipli alanlardır ve buraya HİÇ girmez).
 *
 * `sliderId: null` — İKİ AYRI çağrı bağlamını ayırt eder (bkz. `importer.ts` Faz 1/Faz 2 iki
 * geçişli çağrı deseni): Faz 1'de slider HENÜZ yaratılmamıştır (gerçek id yoktur) ama asset
 * token'ları ZATEN çözülebilir durumdadır (`storage.save()` gerçek URL'i verir) — bu geçişte
 * `ref:slider` BİLEREK dokunulmadan bırakılır (unresolved SAYILMAZ, sadece ERTELENİR); asıl
 * slider-id çözümlemesi Faz 2'de (`slider.create` SONRASI) `sliderId` gerçek bir string ile
 * TEKRAR çağrılarak tamamlanır. Tek bir "unresolved" sınıfı vardır: `assetUrlByKey`'de
 * KARŞILIĞI OLMAYAN bir `asset:<key>` — bu HER ZAMAN gerçek bir hata (yazım hatası/eksik
 * varlık tanımı) sayılır ve hangi geçişte çağrılırsa çağrılsın raporlanır.
 *
 * İTERATİF (explicit stack, `lib/page-blocks.ts::scanPageNodeStructure` ile AYNI disiplin) —
 * ÖZYİNELEME YOK.
 *
 * `productCategoryIdBySlug` — `sliderId` ile BİREBİR AYNI iki-fazlı erteleme deseni:
 * `null` ise `ref:product-category:<slug>` token'ları bilinçli olarak DOKUNULMADAN bırakılır
 * (ERTELENİR, unresolved SAYILMAZ — ürün kategorileri henüz oluşturulmamıştır). Bir `Map`
 * verildiğinde (Faz 0 kuru koşuda PLACEHOLDER_UUID'lerle, Faz 2 son çözümlemede gerçek
 * `ProductCategory.id`'lerle) haritada KARŞILIĞI OLMAYAN her slug FATAL/unresolved sayılır.
 *
 * `productCategorySlugByTemplateSlug` — YUKARIDAKİ İKİSİYLE (`sliderId`/`productCategoryIdBySlug`)
 * BİREBİR AYNI iki-fazlı erteleme deseni, TEK farkla: `productCategoryIdBySlug`'ın AKSİNE harita
 * ham bir `id` değil `resolveSlugPlan`'ın ürettiği BENZERSİZLEŞTİRİLMİŞ gerçek slug'ı taşır ve
 * çözümleyici bu slug'dan doğrudan KULLANILABİLİR bir `href` (`/products?category=<gerçek-slug>`)
 * İNŞA EDER — `ref:slider`'ın alana doğrudan kullanılabilir `sliderId` koyması ile AYNI desen
 * (bkz. `PRODUCT_CATEGORY_SLUG_REF_PREFIX` yorumu, bugfix: "Keşfet" butonu force-reapply'de eski/
 * yanlış slug'a işaret ediyordu). `null` ise `ref:product-category-slug:<templateSlug>` token'ları
 * DOKUNULMADAN ERTELENİR (unresolved SAYILMAZ); bir `Map` verildiğinde haritada KARŞILIĞI OLMAYAN
 * her `templateSlug` FATAL/unresolved sayılır.
 *
 * `specialtySlugByTemplateSlug` — `productCategorySlugByTemplateSlug` ile BİREBİR AYNI iki-fazlı
 * erteleme deseni (`.claude/architect-scope-telehealth-template.md` §6.2): `null` ise
 * `ref:specialty-slug:<templateSlug>` token'ları DOKUNULMADAN ERTELENİR; bir `Map` verildiğinde
 * haritada KARŞILIĞI OLMAYAN her `templateSlug` FATAL/unresolved sayılır. Çözümleyici `href`'i
 * `/doctors?specialty=<gerçek-slug>` olarak inşa eder.
 */
export function resolvePageBlockTokens(
  blocks: unknown[],
  assetUrlByKey: ReadonlyMap<string, string>,
  sliderId: string | null,
  productCategoryIdBySlug: ReadonlyMap<string, string> | null = null,
  productCategorySlugByTemplateSlug: ReadonlyMap<string, string> | null = null,
  specialtySlugByTemplateSlug: ReadonlyMap<string, string> | null = null
): ResolveTokensResult {
  const root: unknown[] = deepCloneJson(blocks) as unknown[];
  const unresolvedTokens = new Set<string>();

  const stack: StackFrame[] = [{ container: root, keys: containerKeys(root), index: 0 }];
  let visits = 0;

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    if (frame.index >= frame.keys.length) {
      stack.pop();
      continue;
    }
    if (++visits > ABSOLUTE_VISIT_CAP) break; // savunma derinliği — pratikte asla tetiklenmez (statik veri)

    const key = frame.keys[frame.index]!;
    frame.index += 1;

    const value = (frame.container as Record<string | number, unknown>)[key];

    if (typeof value === "string") {
      if (value === SLIDER_REF_TOKEN) {
        if (sliderId !== null) {
          (frame.container as Record<string | number, unknown>)[key] = sliderId;
        }
        // sliderId === null → bilinçli olarak dokunulmadan bırakılır (bkz. yukarıdaki yorum).
        continue;
      }
      if (isProductCategoryRefToken(value)) {
        if (productCategoryIdBySlug !== null) {
          const slug = productCategorySlugFromToken(value);
          const id = productCategoryIdBySlug.get(slug);
          if (id !== undefined) {
            (frame.container as Record<string | number, unknown>)[key] = id;
          } else {
            unresolvedTokens.add(value);
          }
        }
        // productCategoryIdBySlug === null → ERTELENİR (bkz. fonksiyon başlığı).
        continue;
      }
      if (isProductCategorySlugHrefRefToken(value)) {
        if (productCategorySlugByTemplateSlug !== null) {
          const templateSlug = productCategorySlugHrefTemplateSlugFromToken(value);
          const resolvedSlug = productCategorySlugByTemplateSlug.get(templateSlug);
          if (resolvedSlug !== undefined) {
            (frame.container as Record<string | number, unknown>)[key] = `/products?category=${resolvedSlug}`;
          } else {
            unresolvedTokens.add(value);
          }
        }
        // productCategorySlugByTemplateSlug === null → ERTELENİR (bkz. fonksiyon başlığı).
        continue;
      }
      if (isSpecialtySlugHrefRefToken(value)) {
        if (specialtySlugByTemplateSlug !== null) {
          const templateSlug = specialtySlugHrefTemplateSlugFromToken(value);
          const resolvedSlug = specialtySlugByTemplateSlug.get(templateSlug);
          if (resolvedSlug !== undefined) {
            (frame.container as Record<string | number, unknown>)[key] = `/doctors?specialty=${resolvedSlug}`;
          } else {
            unresolvedTokens.add(value);
          }
        }
        // specialtySlugByTemplateSlug === null → ERTELENİR (bkz. fonksiyon başlığı).
        continue;
      }
      if (isAssetToken(value)) {
        const assetKey = assetKeyFromToken(value);
        const url = assetUrlByKey.get(assetKey);
        if (url !== undefined) {
          (frame.container as Record<string | number, unknown>)[key] = url;
        } else {
          unresolvedTokens.add(value);
        }
      }
      continue;
    }

    if (value && typeof value === "object") {
      stack.push({ container: value as Record<string, unknown> | unknown[], keys: containerKeys(value), index: 0 });
    }
  }

  return { blocks: root, unresolvedTokens: Array.from(unresolvedTokens) };
}

function containerKeys(container: unknown): (string | number)[] {
  if (Array.isArray(container)) return container.map((_, i) => i);
  return Object.keys(container as Record<string, unknown>);
}

/** `structuredClone` yerine `JSON` round-trip — girdi zaten JSON-serileştirilebilir statik veridir (Prisma `Json` kolonuna yazılacak). */
function deepCloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
