import { test, expect, type Page } from "@playwright/test";
import {
  getCachedAdminSession,
  getFixtureUserToken,
  createPageWithBlocks,
  getPage,
  deletePagePermanently,
  API_BASE_URL,
} from "./support/api";
import { createAuthenticatedPageAs } from "./support/admin-session";
import {
  registerFixtureUser,
  resetFixtureUserToBaseline,
  adminGetUserByEmail,
  adminUpdateRole,
  adminUpdateBuilderAccess,
} from "./support/admin-users-fixtures";

/**
 * qa-agent — `.claude/architect-scope-page-editor-roles.md` §6.6 (BAĞLAYICI, 6 madde) — Sayfa
 * düzenleyicide "Standart" (`editMode: TEMPLATE` + `!canUseAdvancedBuilder`) ve "Gelişmiş" mod
 * ayrımının e2e/entegrasyon kapsamı. §6.6'nın 7. maddesi (security-agent'ın bıraktığı
 * `PATCH /admin/users/{id}/builder-access` DELETED-kullanıcı kapsam notu) AYRI bir backend
 * entegrasyon testi olarak eklendi — bkz. `backend/tests/integration/admin-users-soft-delete.test.ts`
 * "PATCH /builder-access, DELETED bir kullanıcıya uygulanamaz" describe bloğu.
 *
 * ============================================================================================
 * qa-agent BULGUSU (KRİTİK, frontend-agent'a yönlendirildi) — DÜZELTİLDİ ve BU TURDA DOĞRULANDI:
 *
 * (A) `page.tsx::handleSave()`/`handleSaveAsDraft()` PATCH gövdesine `slug`'ı KOŞULSUZ olarak
 *     ekliyordu (`isLegalDocument`in `...(isAdmin ? { isLegalDocument } : {})` deseninin AKSİNE,
 *     `slug` için HİÇBİR koşul YOKTU). Backend'in `assertAdvancedFieldsAuthorized()`
 *     (`pages.routes.ts`) `body.slug !== undefined` olduğu AN 403 fırlatıyordu — DEĞER AYNI
 *     kalsa BİLE. DÜZELTME (frontend-agent, doğrulandı): `slug` artık `isLegalDocument` ile AYNI
 *     koşullu-alan desenini kullanıyor — `...(!simpleMode ? { slug } : {})` (hem `handleSave` hem
 *     `handleSaveAsDraft`). "1a" testi artık `test.fail()` OLMADAN normal bir geçme beklentisiyle
 *     çalışır (bu turda kaldırıldı — bkz. git geçmişi); "1b" testi backend/guard'ın KENDİSİNİN
 *     (yalnızca frontend'in gönderdiği fazladan `slug` alanı olmadan) içerik-only bir PATCH'i
 *     doğru şekilde 200 ile kabul ettiğini AYRICA kanıtlar.
 *
 * (B) `page.tsx::load()` HER kullanıcı için (standart dahil) `wrapBareRootBlocks()` çağırıyordu —
 *     kökte "çıplak" (bir `container`'ın DIŞINDaki) blok varsa YENİ bir `container`'a sarıyordu.
 *     Bu sarma `TemplateEditorView`'a giden `activeNodes`'u da etkiliyordu; sayfa DB'de kökte
 *     çıplak bir blokla saklanmışsa, standart kullanıcı SALT bir metin alanını değiştirse bile
 *     gönderilen `blocks` kayıtlı ağaçtan YAPISAL olarak farklı hale geliyordu (yeni bir
 *     `container` düğümü) — `assertTemplateEditAllowed` bunu (doğru biçimde) 403'e düşürüyordu.
 *     DÜZELTME (frontend-agent, doğrulandı): `load()` içinde `isSimpleModePage` hesaplanıp
 *     TEMPLATE + standart kullanıcı iken `wrapBareRootBlocks` ATLANIYOR. Bu dosyadaki fixture'lar
 *     kök bloğu YİNE de bir `container` İÇİNE sarılmış oluşturur (bkz. `createTemplatePage`
 *     başlığı) — bu artık zorunlu değil ama zararsız/gerçekçi bir fixture deseni olarak kalır.
 *
 * (C) EK (orkestratör tarafından, aynı desenle) — `enBlocks` `useMemo`'su (çeviri sekmesindeki
 *     bloklar, `translations.<locale>.blocks`) da (B) ile AYNI riski taşıyordu; artık
 *     `editMode === "TEMPLATE" && !canUseAdvancedBuilder` iken `wrapBareRootBlocks`'u atlıyor.
 *     Bu dosyada AYRI bir çeviri-sekmesi senaryosu YOK (kapsam dışı — varsayılan locale ile
 *     sınırlı) ama diff/kod incelemesiyle DOĞRULANDI; ileride bir çeviri-sekmesi senaryosu
 *     eklenmesi TEST_COVERAGE.md'de eksik olarak not edilir.
 * ============================================================================================
 */
