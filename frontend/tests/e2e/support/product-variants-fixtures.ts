/**
 * qa-agent — `.claude/architect-scope-ecommerce-pro-template.md` §9.9 (E2E kapsamı) storefront
 * genişlemesi (varyasyon/döküman/kargo) için ürün fixture yardımcıları. `support/api.ts` ile AYNI
 * desen: doğrudan `fetch` ile gerçek backend'e (saas_e2e) konuşur — kurulum UI akışına bağımlı
 * DEĞİLDİR, testler yalnızca doğrulamayı tarayıcı üzerinden yapar.
 *
 * Bilinçli tasarım kararı: PDP varyasyon/kargo/sepet senaryoları `ecommerce-pro` şablonunun
 * KENDİ ürün verisiyle DEĞİL, bu dosyanın ürettiği İZOLE fixture ürünleriyle test edilir —
 * gerekçe: `templates/ecommerce-pro.ts`teki HİÇBİR varyasyonun `imageAssetKey` doldurulmamış
 * (tümü `null`), yani şablonun kendi verisiyle "renk seçimi GÖRSELİ değiştiriyor" iddiası
 * doğrulanamaz. Şablon içe aktarma senaryoları (7/8/9, §9.9) ayrı bir dosyada
 * (`ecommerce-pro-fixtures.ts`) şablonun KENDİ verisiyle test edilir.
 */
import { API_BASE_URL } from "./api";

