import { test, expect, type Page, type Locator } from "@playwright/test";
import {
  getCachedAdminSession,
  getFixtureUserToken,
  createPageWithBlocks,
  getPage,
  deletePagePermanently,
  API_BASE_URL,
} from "./support/api";
import { createAuthenticatedPageAs } from "./support/admin-session";
import { registerFixtureUser, resetFixtureUserToBaseline, adminGetUserByEmail, adminUpdateRole } from "./support/admin-users-fixtures";

/**
 * qa-agent — `.claude/architect-scope-rbac-5-tier.md` §6 (Sayfa modülü, üç katmanlı yetki) +
 * §10.5 madde 3/5 (bu ajanın görev listesi). Bu dosya `.claude/architect-scope-page-editor-
 * roles.md` §6.6 için yazılmış eski sürümün REVİZE EDİLMİŞ hâlidir — architect'in RBAC 5-kademe
 * kararı (§3, §6.2) `User.advancedBuilderEnabled` kullanıcı-başı bayrağını VE
 * `PATCH /admin/users/{userId}/builder-access` ucunu TAMAMEN KALDIRDI:
 *
 *   `canUseAdvancedBuilder(user) = (user.role === "ADMIN")` — SAF rol türevi.
 *
 * Bunun sonucu: eskiden "standart editör" (EDITOR + bayrak KAPALI) / "gelişmiş editör"
 * (EDITOR + bayrak AÇIK) ayrımı roldü DEĞİL bir kullanıcı-başı anahtardı; şimdi ayrım
 * DOĞRUDAN ROLDÜR — ADMIN dışındaki HER rol (MANAGER dahil) `simpleMode` görür. Bu dosya bu
 * yüzden İKİ aktöre indirgendi:
 *   - `editorPage` (rol: EDITOR) — kısıtlı ("standart") DOM kanıtı.
 *   - `adminPage` (rol: ADMIN, ikinci bir admin fixture'ı — qa-e2e-admin'in KENDİSİ değil, testin
 *     "son admin" kısıtlarına takılmaması için) — kısıtsız ("gelişmiş") DOM kanıtı.
 * MANAGER'ın AYNI Katman 1 kısıtına tabi olduğu (§6 — "MANAGER ve EDITOR ikisi de aynı şablon
 * diff'ine tabidir") API seviyesinde HEM backend'in `tests/integration/page-editor-roles.test.ts`
 * (MANAGER+EDITOR parametrik, `app.inject`) HEM bu suite'in kardeşi
 * `admin-rbac-5tier-critical-flows.spec.ts` (gerçek HTTP, `doğrudan API isteğiyle` — mimar
 * dokümanı §10.5 madde 3/4'ün "UI'dan DEĞİL, API'den" talimatına birebir uyar) tarafından
 * kapsanıyor — burada AYRICA bir MANAGER tarayıcı oturumu AÇILMADI (gereksiz DOM tekrarı,
 * kısıt zaten EDITOR ile BİREBİR aynı DOM koduna (`simpleMode`) düşüyor).
 *
 * ============================================================================================
 * qa-agent BULGUSU (KRİTİK, frontend-agent'a yönlendirildi) — önceki turda DÜZELTİLDİ ve
 * DOĞRULANDI, rol modeli değişikliğinden BAĞIMSIZ olarak hâlâ geçerli:
 *
 * (A) `page.tsx::handleSave()`/`handleSaveAsDraft()` PATCH gövdesine `slug`'ı KOŞULSUZ olarak
 *     ekliyordu. DÜZELTME (doğrulandı): `slug` artık `...(!simpleMode ? { slug } : {})` — AYNI
 *     koşullu-alan deseni, artık `simpleMode = !canUseAdvancedBuilder = role !== "ADMIN"`.
 *
 * (B)/(C) `page.tsx::load()` ve `enBlocks` `useMemo`'su standart (şimdi: ADMIN-olmayan) kullanıcı
 *     için `wrapBareRootBlocks()`'u ATLAR (`isSimpleModePage`/`editMode === "TEMPLATE" &&
 *     !canUseAdvancedBuilder` kontrolü) — DEĞİŞMEDİ, rol yeniden adlandırmasından ETKİLENMEDİ.
 * ============================================================================================
 *
 * qa-agent — KENDİ testinde bulduğu flaky kaynağını KENDİSİ düzeltti (proje kökü CLAUDE.md madde
 * 3): "•••" (`Daha fazla işlem`) menüsünden `DropdownMenuSub` "Alta Konteyner Ekle" alt-grid'ini
 * açan hover etkileşimi bu ortamda ARA SIRA tek denemede açılmıyor (floating-ui `allowMouseEnter`
 * koruması, `admin-page-builder-containers.spec.ts`'teki AYNI belgelenmiş kategori) —
 * `openAddBelowSingleColumnTileUntilVisible()` yardımcısı (menüyü kapat → yeniden aç → yeniden
 * hover, en fazla 4 deneme, sabit bekleme SÜRESİ değil) yalnızca FREEFORM/ADMIN testinde
 * kullanılır (aşağıdaki test "9").
 */
