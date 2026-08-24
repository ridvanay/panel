/**
 * qa-agent E2E test fixture yardımcıları — gerçek backend'e (varsayılan: `http://localhost:4001`,
 * `saas_e2e` veritabanı, bkz. `playwright.config.ts` başlığı) doğrudan `fetch` ile konuşur.
 * Amaç: Playwright testlerini rich-text editör UI akışlarına bağımlı kılmadan (kırılgan/yavaş)
 * gerçekçi içerik/locale durumları kurmak — backend zaten bu uçları `tests/integration/*.test.ts`
 * ile ayrı doğruluyor, burada YALNIZCA fixture amaçlı kullanılıyor.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";

const API_BASE_URL = process.env.E2E_API_URL ?? "http://localhost:4001/api/v1";

// `/auth/login` ve `/auth/register` sabit 5 istek/dk IP başına sınırlıdır
// (`backend/src/modules/auth/auth.routes.ts` `AUTH_RATE_LIMIT`, env'den bağımsız). Aynı test
// koşumunda onlarca fixture çağrısı bu limiti anında aşar — bu yüzden `auth.setup.ts` TEK SEFER
// login olup token'ı diske yazar, diğer tüm spec dosyaları buradan okur (tekrar login OLMAZ).
const TOKEN_CACHE_PATH = path.join(process.cwd(), "tests/e2e/.auth/admin-token.json");

export interface AdminSession {
  email: string;
  password: string;
  accessToken: string;
  userId: string;
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

export const ADMIN_EMAIL = "qa-e2e-admin@example.com";
export const ADMIN_PASSWORD = "QaE2eAdmin12345!";

/**
 * İlk kaydolan kullanıcı otomatik ADMIN olur (`backend/src/modules/auth/auth.service.ts`,
 * `userCount === 0 ? "ADMIN" : undefined`). `saas_e2e` veritabanı boşsa register, doluysa
 * (aynı test paketi tekrar çalıştırıldıysa) login'e düşer — idempotent. Yalnızca
 * `auth.setup.ts` (Playwright "setup" projesi, tüm suite için BİR KEZ) tarafından çağrılır;
 * sonucu diske yazar. Diğer testler `getCachedAdminSession()` kullanmalıdır.
 */
export async function ensureAdminSession(
  email = ADMIN_EMAIL,
  password = ADMIN_PASSWORD
): Promise<AdminSession> {
  const registerRes = await fetch(`${API_BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: "QA E2E Admin" }),
  });

  let session: AdminSession;
  if (registerRes.ok) {
    const body = (await registerRes.json()) as {
      data: { user: { id: string; role: string }; tokens: { accessToken: string } };
    };
    session = { email, password, accessToken: body.data.tokens.accessToken, userId: body.data.user.id };
  } else {
    // Zaten kayıtlı (409) — login ile devam.
    const loginRes = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await json<{ data: { user: { id: string }; tokens: { accessToken: string } } }>(loginRes);
    session = { email, password, accessToken: body.data.tokens.accessToken, userId: body.data.user.id };
  }

  await mkdir(path.dirname(TOKEN_CACHE_PATH), { recursive: true });
  await writeFile(TOKEN_CACHE_PATH, JSON.stringify(session), "utf-8");
  return session;
}

/**
 * `ensureAdminSession()`'ın ADMIN'e ÖZGÜ OLMAYAN genel hali (§10.20) — bir fixture kullanıcının
 * (standart/gelişmiş EDITOR, ikinci ADMIN…) access token'ını, DİSKE YAZMADAN döner. `POST
 * /auth/register`/`/auth/login`'in sabit 5 istek/dk kotasına katkısı `ensureAdminSession()` ile
 * AYNIDIR — çağıran dosya bunu göz önünde bulundurup çağrı sayısını (dosya başına birkaç fixture
 * kullanıcı) sınırlı tutmalıdır. Kayıt zaten varsa (409) login'e düşer — `registerFixtureUser()`/
 * `resetFixtureUserToBaseline()` (`support/admin-users-fixtures.ts`) ile İDEMPOTENT olarak birlikte kullanılır.
 */
export async function getFixtureUserToken(email: string, password: string, name: string): Promise<string> {
  const registerRes = await fetch(`${API_BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name }),
  });
  if (registerRes.ok) {
    const body = (await registerRes.json()) as { data: { tokens: { accessToken: string } } };
    return body.data.tokens.accessToken;
  }
  const loginRes = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await json<{ data: { tokens: { accessToken: string } } }>(loginRes);
  return body.data.tokens.accessToken;
}

