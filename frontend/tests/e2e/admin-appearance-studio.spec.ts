import { test, expect, type Page } from "@playwright/test";
import { API_BASE_URL, getAdminAppearance, getCachedAdminSession, patchAppearance } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";

/**
 * qa-agent — "tasarım stüdyosu" genişlemesi (kurumsal renk paletleri `CORPORATE_COLOR_PALETTES`,
 * font eşleşmeleri `FONT_PAIRINGS`, 4 sayfa başlığı şablonu `pageHeaderLayout`) için e2e kapsamı.
 * `admin-appearance-theme-tokens.spec.ts` İLE AYNI desen (kendi context'i, gerçek backend/Postgres,
 * `revalidate: 60` önbelleği için `expect.poll`) — o dosya 7 alanlık tema token genişlemesini
 * doğruluyordu, bu dosya SADECE bu turun YENİ UI'sini (kartlara TIKLAMA → form alanlarının
 * DOLMASI → kayıt → sayfa yenileme sonrası KALICILIK → gerçek `(site)` sayfasına yansıma) kapsar.
 *
 * NOT (auth): AYNI gerekçeyle (`support/admin-session.ts` başlığı — refresh-token rotasyonu +
 * biriken navigasyon riski) bu dosya da kendi `browser`/context'ini `beforeAll`'da BİR KEZ kurar.
 */
test.describe.configure({ timeout: 150_000, retries: 2 });

const FRONTEND_URL = process.env.E2E_FRONTEND_URL ?? "http://localhost:3100";

/** `corporate-palettes.ts`'teki "Zümrüt Kurumsal" (emerald-corporate) — varsayılan "Modern Indigo"dan
 * (`DEFAULT_APPEARANCE.primaryColor === "#4f46e5"`, kurumsal paletlerin İLKİYLE birebir aynı) kolayca
 * ayırt edilebilir, farklı bir palet seçildi (regresyon: değişikliğin GERÇEKTEN uygulandığını kanıtlamak
 * için mevcut değerle çakışmaması gerekir). Değerler `corporate-palettes.ts`'ten AYNEN kopyalandı.
 */
const TEST_PALETTE = {
  label: "Zümrüt Kurumsal",
  values: {
    primaryColor: "#065f46",
    secondaryColor: "#022c22",
    buttonColor: "#065f46",
    buttonTextColor: "#ffffff",
    linkColor: "#047857",
    accentColor: "#34d399",
    backgroundColor: "#ffffff",
    surfaceColor: "#ecfdf5",
    textColor: "#022c22",
    mutedTextColor: "#6b7280",
  },
};

/** `font-pairings.ts`'teki "Klasik Kurumsal" (classic-corporate) — varsayılan `SYSTEM`/`SYSTEM`'dan
 * (`DEFAULT_APPEARANCE.headingFont`/`bodyFont`) kolayca ayırt edilebilir. */
const TEST_FONT_PAIRING = {
  label: "Klasik Kurumsal",
  headingFont: "PLAYFAIR_DISPLAY",
  bodyFont: "SOURCE_SERIF_4",
  headingFontLabel: "Playfair Display",
  bodyFontLabel: "Source Serif 4",
  // `--site-heading-font`/`--site-body-font`, next/font'un ürettiği `--font-site-xxx` custom
  // property'sine `var(...)` ile atıfta bulunur (bkz. `site-fonts.ts`); tarayıcı
  // `getComputedStyle` ÜZERİNDEN bu zinciri TAMAMEN çözümleyip next/font'un tanımladığı gerçek
  // font-family + fallback string'ini döner (ampirik olarak doğrulandı — `var(...)` literal metni
  // DEĞİL, çözümlenmiş değer görünür).
  headingResolvedFontFamily: '"Playfair Display", "Playfair Display Fallback"',
  bodyResolvedFontFamily: '"Source Serif 4", "Source Serif 4 Fallback"',
};

const COLOR_FIELD_LABELS: Record<keyof typeof TEST_PALETTE.values, string> = {
  primaryColor: "Birincil Renk",
  secondaryColor: "İkincil Renk",
  buttonColor: "Buton Zemini",
  buttonTextColor: "Buton Metni",
  linkColor: "Bağlantı Rengi",
  accentColor: "Vurgu Rengi",
  backgroundColor: "Sayfa Zemini",
  surfaceColor: "Yüzey / Kart Zemini",
  textColor: "Başlık Metni",
  mutedTextColor: "Gövde Metni",
};

