import { test, expect } from "@playwright/test";
import { getCachedAdminSession, getNavigationConfig, updateNavigationConfig, API_BASE_URL } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";
import { deleteSpecialty } from "./support/blog-z1-fixtures";
import { snapshotSiteState, restoreSiteStateAndRevalidate, type SiteStateSnapshot } from "./support/site-state-snapshot";
// AL: PUT /admin/navigation tam degistirme yapar ve GET->PUT turu menu etiket cevirilerini dusurur; saas_e2e site kimligi (menu/altbilgi/ayarlar)
// snapshot ile korunur. Geri yukleme iki kez (ilk ve son afterAll) kayitlidir: hook siralamasindan bagimsiz olarak en son o calisir.
let siteStateGuard: SiteStateSnapshot | undefined;
test.beforeAll(() => {
  siteStateGuard = snapshotSiteState();
});
test.afterAll(async () => {
  if (siteStateGuard) await restoreSiteStateAndRevalidate(siteStateGuard);
});


/**
 * qa-agent — Paket AG e2e: alt uzmanlik (tek seviye) hiyerarsisi + admin randevu bildirimi alici ayari.
 * Veri: koşuya özgü slug'li bir üst uzmanlık + iki alt uzmanlık; geçici nav öğeleri (teardown'da orijinal nav geri yazılır);
 * alıcı ayarı teardown'da null'a (varsayılan) döner.
 */
const RUN = Date.now().toString(36);
const PARENT = { slug: `qa-ag-gastro-${RUN}`, name: `QA AG Gastro ${RUN}` };
const CHILDREN = [
  { slug: `qa-ag-esd-${RUN}`, name: `QA AG ESD ${RUN}` },
  { slug: `qa-ag-ercp-${RUN}`, name: `QA AG ERCP ${RUN}` },
];

test.use({ navigationTimeout: 120_000, actionTimeout: 20_000 });

let token = "";
let parentId = "";
const childIds: string[] = [];
let originalNav: Record<string, unknown> | null = null;

async function adminFetch(path: string, init: RequestInit = {}) {
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
}

async function createSpecialtyWithParent(input: { slug: string; name: string }, parent: string | null) {
  const res = await adminFetch("/admin/telehealth/specialties", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      slug: input.slug,
      icon: "Stethoscope",
      parentId: parent,
      translations: { en: { name: input.name } },
    }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { data: { id: string } }).data.id;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  token = (await getCachedAdminSession()).accessToken;
  parentId = await createSpecialtyWithParent(PARENT, null);
  for (const c of CHILDREN) childIds.push(await createSpecialtyWithParent(c, parentId));

  originalNav = (await getNavigationConfig(token)) as Record<string, unknown>;
  const items = (originalNav.navigationItems as Array<Record<string, unknown>>) ?? [];
  const rootId = crypto.randomUUID();
  const withMenu = [
    ...items,
    { id: rootId, label: "AG Specialties", href: "/specialties", order: items.length, parentId: null },
    { id: crypto.randomUUID(), label: PARENT.name, href: `/specialties/${PARENT.slug}`, order: 0, parentId: rootId },
    ...CHILDREN.map((c, i) => ({ id: crypto.randomUUID(), label: c.name, href: `/specialties/${c.slug}`, order: i + 1, parentId: rootId })),
  ];
  await updateNavigationConfig(token, { ...originalNav, navigationItems: withMenu });
});

test.afterAll(async () => {
  if (originalNav) await updateNavigationConfig(token, originalNav).catch(() => undefined);
  for (const id of childIds) await deleteSpecialty(token, id).catch(() => undefined);
  if (parentId) await deleteSpecialty(token, parentId).catch(() => undefined);
  await adminFetch("/admin/settings", { method: "PATCH", body: JSON.stringify({ bookingNotificationRecipients: null }) }).catch(() => undefined);
});

test("API: alt uzmanlik parentId/parentSlug ve ust uzmanlik children doner", async () => {
  const list = await (await fetch(`${API_BASE_URL}/specialties`)).json();
  const child = (list.data as Array<{ slug: string; parentId: string | null; parentSlug: string | null }>).find((s) => s.slug === CHILDREN[0]!.slug);
  expect(child?.parentId).toBe(parentId);
  expect(child?.parentSlug).toBe(PARENT.slug);
  const detail = await (await fetch(`${API_BASE_URL}/specialties/${PARENT.slug}`)).json();
  expect((detail.data.children as Array<{ slug: string }>).map((c) => c.slug).sort()).toEqual(CHILDREN.map((c) => c.slug).sort());
});

test("admin API: alt uzmanligin altina alt uzmanlik 422 (tek seviye)", async () => {
  const res = await adminFetch("/admin/telehealth/specialties", {
    method: "POST",
    body: JSON.stringify({ name: "QA AG Deep", slug: `qa-ag-deep-${RUN}`, icon: "Stethoscope", parentId: childIds[0] }),
  });
  expect(res.status).toBe(422);
});

