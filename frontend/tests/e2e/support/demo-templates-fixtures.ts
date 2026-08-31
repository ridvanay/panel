/**
 * qa-agent — "1 Tıkla Hazır Demo / Şablon İçe Aktarıcı" (`demo-templates` modülü) E2E fixture
 * yardımcıları. Kaynak kontrat: `.claude/architect-scope-demo-template-import.md` (bağlayıcı karar
 * dokümanı, özellikle §6 API sözleşmesi + §6.1 yıkıcılık matrisi + §6.4 idempotency/force) +
 * `docs/architecture/openapi.yaml` `DemoTemplates` tag'i. `admin-demo-template-import.spec.ts`
 * tarafından kullanılır.
 *
 * `support/api.ts`/`support/sliders-fixtures.ts` ile AYNI desen: doğrudan `fetch` ile gerçek
 * backend'e (saas_e2e) konuşur, UI akışından bağımsız kurulum/temizlik sağlar. Yalnızca
 * `demo_template_imports` işaret tablosu için (bu tablonun DELETE ucu YOK, §10.1 architect kararı
 * — audit log'dan/başka bir singleton'dan türetilmesi BİLİNÇLİ olarak REDDEDİLDİ) ham SQL kullanılır
 * — `support/api.ts::setRawPageBlocksDirectly`/`createPendingOrderDirect` İLE AYNI
 * `prisma db execute --stdin` deseni. Sayfa/slider/portföy/medya temizliği İSE HER ZAMAN gerçek
 * (permanent-delete) API uçları üzerinden yapılır — bunların kendi cascade/revizyon/slug temizliği
 * ZATEN vardır, ham SQL ile o mantığı burada YENİDEN ÜRETMEK kırılgan olurdu.
 */
import path from "node:path";
import { execFileSync } from "node:child_process";
import { API_BASE_URL } from "./api";

// `support/api.ts::E2E_DATABASE_URL`/`BACKEND_DIR` İLE BİREBİR AYNI değerler (o dosyadaki sabitler
// export edilmediği için burada bilinçli olarak yeniden tanımlanır — iki dosya bağımsız modüller).
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

/** `templates/modern-architecture.ts` — architect-scope §9 madde 3/§4.3 ile BİREBİR (bağlayıcı). */
export const DEMO_TEMPLATE_KEY = "modern-architecture";

/** `templates/modern-architecture.ts::assets` — §4.4 "net sonuç: ~6 PNG varlık". */
export const KNOWN_ASSET_FILENAMES = [
  "portfolio-cover-1.png",
  "portfolio-cover-2.png",
  "portfolio-cover-3.png",
  "portfolio-cover-4.png",
  "cta-banner.png",
  "about-image.png",
];

/** `templates/modern-architecture.ts::portfolio.items[].title` — BİREBİR. */
export const KNOWN_PORTFOLIO_ITEM_TITLES = [
  "Konut Kompleksi Projesi",
  "Ticari Ofis Binası",
  "Kurumsal Merkez Binası",
  "Karma Kullanım Yapı Kompleksi",
];

/** `templates/modern-architecture.ts::portfolio.categories[].slug` — `force` ile "-2"/"-3" gibi
 *  benzersizleştirilmiş kopyaları da yakalamak için ÖNEK (prefix) olarak kullanılır. */
export const KNOWN_PORTFOLIO_CATEGORY_SLUG_PREFIXES = ["konut-projeleri", "ticari-projeler"];

/**
 * `DemoTemplateImport.templateKey` @unique satırını siler — §6.4 idempotency işaretinin sıfırlanması.
 * Silme ucu YOKTUR (architect §10.1 bağlayıcı kararı: bu tablo İÇERİK TUTMAZ, yalnızca "ne zaman
 * uygulandı" işareti taşır) — bu yüzden testin kendi başlangıç/bitiş temizliği için TEK seçenek budur.
 * `Page.demoTemplateImports` ilişkisi `onDelete: SetNull` olduğu İÇİN bu satırı silmek, ilişkili
 * sayfa/slider satırlarını ETKİLEMEZ (onlar ayrıca, gerçek permanent-delete uçlarıyla silinmelidir).
 */