function hexInput(page: Page, fieldLabel: string) {
  return page.getByLabel(`${fieldLabel} — hex kod`);
}

let page: Page;
let closeSession: () => Promise<void>;
let token: string;
let original: Record<string, unknown>;

test.beforeAll(async ({ browser }) => {
  ({ page, close: closeSession } = await createAuthenticatedPage(browser));
  const admin = await getCachedAdminSession();
  token = admin.accessToken;
  original = await getAdminAppearance(token);
});

test.afterAll(async () => {
  await patchAppearance(token, {
    primaryColor: original.primaryColor,
    secondaryColor: original.secondaryColor,
    buttonColor: original.buttonColor,
    buttonTextColor: original.buttonTextColor,
    linkColor: original.linkColor,
    accentColor: original.accentColor,
    backgroundColor: original.backgroundColor,
    surfaceColor: original.surfaceColor,
    textColor: original.textColor,
    mutedTextColor: original.mutedTextColor,
    headingFont: original.headingFont,
    bodyFont: original.bodyFont,
    presetKey: original.presetKey,
    pageHeaderStyle: original.pageHeaderStyle,
    pageHeaderLayout: original.pageHeaderLayout,
  });
  await closeSession();
});

test("colors sekmesinde kurumsal palet kartına tıklayınca 10 renk alanı doldurulur, kaydedilir ve yenilemeden SONRA kalıcı kalır", async () => {
  await page.goto("/admin/appearance");
  await page.getByRole("tab", { name: "Stil / Renk" }).click();

  const paletteGroup = page.locator('[role="radiogroup"][aria-label="Kurumsal renk paleti"]');
  await paletteGroup.getByRole("radio", { name: TEST_PALETTE.label }).click();

  for (const [field, hex] of Object.entries(TEST_PALETTE.values)) {
    await expect(hexInput(page, COLOR_FIELD_LABELS[field as keyof typeof TEST_PALETTE.values])).toHaveValue(hex);
  }

  await page.getByRole("button", { name: "Bu bölümü kaydet" }).click();
  await expect(page.getByText("Değişiklikler kaydedildi.")).toBeVisible();

  // Sunucu tarafında da kalıcı — UI state'e değil gerçek API'ye karşı doğrulanır.
  await expect
    .poll(async () => (await getAdminAppearance(token)).primaryColor, { timeout: 10_000 })
    .toBe(TEST_PALETTE.values.primaryColor);
  expect((await getAdminAppearance(token)).accentColor).toBe(TEST_PALETTE.values.accentColor);

  await page.reload();
  await page.getByRole("tab", { name: "Stil / Renk" }).click();
  for (const [field, hex] of Object.entries(TEST_PALETTE.values)) {
    await expect(hexInput(page, COLOR_FIELD_LABELS[field as keyof typeof TEST_PALETTE.values])).toHaveValue(hex);
  }
});