// NOT (retries KASITLI OLARAK ayarlanmaz) — `/auth/register`/`/auth/login` sabit 5 istek/dk
// kotası (`AUTH_RATE_LIMIT`) bu dosyada zaten dar: `beforeAll` birden fazla fixture kullanıcı +
// GERÇEK UI login'leri tüketiyor. Retry, `beforeAll`'ı (dolayısıyla register/login'i) YENİDEN
// tetikleyip kotayı katlayarak 429'a düşürür (bkz. `admin-user-management.spec.ts`'teki AYNI
// gerekçe).

const FIXTURE_PASSWORD = "QaE2ePageRoles12345!";
// Her kullanıcı için ÇALIŞTIRMA-BAŞINA-BENZERSİZ bir e-posta üretilir — `POST /auth/register`'ın
// HER ZAMAN 201 (ilk kayıt) dönmesini garanti eder, `getFixtureUserToken()`'ın `/auth/login`'e
// DÜŞMESİNİ (ve login kotasını tüketmesini) gerektirmez.
const RUN_SUFFIX = Date.now().toString(36);
const EDITOR_EMAIL = `qa-e2e-per-editor-${RUN_SUFFIX}@example.com`;
const SECOND_ADMIN_EMAIL = `qa-e2e-per-second-admin-${RUN_SUFFIX}@example.com`;
const DOWNGRADE_EMAIL = `qa-e2e-per-downgrade-${RUN_SUFFIX}@example.com`;

/** `admin-page-builder-containers.spec.ts::col` ile AYNI desen — geçerli, minimal bir `ContainerSettings`. */
const col = {
  layout: "boxed" as const,
  direction: "column" as const,
  justifyContent: "start" as const,
  alignItems: "stretch" as const,
  gap: 16,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
  background: { type: "none" as const },
};

function heading(id: string, text: string) {
  return { id, type: "heading", data: { text, level: 2, align: "left", underline: false } };
}

let adminToken: string;
/** Bir kez alınır (`beforeAll`), 1b testinde AYNEN yeniden kullanılır — her testin KENDİ
 *  `getFixtureUserToken()` çağrısı yapması auth kotasını gereksiz yere tüketirdi. */
let editorApiToken: string;
let editorPage: Page;
let closeEditorSession: () => Promise<void>;
let adminPage: Page;
let closeAdminSession: () => Promise<void>;

async function cleanupFixtures() {
  await resetFixtureUserToBaseline(adminToken, EDITOR_EMAIL);
  await resetFixtureUserToBaseline(adminToken, SECOND_ADMIN_EMAIL);
  await resetFixtureUserToBaseline(adminToken, DOWNGRADE_EMAIL);
}

/** `createPageWithBlocks` sarmalayıcısı — benzersiz slug + `editMode: TEMPLATE`, `DRAFT` durumunda. */
async function createTemplatePage(prefix: string, blocks: unknown[]) {
  const unique = `${Date.now().toString(36)}${Math.floor(Math.random() * 46_656).toString(36)}`;
  const slug = `qa-per-${prefix}-${unique}`;
  const created = await createPageWithBlocks(adminToken, {
    title: `QaE2ePageEditorRoles ${prefix} ${unique}`,
    slug,
    status: "DRAFT",
    editMode: "TEMPLATE",
    blocks,
  });
  return { pageId: created.id as string };
}

/** `createTemplatePage` ile AYNI desen, yalnızca `editMode: FREEFORM` — kısıt `editMode`'dan
 *  BAĞIMSIZ olduğu için (`simpleMode = !canUseAdvancedBuilder`, `pages.routes.ts::
 *  isStructureRestricted`) aşağıdaki 6-8 numaralı testler AYNI senaryoların FREEFORM
 *  eşleniğidir. */
async function createFreeformPage(prefix: string, blocks: unknown[]) {
  const unique = `${Date.now().toString(36)}${Math.floor(Math.random() * 46_656).toString(36)}`;
  const slug = `qa-per-${prefix}-${unique}`;
  const created = await createPageWithBlocks(adminToken, {
    title: `QaE2ePageEditorRoles ${prefix} ${unique}`,
    slug,
    status: "DRAFT",
    editMode: "FREEFORM",
    blocks,
  });
  return { pageId: created.id as string };
}