/** Diğer spec dosyalarının kullanması gereken yol — `auth.setup.ts`'in yazdığı token'ı okur. */
export async function getCachedAdminSession(): Promise<AdminSession> {
  try {
    const raw = await readFile(TOKEN_CACHE_PATH, "utf-8");
    return JSON.parse(raw) as AdminSession;
  } catch {
    // "setup" projesi hiç çalışmadıysa (örn. dosya tek başına çalıştırıldıysa) — fallback.
    return ensureAdminSession();
  }
}

function authHeaders(token: string) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

/** GET/DELETE (gövdesiz) istekler için — bkz. `blog-fixtures.ts` başlığındaki qa-agent bulgusu:
 * `Content-Type: application/json` header'ı gövdesiz bir DELETE'te Fastify'de `400 Bad Request`
 * üretir (GET/HEAD bundan muaf). `authHeaders()`'ı gövdesiz isteklerde KULLANMAYIN. */
function authHeadersNoBody(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export interface PageFixtureInput {
  title: string;
  slug: string;
  html: string;
  status?: "PUBLISHED" | "DRAFT";
  isLegalDocument?: boolean;
  translations?: Record<string, { title?: string; slug?: string; html?: string }>;
}

/** `POST /admin/pages` — testlerin ihtiyaç duyduğu minimal alanlarla bir `Page` oluşturur. */
export async function createPage(token: string, input: PageFixtureInput) {
  const translations = input.translations
    ? Object.fromEntries(
        Object.entries(input.translations).map(([locale, fields]) => [
          locale,
          {
            ...(fields.title ? { title: fields.title } : {}),
            ...(fields.slug ? { slug: fields.slug } : {}),
            ...(fields.html ? { blocks: [{ id: "b1", type: "text", data: { html: fields.html } }] } : {}),
          },
        ])
      )
    : undefined;

  const res = await fetch(`${API_BASE_URL}/admin/pages`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      title: input.title,
      slug: input.slug,
      status: input.status ?? "PUBLISHED",
      blocks: [{ id: "b1", type: "text", data: { html: input.html } }],
      ...(input.isLegalDocument !== undefined ? { isLegalDocument: input.isLegalDocument } : {}),
      ...(translations ? { translations } : {}),
    }),
  });
  return json<{ data: Record<string, unknown> }>(res).then((b) => b.data);
}

export interface TemplatePageFixtureInput {
  title: string;
  slug: string;
  status?: "PUBLISHED" | "DRAFT";
  /** §10.20 — `admin-page-editor-roles.spec.ts` tarafından kullanılır. `blocks` `createPage()`'in
   *  aksine SERBEST verilir (yalnızca tek bir `text` bloğu DEĞİL) — kök seviyede zaten bir
   *  `container`'a SARILMIŞ olmalıdır (bkz. o dosyanın başlığındaki qa-agent bulgusu:
   *  `frontend/src/lib/page-builder/containers.ts::wrapBareRootBlocks` editör YÜKLENİRKEN çıplak
   *  kök blokları KENDİ container'ına sarar — bu fixture'ın kök bloğu ZATEN bir `container` İSE bu
   *  sarma no-op'tur ve fixture'ın kayıtlı ağacıyla editörün ürettiği ağaç birebir eşleşir). */
  blocks: unknown[];
  editMode?: "FREEFORM" | "TEMPLATE";
}

/** `POST /admin/pages` — `createPage()`'in serbest-`blocks`/`editMode` alan hali (§10.20). */
export async function createPageWithBlocks(token: string, input: TemplatePageFixtureInput) {
  const res = await fetch(`${API_BASE_URL}/admin/pages`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      title: input.title,
      slug: input.slug,
      status: input.status ?? "DRAFT",
      blocks: input.blocks,
      ...(input.editMode ? { editMode: input.editMode } : {}),
    }),
  });
  return json<{ data: Record<string, unknown> }>(res).then((b) => b.data);
}