function authHeaders(token: string) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}
function authHeadersNoBody(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function json<T>(res: Response, label: string): Promise<T> {
  const body = (await res.json()) as T & { error?: { code?: string; message?: string; details?: unknown } };
  if (!res.ok) {
    throw new Error(`${label} ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

export interface FixtureProductVariantOptionValue {
  value: string;
  swatchHex?: string | null;
}
export interface FixtureProductVariantOption {
  name: string;
  type: "SWATCH" | "TEXT";
  values: FixtureProductVariantOptionValue[];
}

export interface CreateFixtureProductInput {
  title: string;
  slug?: string;
  priceCents: number;
  discountPriceCents?: number | null;
  sku?: string | null;
  stockQuantity?: number;
  status?: "PUBLISHED" | "DRAFT";
  coverMediaId?: string | null;
  variantOptions?: FixtureProductVariantOption[];
}

export interface FixtureProductVariant {
  id: string;
  variantKey: string;
  optionValues: Record<string, string>;
  label: string;
  sku: string | null;
  priceCents: number | null;
  discountPriceCents: number | null;
  stockQuantity: number;
  media: { id: string; url: string } | null;
  isActive: boolean;
}

export interface FixtureProduct {
  id: string;
  slug: string;
  title: string;
  variants: FixtureProductVariant[];
  documents: Array<{ id: string; title: string; media: { url: string } }>;
  [key: string]: unknown;
}

/** `POST /admin/products` — `support/api.ts::adminCreateProduct`'ın zengin hali (§1 varyasyon/kargo genişlemesi). */
export async function adminCreateProductFull(token: string, input: CreateFixtureProductInput): Promise<FixtureProduct> {
  const res = await fetch(`${API_BASE_URL}/admin/products`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      title: input.title,
      ...(input.slug ? { slug: input.slug } : {}),
      priceCents: input.priceCents,
      discountPriceCents: input.discountPriceCents ?? null,
      sku: input.sku ?? null,
      stockQuantity: input.stockQuantity ?? 0,
      status: input.status ?? "PUBLISHED",
      coverMediaId: input.coverMediaId ?? null,
      variantOptions: input.variantOptions ?? [],
    }),
  });
  return json<{ data: FixtureProduct }>(res, "adminCreateProductFull").then((b) => b.data);
}

export interface CreateFixtureVariantInput {
  optionValues: Record<string, string>;
  sku?: string | null;
  priceCents?: number | null;
  discountPriceCents?: number | null;
  stockQuantity?: number;
  mediaId?: string | null;
  isActive?: boolean;
}

/** `POST /admin/products/{productId}/variants` — güncellenmiş `Product` (tüm varyasyonlarla) döner. */
export async function adminCreateProductVariant(
  token: string,
  productId: string,
  input: CreateFixtureVariantInput
): Promise<FixtureProduct> {
  const res = await fetch(`${API_BASE_URL}/admin/products/${productId}/variants`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(input),
  });
  return json<{ data: FixtureProduct }>(res, "adminCreateProductVariant").then((b) => b.data);
}

/** `POST /admin/products/{productId}/documents` — güncellenmiş `Product` (tüm dökümanlarla) döner. */
export async function adminAddProductDocument(
  token: string,
  productId: string,
  mediaId: string,
  title?: string
): Promise<FixtureProduct> {
  const res = await fetch(`${API_BASE_URL}/admin/products/${productId}/documents`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ mediaId, ...(title ? { title } : {}) }),
  });
  return json<{ data: FixtureProduct }>(res, "adminAddProductDocument").then((b) => b.data);
}

/** Çöpe taşı + kalıcı sil — `support/api.ts::deletePagePermanently` İLE AYNI iki aşamalı desen. */
export async function adminDeleteProductPermanently(token: string, productId: string): Promise<void> {
  await fetch(`${API_BASE_URL}/admin/products/${productId}`, { method: "DELETE", headers: authHeadersNoBody(token) });
  await fetch(`${API_BASE_URL}/admin/products/${productId}/permanent`, {
    method: "DELETE",
    headers: authHeadersNoBody(token),
  });
}

/** 1x1 şeffaf PNG — `support/api.ts::uploadTestMedia`'daki AYNI sabit, magic-byte doğrulamasını geçer. */
const TEST_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

export interface TestMediaFixture {
  id: string;
  url: string;
  filename: string;
}

/** `POST /admin/media` — gerçek (küçük) bir PNG yükler. `support/api.ts::uploadTestMedia` ile aynı davranış,
 *  yalnızca bu dosyanın kendi tipiyle (`TestMediaFixture`) döner. */
export async function uploadTestImageMedia(token: string, filename: string): Promise<TestMediaFixture> {
  const bytes = Buffer.from(TEST_PNG_BASE64, "base64");
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/png" }), filename);
  const res = await fetch(`${API_BASE_URL}/admin/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return json<{ data: TestMediaFixture }>(res, "uploadTestImageMedia").then((b) => b.data);
}

/**
 * §2.2 (architect-scope-ecommerce-pro-template.md) — PDF magic byte'ı (`%PDF-`) ile başlayan
 * MİNİMAL geçerli bir tek-sayfalık PDF. `backend/src/lib/mime-detect.ts::detectPdfMimeType`
 * yalnızca ilk 5 bayta bakar — bu, gerçek bir PDF görüntüleyicide açılabilir olmasa da backend'in
 * kabul/servis boru hattını (magic-byte tespiti → `application/pdf` → `Content-Disposition:
 * attachment`) uçtan uca test etmek için yeterli ve doğru bir fixture'dır.
 */
const MINIMAL_PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
  "utf-8"
);

export async function uploadTestPdfMedia(token: string, filename: string): Promise<TestMediaFixture> {
  const form = new FormData();
  form.append("file", new Blob([MINIMAL_PDF_BYTES], { type: "application/pdf" }), filename);
  const res = await fetch(`${API_BASE_URL}/admin/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return json<{ data: TestMediaFixture }>(res, "uploadTestPdfMedia").then((b) => b.data);
}

export async function deleteTestMedia(token: string, mediaId: string): Promise<void> {
  await fetch(`${API_BASE_URL}/admin/media/${mediaId}`, { method: "DELETE", headers: authHeadersNoBody(token) });
}

/** `GET /admin/settings` şeklinden yalnızca kargo alanları — `support/api.ts::getAdminSettings`'in dar hali. */
export interface ShippingSettingsFixture {
  shippingFlatFeeCents: number | null;
  freeShippingThresholdCents: number | null;
}

export async function getShippingSettings(token: string): Promise<ShippingSettingsFixture> {
  const res = await fetch(`${API_BASE_URL}/admin/settings`, { headers: authHeadersNoBody(token) });
  const body = await json<{ data: ShippingSettingsFixture }>(res, "getShippingSettings");
  return { shippingFlatFeeCents: body.data.shippingFlatFeeCents, freeShippingThresholdCents: body.data.freeShippingThresholdCents };
}

export async function patchShippingSettings(token: string, patch: ShippingSettingsFixture): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/admin/settings`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(patch),
  });
  await json(res, "patchShippingSettings");
}

/** `frontend/src/lib/format-price.ts::formatPriceFromCents` İLE BİREBİR AYNI — test assertion'larının
 *  fiyat metnini HARDCODE etmek yerine (yerel biçimlendirme kütüphanesinin tam çıktısı, ör. "₺100,00",
 *  boşluksuz — `Intl.NumberFormat` sürüm/ortama göre kırılgandır) canlı olarak türetmesi için. */
export function formatPriceFromCentsTRY(cents: number, currency = "TRY"): string {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency }).format(cents / 100);
}