test("typography sekmesinde font eşleşme kartına tıklayınca başlık/gövde fontu değişir, kaydedilir ve yenilemeden SONRA kalıcı kalır", async () => {
  await page.goto("/admin/appearance");
  await page.getByRole("tab", { name: "Yazı Tipi" }).click();

  await page.getByRole("radio", { name: new RegExp(TEST_FONT_PAIRING.label) }).click();

  const headingGroup = page.locator('[role="radiogroup"][aria-label="Başlık fontu"]');
  const bodyGroup = page.locator('[role="radiogroup"][aria-label="Gövde fontu"]');
  await expect(headingGroup.getByRole("radio", { name: new RegExp(TEST_FONT_PAIRING.headingFontLabel) })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  await expect(bodyGroup.getByRole("radio", { name: new RegExp(TEST_FONT_PAIRING.bodyFontLabel) })).toHaveAttribute(
    "aria-checked",
    "true"
  );

  await page.getByRole("button", { name: "Bu bölümü kaydet" }).click();
  await expect(page.getByText("Değişiklikler kaydedildi.")).toBeVisible();

  await expect
    .poll(async () => (await getAdminAppearance(token)).headingFont, { timeout: 10_000 })
    .toBe(TEST_FONT_PAIRING.headingFont);
  expect((await getAdminAppearance(token)).bodyFont).toBe(TEST_FONT_PAIRING.bodyFont);

  await page.reload();
  await page.getByRole("tab", { name: "Yazı Tipi" }).click();
  await expect(
    page
      .locator('[role="radiogroup"][aria-label="Başlık fontu"]')
      .getByRole("radio", { name: new RegExp(TEST_FONT_PAIRING.headingFontLabel) })
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page
      .locator('[role="radiogroup"][aria-label="Gövde fontu"]')
      .getByRole("radio", { name: new RegExp(TEST_FONT_PAIRING.bodyFontLabel) })
  ).toHaveAttribute("aria-checked", "true");
});

test("kaydedilen palet public GET /appearance ve (site) layout'un --site-* CSS değişkenlerine yansır", async ({
  page: publicPage,
}) => {
  // Önceki iki testte kaydedilen (palet + font eşleşmesi) durumu — public sözleşmeye karşı doğrulanır
  // (kontrat testleri backend tarafında zaten var, burada bu ÇALIŞAN sürecin aynı değerleri
  // döndürdüğü doğrulanır — regresyon tripwire'ı, `admin-appearance-theme-tokens.spec.ts` ile AYNI desen).
  const publicRes = await fetch(`${API_BASE_URL}/appearance`);
  const publicData = (await publicRes.json()).data as Record<string, unknown>;
  for (const [field, hex] of Object.entries(TEST_PALETTE.values)) {
    expect(publicData[field]).toBe(hex);
  }
  // `headingFont`/`bodyFont`'un backend/public API sözleşmesindeki kalıcılığı — CSS render'ı
  // AŞAĞIDAKİ ayrı (bilinen hatayı belgeleyen) testte ele alınır, burada SADECE veri katmanı.
  expect(publicData.headingFont).toBe(TEST_FONT_PAIRING.headingFont);
  expect(publicData.bodyFont).toBe(TEST_FONT_PAIRING.bodyFont);

  // `(site)/layout.tsx` `revalidate: 60` önbelleklidir — anlık değil, eventual consistency.
  await expect
    .poll(async () => (await fetch(`${FRONTEND_URL}/`)).text(), { timeout: 90_000, intervals: [2_000] })
    .toContain(TEST_PALETTE.values.primaryColor);

  await publicPage.goto("/");
  const siteScope = publicPage.locator(".site-scope");
  await expect(siteScope).toBeVisible();
  const cssVars = await siteScope.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      primary: style.getPropertyValue("--site-primary").trim(),
      secondary: style.getPropertyValue("--site-secondary").trim(),
      button: style.getPropertyValue("--site-button").trim(),
      buttonText: style.getPropertyValue("--site-button-text").trim(),
      link: style.getPropertyValue("--site-link").trim(),
      accent: style.getPropertyValue("--site-accent").trim(),
      background: style.getPropertyValue("--site-background").trim(),
      surface: style.getPropertyValue("--site-surface").trim(),
      text: style.getPropertyValue("--site-text").trim(),
      mutedText: style.getPropertyValue("--site-muted-text").trim(),
    };
  });
  expect(cssVars.primary).toBe(TEST_PALETTE.values.primaryColor);
  expect(cssVars.secondary).toBe(TEST_PALETTE.values.secondaryColor);
  expect(cssVars.button).toBe(TEST_PALETTE.values.buttonColor);
  expect(cssVars.buttonText).toBe(TEST_PALETTE.values.buttonTextColor);
  expect(cssVars.link).toBe(TEST_PALETTE.values.linkColor);
  expect(cssVars.accent).toBe(TEST_PALETTE.values.accentColor);
  expect(cssVars.background).toBe(TEST_PALETTE.values.backgroundColor);
  expect(cssVars.surface).toBe(TEST_PALETTE.values.surfaceColor);
  expect(cssVars.text).toBe(TEST_PALETTE.values.textColor);
  expect(cssVars.mutedText).toBe(TEST_PALETTE.values.mutedTextColor);
});