test("alt uzmanlik sayfasi: breadcrumb + BreadcrumbList JSON-LD + MedicalSpecialty korunur", async ({ page }) => {
  await expect(async () => {
    await page.goto(`/en/specialties/${CHILDREN[0]!.slug}`);
    await expect(page.getByRole("navigation", { name: /breadcrumb/i }).getByText(PARENT.name)).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000, intervals: [2_000, 5_000] });

  const crumbs = page.getByRole("navigation", { name: /breadcrumb/i });
  await expect(crumbs.getByRole("link", { name: PARENT.name })).toHaveAttribute("href", new RegExp(`/specialties/${PARENT.slug}$`));
  await expect(crumbs).toContainText(CHILDREN[0]!.name);

  const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t) as Record<string, unknown>);
  expect(ld.some((o) => o["@type"] === "MedicalSpecialty")).toBe(true);
  const bl = ld.find((o) => o["@type"] === "BreadcrumbList") as { itemListElement: Array<{ position: number; name: string }> } | undefined;
  expect(bl).toBeTruthy();
  expect(bl!.itemListElement.map((i) => i.name)).toEqual(["Health Tourism Services", PARENT.name, CHILDREN[0]!.name]); // AL: AH sonrası "Specialties" kök adı "Health Tourism Services" oldu
});

test("ust uzmanlik sayfasi: Procedures bolumu alt uzmanliklara baglanir; uzmanliklar listesinde yalniz ust", async ({ page }) => {
  await expect(async () => {
    await page.goto(`/en/specialties/${PARENT.slug}`);
    await expect(page.getByRole("heading", { name: "Procedures" })).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000, intervals: [2_000, 5_000] });
  for (const c of CHILDREN) await expect(page.locator(`a[href$="/specialties/${c.slug}"]`).first()).toBeVisible();

  // Liste önbelleği (60 sn revalidate) bayat olabilir: yeni üst uzmanlık görünene kadar yeniden yükle.
  await expect(async () => {
    await page.goto("/en/specialties");
    await expect(page.locator(`a[href$="/specialties/${PARENT.slug}"]`).first()).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000, intervals: [2_000, 5_000] });
  // AL: AI sonrası /specialties gruplu sayfadır; alt bölümler ayrı kart değil, üst bölümün grubunda tek bağlantı olarak listelenir.
  for (const c of CHILDREN) await expect(page.locator(`main a[href$="/specialties/${c.slug}"]`)).toHaveCount(1);
});

test("header menusu: alt uzmanliklar ayri kart degil, 'Procedures:' satirinda gruplanir", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(async () => {
    await page.goto("/en");
    await page.locator("header button", { hasText: /^AG Specialties$/ }).click({ timeout: 5_000 });
    await expect(page.getByText(PARENT.name).first()).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000, intervals: [2_000, 5_000] });
  const proc = page.locator("[data-testid='nav-procedures'], :text('Procedures:')").first();
  await expect(proc).toBeVisible();
  for (const c of CHILDREN) {
    const links = page.locator(`a[href$="/specialties/${c.slug}"]`);
    await expect(links).toHaveCount(1); // tek bağlantı: üst kartın Procedures satırında
  }
});

test("admin Ayarlar: randevu bildirimi alicilari kaydedilir (gecersiz adres reddedilir)", async ({ browser }) => {
  const bad = await adminFetch("/admin/settings", { method: "PATCH", body: JSON.stringify({ bookingNotificationRecipients: "ok@example.com, not-an-email" }) });
  expect(bad.status).toBe(422);

  // AL: ziyaretçi/giriş sayfası artık yalnız İngilizce (Türkçe kapalı); yönetici oturumu ortak yardımcıyla açılır.
  const { page, close } = await createAuthenticatedPage(browser);
  try {
    await page.goto("/admin/settings");
    const field = page.getByLabel("Alıcı e-posta adresleri");
    await expect(field).toBeVisible({ timeout: 60_000 });
    await expect(field).toHaveAttribute("placeholder", /admin@wmhealthistanbul\.com/);
    await field.fill("qa-ag-1@example.com, QA-AG-2@example.com");
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expect(async () => {
      const res = await adminFetch("/admin/settings");
      const body = (await res.json()) as { data: { bookingNotificationRecipientsEffective: string[] } };
      expect(body.data.bookingNotificationRecipientsEffective).toEqual(["qa-ag-1@example.com", "qa-ag-2@example.com"]);
    }).toPass({ timeout: 15_000 });
  } finally {
    await close();
  }
});

test.afterAll(async () => {
  if (siteStateGuard) await restoreSiteStateAndRevalidate(siteStateGuard);
});