export async function deletePagePermanently(token: string, pageId: string) {
  await fetch(`${API_BASE_URL}/admin/pages/${pageId}`, { method: "DELETE", headers: authHeadersNoBody(token) });
  await fetch(`${API_BASE_URL}/admin/pages/${pageId}/permanent`, {
    method: "DELETE",
    headers: authHeadersNoBody(token),
  });
}

export async function listAdminLocales(token: string) {
  const res = await fetch(`${API_BASE_URL}/admin/locales`, { headers: authHeadersNoBody(token) });
  return json<{ data: Array<Record<string, unknown>> }>(res).then((b) => b.data);
}

export async function deleteLocale(token: string, code: string) {
  return fetch(`${API_BASE_URL}/admin/locales/${code}`, { method: "DELETE", headers: authHeadersNoBody(token) });
}

export async function createLocale(
  token: string,
  input: { code: string; label: string; nativeLabel: string; enabled?: boolean }
) {
  const res = await fetch(`${API_BASE_URL}/admin/locales`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(input),
  });
  return json<{ data: Record<string, unknown> }>(res).then((b) => b.data);
}

/** `GET /admin/settings` — `SiteSettingsDto` (`homePageId` dahil, bkz. `settings.routes.ts`). */
export async function getAdminSettings(token: string) {
  const res = await fetch(`${API_BASE_URL}/admin/settings`, { headers: authHeadersNoBody(token) });
  return json<{ data: Record<string, unknown> }>(res).then((b) => b.data);
}

/** `PATCH /admin/settings` — kısmi güncelleme (ör. `homePageId` — CMS'te "Ana Sayfa" olarak
 * seçili `Page`; `null` ise `/` rotası `FallbackHome`'a düşer, bkz. `app/[lang]/(site)/page.tsx`). */
export async function patchSiteSettings(token: string, patch: Record<string, unknown>) {
  const res = await fetch(`${API_BASE_URL}/admin/settings`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(patch),
  });
  return json<{ data: Record<string, unknown> }>(res).then((b) => b.data);
}

export async function setMaintenanceMode(token: string, enabled: boolean, message?: string) {
  const res = await fetch(`${API_BASE_URL}/admin/appearance`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ maintenanceModeEnabled: enabled, ...(message ? { maintenanceMessage: message } : {}) }),
  });
  return json<{ data: Record<string, unknown> }>(res).then((b) => b.data);
}

/** `GET /admin/appearance` — mevcut `SiteAppearance` satırının tamamı (teardown'da orijinal
 * değeri geri yazabilmek için, `patchAppearance()`'tan ÖNCE çağrılmalı). */
export async function getAdminAppearance(token: string) {
  const res = await fetch(`${API_BASE_URL}/admin/appearance`, { headers: authHeadersNoBody(token) });
  return json<{ data: Record<string, unknown> }>(res).then((b) => b.data);
}

/** `PATCH /admin/appearance` — kısmi güncelleme (bkz. `UpdateSiteAppearanceRequestSchema`,
 * `backend/src/modules/appearance/appearance.schemas.ts`). `setMaintenanceMode()`'un genel hali. */
export async function patchAppearance(token: string, patch: Record<string, unknown>) {
  const res = await fetch(`${API_BASE_URL}/admin/appearance`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(patch),
  });
  return json<{ data: Record<string, unknown> }>(res).then((b) => b.data);
}

/** `GET /admin/navigation` — `NavigationConfigDto` (bkz. `backend/src/schemas/entities.ts`
 * `NavigationConfigSchema`). Teardown'da `updateNavigationConfig()`'e AYNEN geri verilebilir —
 * dönen `navigationItems[].id`/`socialLinks[].id`/`footerColumns[].id` alanları
 * `UpdateNavigationConfigRequestSchema`'nın kabul ettiği (fazla alanları sessizce yok sayan,
 * `strict()` OLMAYAN) girdi şekliyle uyumludur. */
export async function getNavigationConfig(token: string) {
  const res = await fetch(`${API_BASE_URL}/admin/navigation`, { headers: authHeadersNoBody(token) });
  return json<{ data: Record<string, unknown> }>(res).then((b) => b.data);
}