/**
 * DÜZELTİLDİ (qa-agent bu turda bulmuştu, frontend-agent tarafından kök nedeni giderildi — bkz.
 * görev özeti) — `frontend/src/lib/site-settings/site-fonts.ts::SITE_FONT_FAMILY` ÖNCEDEN her
 * `SiteFont` değerini `var(${xxx.variable})` ile üretiyordu; bu projenin Next.js/Turbopack
 * sürümünde `.variable` KLASİK next/font davranışındaki gibi `"--font-site-xxx"` custom-property
 * adının KENDİSİni DEĞİL, hash'li bir CSS-module class token'ı döndürüyor (ör.
 * `playfair_display_ef51b57b-module__ZA5ysa__variable`, "--" ÖNEKİ YOK) — bu token `var(...)`
 * içine sarıldığında SÖZDİZİMSEL OLARAK GEÇERSİZ bir `var()` çağrısı oluşuyordu (ilk argüman "--"
 * ile BAŞLAMAK ZORUNDADIR) ve tarayıcı bildirimi sessizce atıyordu. Düzeltme: `SITE_FONT_FAMILY`
 * artık `variable:` seçeneğine verilen LİTERAL custom-property adını (`--font-site-xxx`) doğrudan
 * `var(...)` içinde referans veriyor — bu adlar `.site-scope`'a `SITE_FONT_VARIABLES` (hash'li
 * class'lar) üzerinden GERÇEKTEN tanımlanıyor. Bu test artık DOĞRU/beklenen davranışı pozitif
 * olarak doğrular (önceden `test.fail()` ile bilinçli kırmızı işaretliydi).
 */
test(
  "kaydedilen font eşleşmesi (site)/layout.tsx'in --site-heading-font/--site-body-font CSS değişkenlerine GEÇERLİ bir değer olarak yansır",
  async ({ page: publicPage }) => {
    await publicPage.goto("/");
    const siteScope = publicPage.locator(".site-scope");
    await expect(siteScope).toBeVisible();
    const cssVars = await siteScope.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        headingFont: style.getPropertyValue("--site-heading-font").trim(),
        bodyFont: style.getPropertyValue("--site-body-font").trim(),
      };
    });
    expect(cssVars.headingFont).toBe(TEST_FONT_PAIRING.headingResolvedFontFamily);
    expect(cssVars.bodyFont).toBe(TEST_FONT_PAIRING.bodyResolvedFontFamily);
  }
);

test("pageHeader: BANNER + SPLIT şablonu seçilip kaydedilince gerçek bir sayfada (/blog) SPLIT düzeni render edilir", async ({
  page: publicPage,
}) => {
  await page.goto("/admin/appearance");
  await page.getByRole("tab", { name: "Sayfa Başlığı Düzeni" }).click();

  await page
    .locator('[role="radiogroup"][aria-label="Sayfa başlığı düzeni"]')
    .getByRole("radio", { name: /^Banner/ })
    .click();
  await page
    .locator('[role="radiogroup"][aria-label="Sayfa başlığı şablonu"]')
    .getByRole("radio", { name: /Bölünmüş Görsel & Metin/ })
    .click();

  await page.getByRole("button", { name: "Bu bölümü kaydet" }).click();
  await expect(page.getByText("Değişiklikler kaydedildi.")).toBeVisible();

  await expect
    .poll(async () => (await getAdminAppearance(token)).pageHeaderLayout, { timeout: 10_000 })
    .toBe("SPLIT");

  // `(site)/blog` sayfası `PageHeader`'ı `appearance.pageHeaderStyle`/`pageHeaderLayout` ile render
  // eder (bkz. `app/[lang]/(site)/blog/page.tsx`) — `revalidate: 60`, eventual consistency. NOT:
  // `"bg-surface"` TEK BAŞINA poll koşulu olarak KULLANILAMAZ — `SiteHeader` HER ZAMAN
  // `bg-surface/80` class'ını taşır (bkz. `components/site/site-header.tsx`), bu yüzden STALE
  // (henüz revalidate olmamış) bir yanıtta bile substring eşleşip poll'u ERKEN/yanlış geçirir
  // (qa-agent bu turda bulundu — SPLIT şablonuna ÖZGÜ, `page-header.tsx`'teki tam grid class'ı kullanılır).
  await expect
    .poll(
      async () => {
        const res = await fetch(`${FRONTEND_URL}/blog`);
        return res.text();
      },
      { timeout: 90_000, intervals: [2_000] }
    )
    .toContain("grid-cols-1 md:grid-cols-2");

  await publicPage.goto("/blog");
  // SPLIT düzeni (`components/site/page-header.tsx`): sol kolon görsel (veya nötr yer tutucu),
  // sağ kolon `bg-surface` zemin + başlık — CENTERED/LEFT_OVERLAY'in aksine (`bg-black/60` pill
  // İLE metin görsel üzerine biner) burada başlık DÜZ bir yüzey kolonunun içindedir.
  const splitTextColumn = publicPage.locator("div.grid.w-full > div.bg-surface");
  await expect(splitTextColumn).toBeVisible();
  await expect(splitTextColumn.getByRole("heading", { name: "Blog", level: 1 })).toBeVisible();
});
