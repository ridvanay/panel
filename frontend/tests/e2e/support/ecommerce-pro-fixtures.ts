/**
 * qa-agent — `.claude/architect-scope-ecommerce-pro-template.md` §9.9 (E2E kapsamı) "Modern
 * Storefront / E-Ticaret" demo şablonu içe aktarma testleri için fixture yardımcıları.
 * `support/demo-templates-fixtures.ts` (modern-architecture için yazılmış emsal) İLE AYNI desen —
 * generic yardımcılar (`resetDemoTemplateImportRow`, `importDemoTemplateRaw`, `getDemoTemplatesRaw`,
 * `listAuditLogsRaw`) ORADAN aynen import edilip `ecommerce-pro` templateKey'iyle kullanılır; bu
 * dosya yalnızca `ecommerce-pro`'ya ÖZGÜ olan (ürün/kategori/varyasyon/döküman/yasal sayfa) bilinen
 * içerik sabitlerini + temizlik/sayım yardımcılarını ekler.
 */
import path from "node:path";
import { execFileSync } from "node:child_process";
import { API_BASE_URL } from "./api";

const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/saas_e2e?schema=public";
const BACKEND_DIR = path.resolve(process.cwd(), "..", "backend");

function runRawSql(sql: string): void {
  execFileSync("npx", ["prisma", "db", "execute", "--stdin", `--url=${E2E_DATABASE_URL}`], {
    cwd: BACKEND_DIR,
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
}

/** `templates/ecommerce-pro.ts::key` — BİREBİR. */
export const ECOMMERCE_TEMPLATE_KEY = "ecommerce-pro";

/** `resetDemoTemplateImportRow()`'un `templateKey`'e göre parametrize genel hali — `demo_template_imports`
 * işaret satırını siler (§6.4 idempotency sıfırlama). `demo-templates-fixtures.ts`'teki fonksiyonla
 * BİREBİR AYNI SQL/desen; bağımsız kopya (o dosya `DEMO_TEMPLATE_KEY`'i sabit varsayılan parametre
 * yapıyor, burada her zaman `ecommerce-pro` verilir — iki dosya birbirinden BAĞIMSIZ modüller). */
export function resetEcommerceProImportRow(): void {
  const esc = (value: string) => value.replace(/'/g, "''");
  runRawSql(`DELETE FROM "demo_template_imports" WHERE "templateKey" = '${esc(ECOMMERCE_TEMPLATE_KEY)}';`);
}

/** `templates/ecommerce-pro.ts::commerce.products[].slug` — BİREBİR (8 ürün). */
export const KNOWN_PRODUCT_SLUGS = [
  "silindirik-metal-masa-lambasi",
  "ayarlanabilir-lambader",
  "kadife-dosemeli-berjer-koltuk",
  "katlanabilir-bahce-sandalyesi",
  "moduler-raf-sistemi",
  "ahsap-ayakkabilik-dolabi",
  "desenli-dekoratif-yastik-seti",
  "cam-aromaterapi-difuzoru",
];

/** `templates/ecommerce-pro.ts::commerce.categories[].slug` — BİREBİR (4 kategori). */
export const KNOWN_CATEGORY_SLUGS = ["aydinlatma", "oturma-grubu", "depolama", "aksesuar"];

/** `templates/ecommerce-pro.ts::extraPages[].slug` — BİREBİR (4 yasal yer tutucu sayfa). */
export const KNOWN_EXTRA_PAGE_SLUGS = [
  "kvkk-aydinlatma-metni",
  "mesafeli-satis-sozlesmesi",
  "on-bilgilendirme-formu",
  "iptal-iade-kosullari",
];

/** `templates/ecommerce-pro.ts::page.slug` / `slider.slug` — BİREBİR. */
export const HOME_PAGE_SLUG = "anasayfa";
export const SLIDER_SLUG = "ferah-ev-yasam-hero";

/** Beklenen `commerceCounts` (audit metadata) — `templates/ecommerce-pro.ts::PRODUCTS`'tan elle
 *  sayılmıştır: varyasyon sayıları [2,0,3,2,4,0,3,0]=14, döküman sayıları [0,1,1,0,1,0,0,1]=4. */
export const EXPECTED_COMMERCE_COUNTS = {
  productCategories: 4,
  products: 8,
  productVariants: 14,
  productDocuments: 4,
  extraPages: 4,
};

function authHeadersNoBody(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function json<T>(res: Response, label: string): Promise<T> {
  const body = (await res.json()) as T & { error?: { code?: string; message?: string } };
  if (!res.ok) throw new Error(`${label} ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

interface AdminPageLite {
  id: string;
  slug: string;
}

async function listAllAdminPages(token: string): Promise<AdminPageLite[]> {
  const all: AdminPageLite[] = [];
  let cursor: string | undefined;
  while (true) {
    const url = new URL(`${API_BASE_URL}/admin/pages`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("trashed", "include");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: authHeadersNoBody(token) });
    const body = await json<{ data: AdminPageLite[]; meta: { nextCursor?: string | null } }>(res, "listAllAdminPages");
    all.push(...body.data);
    if (!body.meta.nextCursor) break;
    cursor = body.meta.nextCursor;
  }
  return all;
}

function matchesKnownSlug(slug: string, knownSlugs: string[]): boolean {
  // `force` ile ikinci import [DTI] §6.5 benzersizleştirmesiyle "-2"/"-3" son eki ekler — bu
  // yüzden TAM eşleşme değil ÖNEK eşleşmesi (bkz. `demo-templates-fixtures.ts::KNOWN_PORTFOLIO_
  // CATEGORY_SLUG_PREFIXES` İLE AYNI gerekçe).
  return knownSlugs.some((known) => slug === known || slug.startsWith(`${known}-`));
}

/**
 * BUG NOTU (backend-agent'a raporlandı, bkz. final qa-agent özeti) — `GET /admin/products` (liste)
 * ve `GET /products` (public liste), `Product.variantOptions` içinde `type: "TEXT"` bir eksenin
 * `swatchHex` alanı OLMAYAN (yani `undefined`, `null` DEĞİL) bir değeri varsa `FST_ERR_RESPONSE_
 * SERIALIZATION` ile 500 döner — `schemas/entities.ts::ProductVariantOptionValueSchema.swatchHex`
 * `z.string().nullable()` (OPTIONAL DEĞİL) ama satır DB'de bu alanı hiç YAZMADAN duruyor (yazma
 * şeması, `lib/variants.ts`, TEXT eksenlerinde `swatchHex` GÖNDERİLMEMESİNİ zorunlu kılıyor —
 * yazma/okuma şeması çelişkisi). `templates/ecommerce-pro.ts`teki "Modüler Raf Sistemi" ürününün
 * KENDİ "Ölçü" (TEXT) ekseni TAM OLARAK bu şekli taşıyor — yani `ecommerce-pro` içe aktarıldıktan
 * SONRA bu satırı içeren HER liste isteği (admin VE public) 500 döner. Bu yüzden bu dosyadaki
 * temizlik artık `GET /admin/products`'a (bozuk) GÜVENMEZ — ürünler DOĞRUDAN SQL ile (bilinen
 * slug'lar + [DTI] §6.5 "-N" son ekleri) silinir; `product_variants`/`product_documents` gerçek
 * DB `ON DELETE CASCADE` FK'siyle (`migrations/20260903085735_.../migration.sql`) otomatik gider.
 */
function deleteKnownProductsSql(): void {
  const slugAlternation = KNOWN_PRODUCT_SLUGS.map((slug) => slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const slugPattern = `^(${slugAlternation})(-[0-9]+)?$`;
  // `content_slugs` (§10.5 i18n) `products` tablosuna DB-seviyesi bir FK İLE bağlı DEĞİLDİR
  // (yalnızca uygulama katmanında, `DELETE /admin/products/{id}/permanent` → `deleteContentSlugsForEntity`
  // ile temizlenir) — bu yüzden HAM SQL ile ürünü silmek bu satırları YETİM bırakır ve bir SONRAKİ
  // import denemesi "slug X başka bir içerik tarafından kullanılıyor" 409'una çarpar (qa-agent bu
  // turda GERÇEKTEN tetikleyip bulduğu bir fixture bug'ı — ÜRÜN kodu DEĞİL, kendi temizlik betiği).
  // Düzeltme: `content_slugs` satırları ÖNCE, ürün satırları SONRA silinir (aynı script, iki deyim).
  runRawSql(
    `DELETE FROM "content_slugs" WHERE "entityType" = 'PRODUCT' AND "entityId" IN (SELECT id FROM "products" WHERE slug ~ '${slugPattern}');\n` +
      `DELETE FROM "products" WHERE slug ~ '${slugPattern}';`
  );
}

/**
 * Bu dosyanın ürettiği (kaç kez `force` ile tekrar uygulanmış olursa olsun) TÜM `ecommerce-pro`
 * içeriğini (ürün/kategori/sayfa/slider) siler; ardından `demo_template_imports` işaretini
 * sıfırlar. `purgeKnownDemoTemplateContent` (`demo-templates-fixtures.ts`) İLE AYNI "genel
 * temizlik" rolü — `ecommerce-pro`'ya özgü. Ürünler İÇİN bkz. `deleteKnownProductsSql` başlığı
 * (yukarıdaki BUG NOTU) — kategori/sayfa/slider temizliği hâlâ gerçek API uçlarını kullanır (bu
 * uçlar `ProductSchema`'yı SERİLEŞTİRMEZ, bug'dan ETKİLENMEZ).
 */
export async function purgeKnownEcommerceProContent(token: string): Promise<void> {
  deleteKnownProductsSql();

  const categoriesRes = await fetch(`${API_BASE_URL}/admin/products/categories`, { headers: authHeadersNoBody(token) });
  const categoriesBody = await json<{ data: Array<{ id: string; slug: string }> }>(categoriesRes, "listProductCategories");
  for (const category of categoriesBody.data) {
    if (matchesKnownSlug(category.slug, KNOWN_CATEGORY_SLUGS)) {
      await fetch(`${API_BASE_URL}/admin/products/categories/${category.id}`, { method: "DELETE", headers: authHeadersNoBody(token) });
    }
  }

  const pages = await listAllAdminPages(token);
  const knownPageSlugs = [HOME_PAGE_SLUG, ...KNOWN_EXTRA_PAGE_SLUGS];
  for (const p of pages) {
    if (matchesKnownSlug(p.slug, knownPageSlugs)) {
      await fetch(`${API_BASE_URL}/admin/pages/${p.id}`, { method: "DELETE", headers: authHeadersNoBody(token) });
      await fetch(`${API_BASE_URL}/admin/pages/${p.id}/permanent`, { method: "DELETE", headers: authHeadersNoBody(token) });
    }
  }

  const slidersRes = await fetch(`${API_BASE_URL}/admin/sliders?search=${encodeURIComponent(SLIDER_SLUG)}&trashed=include`, {
    headers: authHeadersNoBody(token),
  });
  const slidersBody = await json<{ data: Array<{ id: string; slug: string }> }>(slidersRes, "listSlidersBySearch");
  for (const slider of slidersBody.data) {
    if (matchesKnownSlug(slider.slug, [SLIDER_SLUG])) {
      await fetch(`${API_BASE_URL}/admin/sliders/${slider.id}`, { method: "DELETE", headers: authHeadersNoBody(token) });
      await fetch(`${API_BASE_URL}/admin/sliders/${slider.id}/permanent`, { method: "DELETE", headers: authHeadersNoBody(token) });
    }
  }

  resetEcommerceProImportRow();
}

/** `GET /admin/orders` — TÜM sayfaları dolaşıp TOPLAM sipariş sayısını döner (§4.5 kabul kriteri:
 *  "hiçbir Order satırı YARATILMADI" — paylaşımlı `saas_e2e` DB'de başka spec dosyalarının ürettiği
 *  siparişler olabileceği için MUTLAK sıfır DEĞİL, import ÖNCESİ/SONRASI DELTA karşılaştırılır). */
export async function countAdminOrders(token: string): Promise<number> {
  let total = 0;
  let cursor: string | undefined;
  while (true) {
    const url = new URL(`${API_BASE_URL}/admin/orders`);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: authHeadersNoBody(token) });
    const body = await json<{ data: unknown[]; meta: { nextCursor?: string | null } }>(res, "countAdminOrders");
    total += body.data.length;
    if (!body.meta.nextCursor) break;
    cursor = body.meta.nextCursor;
  }
  return total;
}

export interface PublicPageFixture {
  id: string;
  slug: string;
  title: string;
  isLegalDocument: boolean;
  blocks: unknown[];
}

/** `GET /pages/{slug}` (PUBLIC) — yasal yer tutucu sayfaların `isLegalDocument`/gövdesini doğrulamak için. */
export async function getPublicPage(slug: string): Promise<{ status: number; data?: PublicPageFixture }> {
  const res = await fetch(`${API_BASE_URL}/pages/${slug}`);
  if (!res.ok) return { status: res.status };
  const body = (await res.json()) as { data: PublicPageFixture };
  return { status: res.status, data: body.data };
}

/**
 * qa-agent — Fix 1 doğrulaması (`.claude/architect-scope-ecommerce-pro-template.md` görev
 * talimatı). `templates/ecommerce-pro.ts::slider.slug` (`SLIDER_SLUG`) ile içe aktarılan CANLI
 * (çöpte OLMAYAN) slider'ın id'sini bulur — `purgeKnownEcommerceProContent`teki AYNI arama
 * deseni (`GET /admin/sliders?search=...`), ama `matchesKnownSlug` eşleşmesi ile `deletedAt`
 * filtresi BİRLEŞTİRİLİR (import [DTI] §6.5 "-N" son ekli benzersizleştirmeyle bile doğru
 * satırı bulur).
 */
export async function getEcommerceProSliderId(token: string): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/admin/sliders?search=${encodeURIComponent(SLIDER_SLUG)}`, {
    headers: authHeadersNoBody(token),
  });
  const body = await json<{ data: Array<{ id: string; slug: string; deletedAt: string | null }> }>(res, "getEcommerceProSliderId");
  const found = body.data.find((s) => matchesKnownSlug(s.slug, [SLIDER_SLUG]) && !s.deletedAt);
  if (!found) throw new Error(`ecommerce-pro slider'ı bulunamadı (arama: "${SLIDER_SLUG}").`);
  return found.id;
}

// NOT: `adminGetProductBySlug`/`listAllAdminProducts` (GET /admin/products tabanlı) BİLİNÇLİ
// olarak buradan KALDIRILDI — bkz. `deleteKnownProductsSql` başlığındaki BUG NOTU: bu uç
// `ecommerce-pro` içe aktarıldıktan sonra 500 döner. Tekil ürün doğrulaması gereken testler
// `GET /admin/products/{id}` yerine `GET /pages/{slug}` (public, etkilenmeyen) gibi ALTERNATİF
// bir kanıt kullanmalı ya da bu bug düzeltilene kadar ürün detayını doğrulamaktan kaçınmalıdır.