/** `PUT /admin/navigation` — TAM DEĞİŞTİRME (replace) semantiği (bkz. `navigation.routes.ts`
 * `deleteMany` + `createMany`): gönderilen `body` mevcut navigasyon/sosyal/footer yapılandırmasının
 * YERİNE geçer. Testler `getNavigationConfig()` ile aldıkları orijinal DTO'yu güncelleyip geri
 * göndermelidir (teardown'da da AYNI şekilde orijinaline geri yazılmalı). */
export async function updateNavigationConfig(token: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE_URL}/admin/navigation`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  return json<{ data: Record<string, unknown> }>(res).then((b) => b.data);
}

// ---------------------------------------------------------------------------
// Galeri bloğu (WordPress-tarzı çoklu görsel) e2e fixture yardımcıları — qa-agent, bu turda
// eklendi. `admin-page-builder-gallery.spec.ts` tarafından kullanılır.
// ---------------------------------------------------------------------------

/** 1x1 şeffaf PNG (geçerli magic byte'lı, gerçek bir görsel) — `detectImageMimeType`'ı geçer. */
const TEST_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

export interface TestMedia {
  id: string;
  url: string;
  filename: string;
  altText: string | null;
}

/**
 * `POST /admin/media` — gerçek (küçük, geçerli) bir PNG yükler. Galeri e2e testlerinin
 * `MediaPicker`'ı GERÇEKTEN kullanabilmesi için (mock/stub DEĞİL) — backend `detectImageMimeType`
 * ile magic-byte doğrulaması yaptığı için rastgele byte'lar YETMEZ, gerçek bir PNG gerekir.
 */
export async function uploadTestMedia(token: string, filename: string): Promise<TestMedia> {
  const bytes = Buffer.from(TEST_PNG_BASE64, "base64");
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/png" }), filename);
  const res = await fetch(`${API_BASE_URL}/admin/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return json<{ data: TestMedia }>(res).then((b) => b.data);
}

export async function deleteTestMedia(token: string, mediaId: string) {
  await fetch(`${API_BASE_URL}/admin/media/${mediaId}`, { method: "DELETE", headers: authHeadersNoBody(token) });
}

/** `PATCH /admin/media/{id}` — yalnızca `altText` (boş string 422 döner, bkz. `media.ts` başlığı). */
export async function setTestMediaAltText(token: string, mediaId: string, altText: string): Promise<TestMedia> {
  const res = await fetch(`${API_BASE_URL}/admin/media/${mediaId}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ altText }),
  });
  return json<{ data: TestMedia }>(res).then((b) => b.data);
}

/** Sayfanın `blocks` alanını API üzerinden DOĞRUDAN değiştirir — UI adımlarını atlayan hızlı kurulum
 * (bkz. eski `admin-page-builder-columns.spec.ts`'teki AYNI desen, bu dosya v3 konteyner mimarisiyle
 * RETİRE edildi — bkz. `admin-page-builder-containers.spec.ts`). Galeri/konteyner public-render
 * testleri için. DİKKAT: bu, `PATCH /admin/pages/{id}` → `UpdatePageRequestSchema` → `PageBlockListSchema`
 * ÜZERİNDEN geçer; legacy `type: "columns"` gönderirsen backend'in `z.preprocess`'i (mimar dokümanı
 * §2.1) BUNU ANINDA `container`'a çevirip ÖYLE YAZAR — yani bu fonksiyonla GERÇEKTEN "DB'de columns
 * olarak duran" bir satır ÜRETEMEZSİN (bkz. `setRawPageBlocksDirectly` — o ihtiyaç için). */
export async function patchPageBlocks(token: string, pageId: string, blocks: unknown[]) {
  const res = await fetch(`${API_BASE_URL}/admin/pages/${pageId}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ blocks }),
  });
  return json<{ data: Record<string, unknown> }>(res).then((b) => b.data);
}

/** `GET /admin/pages/{id}` — testin (özellikle §10.19/Dalga 3.3 legacy-fixture senaryosunun) editör
 * DIŞINDAN, API yanıtındaki `blocks` şeklini (ör. `type: "container"` mi `"columns"` mu) doğrudan
 * doğrulaması için. Ham JSON döner (mimar dokümanı §9.2 "PageDetail.blocks" notu — re-validate
 * EDİLMEZ), bu yüzden `setRawPageBlocksDirectly` ile yazılan gerçek legacy şekli DE olduğu gibi yansıtır. */
