import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession, getSiteModules, patchSiteModule, getFixtureUserToken } from "./support/api";
import { createAuthenticatedPageAs } from "./support/admin-session";
import { resetFixtureUserToBaseline, adminGetUserByEmail, adminUpdateRole } from "./support/admin-users-fixtures";
import { ensureTelehealthModuleWithDoctors, listAdminAppointmentsRaw } from "./support/telehealth-fixtures";

/**
 * qa-agent — `.claude/architect-scope-telehealth-template.md` §8.4/§10 (QA kapsamı) madde 12 +
 * `.claude/architect-scope-rbac-5-tier.md` §8.2 (sidebar görünürlük tablosu). Hasta PII'si taşıyan
 * `/admin/telehealth/appointments` ucu bilinçli olarak `requirePanelAccess()` (ADMIN|MANAGER|EDITOR)
 * DEĞİL, daha dar `requireSiteRole(ADMIN, MANAGER)` kullanır (bkz. `telehealth.admin.routes.ts`) —
 * EDITOR bu turda AÇIKÇA DIŞLANIR. Bu dosya hem sidebar GÖRÜNÜRLÜĞÜNÜ (kullanılabilirlik) hem
 * backend'in BAĞIMSIZ kararını (güvenlik sınırı, doğrudan URL/API ile de test edilir — sidebar'da
 * gizli olması TEK BAŞINA yeterli DEĞİLDİR) gerçek tarayıcı + gerçek backend üzerinden doğrular.
 *
 * `admin-page-editor-roles.spec.ts` İLE AYNI desen: dosya başına BİR context/login (refresh-token
 * rotasyonu riski, bkz. `support/admin-session.ts` başlığı), çalıştırma-başına-benzersiz e-postalı
 * fixture kullanıcılar (`POST /auth/register`'ın HER ZAMAN 201 dönmesi için, login kotasına
 * dokunulmaz), roller UI login'den ÖNCE kesinleştirilir.
 *
 * `telehealth-template-import.spec.ts`'ten BAĞIMSIZ çalışır — `ensureTelehealthModuleWithDoctors()`
 * (bkz. `support/telehealth-fixtures.ts`) GERÇEK importer'ı kullanarak modülün açık olduğunu garanti
 * eder (kapalıyken hem sidebar item'ı hem sayfanın kendisi 404 döner — RBAC farkı hiç gözlemlenemez).
 */
test.describe.configure({ mode: "serial" });

const FIXTURE_PASSWORD = "QaE2eTelehealthRbac12345!";
const RUN_SUFFIX = Date.now().toString(36);
const EDITOR_EMAIL = `qa-e2e-telehealth-rbac-editor-${RUN_SUFFIX}@example.com`;
const MANAGER_EMAIL = `qa-e2e-telehealth-rbac-manager-${RUN_SUFFIX}@example.com`;

let adminToken: string;
let initialTelehealthEnabled: boolean;
let editorApiToken: string;
let managerApiToken: string;
let editorPage: Page;
let closeEditorSession: () => Promise<void>;
let managerPage: Page;
let closeManagerSession: () => Promise<void>;

/**
 * qa-agent bulgusu — `getByRole("link", { name })` bu sayfalarda BİRDEN FAZLA elemanla eşleşiyor
 * (ör. `/admin/telehealth/doctors` sayfasının kendi içeriğinde de "Uzmanlıklar" adlı bir aksiyon
 * linki/kartı var). Gerçek sidebar menü linkleri `ui/sidebar.tsx::SidebarMenuButton`'ın DAİMA
 * eklediği `data-slot="sidebar-menu-button"` özniteliğiyle işaretlidir — bu, sidebar'ın kendisi bir
 * `<nav>`/`role="navigation"` landmark'ı KULLANMADIĞI için (bkz. yukarıdaki dosya başlığı) en
 * güvenilir kapsam belirleyicidir.
 */
function sidebarLink(page: Page, name: string) {
  return page.locator('[data-slot="sidebar-menu-button"]').filter({ hasText: name });
}

