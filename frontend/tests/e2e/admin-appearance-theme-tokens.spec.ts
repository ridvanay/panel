import { test, expect, type Page } from "@playwright/test";
import { API_BASE_URL, getAdminAppearance, getCachedAdminSession, patchAppearance } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";

/**
 * qa-agent — `.claude/architect-scope-theme-typography.md` (Global Tema & Tipografi Yöneticisi
 * genişlemesi) için e2e kapsamı. Bu görevin yeni 7 alanı (`accentColor`, `backgroundColor`,
 * `surfaceColor`, `textColor`, `mutedTextColor`, `borderRadius`, `buttonStyle`) zaten
 * `backend/tests/integration/appearance.test.ts` (RBAC + partial PATCH + public GET yansıması)
 * ve `frontend/tests/unit/admin-appearance-*.test.tsx` (form/section davranışı, a11y) tarafından
 * birim seviyesinde kapsanıyor — bu dosya SADECE gerçek tarayıcı + gerçek backend + gerçek
 * Postgres ile uçtan uca kalıcılığı VE `(site)` layout'unun `--site-*` CSS değişkenlerine doğru
 * yansımasını doğrular (`admin-locale-management.spec.ts`/`site-home-layout-parity.spec.ts` ile
 * AYNI desen — auth için kendi context'i, `revalidate: 60` önbelleği için `expect.poll`).
 *
 * NOT (auth): `admin-locale-management.spec.ts` başlığındaki AYNI gerekçeyle bu dosya kendi
 * `browser`/context'ini `support/admin-session.ts` ile kurar — dosyalar arası paylaşılan bir
 * oturum GÜVENİLİR DEĞİL (refresh-token rotasyonu).
 */
test.describe.configure({ timeout: 150_000, retries: 2 });

const FRONTEND_URL = process.env.E2E_FRONTEND_URL ?? "http://localhost:3100";
// Varsayılan `#f59e0b`'ten kolayca ayırt edilebilir, geçerli bir 6 haneli hex renk (`HexColorSchema`).
const TEST_ACCENT_COLOR = "#22c55e";

let page: Page;
let closeSession: () => Promise<void>;
let token: string;
let originalAccentColor: string;
let originalBorderRadius: string;

test.beforeAll(async ({ browser }) => {
  ({ page, close: closeSession } = await createAuthenticatedPage(browser));
  const admin = await getCachedAdminSession();
  token = admin.accessToken;
  const appearance = await getAdminAppearance(token);
  originalAccentColor = appearance.accentColor as string;
  originalBorderRadius = appearance.borderRadius as string;
});

test.afterAll(async () => {
  await patchAppearance(token, { accentColor: originalAccentColor, borderRadius: originalBorderRadius });
  await closeSession();
});

test("panelde Vurgu Rengi değiştirilip kaydedilince sayfa yenilemesinden SONRA kalıcı kalır", async () => {
  await page.goto("/admin/appearance");
  await page.getByRole("tab", { name: "Stil / Renk" }).click();

  const accentHexInput = page.getByLabel("Vurgu Rengi — hex kod");
  await expect(accentHexInput).toBeVisible();
  await accentHexInput.fill(TEST_ACCENT_COLOR);

  await page.getByRole("button", { name: "Bu bölümü kaydet" }).click();
  await expect(page.getByText("Değişiklikler kaydedildi.")).toBeVisible();

  // Sunucu tarafında da kalıcı — UI state'e değil gerçek API'ye karşı doğrulanır.
  await expect
    .poll(async () => (await getAdminAppearance(token)).accentColor, { timeout: 10_000 })
    .toBe(TEST_ACCENT_COLOR.toLowerCase());

  await page.reload();
  await page.getByRole("tab", { name: "Stil / Renk" }).click();
  await expect(page.getByLabel("Vurgu Rengi — hex kod")).toHaveValue(TEST_ACCENT_COLOR.toLowerCase());
});