// NOT (retries KASITLI OLARAK ayarlanmaz, varsayılan 0'da bırakılır) — `/auth/register`/`/auth/login`
// sabit 5 istek/dk kotası (`AUTH_RATE_LIMIT`, `auth.routes.ts`) BU DOSYADA zaten dar: `beforeAll`
// birden fazla fixture kullanıcı (register) + İKİ GERÇEK UI login'i tüketiyor. Playwright `retries`
// AYARLANDIĞINDA bir testin başarısız olması YENİ bir worker'da `beforeAll`'ı BAŞTAN çalıştırır —
// bu da register/login çağrılarını İKİYE KATLAYIP kotayı anında 429'a düşürür (qa-agent'ın kendi
// ilk taslağında gözlemlendi: `admin-user-management.spec.ts`'teki AYNI kararın (dosya başlığı,
// "NOT — retries BİLİNÇLİ OLARAK ayarlanmıyor") BİREBİR aynı gerekçesi).

const FIXTURE_PASSWORD = "QaE2ePageRoles12345!";
// `/auth/register`/`/auth/login`'in sabit 5 istek/dk kotası (yukarıdaki NOT) — bu dosya HER
// kullanıcı için `RUN_SUFFIX` ile ÇALIŞTIRMA-BAŞINA-BENZERSİZ bir e-posta üretir. Bu, `POST
// /auth/register`'ın HER ZAMAN 201 (ilk kayıt) dönmesini, dolayısıyla `getFixtureUserToken()`'ın
// `/auth/login`'e DÜŞMEMESİNİ garanti eder — `admin-user-management.spec.ts`'teki (KALICI, tekrar
// kullanılan e-posta + `resetFixtureUserToBaseline`) desenin AKSİNE, burada KİMLİK SÜREKLİLİĞİ
// gerekmez (her fixture kullanıcı yalnızca BU dosyanın KENDİ testleri içinde kullanılır) — bu
// yüzden basit/benzersiz e-posta, login-kotası riskini TAMAMEN ortadan kaldırdığı için TERCİH
// EDİLDİ (qa-agent'ın ilk taslağı KALICI e-posta kullanıyordu, 429'a çarptı — bu turda düzeltildi).
const RUN_SUFFIX = Date.now().toString(36);
const STANDARD_EDITOR_EMAIL = `qa-e2e-per-standard-editor-${RUN_SUFFIX}@example.com`;
const ADVANCED_EDITOR_EMAIL = `qa-e2e-per-advanced-editor-${RUN_SUFFIX}@example.com`;
const REALTIME_EDITOR_EMAIL = `qa-e2e-per-realtime-editor-${RUN_SUFFIX}@example.com`;
const SECOND_ADMIN_EMAIL = `qa-e2e-per-second-admin-${RUN_SUFFIX}@example.com`;

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
/** §10.20 — bir sonraki auth kotası notunun gerekçesi: bu token tek bir `getFixtureUserToken()`
 *  çağrısıyla (`beforeAll`) elde edilir ve 1b/2 testlerinde AYNEN yeniden kullanılır — her testin
 *  KENDİ `getFixtureUserToken()` çağrısı yapması `/auth/register`/`/auth/login`'in 5/dk kotasını
 *  gereksiz yere tüketirdi (qa-agent'ın ilk taslağında gözlemlendi ve düzeltildi). */