export function resetDemoTemplateImportRow(templateKey: string = DEMO_TEMPLATE_KEY): void {
  const esc = (value: string) => value.replace(/'/g, "''");
  runRawSql(`DELETE FROM "demo_template_imports" WHERE "templateKey" = '${esc(templateKey)}';`);
}

function authHeadersNoBody(token: string) {
  return { Authorization: `Bearer ${token}` };
}
function authHeaders(token: string) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

export interface DemoTemplateSummaryFixture {
  key: string;
  version: string;
  name: string;
  appliedAt: string | null;
  appliedPageId?: string | null;
  contents: Record<string, number>;
  [key: string]: unknown;
}

/** `GET /admin/demo-templates` — panel kapısı (ADMIN/MANAGER/EDITOR). */
export async function getDemoTemplatesRaw(
  token: string
): Promise<{ status: number; data?: DemoTemplateSummaryFixture[]; error?: { code: string; message: string } }> {
  const res = await fetch(`${API_BASE_URL}/admin/demo-templates`, { headers: authHeadersNoBody(token) });
  const body = (await res.json()) as { data?: DemoTemplateSummaryFixture[]; error?: { code: string; message: string } };
  return { status: res.status, data: body.data, error: body.error };
}

export interface RawImportResult {
  status: number;
  data?: Record<string, unknown>;
  error?: { code: string; message: string; details?: unknown };
}

/**
 * `POST /admin/demo-templates/{templateKey}/import` — durum kodunu FIRLATMADAN döner
 * (`sliders-fixtures.ts::createSliderRaw` İLE AYNI desen). `token: null` → Authorization header'ı
 * HİÇ eklenmez (§12 madde 13 — hız sınırı testi, `@fastify/rate-limit`'in route-level `config`'i
 * `onRequest` aşamasında çalışır, yani `authenticate`/RBAC preHandler'larından ÖNCE; bu yüzden
 * kimlik doğrulaması OLMADAN gönderilen istekler de sayaca dahildir ve testin token'a HİÇ ihtiyacı
 * yoktur).
 */
export async function importDemoTemplateRaw(
  token: string | null,
  templateKey: string,
  body: Record<string, unknown> | undefined
): Promise<RawImportResult> {
  const res = await fetch(`${API_BASE_URL}/admin/demo-templates/${templateKey}/import`, {
    method: "POST",
    headers: token ? authHeaders(token) : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed: { data?: Record<string, unknown>; error?: RawImportResult["error"] } = {};
  try {
    parsed = await res.json();
  } catch {
    // 429/401 gibi bazı yanıtlar gövdesiz/parse edilemeyen olabilir — durum kodu tek başına yeterli.
  }
  return { status: res.status, data: parsed.data, error: parsed.error };
}

/**
 * `GET /admin/media` — TÜM sayfaları (cursor döngüsüyle) dolaşıp `id -> filename` haritası döner.
 * `admin-users-fixtures.ts::adminGetUserByEmail` İLE AYNI "tüm sayfaları tara" deseni — import
 * öncesi/sonrası TAM bir küme farkı (diff) alıp YENİ oluşturulan medyayı kesin olarak bulmak için
 * (§4.2 kabul kriteri — madde 11).
 */
export async function listAllAdminMediaIds(token: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let cursor: string | undefined;
  while (true) {
    const url = new URL(`${API_BASE_URL}/admin/media`);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: authHeadersNoBody(token) });
    const body = (await res.json()) as { data: { id: string; filename: string }[]; meta: { nextCursor?: string | null } };
    for (const m of body.data) map.set(m.id, m.filename);
    if (!body.meta.nextCursor) break;
    cursor = body.meta.nextCursor;
  }
  return map;
}

export async function deleteMediaById(token: string, mediaId: string): Promise<void> {
  await fetch(`${API_BASE_URL}/admin/media/${mediaId}`, { method: "DELETE", headers: authHeadersNoBody(token) });
}

export interface FixturePortfolioItem {
  id: string;
  slug: string;
  title: string;
  deletedAt: string | null;
}

/** `GET /admin/portfolio?search=<title>&trashed=include` — `search` yalnızca title/clientName
 *  içinde arar (bkz. `portfolio.routes.ts`), bu yüzden sonuç istemci tarafında TAM eşleşmeye
 *  daraltılır (aksi halde alt-dize çakışmaları yanlış öğeleri yakalayabilir). */
export async function findPortfolioItemsByTitle(token: string, title: string): Promise<FixturePortfolioItem[]> {
  const url = new URL(`${API_BASE_URL}/admin/portfolio`);
  url.searchParams.set("search", title);
  url.searchParams.set("trashed", "include");
  url.searchParams.set("limit", "50");
  const res = await fetch(url, { headers: authHeadersNoBody(token) });
  const body = (await res.json()) as { data: FixturePortfolioItem[] };
  return body.data.filter((item) => item.title === title);
}

/** Çöpe taşı + kalıcı sil — `§10.7` iki aşamalı desen (`api.ts::deletePagePermanently` İLE AYNI). */
export async function purgePortfolioItem(token: string, itemId: string): Promise<void> {
  await fetch(`${API_BASE_URL}/admin/portfolio/${itemId}`, { method: "DELETE", headers: authHeadersNoBody(token) });
  await fetch(`${API_BASE_URL}/admin/portfolio/${itemId}/permanent`, { method: "DELETE", headers: authHeadersNoBody(token) });
}

export interface FixturePortfolioCategory {
  id: string;
  slug: string;
  name: string;
}

export async function listPortfolioCategories(token: string): Promise<FixturePortfolioCategory[]> {
  const res = await fetch(`${API_BASE_URL}/admin/portfolio/categories`, { headers: authHeadersNoBody(token) });
  const body = (await res.json()) as { data: FixturePortfolioCategory[] };
  return body.data;
}

/** `DELETE /admin/portfolio/categories/{id}` — DOĞRUDAN kalıcı sil (bu modelde soft-delete/`deletedAt` YOK). */
export async function deletePortfolioCategory(token: string, id: string): Promise<void> {
  await fetch(`${API_BASE_URL}/admin/portfolio/categories/${id}`, { method: "DELETE", headers: authHeadersNoBody(token) });
}

export interface AuditLogFixtureEntry {
  id: string;
  action: string;
  status: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  actorEmail: string | null;
  createdAt: string;
}

/** `GET /admin/logs?action=...` — `logs.routes.ts`'in `startsWith` filtresiyle AYNI davranışı bekler. */
export async function listAuditLogsRaw(
  token: string,
  params: { action?: string; limit?: number } = {}
): Promise<AuditLogFixtureEntry[]> {
  const url = new URL(`${API_BASE_URL}/admin/logs`);
  url.searchParams.set("limit", String(params.limit ?? 20));
  if (params.action) url.searchParams.set("action", params.action);
  const res = await fetch(url, { headers: authHeadersNoBody(token) });
  const body = (await res.json()) as { data: AuditLogFixtureEntry[] };
  return body.data;
}

/**
 * Genel temizlik — şablonun ürettiği (kaç kez `force` ile tekrar uygulanmış olursa olsun) TÜM
 * portföy kategorisi/öğesi + medya satırlarını, bilinen başlık/slug-öneki/dosya-adı eşleşmesiyle
 * bulup GERÇEK API uçlarıyla (kalıcı) siler; ardından `demo_template_imports` işaretini sıfırlar.
 * Sayfa/slider'lar bu fonksiyonun KAPSAMI DIŞINDADIR (çağıran taraf bunları kendi yakaladığı
 * id'lerle `api.ts::deletePagePermanently` / `sliders-fixtures.ts::permanentDeleteSlider` ile siler)
 * — o iki tür zaten yalnızca BU testin ürettiği id'ler bilindiği için hedefe yönelik silinebiliyor.
 */
export async function purgeKnownDemoTemplateContent(token: string): Promise<void> {
  for (const title of KNOWN_PORTFOLIO_ITEM_TITLES) {
    const items = await findPortfolioItemsByTitle(token, title);
    for (const item of items) await purgePortfolioItem(token, item.id);
  }

  const categories = await listPortfolioCategories(token);
  for (const category of categories) {
    if (KNOWN_PORTFOLIO_CATEGORY_SLUG_PREFIXES.some((prefix) => category.slug.startsWith(prefix))) {
      await deletePortfolioCategory(token, category.id);
    }
  }

  const media = await listAllAdminMediaIds(token);
  for (const [id, filename] of media) {
    if (KNOWN_ASSET_FILENAMES.includes(filename)) await deleteMediaById(token, id);
  }

  resetDemoTemplateImportRow();
}