test("Köşe Yuvarlaklığı radyo grubu ile buttonStyle DEĞİŞMEDEN sadece borderRadius güncellenir", async () => {
  await page.goto("/admin/appearance");
  await page.getByRole("tab", { name: "Stil / Renk" }).click();

  const radiusGroup = page.locator('[role="radiogroup"][aria-label="Köşe yuvarlaklığı"]');
  await radiusGroup.getByRole("radio", { name: /Tam Yuvarlak/ }).click();
  await page.getByRole("button", { name: "Bu bölümü kaydet" }).click();
  await expect(page.getByText("Değişiklikler kaydedildi.")).toBeVisible();

  await expect
    .poll(async () => (await getAdminAppearance(token)).borderRadius, { timeout: 10_000 })
    .toBe("FULL");
});

test("public GET /appearance ve (site) layout'un --site-* CSS değişkenleri yeni tema token'larını yansıtır", async ({
  page: publicPage,
}) => {
  // Tüm 7 yeni alanı tek PATCH'te değiştirip hem public GET'i hem gerçek DOM render'ını doğrular.
  const patch = {
    accentColor: "#0ea5e9",
    backgroundColor: "#fafaf9",
    surfaceColor: "#f5f5f4",
    textColor: "#1c1917",
    mutedTextColor: "#78716c",
    borderRadius: "SM" as const,
    buttonStyle: "OUTLINE" as const,
  };
  await patchAppearance(token, patch);

  // Public API sözleşmesi — kontrat testleri backend tarafında zaten var, burada sadece bu
  // ÇALIŞAN sürecin aynı değerleri döndürdüğü doğrulanır (regresyon tripwire'ı).
  const publicRes = await fetch(`${API_BASE_URL}/appearance`);
  const publicData = (await publicRes.json()).data as Record<string, unknown>;
  expect(publicData.accentColor).toBe(patch.accentColor);
  expect(publicData.backgroundColor).toBe(patch.backgroundColor);
  expect(publicData.surfaceColor).toBe(patch.surfaceColor);
  expect(publicData.textColor).toBe(patch.textColor);
  expect(publicData.mutedTextColor).toBe(patch.mutedTextColor);
  expect(publicData.borderRadius).toBe(patch.borderRadius);
  expect(publicData.buttonStyle).toBe(patch.buttonStyle);

  // `(site)/layout.tsx` `revalidate: 60` önbelleklidir (bkz. `admin-locale-management.spec.ts`/
  // `site-home-layout-parity.spec.ts`'teki AYNI desen) — anlık değil, eventual consistency.
  await expect
    .poll(async () => (await fetch(`${FRONTEND_URL}/`)).text(), { timeout: 90_000, intervals: [2_000] })
    .toContain(patch.accentColor);

  await publicPage.goto("/");
  const siteScope = publicPage.locator(".site-scope");
  await expect(siteScope).toBeVisible();
  const cssVars = await siteScope.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      accent: style.getPropertyValue("--site-accent").trim(),
      background: style.getPropertyValue("--site-background").trim(),
      surface: style.getPropertyValue("--site-surface").trim(),
      text: style.getPropertyValue("--site-text").trim(),
      mutedText: style.getPropertyValue("--site-muted-text").trim(),
      radius: style.getPropertyValue("--site-radius").trim(),
    };
  });
  expect(cssVars.accent).toBe(patch.accentColor);
  expect(cssVars.background).toBe(patch.backgroundColor);
  expect(cssVars.surface).toBe(patch.surfaceColor);
  expect(cssVars.text).toBe(patch.textColor);
  expect(cssVars.mutedText).toBe(patch.mutedTextColor);
  // `SITE_BORDER_RADIUS_PX.SM` (architect'in enum→px map'i, `.claude/architect-scope-theme-
  // typography.md`) — "SM" -> "4px".
  expect(cssVars.radius).toBe("4px");
});