export async function getPage(token: string, pageId: string) {
  const res = await fetch(`${API_BASE_URL}/admin/pages/${pageId}`, { headers: authHeadersNoBody(token) });
  return json<{ data: Record<string, unknown> }>(res).then((b) => b.data);
}

// ---------------------------------------------------------------------------
// §10.19 hiyerarşik konteyner (`container`) mimarisi — Dalga 3.3 e2e fixture yardımcıları
// (qa-agent, bu turda eklendi). `admin-page-builder-containers.spec.ts` tarafından kullanılır.
// ---------------------------------------------------------------------------

/** e2e Postgres veritabanının bağlantı adresi — `backend/.env.e2e`'deki `DATABASE_URL` ile AYNI
 * OLMAK ZORUNDADIR (bkz. `playwright.config.ts` başlığındaki kurulum talimatı). Ortam değişkeniyle
 * override edilebilir (CI'da devops-agent farklı bir host/port kullanabilir). */
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/saas_e2e?schema=public";

/** `backend/` kök dizini — `prisma db execute` komutunu backend'in KENDİ `node_modules/.bin/prisma`
 * CLI'ından (zaten kurulu, YENİ bir bağımlılık EKLENMEZ) çalıştırmak için `cwd` olarak kullanılır. */
const BACKEND_DIR = path.resolve(process.cwd(), "..", "backend");

/**
 * "Legacy fixture" senaryosu (Dalga 3.3 madde 4) için — `patchPageBlocks`'un AKSİNE, backend'in
 * yazma-anındaki `z.preprocess` normalizasyonunu (§2.1 mimar dokümanı) TAMAMEN ATLAYARAK `Page.blocks`
 * kolonuna VERİLEN JSON'u OLDUĞU GİBİ, ham SQL ile yazar. Bu, "v3 migration'ından ÖNCE, eski bir
 * istemciyle kaydedilmiş ve o zamandan beri hiç dokunulmamış bir sayfa" durumunu GERÇEKÇİ biçimde
 * simüle etmenin TEK yoludur — API üzerinden (hangi uç olursa olsun) `columns` göndermek her zaman
 * ANINDA `container`'a çevrilip öyle yazılır (mimar dokümanı §2.1/§7.1), yani gerçek bir "DB'de hâlâ
 * columns duruyor" satırı normal API akışıyla ÜRETİLEMEZ.
 *
 * `prisma db execute --stdin` (backend'in zaten kurulu `prisma` CLI'ı, YENİ npm bağımlılığı YOK)
 * ile çalışır — Prisma'nın `db execute` komutu tek bir ham SQL script'ini doğrudan datasource'a
 * gönderir (schema/model doğrulaması YAPMAZ), bu yüzden herhangi bir Zod şemasından GEÇMEDEN
 * `jsonb` sütununa yazabiliriz. İçerik tamamen bu test dosyasının KENDİ ürettiği veridir (kullanıcı
 * girdisi DEĞİL) — tek tırnak kaçışı (`'` → `''`, standart SQL string escaping) bu bağlamda yeterli
 * ve güvenlidir.
 */