async function cleanupFixtures() {
  await resetFixtureUserToBaseline(adminToken, EDITOR_EMAIL);
  await resetFixtureUserToBaseline(adminToken, MANAGER_EMAIL);
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(120_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  await cleanupFixtures();

  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  await ensureTelehealthModuleWithDoctors(adminToken);

  // TEK çağrı hem oluşturur (idempotent, `registerFixtureUser` başlığı) HEM API token'ını döner.
  editorApiToken = await getFixtureUserToken(EDITOR_EMAIL, FIXTURE_PASSWORD, "QA E2E Telehealth RBAC Editor");
  managerApiToken = await getFixtureUserToken(MANAGER_EMAIL, FIXTURE_PASSWORD, "QA E2E Telehealth RBAC Manager");

  const editorUser = await adminGetUserByEmail(adminToken, EDITOR_EMAIL);
  const managerUser = await adminGetUserByEmail(adminToken, MANAGER_EMAIL);
  if (!editorUser || !managerUser) throw new Error("Fixture kullanıcılar oluşturulamadı.");

  await adminUpdateRole(adminToken, editorUser.id, "EDITOR");
  await adminUpdateRole(adminToken, managerUser.id, "MANAGER");

  // UI login'ler roller KESİNLEŞTİKTEN SONRA yapılır (bkz. `support/admin-session.ts` başlığı).
  ({ page: editorPage, close: closeEditorSession } = await createAuthenticatedPageAs(browser, EDITOR_EMAIL, FIXTURE_PASSWORD));
  ({ page: managerPage, close: closeManagerSession } = await createAuthenticatedPageAs(browser, MANAGER_EMAIL, FIXTURE_PASSWORD));
});

test.afterAll(async () => {
  if (closeEditorSession) await closeEditorSession();
  if (closeManagerSession) await closeManagerSession();
  await cleanupFixtures();
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

test("madde 12a: EDITOR — sidebar'da 'Randevular' HİÇ görünmez (Tele-Sağlık/Uzmanlıklar salt-okunur GÖRÜNÜR — §8.4 farkı)", async () => {
  // `/admin/telehealth/doctors` EDITOR'e açık salt-okunur bir sayfadır (§5.1) — sidebar'ı görmek
  // için nötr bir iniş noktası.
  await editorPage.goto("/admin/telehealth/doctors");
  await expect(sidebarLink(editorPage, "Tele-Sağlık")).toBeVisible();
  await expect(sidebarLink(editorPage, "Uzmanlıklar")).toBeVisible();
  await expect(sidebarLink(editorPage, "Randevular")).toHaveCount(0);
});

test("madde 12b: EDITOR — doğrudan URL ile /admin/telehealth/appointments'a gidince backend BAĞIMSIZ olarak 403 verir", async () => {
  await editorPage.goto("/admin/telehealth/appointments");
  await expect(editorPage.getByRole("heading", { name: "Randevular" })).toBeVisible({ timeout: 15_000 });
  await expect(editorPage.getByText("Bu işlem için yetkiniz yok.", { exact: false })).toBeVisible({ timeout: 15_000 });
  // Sidebar'da gizlemenin GÜVENLİK sınırı OLMADIĞININ kanıtı — sayfa hasta PII'sini HİÇ render etmez.
  await expect(editorPage.locator("table")).toHaveCount(0);

  const apiRes = await listAdminAppointmentsRaw(editorApiToken);
  expect(apiRes.status).toBe(403);
});

test("madde 12c: MANAGER — sidebar'da 'Randevular' GÖRÜNÜR ve sayfa başarıyla yüklenir (hasta PII erişimi VAR)", async () => {
  await managerPage.goto("/admin/telehealth/appointments");
  await expect(sidebarLink(managerPage, "Randevular")).toBeVisible();

  await expect(managerPage.getByRole("heading", { name: "Randevular" })).toBeVisible({ timeout: 15_000 });
  await expect(managerPage.getByText("Bu işlem için yetkiniz yok.", { exact: false })).toHaveCount(0);
  // Ya boş-durum ya da tablo görünür — ikisi de "403 DEĞİL" kanıtıdır.
  await expect(managerPage.getByText("Henüz randevu yok").or(managerPage.locator("table"))).toBeVisible({ timeout: 15_000 });

  const apiRes = await listAdminAppointmentsRaw(managerApiToken);
  expect(apiRes.status).toBe(200);
});
