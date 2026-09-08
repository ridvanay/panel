import { test, expect } from "@playwright/test";
import crypto from "node:crypto";
import path from "node:path";
import { getCachedAdminSession, getNavigationConfig, updateNavigationConfig } from "./support/api";

/**
 * qa-agent — `.claude/architect-scope-navigation-deep-nesting.md` §5: storefront'ta 4 seviyeli
 * (`Ana Menü → Kategori → Alt Kategori → Ürün Grubu`) bir navigasyon dalının, masaüstü nested
 * flyout (`site-header.tsx::NavMenuItems`, `DropdownMenuSub`/`SubTrigger`/`SubContent`)
 * ile en son (4.) seviyeye kadar açılıp doğru sayfaya yönlendirdiğini doğrular.
 *
 * Kök tetikleyici TIKLAMA ile açılır (`DropdownMenuTrigger` — `openOnHover` YOK); 2./3. seviye
 * alt-menüler HOVER-INTENT ile açılır (`DropdownMenuSubTrigger openOnHover delay={150}` — bkz.
 * `frontend/tests/unit/site-header-nested-nav.test.tsx` "3 seviyeli..." testindeki AYNI etkileşim
 * deseni, oradaki `user.hover()` + `findByRole(..., {timeout:2000})` karşılığı).
 *
 * `[[project_revalidate_60s_staleness]]`: `GET /navigation` `next: { revalidate: 60 }` ile
 * önbelleklenir (`frontend/src/lib/api/server-navigation.ts`). `PUT /admin/navigation` best-effort
 * `triggerGlobalRevalidation()` tetikler (bkz. `navigation.routes.ts`) — bu GENELLİKLE anlık
 * yansımayı sağlar (`admin-appearance-instant-revalidation.spec.ts`teki TEK `reload()` deseniyle
 * AYNI mekanizma), ANCAK e2e ortamında `E2E_REVALIDATE_SECRET` eşleşmesine bağlı (bkz.
 * `playwright.config.ts` başlığındaki qa-agent notu) — best-effort başarısız olursa (sessizce
 * `warn` loglanır) 60sn'lik doğal önbellek süresine düşülür. Bu yüzden görev tanımı gereği TEK
 * `reload()` yerine `toPass` + poll kullanılır (kırılgan/flaky bir "tek reload yeter" varsayımı
 * YAPILMAZ).
 */
test.describe.configure({ timeout: 120_000, retries: 0 });

interface NavItemDto {
  id: string;
  label: string;
  href: string;
  order: number;
  parentId: string | null;
}
interface NavConfigDto {
  headerCtaLabel: string | null;
  headerCtaHref: string | null;
  footerCopyrightText: string | null;
  navigationItems: NavItemDto[];
  socialLinks: { id: string; platform: string; url: string; order: number }[];
  footerColumns: { id: string; title: string; order: number; links: { id: string; label: string; href: string; order: number }[] }[];
}

let adminToken: string;
let originalConfig: NavConfigDto;

test.beforeAll(async () => {
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  originalConfig = (await getNavigationConfig(adminToken)) as unknown as NavConfigDto;
});

test.afterAll(async () => {
  if (adminToken && originalConfig) {
    await updateNavigationConfig(adminToken, buildNavPutPayload(originalConfig.navigationItems, originalConfig));
  }
});

function buildNavPutPayload(items: NavItemDto[], base: NavConfigDto) {
  return {
    headerCtaLabel: base.headerCtaLabel,
    headerCtaHref: base.headerCtaHref,
    footerCopyrightText: base.footerCopyrightText,
    navigationItems: items.map((item) => ({
      id: item.id,
      label: item.label,
      href: item.href,
      order: item.order,
      parentId: item.parentId,
    })),
    socialLinks: base.socialLinks.map((link) => ({ platform: link.platform, url: link.url, order: link.order })),
    footerColumns: base.footerColumns.map((column) => ({
      title: column.title,
      order: column.order,
      links: column.links.map((link) => ({ label: link.label, href: link.href, order: link.order })),
    })),
  };
}