export function setRawPageBlocksDirectly(pageId: string, blocks: unknown[]): void {
  const escapedBlocks = JSON.stringify(blocks).replace(/'/g, "''");
  const escapedId = pageId.replace(/'/g, "''");
  const sql = `UPDATE "pages" SET blocks = '${escapedBlocks}'::jsonb WHERE id = '${escapedId}';`;
  execFileSync("npx", ["prisma", "db", "execute", "--stdin", `--url=${E2E_DATABASE_URL}`], {
    cwd: BACKEND_DIR,
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
}

// ---------------------------------------------------------------------------
// `.claude/architect-scope-rbac-5-tier.md` §7.2/§10.5 madde 7 — ödeme akışı e2e fixture
// yardımcıları (qa-agent, bu turda eklendi). `admin-rbac-5tier-critical-flows.spec.ts`
// tarafından kullanılır.
// ---------------------------------------------------------------------------

/** `POST /admin/products` — testin ihtiyaç duyduğu minimal alanlarla bir `Product` oluşturur
 * (`PUBLISHED`, yeterli stokla — webhook'un `insufficient_stock` dalına düşmemesi için). */
export async function adminCreateProduct(
  token: string,
  input: { title: string; priceCents: number; stockQuantity?: number }
) {
  const res = await fetch(`${API_BASE_URL}/admin/products`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      title: input.title,
      priceCents: input.priceCents,
      stockQuantity: input.stockQuantity ?? 10,
      status: "PUBLISHED",
    }),
  });
  return json<{ data: Record<string, unknown> }>(res).then((b) => b.data);
}

export async function adminDeleteProductPermanently(token: string, productId: string) {
  await fetch(`${API_BASE_URL}/admin/products/${productId}`, { method: "DELETE", headers: authHeadersNoBody(token) });
  await fetch(`${API_BASE_URL}/admin/products/${productId}/permanent`, {
    method: "DELETE",
    headers: authHeadersNoBody(token),
  });
}

/**
 * `POST /checkout/session` GERÇEK bir Stripe ağ çağrısı yapar (`stripe.checkout.sessions.create`)
 * — e2e ortamında `STRIPE_SECRET_KEY=sk_test_e2e` SAHTE olduğundan (bkz. `backend/.env.e2e`) bu
 * çağrı gerçek Stripe API'sine ulaşıp BAŞARISIZ olurdu (backend'in kendi `tests/integration/
 * checkout.test.ts`'i bu adımı `vi.mock("../../src/lib/stripe")` ile atlıyor — e2e'de mock
 * KATMANI yok). Bu yüzden PENDING `Order` + `OrderItem` satırı, `setRawPageBlocksDirectly`
 * (bu dosyanın §10.19 bölümü) İLE AYNI desenle — `prisma db execute --stdin` — DOĞRUDAN
 * oluşturulur; testin GERÇEKTEN doğruladığı adım (ödeme TAMAMLANMA webhook'u,
 * `postStripeCheckoutSessionCompleted()`, aşağıda) buradan BAĞIMSIZ ve TAM olarak gerçek HTTP +
 * gerçek Stripe imza doğrulama kod yolundan geçer.
 */
export function createPendingOrderDirect(input: {
  siteUserId: string;
  customerEmail: string;
  productId: string;
  productTitle: string;
  unitPriceCents: number;
  quantity?: number;
}): { orderId: string; orderNumber: string } {
  const orderId = crypto.randomUUID();
  const orderItemId = crypto.randomUUID();
  const orderNumber = `ORD-E2E-${Date.now().toString(36).toUpperCase()}`;
  const quantity = input.quantity ?? 1;
  const lineTotalCents = input.unitPriceCents * quantity;
  const esc = (value: string) => value.replace(/'/g, "''");

  const sql = `
INSERT INTO "orders"
  (id, "orderNumber", "siteUserId", "customerEmail", status, currency, "subtotalCents", "discountCents", "taxCents", "totalCents", "createdAt", "updatedAt")
VALUES
  ('${esc(orderId)}', '${esc(orderNumber)}', '${esc(input.siteUserId)}', '${esc(input.customerEmail)}', 'PENDING', 'TRY', ${lineTotalCents}, 0, 0, ${lineTotalCents}, now(), now());

INSERT INTO "order_items"
  (id, "orderId", "productId", "productTitle", "unitPriceCents", quantity, "lineTotalCents")
VALUES
  ('${esc(orderItemId)}', '${esc(orderId)}', '${esc(input.productId)}', '${esc(input.productTitle)}', ${input.unitPriceCents}, ${quantity}, ${lineTotalCents});
`;

  execFileSync("npx", ["prisma", "db", "execute", "--stdin", `--url=${E2E_DATABASE_URL}`], {
    cwd: BACKEND_DIR,
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });

  return { orderId, orderNumber };
}

/** `STRIPE_WEBHOOK_SECRET` — `backend/.env.e2e` ile AYNI OLMAK ZORUNDADIR (bkz. o dosyadaki
 * `whsec_test_e2e` değeri). Ortam değişkeniyle override edilebilir (`E2E_DATABASE_URL` ile
 * AYNI desen). */
const E2E_STRIPE_WEBHOOK_SECRET = process.env.E2E_STRIPE_WEBHOOK_SECRET ?? "whsec_test_e2e";

/** Stripe'ın belgelenmiş webhook imza şeması (`t=<unix-saniye>,v1=<hmac-sha256 hex>`,
 * `signed_payload = "${t}.${rawBody}"`) — `stripe` SDK'sı KULLANILMADAN `node:crypto` ile
 * ELLE üretilir (frontend'in bağımlılığı değil; backend'in `stripe.webhooks.constructEvent`'i
 * AYNI algoritmayı doğrular, bkz. `backend/tests/integration/webhook-order.test.ts`
 * `generateTestHeaderString` kullanımı — burada TAM OLARAK aynı sonucu üreten manuel karşılığı). */
function buildStripeSignatureHeader(payload: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const signature = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

/**
 * §7.2 — `checkout.session.completed` (mode: "payment") olayını GERÇEK HTTP isteğiyle, GEÇERLİ
 * bir Stripe imzasıyla e2e backend'ine gönderir. Sipariş `PAID` olur, stok düşer,
 * `Order.siteUserId` doluysa (ve rolü `USER` ise) `USER → CUSTOMER` terfisi tetiklenir
 * (`stripe.routes.ts::promoteUserToCustomerIfNeeded`).
 */
export async function postStripeCheckoutSessionCompleted(orderId: string): Promise<{ status: number }> {
  const event = {
    id: `evt_e2e_${crypto.randomUUID()}`,
    object: "event",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_test_e2e_${crypto.randomUUID()}`,
        object: "checkout.session",
        mode: "payment",
        metadata: { kind: "order", orderId },
      },
    },
  };
  const payload = JSON.stringify(event);
  const res = await fetch(`${API_BASE_URL}/webhooks/stripe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": buildStripeSignatureHeader(payload, E2E_STRIPE_WEBHOOK_SECRET),
    },
    body: payload,
  });
  return { status: res.status };
}

// ---------------------------------------------------------------------------
// `.claude/architect-scope-customer-portal.md` §9 — Müşteri & E-Ticaret Alanı e2e fixture
// yardımcıları (qa-agent, bu turda eklendi). `customer-portal-module-toggle.spec.ts` tarafından
// kullanılır.
// ---------------------------------------------------------------------------

/** `PATCH /admin/modules/{key}` — `{ enabled }` gövdesiyle bir modülü açar/kapatır
 * (yalnızca ADMIN, bkz. `site-modules.routes.ts`). Testler ÖNCEKİ durumu okuyup (`GET
 * /admin/modules`) `afterAll`'da geri yazmalıdır — bu fonksiyon o okumayı yapmaz. */
export async function patchSiteModule(token: string, key: string, enabled: boolean) {
  const res = await fetch(`${API_BASE_URL}/admin/modules/${key}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ enabled }),
  });
  return json<{ data: Record<string, unknown> }>(res).then((b) => b.data);
}

/** `GET /admin/modules` — mevcut modül listesi, bir `key` için `enabled` durumunu okumak için
 * (teardown'da orijinal değeri geri yazabilmek amacıyla `patchSiteModule()`'dan ÖNCE çağrılmalı,
 * `getAdminAppearance()`/`patchAppearance()` ile AYNI desen). */
export async function getSiteModules(token: string) {
  const res = await fetch(`${API_BASE_URL}/admin/modules`, { headers: authHeadersNoBody(token) });
  return json<{ data: Array<{ key: string; enabled: boolean }> }>(res).then((b) => b.data);
}

/** `PATCH /admin/orders/{orderId}/status` — `.claude/architect-scope-customer-portal.md` §2.4:
 * `status: SHIPPED` iken `trackingNumber` ZORUNLUDUR. Admin sipariş detay UI'sı
 * `admin-order-detail-ship.test.tsx` (mock API) ile zaten unit test'li; bu fonksiyon e2e'de
 * gerçek bir sipariş üzerinde kargo bilgisini API'den doğrudan set etmek için kullanılır (müşteri
 * tarafının `/hesabim/siparislerim/{orderId}` sayfasında takip no görünürlüğünü doğrulamak için). */
export async function adminUpdateOrderStatus(
  token: string,
  orderId: string,
  body: { status: string; trackingNumber?: string; shippingCarrier?: string }
): Promise<{ status: number; data?: Record<string, unknown> }> {
  const res = await fetch(`${API_BASE_URL}/admin/orders/${orderId}/status`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) return { status: res.status };
  const parsed = (await res.json()) as { data: Record<string, unknown> };
  return { status: res.status, data: parsed.data };
}

export { API_BASE_URL };