let standardApiToken: string;
let standardPage: Page;
let closeStandardSession: () => Promise<void>;
let advancedPage: Page;
let closeAdvancedSession: () => Promise<void>;

async function cleanupFixtures() {
  await resetFixtureUserToBaseline(adminToken, STANDARD_EDITOR_EMAIL);
  await resetFixtureUserToBaseline(adminToken, ADVANCED_EDITOR_EMAIL);
  await resetFixtureUserToBaseline(adminToken, REALTIME_EDITOR_EMAIL);
  await resetFixtureUserToBaseline(adminToken, SECOND_ADMIN_EMAIL);
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

  // TEK çağrı standart editörü hem oluşturur (idempotent) HEM API token'ını döner — 1b/2
  // testlerinin AYRICA `getFixtureUserToken()` çağırmasına gerek KALMAZ (auth kotası notu, yukarı).
  standardApiToken = await getFixtureUserToken(STANDARD_EDITOR_EMAIL, FIXTURE_PASSWORD, "QA E2E Standart Editor");
  await registerFixtureUser(ADVANCED_EDITOR_EMAIL, FIXTURE_PASSWORD, "QA E2E Gelismis Editor");

  const standardUser = await adminGetUserByEmail(adminToken, STANDARD_EDITOR_EMAIL);
  const advancedUser = await adminGetUserByEmail(adminToken, ADVANCED_EDITOR_EMAIL);
  if (!standardUser || !advancedUser) throw new Error("Fixture kullanıcılar oluşturulamadı.");

  // Standart editör: rol EDITOR, `advancedBuilderEnabled` VARSAYILAN (false) — dokunulmaz.
  await adminUpdateRole(adminToken, standardUser.id, "EDITOR");
  // Gelişmiş editör: rol EDITOR + `advancedBuilderEnabled: true`.
  await adminUpdateRole(adminToken, advancedUser.id, "EDITOR");
  await adminUpdateBuilderAccess(adminToken, advancedUser.id, true);

  // UI login'ler roller/bayraklar KESİNLEŞTİKTEN SONRA yapılır (dosya başına bir context,
  // `support/admin-session.ts` başlığındaki refresh-token rotasyonu notuyla TUTARLI).
  ({ page: standardPage, close: closeStandardSession } = await createAuthenticatedPageAs(
    browser,
    STANDARD_EDITOR_EMAIL,
    FIXTURE_PASSWORD
  ));
  ({ page: advancedPage, close: closeAdvancedSession } = await createAuthenticatedPageAs(
    browser,
    ADVANCED_EDITOR_EMAIL,
    FIXTURE_PASSWORD
  ));
});

test.afterAll(async () => {
  if (closeStandardSession) await closeStandardSession();
  if (closeAdvancedSession) await closeAdvancedSession();
  await cleanupFixtures();
});