test("4 seviyeli menüde: Ürünler (tıkla) → Aydınlatma (hover) → Masa Lambaları (hover) → Metal Lambalar (tıkla) doğru sayfaya gider", async ({
  page,
}) => {
  const suffix = Date.now().toString(36);
  const labels = {
    root: `QA Flyout Ürünler ${suffix}`,
    l2: `QA Flyout Aydınlatma ${suffix}`,
    l3: `QA Flyout Masa Lambaları ${suffix}`,
    l4: `QA Flyout Metal Lambalar ${suffix}`,
  };
  const hrefs = {
    root: `/qa-flyout-urunler-${suffix}`,
    l2: `/qa-flyout-urunler-${suffix}/aydinlatma`,
    l3: `/qa-flyout-urunler-${suffix}/aydinlatma/masa-lambalari`,
    l4: `/qa-flyout-urunler-${suffix}/aydinlatma/masa-lambalari/metal-lambalar`,
  };

  const idRoot = crypto.randomUUID();
  const idL2 = crypto.randomUUID();
  const idL3 = crypto.randomUUID();
  const idL4 = crypto.randomUUID();
  const items: NavItemDto[] = [
    { id: idRoot, label: labels.root, href: hrefs.root, order: 0, parentId: null },
    { id: idL2, label: labels.l2, href: hrefs.l2, order: 0, parentId: idRoot },
    { id: idL3, label: labels.l3, href: hrefs.l3, order: 0, parentId: idL2 },
    { id: idL4, label: labels.l4, href: hrefs.l4, order: 0, parentId: idL3 },
  ];
  await updateNavigationConfig(adminToken, buildNavPutPayload(items, originalConfig));

  await page.setViewportSize({ width: 1280, height: 900 });

  // Public GET /navigation eventual-consistency toleransı — kök tetikleyici görünene kadar
  // reload'la POLL et (tek seferlik `reload()` varsayımı YOK, bkz. dosya başlığı).
  await expect(async () => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: labels.root, exact: true })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 90_000, intervals: [3_000] });

  // 1. seviye: kök tetikleyici TIKLAMA ile açılır (openOnHover YOK, bkz. dosya başlığı).
  await page.getByRole("button", { name: labels.root, exact: true }).click();
  const level2Trigger = page.getByRole("menuitem", { name: labels.l2, exact: true });
  await expect(level2Trigger).toBeVisible({ timeout: 5_000 });
  await expect(level2Trigger).toHaveAttribute("aria-haspopup");

  // 2. seviye: hover-intent (150ms gecikme) ile 3. seviye flyout'u açar.
  await level2Trigger.hover();
  const level3Trigger = page.getByRole("menuitem", { name: labels.l3, exact: true });
  await expect(level3Trigger).toBeVisible({ timeout: 3_000 });
  await expect(level3Trigger).toHaveAttribute("aria-haspopup");

  // 3. seviye: hover-intent ile 4. (son, yaprak) seviyeyi açar.
  await level3Trigger.hover();
  const level4Leaf = page.getByRole("menuitem", { name: labels.l4, exact: true });
  await expect(level4Leaf).toBeVisible({ timeout: 3_000 });
  await expect(level4Leaf).toHaveAttribute("href", hrefs.l4);

  // 4. seviyeye (yaprak) tıklayınca DOĞRU sayfaya (kendi href'i) gider.
  await level4Leaf.click();
  await expect(page).toHaveURL(new RegExp(`${hrefs.l4.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
});

test("nested flyout açıkken ciddi/kritik a11y ihlali içermez (axe-core)", async ({ page }) => {
  const suffix = Date.now().toString(36) + "a11y";
  const labels = { root: `QA Flyout A11y Ürünler ${suffix}`, l2: `QA Flyout A11y Aydınlatma ${suffix}` };
  const idRoot = crypto.randomUUID();
  const idL2 = crypto.randomUUID();
  const items: NavItemDto[] = [
    { id: idRoot, label: labels.root, href: `/qa-flyout-a11y-${suffix}`, order: 0, parentId: null },
    { id: idL2, label: labels.l2, href: `/qa-flyout-a11y-${suffix}/child`, order: 0, parentId: idRoot },
  ];
  await updateNavigationConfig(adminToken, buildNavPutPayload(items, originalConfig));

  await page.setViewportSize({ width: 1280, height: 900 });

  await expect(async () => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: labels.root, exact: true })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 90_000, intervals: [3_000] });

  await page.getByRole("button", { name: labels.root, exact: true }).click();
  await expect(page.getByRole("menuitem", { name: labels.l2, exact: true })).toBeVisible({ timeout: 5_000 });

  // Proje `@axe-core/playwright` WRAPPER'ını bağımlılık olarak İÇERMİYOR (bkz. `package.json` —
  // yalnızca `jest-axe`/`axe-core` unit test tarafında var). Yeni bir npm bağımlılığı eklemek
  // code-quality-agent'ın bağımlılık politikası kapsamına girer (bu ajanın "Yapmaz" sütunu), bu
  // yüzden zaten kurulu OLAN çekirdek `axe-core` paketi (jest-axe'in transitive bağımlılığı)
  // tarayıcıya DOĞRUDAN `page.addScriptTag` ile enjekte edilip `axe.run()` çalıştırılır — ek
  // paket GEREKMEZ. `frontend-agent`'ın `site-header-nested-nav.test.tsx`teki jest-axe testinin
  // (statik jsdom render) e2e/gerçek-tarayıcı KARŞILIĞI.
  //
  // Kapsam KASITLI OLARAK `header` + AÇIK dropdown/submenu popup'larıyla SINIRLI (`.site-scope`/
  // `body` DEĞİL) — bu testin amacı YALNIZCA bu turda eklenen nested flyout'un (Base UI
  // Menu/Submenu, hover-intent, aria-haspopup zinciri) a11y regresyonu içermediğini
  // doğrulamaktır. Popup içerikleri `MenuPrimitive.Portal` ile `document.body`nin SONUNA
  // portallanır (`header`in DIŞINA) — bu yüzden `[data-slot="dropdown-menu-content"]` /
  // `[data-slot="dropdown-menu-sub-content"]` seçicileri AYRICA dahil edilir (bkz.
  // `components/ui/dropdown-menu.tsx`), yoksa açık flyout'un KENDİSİ taranmamış olurdu.
  // Sayfanın GERİ KALANI (ör. footer telif metni/site sloganı rengi) BAĞIMSIZ, bu özellikle
  // İLGİSİZ, ÖNCEDEN VAR OLAN renk-kontrastı sorunları taşıyabilir (qa-agent bu turda gerçekten
  // gözlemledi — bkz. final rapor) — bunları burada dahil etmek bu testi YANLIŞ AJANIN
  // (ui-designer/frontend-agent site teması) sorumluluğundaki İLGİSİZ bir regresyona karşı
  // kararsız (flaky-by-scope-creep) yapardı.
  await page.addScriptTag({ path: path.join(process.cwd(), "node_modules", "axe-core", "axe.min.js") });
  const axeResults = (await page.evaluate(() =>
    (
      window as unknown as {
        axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: Array<{ id: string; impact: string | null; nodes: unknown[] }> }> };
      }
    ).axe.run(["header", "[data-slot='dropdown-menu-content']", "[data-slot='dropdown-menu-sub-content']"], {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    })
  )) as { violations: Array<{ id: string; impact: string | null; nodes: unknown[] }> };
  const critical = axeResults.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
});