/** menüyü her denemede baştan (KAPAT → "•••"e yeniden tıkla → yeniden hover) açarak floating-ui'nin
 *  girişi kaçırdığı ender durumu birkaç deneme içinde EZER — yalnızca test "9"da kullanılır. */
async function openAddBelowSingleColumnTileUntilVisible(page: Page, moreMenuTrigger: Locator): Promise<Locator> {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await moreMenuTrigger.click();
    const addBelowSubTrigger = page.getByRole("menuitem", { name: "Alta Konteyner Ekle" });
    await expect(addBelowSubTrigger).toBeVisible();
    await page.mouse.move(0, 0);
    await addBelowSubTrigger.hover();
    const singleColumnTile = page.getByRole("button", { name: "Tek Sütun" });
    try {
      await expect(singleColumnTile).toBeVisible({ timeout: 2_000 });
      return singleColumnTile;
    } catch {
      if (attempt === maxAttempts) throw new Error('"Tek Sütun" karosu tekrarlı denemelere rağmen görünmedi.');
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
    }
  }
  throw new Error("Ulaşılamaz kod yolu.");
}

/** `PATCH /admin/pages/{id}` — durum kodunu FIRLATMADAN döner (403/200 iddiaları için). */
async function patchPageDirect(
  token: string,
  pageId: string,
  body: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${API_BASE_URL}/admin/pages/${pageId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(90_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  await cleanupFixtures();

  // TEK çağrı EDITOR'ü hem oluşturur (idempotent) HEM API token'ını döner — 1b/2/3 testlerinin
  // AYRICA `getFixtureUserToken()` çağırmasına gerek KALMAZ (auth kotası notu, yukarı).
  editorApiToken = await getFixtureUserToken(EDITOR_EMAIL, FIXTURE_PASSWORD, "QA E2E Editor");
  await registerFixtureUser(SECOND_ADMIN_EMAIL, FIXTURE_PASSWORD, "QA E2E Ikinci Admin");

  const editorUser = await adminGetUserByEmail(adminToken, EDITOR_EMAIL);
  const secondAdminUser = await adminGetUserByEmail(adminToken, SECOND_ADMIN_EMAIL);
  if (!editorUser || !secondAdminUser) throw new Error("Fixture kullanıcılar oluşturulamadı.");

  await adminUpdateRole(adminToken, editorUser.id, "EDITOR");
  await adminUpdateRole(adminToken, secondAdminUser.id, "ADMIN");

  // UI login'ler roller KESİNLEŞTİKTEN SONRA yapılır (dosya başına bir context, `support/
  // admin-session.ts` başlığındaki refresh-token rotasyonu notuyla TUTARLI).
  ({ page: editorPage, close: closeEditorSession } = await createAuthenticatedPageAs(browser, EDITOR_EMAIL, FIXTURE_PASSWORD));
  ({ page: adminPage, close: closeAdminSession } = await createAuthenticatedPageAs(browser, SECOND_ADMIN_EMAIL, FIXTURE_PASSWORD));
});

test.afterAll(async () => {
  if (closeEditorSession) await closeEditorSession();
  if (closeAdminSession) await closeAdminSession();
  await cleanupFixtures();
});

test.describe("Sayfa düzenleyici — rol tabanlı Katman 1 kısıtı (§6, canUseAdvancedBuilder = role===ADMIN)", () => {
  test("1a) EDITOR: şablon sayfada 'Kaydet' düğmesiyle kaydet → başarı", async () => {
    // qa-agent bulgusu (A) — bkz. dosya başlığı. `slug` yalnızca `!simpleMode` iken gövdeye
    // eklenir; regresyona dönerse (frontend-agent tekrar koşulsuz `slug` eklerse) CI KIRILIR.
    const { pageId } = await createTemplatePage("kaydet-basari", [
      { id: "qa-1a-root", type: "container", settings: col, children: [heading("qa-1a-heading", "Orijinal Başlık")] },
    ]);
    try {
      await editorPage.goto(`/admin/pages/${pageId}`);
      await expect(editorPage.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
      await editorPage.waitForTimeout(500);

      const headingField = editorPage.getByLabel("Başlık metni");
      await expect(headingField).toHaveValue("Orijinal Başlık");
      await headingField.fill("EDITOR tarafından değiştirildi");

      await editorPage.getByRole("button", { name: "Kaydet", exact: true }).click();
      await expect(editorPage.getByText("Sayfa kaydedildi.").last()).toBeVisible({ timeout: 5_000 });
    } finally {
      await deletePagePermanently(adminToken, pageId);
    }
  });

  test("1b) EDITOR: simpleMode DOM kanıtı + kontrol: backend/guard içerik-only bir PATCH'i (fazladan `slug` OLMADAN) 200 ile kabul eder", async () => {
    const { pageId } = await createTemplatePage("dom-ve-icerik-kabulu", [
      { id: "qa-1b-root", type: "container", settings: col, children: [heading("qa-1b-heading", "Orijinal Başlık")] },
    ]);
    try {
      await editorPage.goto(`/admin/pages/${pageId}`);
      await expect(editorPage.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
      await editorPage.waitForTimeout(500);

      // simpleMode DOM kanıtı — `BuilderCanvas`/`ContainerSettingsPanel` ADMIN-olmayan (rol===
      // EDITOR) kullanıcı için HİÇ mount edilmez ("devre dışı buton" DEĞİL).
      await expect(editorPage.locator('button[aria-label^="Sürükle: "]')).toHaveCount(0);
      await expect(editorPage.locator('button[aria-label="Konteyner ayarları"]')).toHaveCount(0);
      await expect(editorPage.getByText("Bölüm 1", { exact: true })).toBeVisible();

      const headingField = editorPage.getByLabel("Başlık metni");
      await expect(headingField).toHaveValue("Orijinal Başlık");
      await headingField.fill("Kontrol PATCH öncesi UI değeri");
      await expect(headingField).toHaveValue("Kontrol PATCH öncesi UI değeri");

      // (A) bulgusunu İZOLE eden kontrol — backend'in KENDİSİ, `slug` alanı OLMAYAN bir içerik-only
      // PATCH'i doğru şekilde kabul ediyor.
      const res = await patchPageDirect(editorApiToken, pageId, {
        blocks: [
          { id: "qa-1b-root", type: "container", settings: col, children: [heading("qa-1b-heading", "İçerik-only PATCH ile değişti")] },
        ],
      });
      expect(res.status).toBe(200);

      const saved = await getPage(adminToken, pageId);
      const savedRoot = (saved.blocks as Array<{ children: Array<{ data: { text: string } }> }>)[0];
      expect(savedRoot.children[0].data.text).toBe("İçerik-only PATCH ile değişti");
    } finally {
      await deletePagePermanently(adminToken, pageId);
    }
  });

  test("2) EDITOR: API seviyesinde yapısal değişiklik (ekleme/silme/sıralama) → 403 FORBIDDEN", async () => {
    const { pageId } = await createTemplatePage("structural-403", [
      {
        id: "qa-2-root",
        type: "container",
        settings: col,
        children: [heading("qa-2-h1", "Birinci Başlık"), heading("qa-2-h2", "İkinci Başlık")],
      },
    ]);
    try {
      const baseRoot = {
        id: "qa-2-root",
        type: "container",
        settings: col,
        children: [heading("qa-2-h1", "Birinci Başlık"), heading("qa-2-h2", "İkinci Başlık")],
      };

      const withAdded = JSON.parse(JSON.stringify(baseRoot));
      withAdded.children.push(heading("qa-2-injected", "Enjekte edilmiş"));
      const addRes = await patchPageDirect(editorApiToken, pageId, { blocks: [withAdded] });
      expect(addRes.status).toBe(403);
      expect((addRes.body as { error: { code: string } }).error.code).toBe("FORBIDDEN");

      const withRemoved = JSON.parse(JSON.stringify(baseRoot));
      withRemoved.children = [withRemoved.children[0]];
      const removeRes = await patchPageDirect(editorApiToken, pageId, { blocks: [withRemoved] });
      expect(removeRes.status).toBe(403);

      const reordered = JSON.parse(JSON.stringify(baseRoot));
      reordered.children = [reordered.children[1], reordered.children[0]];
      const reorderRes = await patchPageDirect(editorApiToken, pageId, { blocks: [reordered] });
      expect(reorderRes.status).toBe(403);

      // Kontrol — YAPI AYNI kalırken İÇERİK (`data.text`) değişikliği BAŞARILI olmalı.
      const withContentEdit = JSON.parse(JSON.stringify(baseRoot));
      withContentEdit.children[0].data.text = "API üzerinden içerik düzenlemesi";
      const contentRes = await patchPageDirect(editorApiToken, pageId, { blocks: [withContentEdit] });
      expect(contentRes.status).toBe(200);
    } finally {
      await deletePagePermanently(adminToken, pageId);
    }
  });

  test("3) KRİTİK — Autosave baypas testi: EDITOR UI'da düzenler, backend autosave'i BAĞIMSIZ olarak REDDEDER (403)", async () => {
    test.setTimeout(45_000);
    const { pageId } = await createTemplatePage("autosave-bypass", [
      { id: "qa-3-root", type: "container", settings: col, children: [heading("qa-3-heading", "Autosave Başlığı")] },
    ]);
    try {
      await editorPage.goto(`/admin/pages/${pageId}`);
      await expect(editorPage.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
      await editorPage.waitForTimeout(500);

      let injectedAutosaveStatus: number | null = null;
      let injectedAutosaveCount = 0;
      // UI EDITOR'e yapısal kontrol HİÇ SUNMADIĞI için (yukarıdaki DOM iddiaları, test 1b)
      // gerçek bir tıklamayla yapısal fark üretmek MÜMKÜN DEĞİL (by construction). Bu yüzden
      // GERÇEK debounce/autosave döngüsünün ürettiği GERÇEK isteğin GÖVDESİNE yapısal bir fark
      // enjekte edilir — istek yine GERÇEK sunucuya, GERÇEK ağ üzerinden gider.
      await editorPage.route(`**/admin/pages/${pageId}/autosave`, async (route) => {
        const request = route.request();
        const payload = request.postDataJSON() as { title?: string; blocks?: Array<{ children?: unknown[] }> };
        const mutatedBlocks = payload.blocks ? (JSON.parse(JSON.stringify(payload.blocks)) as Array<{ children?: unknown[] }>) : [];
        if (mutatedBlocks[0] && Array.isArray(mutatedBlocks[0].children)) {
          (mutatedBlocks[0].children as unknown[]).push(heading("qa-3-injected", "Enjekte edilmiş yapı"));
        }
        const response = await route.fetch({ postData: JSON.stringify({ ...payload, blocks: mutatedBlocks }) });
        injectedAutosaveCount += 1;
        injectedAutosaveStatus = response.status();
        await route.fulfill({ response });
      });

      const headingField = editorPage.getByLabel("Başlık metni");
      await headingField.fill("Autosave icin sadece metin degisikligi");

      await expect.poll(() => injectedAutosaveCount, { timeout: 8_000 }).toBeGreaterThan(0);
      await expect.poll(() => injectedAutosaveStatus, { timeout: 5_000 }).toBe(403);

      // Enjekte edilen yapısal fark REDDEDİLDİ — DB'de hâlâ TEK çocuk var, YAZILMADI.
      const afterReject = await getPage(adminToken, pageId);
      const rootAfterReject = (afterReject.blocks as Array<{ children: unknown[] }>)[0];
      expect(rootAfterReject.children).toHaveLength(1);

      // Kontrol — autosave GENEL olarak bozuk DEĞİL: interceptor kaldırılınca GERÇEK
      // (enjeksiyonsuz) bir içerik değişikliği normal şekilde kalıcı olur.
      await editorPage.unroute(`**/admin/pages/${pageId}/autosave`);
      await headingField.fill("Autosave sonrasi gercek icerik kaydi");
      await expect
        .poll(
          async () => {
            const p = await getPage(adminToken, pageId);
            const root = (p.blocks as Array<{ children: Array<{ data: { text: string } }> }>)[0];
            return root.children[0].data.text;
          },
          { timeout: 8_000 }
        )
        .toBe("Autosave sonrasi gercek icerik kaydi");
    } finally {
      await deletePagePermanently(adminToken, pageId);
    }
  });

  test("4) ADMIN: aynı türde bir şablon sayfada tam serbestlik — BuilderCanvas görünür, konteyner ekleyip kaydedebilir", async () => {
    test.setTimeout(45_000);
    const { pageId } = await createTemplatePage("advanced-freedom", [
      { id: "qa-4-root", type: "container", settings: col, children: [heading("qa-4-heading", "Admin Başlığı")] },
    ]);
    try {
      await adminPage.goto(`/admin/pages/${pageId}`);
      await expect(adminPage.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
      await adminPage.waitForTimeout(500);

      // ADMIN kanıtı — BuilderCanvas GERÇEKTEN mount edilmiş (simpleMode'daki TemplateEditorView
      // DEĞİL): mevcut konteynerin sürükle tutamacı + "Konteyner ayarları" görünür.
      await expect(adminPage.locator('button[aria-label^="Sürükle: "]')).toHaveCount(2); // konteyner + başlık
      await expect(adminPage.locator('button[aria-label="Konteyner ayarları"]')).toHaveCount(1);
      // Şablon modu göstergesi — YALNIZCA ADMIN görür (`editMode === "TEMPLATE" && canUseAdvancedBuilder`).
      await expect(adminPage.getByText("Şablon Modu", { exact: true })).toBeVisible();

      const moreMenuTrigger = adminPage.locator('button[aria-label="Daha fazla işlem"]').first();
      await moreMenuTrigger.click();
      const addBelowSubTrigger = adminPage.getByRole("menuitem", { name: "Alta Konteyner Ekle" });
      await expect(addBelowSubTrigger).toBeVisible();
      await adminPage.mouse.move(0, 0);
      await addBelowSubTrigger.hover();
      const singleColumnTile = adminPage.getByRole("button", { name: "Tek Sütun" });
      await expect(singleColumnTile).toBeVisible();
      await singleColumnTile.click();
      await adminPage.keyboard.press("Escape");
      await adminPage.keyboard.press("Escape");

      await expect(adminPage.locator('button[aria-label="Konteyner ayarları"]')).toHaveCount(2);

      await adminPage.getByRole("button", { name: "Kaydet", exact: true }).click();
      await expect(adminPage.getByText("Sayfa kaydedildi.").last()).toBeVisible({ timeout: 10_000 });

      const saved = await getPage(adminToken, pageId);
      expect((saved.blocks as unknown[]).length).toBe(2); // orijinal konteyner + yeni eklenen (boş) konteyner
    } finally {
      await deletePagePermanently(adminToken, pageId);
    }
  });

  test("5) rol GERÇEK ZAMANLI kaynak — ADMIN'den EDITOR'e düşürülünce AYNI (yenilenmemiş) access token'ın BİR SONRAKİ isteğinde kısıt ANINDA etkin olur", async () => {
    // §3.1 — `canUseAdvancedBuilder` her istekte DB'den (request.user.role) YENİDEN hesaplanır,
    // token'a gömülü bir iddia DEĞİLDİR. Eski `advancedBuilderEnabled` bayrağının "gerçek zamanlı
    // toggle" testinin (kaldırılan §10.20 testi "5") ROL modeline taşınmış hâli: artık toggle
    // edilen bayrak değil, KULLANICININ ROLÜNÜN KENDİSİ.
    const downgradeToken = await getFixtureUserToken(DOWNGRADE_EMAIL, FIXTURE_PASSWORD, "QA E2E Downgrade");
    const downgradeUser = await adminGetUserByEmail(adminToken, DOWNGRADE_EMAIL);
    if (!downgradeUser) throw new Error("Downgrade fixture kullanıcı bulunamadı.");
    // Başlangıçta ADMIN — ilk istek kısıtsız geçmeli (kontrol).
    const promote = await adminUpdateRole(adminToken, downgradeUser.id, "ADMIN");
    expect(promote.status).toBe(200);

    const { pageId } = await createTemplatePage("realtime-role-downgrade", [
      { id: "qa-5-root", type: "container", settings: col, children: [heading("qa-5-heading", "Realtime Başlık")] },
    ]);
    try {
      const rootWithOneAdded = {
        id: "qa-5-root",
        type: "container",
        settings: col,
        children: [heading("qa-5-heading", "Realtime Başlık"), heading("qa-5-added-1", "ADMIN iken eklendi")],
      };
      // ADIM 1 — ADMIN İKEN yapısal değişiklik BAŞARILI (kısıtsız kontrol).
      const before = await patchPageDirect(downgradeToken, pageId, { blocks: [rootWithOneAdded] });
      expect(before.status).toBe(200);

      // ADIM 2 — başka bir ADMIN, hedefi EDITOR'e DÜŞÜRÜR; kullanıcı OTURUMUNU YENİLEMEDİ, AYNI
      // access token duruyor.
      const demote = await adminUpdateRole(adminToken, downgradeUser.id, "EDITOR");
      expect(demote.status).toBe(200);

      // ADIM 3 — AYNI token, BİR SONRAKİ istek — sunucu her istekte rolü DB'den YENİDEN okur.
      const rootWithTwoAdded = JSON.parse(JSON.stringify(rootWithOneAdded));
      rootWithTwoAdded.children.push(heading("qa-5-added-2", "Düşürüldükten sonra denendi"));
      const after = await patchPageDirect(downgradeToken, pageId, { blocks: [rootWithTwoAdded] });
      expect(after.status).toBe(403);
    } finally {
      await deletePagePermanently(adminToken, pageId);
    }
  });

  // ============================================================================================
  // FREEFORM eşlenikleri — kısıt `editMode`'dan BAĞIMSIZ olduğu için (`simpleMode =
  // !canUseAdvancedBuilder`, `pages.routes.ts::isStructureRestricted`) yukarıdaki 1/2/3/4
  // numaralı senaryolar `editMode: FREEFORM` sayfalarda da doğrulanır.
  // ============================================================================================

  test("6) EDITOR: FREEFORM sayfada BuilderCanvas hiç render edilmez, yalnızca TemplateEditorView (form) görünür + içerik kaydı başarı", async () => {
    const { pageId } = await createFreeformPage("freeform-editor-kaydet", [
      { id: "qa-6-root", type: "container", settings: col, children: [heading("qa-6-heading", "Orijinal Başlık")] },
    ]);
    try {
      await editorPage.goto(`/admin/pages/${pageId}`);
      await expect(editorPage.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
      await editorPage.waitForTimeout(500);

      await expect(editorPage.locator('button[aria-label^="Sürükle: "]')).toHaveCount(0);
      await expect(editorPage.locator('button[aria-label="Konteyner ayarları"]')).toHaveCount(0);
      await expect(editorPage.getByText("İçerik alanlarını doldurun — yapı bu şablonda sabittir.")).toBeVisible();
      await expect(editorPage.getByText("Bölüm 1", { exact: true })).toBeVisible();

      const headingField = editorPage.getByLabel("Başlık metni");
      await expect(headingField).toHaveValue("Orijinal Başlık");
      await headingField.fill("EDITOR tarafından değiştirildi (freeform)");

      await editorPage.getByRole("button", { name: "Kaydet", exact: true }).click();
      await expect(editorPage.getByText("Sayfa kaydedildi.").last()).toBeVisible({ timeout: 5_000 });

      const saved = await getPage(adminToken, pageId);
      const savedRoot = (saved.blocks as Array<{ children: Array<{ data: { text: string } }> }>)[0];
      expect(savedRoot.children[0].data.text).toBe("EDITOR tarafından değiştirildi (freeform)");
    } finally {
      await deletePagePermanently(adminToken, pageId);
    }
  });

  test("7) EDITOR: FREEFORM sayfada API seviyesinde yapısal değişiklik (ekleme/silme/sıralama) → 403 FORBIDDEN", async () => {
    const { pageId } = await createFreeformPage("freeform-structural-403", [
      {
        id: "qa-7-root",
        type: "container",
        settings: col,
        children: [heading("qa-7-h1", "Birinci Başlık"), heading("qa-7-h2", "İkinci Başlık")],
      },
    ]);
    try {
      const baseRoot = {
        id: "qa-7-root",
        type: "container",
        settings: col,
        children: [heading("qa-7-h1", "Birinci Başlık"), heading("qa-7-h2", "İkinci Başlık")],
      };

      const withAdded = JSON.parse(JSON.stringify(baseRoot));
      withAdded.children.push(heading("qa-7-injected", "Enjekte edilmiş"));
      const addRes = await patchPageDirect(editorApiToken, pageId, { blocks: [withAdded] });
      expect(addRes.status).toBe(403);
      expect((addRes.body as { error: { code: string } }).error.code).toBe("FORBIDDEN");

      const withRemoved = JSON.parse(JSON.stringify(baseRoot));
      withRemoved.children = [withRemoved.children[0]];
      const removeRes = await patchPageDirect(editorApiToken, pageId, { blocks: [withRemoved] });
      expect(removeRes.status).toBe(403);

      const reordered = JSON.parse(JSON.stringify(baseRoot));
      reordered.children = [reordered.children[1], reordered.children[0]];
      const reorderRes = await patchPageDirect(editorApiToken, pageId, { blocks: [reordered] });
      expect(reorderRes.status).toBe(403);

      const withContentEdit = JSON.parse(JSON.stringify(baseRoot));
      withContentEdit.children[0].data.text = "API üzerinden içerik düzenlemesi (freeform)";
      const contentRes = await patchPageDirect(editorApiToken, pageId, { blocks: [withContentEdit] });
      expect(contentRes.status).toBe(200);
    } finally {
      await deletePagePermanently(adminToken, pageId);
    }
  });

  test("8) KRİTİK — Autosave baypas testi (FREEFORM): EDITOR UI'da düzenler, backend autosave'i BAĞIMSIZ olarak REDDEDER (403)", async () => {
    test.setTimeout(45_000);
    const { pageId } = await createFreeformPage("freeform-autosave-bypass", [
      { id: "qa-8-root", type: "container", settings: col, children: [heading("qa-8-heading", "Autosave Başlığı")] },
    ]);
    try {
      await editorPage.goto(`/admin/pages/${pageId}`);
      await expect(editorPage.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
      await editorPage.waitForTimeout(500);

      let injectedAutosaveStatus: number | null = null;
      let injectedAutosaveCount = 0;
      await editorPage.route(`**/admin/pages/${pageId}/autosave`, async (route) => {
        const request = route.request();
        const payload = request.postDataJSON() as { title?: string; blocks?: Array<{ children?: unknown[] }> };
        const mutatedBlocks = payload.blocks ? (JSON.parse(JSON.stringify(payload.blocks)) as Array<{ children?: unknown[] }>) : [];
        if (mutatedBlocks[0] && Array.isArray(mutatedBlocks[0].children)) {
          (mutatedBlocks[0].children as unknown[]).push(heading("qa-8-injected", "Enjekte edilmiş yapı"));
        }
        const response = await route.fetch({ postData: JSON.stringify({ ...payload, blocks: mutatedBlocks }) });
        injectedAutosaveCount += 1;
        injectedAutosaveStatus = response.status();
        await route.fulfill({ response });
      });

      const headingField = editorPage.getByLabel("Başlık metni");
      await headingField.fill("Autosave icin sadece metin degisikligi (freeform)");

      await expect.poll(() => injectedAutosaveCount, { timeout: 8_000 }).toBeGreaterThan(0);
      await expect.poll(() => injectedAutosaveStatus, { timeout: 5_000 }).toBe(403);

      const afterReject = await getPage(adminToken, pageId);
      const rootAfterReject = (afterReject.blocks as Array<{ children: unknown[] }>)[0];
      expect(rootAfterReject.children).toHaveLength(1);

      await editorPage.unroute(`**/admin/pages/${pageId}/autosave`);
      await headingField.fill("Autosave sonrasi gercek icerik kaydi (freeform)");
      await expect
        .poll(
          async () => {
            const p = await getPage(adminToken, pageId);
            const root = (p.blocks as Array<{ children: Array<{ data: { text: string } }> }>)[0];
            return root.children[0].data.text;
          },
          { timeout: 8_000 }
        )
        .toBe("Autosave sonrasi gercek icerik kaydi (freeform)");
    } finally {
      await deletePagePermanently(adminToken, pageId);
    }
  });

  test("9) ADMIN: FREEFORM sayfada tam serbestlik (regresyon) — BuilderCanvas görünür, konteyner ekleyip kaydedebilir", async () => {
    // Test "4" ile AYNI desen — yalnızca `editMode: FREEFORM`. Bu senaryo `simpleMode`'un
    // yalnızca `canUseAdvancedBuilder`'a bağlı olduğunu, FREEFORM sayfada ADMIN için HİÇBİR yeni
    // kısıt getirmediğini kanıtlar.
    test.setTimeout(45_000);
    const { pageId } = await createFreeformPage("freeform-advanced-freedom", [
      { id: "qa-9-root", type: "container", settings: col, children: [heading("qa-9-heading", "Admin Başlığı")] },
    ]);
    try {
      await adminPage.goto(`/admin/pages/${pageId}`);
      await expect(adminPage.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
      await adminPage.waitForTimeout(500);

      await expect(adminPage.locator('button[aria-label^="Sürükle: "]')).toHaveCount(2); // konteyner + başlık
      await expect(adminPage.locator('button[aria-label="Konteyner ayarları"]')).toHaveCount(1);
      // FREEFORM sayfada şablon modu rozeti GÖRÜNMEMELİDİR — o gösterge yalnızca
      // `editMode === "TEMPLATE" && canUseAdvancedBuilder` iken render edilir.
      await expect(adminPage.getByText("Şablon Modu", { exact: true })).not.toBeVisible();

      const moreMenuTrigger = adminPage.locator('button[aria-label="Daha fazla işlem"]').first();
      const singleColumnTile = await openAddBelowSingleColumnTileUntilVisible(adminPage, moreMenuTrigger);
      await singleColumnTile.click();
      await adminPage.keyboard.press("Escape");
      await adminPage.keyboard.press("Escape");

      await expect(adminPage.locator('button[aria-label="Konteyner ayarları"]')).toHaveCount(2);

      await adminPage.getByRole("button", { name: "Kaydet", exact: true }).click();
      await expect(adminPage.getByText("Sayfa kaydedildi.").last()).toBeVisible({ timeout: 10_000 });

      const saved = await getPage(adminToken, pageId);
      expect((saved.blocks as unknown[]).length).toBe(2);
    } finally {
      await deletePagePermanently(adminToken, pageId);
    }
  });
});