test.describe("Sayfa düzenleyici — Standart/Gelişmiş mod ayrımı (§10.20)", () => {
  test("1a) Standart kullanıcı: şablon sayfada 'Kaydet' düğmesiyle kaydet → başarı", async () => {
    // qa-agent bulgusu (A) DÜZELTİLDİ ve DOĞRULANDI (bkz. dosya başlığı) — `handleSave()`/
    // `handleSaveAsDraft()` artık `slug`'ı yalnızca `!simpleMode` iken gövdeye ekliyor
    // (`...(!simpleMode ? { slug } : {})`, `isLegalDocument` ile AYNI koşullu-alan deseni).
    // `test.fail()` KALDIRILDI — bu test artık NORMAL bir geçme beklentisiyle çalışır; regresyona
    // dönerse (frontend-agent tekrar koşulsuz `slug` eklerse) CI KIRILIR (istenen davranış).

    const { pageId } = await createTemplatePage("kaydet-basari", [
      { id: "qa-1a-root", type: "container", settings: col, children: [heading("qa-1a-heading", "Orijinal Başlık")] },
    ]);
    try {
      await standardPage.goto(`/admin/pages/${pageId}`);
      await expect(standardPage.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
      await standardPage.waitForTimeout(500);

      const headingField = standardPage.getByLabel("Başlık metni");
      await expect(headingField).toHaveValue("Orijinal Başlık");
      await headingField.fill("Standart kullanıcı tarafından değiştirildi");

      await standardPage.getByRole("button", { name: "Kaydet", exact: true }).click();
      await expect(standardPage.getByText("Sayfa kaydedildi.").last()).toBeVisible({ timeout: 5_000 });
    } finally {
      await deletePagePermanently(adminToken, pageId);
    }
  });

  test("1b) Standart mod DOM kanıtı + kontrol: backend/guard içerik-only bir PATCH'i (fazladan `slug` OLMADAN) 200 ile kabul eder", async () => {
    const { pageId } = await createTemplatePage("dom-ve-icerik-kabulu", [
      { id: "qa-1b-root", type: "container", settings: col, children: [heading("qa-1b-heading", "Orijinal Başlık")] },
    ]);
    try {
      await standardPage.goto(`/admin/pages/${pageId}`);
      await expect(standardPage.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
      await standardPage.waitForTimeout(500);

      // Standart mod DOM kanıtı — design-notes-page-builder-standard-mode.md Karar 1/2: `BuilderCanvas`/
      // `ContainerSettingsPanel` standart kullanıcı için HİÇ mount edilmez ("devre dışı buton" DEĞİL).
      await expect(standardPage.locator('button[aria-label^="Sürükle: "]')).toHaveCount(0);
      await expect(standardPage.locator('button[aria-label="Konteyner ayarları"]')).toHaveCount(0);
      await expect(standardPage.getByText("Bölüm 1", { exact: true })).toBeVisible();

      const headingField = standardPage.getByLabel("Başlık metni");
      await expect(headingField).toHaveValue("Orijinal Başlık");
      await headingField.fill("Kontrol PATCH öncesi UI değeri");
      await expect(headingField).toHaveValue("Kontrol PATCH öncesi UI değeri");

      // (A) bulgusunu İZOLE eden kontrol — backend'in KENDİSİ, `slug` alanı OLMAYAN bir içerik-only
      // PATCH'i doğru şekilde kabul ediyor (`standardApiToken` — `beforeAll`'da TEK SEFER alınan
      // fixture token, auth kotası notuna bkz.).
      const res = await patchPageDirect(standardApiToken, pageId, {
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

  test("2) Standart kullanıcı: API seviyesinde yapısal değişiklik (ekleme/silme/sıralama) → 403 FORBIDDEN", async () => {
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

      // (a) EKLEME.
      const withAdded = JSON.parse(JSON.stringify(baseRoot));
      withAdded.children.push(heading("qa-2-injected", "Enjekte edilmiş"));
      const addRes = await patchPageDirect(standardApiToken, pageId, { blocks: [withAdded] });
      expect(addRes.status).toBe(403);
      expect((addRes.body as { error: { code: string } }).error.code).toBe("FORBIDDEN");

      // (b) SİLME.
      const withRemoved = JSON.parse(JSON.stringify(baseRoot));
      withRemoved.children = [withRemoved.children[0]];
      const removeRes = await patchPageDirect(standardApiToken, pageId, { blocks: [withRemoved] });
      expect(removeRes.status).toBe(403);

      // (c) SIRALAMA.
      const reordered = JSON.parse(JSON.stringify(baseRoot));
      reordered.children = [reordered.children[1], reordered.children[0]];
      const reorderRes = await patchPageDirect(standardApiToken, pageId, { blocks: [reordered] });
      expect(reorderRes.status).toBe(403);

      // Kontrol — YAPI AYNI kalırken İÇERİK (`data.text`) değişikliği BAŞARILI olmalı; 403'ün
      // "her PATCH'i reddediyor" değil, SPESİFİK olarak yapısal değişikliği hedeflediğini kanıtlar.
      const withContentEdit = JSON.parse(JSON.stringify(baseRoot));
      withContentEdit.children[0].data.text = "API üzerinden içerik düzenlemesi";
      const contentRes = await patchPageDirect(standardApiToken, pageId, { blocks: [withContentEdit] });
      expect(contentRes.status).toBe(200);
    } finally {
      await deletePagePermanently(adminToken, pageId);
    }
  });

  test("3) Autosave baypas testi: standart kullanıcı UI'da düzenler, backend autosave'i BAĞIMSIZ olarak REDDEDER (403)", async () => {
    test.setTimeout(45_000);
    const { pageId } = await createTemplatePage("autosave-bypass", [
      { id: "qa-3-root", type: "container", settings: col, children: [heading("qa-3-heading", "Autosave Başlığı")] },
    ]);
    try {
      await standardPage.goto(`/admin/pages/${pageId}`);
      await expect(standardPage.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
      await standardPage.waitForTimeout(500);

      let injectedAutosaveStatus: number | null = null;
      let injectedAutosaveCount = 0;
      // §10.20/§3.5 mimari uyarısı — UI standart kullanıcıya yapısal kontrol HİÇ SUNMADIĞI için
      // (yukarıdaki DOM iddiaları, test 1b) gerçek bir tıklamayla yapısal fark üretmek MÜMKÜN
      // DEĞİL (by construction). Bu yüzden GERÇEK debounce/autosave döngüsünün ürettiği GERÇEK
      // isteğin GÖVDESİNE yapısal bir fark enjekte edilir (mimar dokümanı §6.6 madde 3'ün izin
      // verdiği ikinci yol) — istek yine GERÇEK sunucuya, GERÇEK ağ üzerinden gider.
      await standardPage.route(`**/admin/pages/${pageId}/autosave`, async (route) => {
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

      const headingField = standardPage.getByLabel("Başlık metni");
      await headingField.fill("Autosave icin sadece metin degisikligi");

      await expect.poll(() => injectedAutosaveCount, { timeout: 8_000 }).toBeGreaterThan(0);
      await expect.poll(() => injectedAutosaveStatus, { timeout: 5_000 }).toBe(403);

      // Enjekte edilen yapısal fark REDDEDİLDİ — DB'de hâlâ TEK çocuk var, YAZILMADI.
      const afterReject = await getPage(adminToken, pageId);
      const rootAfterReject = (afterReject.blocks as Array<{ children: unknown[] }>)[0];
      expect(rootAfterReject.children).toHaveLength(1);

      // Kontrol — autosave GENEL olarak bozuk DEĞİL: interceptor kaldırılınca GERÇEK (enjeksiyonsuz)
      // bir içerik değişikliği normal şekilde kalıcı olur.
      await standardPage.unroute(`**/admin/pages/${pageId}/autosave`);
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

  test("4) Gelişmiş EDITOR: aynı türde bir şablon sayfada tam serbestlik — BuilderCanvas görünür, konteyner ekleyip kaydedebilir", async () => {
    test.setTimeout(45_000);
    const { pageId } = await createTemplatePage("advanced-freedom", [
      { id: "qa-4-root", type: "container", settings: col, children: [heading("qa-4-heading", "Gelişmiş Kullanıcı Başlığı")] },
    ]);
    try {
      await advancedPage.goto(`/admin/pages/${pageId}`);
      await expect(advancedPage.getByRole("heading", { name: "İçerik blokları" })).toBeVisible({ timeout: 15_000 });
      await advancedPage.waitForTimeout(500);

      // Gelişmiş kullanıcı kanıtı — BuilderCanvas GERÇEKTEN mount edilmiş (standart moddaki
      // TemplateEditorView DEĞİL): mevcut konteynerin sürükle tutamacı + "Konteyner ayarları" görünür.
      await expect(advancedPage.locator('button[aria-label^="Sürükle: "]')).toHaveCount(2); // konteyner + başlık
      await expect(advancedPage.locator('button[aria-label="Konteyner ayarları"]')).toHaveCount(1);
      // Şablon modu göstergesi — design-notes Karar 4, YALNIZCA gelişmiş kullanıcı görür.
      // `{ exact: true }` — sayfada AYRICA "şablon modunda" alt-dizesini içeren bir `Alert` cümlesi
      // de var (design-notes Karar 4.2); tam metin eşleşmesi yalnızca sticky toolbar rozetini hedefler.
      await expect(advancedPage.getByText("Şablon Modu", { exact: true })).toBeVisible();

      // Yapısal değişiklik — mevcut konteynerin "•••" menüsünden "Alta Konteyner Ekle"
      // (`admin-page-builder-containers.spec.ts`'teki AYNI etkileşim deseni: hover, click DEĞİL —
      // `DropdownMenuSubTrigger` base-ui'de `openOnHover`).
      const moreMenuTrigger = advancedPage.locator('button[aria-label="Daha fazla işlem"]').first();
      await moreMenuTrigger.click();
      const addBelowSubTrigger = advancedPage.getByRole("menuitem", { name: "Alta Konteyner Ekle" });
      await expect(addBelowSubTrigger).toBeVisible();
      await advancedPage.mouse.move(0, 0);
      await addBelowSubTrigger.hover();
      const singleColumnTile = advancedPage.getByRole("button", { name: "Tek Sütun" });
      await expect(singleColumnTile).toBeVisible();
      await singleColumnTile.click();
      await advancedPage.keyboard.press("Escape");
      await advancedPage.keyboard.press("Escape");

      await expect(advancedPage.locator('button[aria-label="Konteyner ayarları"]')).toHaveCount(2);

      await advancedPage.getByRole("button", { name: "Kaydet", exact: true }).click();
      await expect(advancedPage.getByText("Sayfa kaydedildi.").last()).toBeVisible({ timeout: 10_000 });

      const saved = await getPage(adminToken, pageId);
      expect((saved.blocks as unknown[]).length).toBe(2); // orijinal konteyner + yeni eklenen (boş) konteyner
    } finally {
      await deletePagePermanently(adminToken, pageId);
    }
  });

  test("5) advancedBuilderEnabled kapatılınca AYNI (yenilenmemiş) access token'ın BİR SONRAKİ isteğinde kısıt ANINDA etkin olur", async () => {
    const realtimeToken = await getFixtureUserToken(REALTIME_EDITOR_EMAIL, FIXTURE_PASSWORD, "QA E2E Realtime Editor");
    const realtimeUser = await adminGetUserByEmail(adminToken, REALTIME_EDITOR_EMAIL);
    if (!realtimeUser) throw new Error("Realtime fixture kullanıcı bulunamadı.");
    await adminUpdateRole(adminToken, realtimeUser.id, "EDITOR");
    // Başlangıçta GELİŞMİŞ — ilk istek kısıtsız geçmeli (kontrol).
    const flipOn = await adminUpdateBuilderAccess(adminToken, realtimeUser.id, true);
    expect(flipOn.status).toBe(200);

    const { pageId } = await createTemplatePage("realtime-toggle", [
      { id: "qa-5-root", type: "container", settings: col, children: [heading("qa-5-heading", "Realtime Başlık")] },
    ]);
    try {
      const rootWithOneAdded = {
        id: "qa-5-root",
        type: "container",
        settings: col,
        children: [heading("qa-5-heading", "Realtime Başlık"), heading("qa-5-added-1", "Gelişmişken eklendi")],
      };
      // ADIM 1 — gelişmiş İKEN yapısal değişiklik BAŞARILI (kısıtsız kontrol).
      const before = await patchPageDirect(realtimeToken, pageId, { blocks: [rootWithOneAdded] });
      expect(before.status).toBe(200);

      // ADIM 2 — ADMIN yeteneği KAPATIR; kullanıcı OTURUMUNU YENİLEMEDİ, AYNI access token duruyor.
      const flipOff = await adminUpdateBuilderAccess(adminToken, realtimeUser.id, false);
      expect(flipOff.status).toBe(200);

      // ADIM 3 — AYNI token, BİR SONRAKİ istek — sunucu her istekte `canUseAdvancedBuilder()`'ı
      // DB'den YENİDEN hesaplar (token'a gömülü bir iddia DEĞİLDİR, §5 madde 1 bağlayıcı kural).
      const rootWithTwoAdded = JSON.parse(JSON.stringify(rootWithOneAdded));
      rootWithTwoAdded.children.push(heading("qa-5-added-2", "Kapatıldıktan sonra denendi"));
      const after = await patchPageDirect(realtimeToken, pageId, { blocks: [rootWithTwoAdded] });
      expect(after.status).toBe(403);
    } finally {
      await deletePagePermanently(adminToken, pageId);
    }
  });

  test("6) ADMIN — advancedBuilderEnabled=false olsa DAHİ şablon sayfada kısıtsızdır (§1.5)", async () => {
    const secondAdminToken = await getFixtureUserToken(SECOND_ADMIN_EMAIL, FIXTURE_PASSWORD, "QA E2E Second Admin");
    const secondAdminUser = await adminGetUserByEmail(adminToken, SECOND_ADMIN_EMAIL);
    if (!secondAdminUser) throw new Error("İkinci admin fixture kullanıcı bulunamadı.");
    await adminUpdateRole(adminToken, secondAdminUser.id, "ADMIN");

    // Yeni oluşturulan bir kullanıcı için `advancedBuilderEnabled` VARSAYILAN OLARAK zaten `false`
    // (backfill yalnızca MEVCUT ADMIN/EDITOR'ları etkiledi, §6.1 madde 2) — kanıt olması için
    // AÇIKÇA doğrulanır; bu bayrağı BİLEREK açmıyoruz (asıl iddia: ADMIN için bunun ÖNEMSİZ olması).
    const fresh = await adminGetUserByEmail(adminToken, SECOND_ADMIN_EMAIL);
    expect(fresh?.advancedBuilderEnabled).toBe(false);
    expect(fresh?.role).toBe("ADMIN");

    const { pageId } = await createTemplatePage("admin-always-advanced", [
      { id: "qa-6-root", type: "container", settings: col, children: [heading("qa-6-heading", "Admin Başlık")] },
    ]);
    try {
      const rootWithAdded = {
        id: "qa-6-root",
        type: "container",
        settings: col,
        children: [heading("qa-6-heading", "Admin Başlık"), heading("qa-6-added", "İkinci admin tarafından eklendi")],
      };
      const res = await patchPageDirect(secondAdminToken, pageId, { blocks: [rootWithAdded] });
      expect(res.status).toBe(200);

      const saved = await getPage(adminToken, pageId);
      const savedRoot = (saved.blocks as Array<{ children: unknown[] }>)[0];
      expect(savedRoot.children).toHaveLength(2);
    } finally {
      await deletePagePermanently(adminToken, pageId);
    }
  });
});
