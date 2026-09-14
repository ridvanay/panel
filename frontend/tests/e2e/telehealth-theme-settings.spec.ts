import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession, getSiteModules } from "./support/api";
import {
  ensureTelehealthModuleWithDoctors,
  listAllAdminDoctors,
  getAdminTelehealthThemeSettings,
  patchAdminTelehealthThemeSettings,
  type FixtureTelehealthThemeSettings,
} from "./support/telehealth-fixtures";

/**
 * qa-agent — Grid görevi (2026-09-14) Görev 2 (backend-agent → frontend-agent → qa-agent
 * daraltılmış akış): randevu sihirbazının (`/doctors/[slug]`) admin panelinden yönetilen 4 tema
 * rengi (`GET|PATCH /admin/telehealth/settings` + PUBLIC `GET /telehealth/theme`,
 * `doctors/layout.tsx`'in `.telehealth-scope` CSS custom property enjeksiyonu) + genişletilmiş
 * takvim kartı (`h-10/h-11` → `h-12/h-14`, iç grid `2fr/3fr` → `1fr/1fr`, dış grid sağ sütun
 * `320px` → `360px`) için e2e kapsamı.
 *
 * Bu dosya `telehealth-booking-wizard.spec.ts`/`telehealth-public-booking.spec.ts`'in DIŞINDA,
 * AYRI bir dosya — paylaşımlı `telehealth-clinic` demo doktorlarını (`ensureTelehealthModuleWithDoctors`)
 * kullanır (kendi izole fixture doktoru GEREKMEZ — yalnızca OKUMA/görsel doğrulama yapılır, hiçbir
 * randevu/booking OLUŞTURULMAZ). `SiteModule.settings` (`key="telehealth"`) TÜM suite'in
 * paylaştığı GLOBAL/singleton bir ayardır — bu yüzden tema değeri değiştiren TEK test
 * `afterEach`'te MUTLAKA orijinaline geri döner (diğer dosyaların/testlerin varsayılan tema
 * bekleyen görsel iddialarını BOZMAMASI için).
 */
test.describe.configure({ mode: "serial" });

let adminToken: string;
let doctorSlug: string;

// `ensureTelehealthModuleWithDoctors` modülü AÇAR ve AÇIK BIRAKIR — bu dosya modülün durumunu
// (`telehealth-booking-wizard.spec.ts::afterAll`'ın AKSİNE) teardown'da GERİ ALMAZ: çok sayıda
// paylaşımlı e2e dosyası (`telehealth-public-booking.spec.ts` vb.) modülün AÇIK kalmasına zaten
// güveniyor, `ensureTelehealthModuleWithDoctors` idempotent (bkz. fonksiyon başlığı) — bu dosya
// yalnızca OKUMA/görsel doğrulama yapar, modülü kapatmak GEREKSİZ bir yan etki olurdu.
test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(90_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  await getSiteModules(adminToken); // erişilebilirlik/oturum sağlık kontrolü — sonucu KULLANILMAZ.
  await ensureTelehealthModuleWithDoctors(adminToken);

  const doctors = await listAllAdminDoctors(adminToken);
  if (doctors.length === 0) throw new Error("qa-agent: telehealth-clinic demo doktoru bulunamadı.");
  doctorSlug = doctors[0]!.slug;
});

/** `#rrggbb` → `rgb(r, g, b)` — `getComputedStyle(...).backgroundColor`'ın döndürdüğü BİÇİMLE
 * karşılaştırmak için (tarayıcılar hex DEĞİL `rgb(...)` döner). */
function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

async function gotoDoctorDetail(page: Page, ready: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.goto(`/doctors/${doctorSlug}`, { waitUntil: "domcontentloaded" });
    await ready();
  }).toPass({ timeout: 75_000, intervals: [2_000, 5_000] });
}

// =============================================================================
// Test 1 — admin panelinde `primaryColor` değişikliği `/doctors/[slug]`'a yansır (`.telehealth-scope`
// `--telehealth-primary`/`--primary` CSS custom property'si VE stepper "tamamlandı" ikonunun
// GERÇEK render edilmiş arka plan rengi). `PATCH /admin/telehealth/settings` — appearance'ın AKSİNE
// (`admin-appearance-instant-revalidation.spec.ts`) `triggerGlobalRevalidation()` ÇAĞIRMAZ (backend
// kaynağında doğrulandı — `adminTelehealthSettingsRoutes` PATCH handler'ında revalidate çağrısı
// YOK); `fetchTelehealthThemeServer()` `next: { revalidate: 60 }` ile önbelleklenir. qa-agent BUNU
// GERÇEK ortamda (yerel `next dev`/Turbopack, bu dosyanın KENDİ koşumlarıyla) ÖLÇTÜ: admin PATCH'ten
// SONRA `/doctors/[slug]`'ın yeni rengi yansıtması GERÇEKTEN ~55-70 saniye sürüyor (tek bir
// `page.reload()` YETERSİZ) — yani `revalidate: 60` penceresi burada GERÇEK bir eventual-consistency
// gecikmesi ÜRETİYOR (appearance'ın AKSİNE, orada `triggerGlobalRevalidation()` bu gecikmeyi ANINDA'ya
// indiriyor). Bu, TEST_COVERAGE.md'ye "backend-agent'a yönlendirilmesi gereken ürün/UX boşluğu"
// olarak raporlandı — qa-agent burada YALNIZCA GÖZLEMLENEN gerçek davranışa göre test yazdı (proje
// belleği: "Products/blog/portfolio 60s staleness — expected eventual consistency, not a bug; e2e
// tests must poll"), reaktif bir DÜZELTME yapmadı. Assertion bu yüzden tek bir `page.reload()`'a
// DEĞİL, `toPass` ile 75sn'e kadar poll'a bağlanır.
test("admin panelinde Birincil Renk değişikliği /doctors/[slug]'a yansır — .telehealth-scope custom property + stepper 'tamamlandı' ikonu rengi", async ({
  page,
}) => {
  test.setTimeout(120_000);

  const original: FixtureTelehealthThemeSettings = await getAdminTelehealthThemeSettings(adminToken);
  // Backend/frontend varsayılanlarıyla (`TELEHEALTH_THEME_DEFAULTS`, `#0f766e`) VE diğer e2e
  // dosyalarının (`admin-appearance-*`) KULLANMADIĞI, tesadüfi eşleşme riski olmayan belirgin bir hex.
  const NEW_PRIMARY_COLOR = "#1e3a8a";
  expect(original.primaryColor).not.toBe(NEW_PRIMARY_COLOR);

  try {
    // 1) Sayfayı BİR KEZ ziyaret ederek Next.js `next: { revalidate: 60 }` Data Cache'ini
    // ISITIRIZ. qa-agent bulgusu (test yazarken GÖZLEMLENDİ) — bu ısıtma adımının GÖSTERDİĞİ değer
    // `original.primaryColor` (backend'in O ANKİ GERÇEK değeri, `getAdminTelehealthThemeSettings`
    // ile okunur) İLE HER ZAMAN BİREBİR AYNI OLMAK ZORUNDA DEĞİLDİR — `PATCH /admin/telehealth/settings`
    // (appearance'ın AKSİNE) `triggerGlobalRevalidation()` ÇAĞIRMADIĞI İÇİN önceki bir test/koşumun
    // ISITTIĞI önbellek satırı, DB'deki güncel değerden `revalidate:60` penceresi kadar GERİDE
    // kalabilir (bu turda GERÇEKTEN GÖZLEMLENDİ — proje belleği "60s staleness, expected eventual
    // consistency" notuyla TUTARLI). Bu yüzden burada KESİN bir eşitlik İDDİA EDİLMEZ — yalnızca
    // aşağıdaki `NEW_PRIMARY_COLOR`'DAN FARKLI olduğu doğrulanır (asıl "değişti" iddiasının anlamlı
    // kalması için, `expect.not.toBe` — appearance testindeki YANLIŞ-POZİTİF önleme gerekçesiyle
    // AYNI ruh, ama sıfır bekleme SÜRESİ VARSAYIMI OLMADAN).
    await gotoDoctorDetail(page, async () => {
      await expect(page.getByRole("heading", { name: "Müsaitlik ve Randevu" })).toBeVisible();
    });
    const scope = page.locator(".telehealth-scope");
    await expect(scope).toBeVisible();
    const primaryBefore = await scope.evaluate((el) => getComputedStyle(el).getPropertyValue("--telehealth-primary").trim());
    expect(primaryBefore).not.toBe(NEW_PRIMARY_COLOR);

    // 2) Admin PATCH ile rengi değiştir — gerçek `PATCH /admin/telehealth/settings`.
    const updated = await patchAdminTelehealthThemeSettings(adminToken, { primaryColor: NEW_PRIMARY_COLOR });
    expect(updated.primaryColor).toBe(NEW_PRIMARY_COLOR);

    // Public uç da yeni değeri yansıtıyor mu — regresyon tripwire'ı (`admin-appearance-instant-
    // revalidation.spec.ts`teki AYNI desen).
    const publicRes = await fetch(`${process.env.E2E_API_URL ?? "http://localhost:4001/api/v1"}/telehealth/theme`);
    const publicData = (await publicRes.json()).data as FixtureTelehealthThemeSettings;
    expect(publicData.primaryColor).toBe(NEW_PRIMARY_COLOR);

    // 3) `/doctors/[slug]`'da (poll ile — bkz. dosya başlığı) YENİ rengin hem CSS custom
    // property'sinde HEM de stepper'ın 1. adım ("tamamlandı", statik/hekim zaten seçili) ikonunun
    // GERÇEK render edilmiş arka plan renginde göründüğünü doğrula.
    await expect(async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(scope).toBeVisible();

      const primaryAfter = await scope.evaluate((el) => getComputedStyle(el).getPropertyValue("--telehealth-primary").trim());
      expect(primaryAfter).toBe(NEW_PRIMARY_COLOR);

      // qa-agent bulgusu (test yazarken GÖZLEMLENDİ, uygulama bug'ı DEĞİL) — modern Chromium
      // `getComputedStyle` bir custom property'nin DEĞERİ başka bir `var(...)` referansı içerse
      // bile onu TAM olarak çözümleyip döner (literal `"var(--telehealth-primary)"` string'i
      // DEĞİL) — yani `.telehealth-scope`'un `--primary: var(--telehealth-primary)` satır-içi
      // stili, `getComputedStyle` üzerinden DOĞRUDAN çözümlenmiş hex değerini verir.
      const primaryVarAfter = await scope.evaluate((el) => getComputedStyle(el).getPropertyValue("--primary").trim());
      expect(primaryVarAfter).toBe(NEW_PRIMARY_COLOR);

      // Adım 1 ("Hekim Seçimi") sayfa ilk açıldığında HER ZAMAN "completed" — `bg-primary` sınıfı
      // `--primary` cascade'i ÜZERİNDEN yeni rengi almalı (`booking-stepper-bar.tsx`).
      const step1Icon = page.getByTestId("booking-stepper-step").nth(0).locator("span").first();
      await expect(step1Icon).toBeVisible();
      const bg = await step1Icon.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).toBe(hexToRgb(NEW_PRIMARY_COLOR));
    }).toPass({ timeout: 75_000, intervals: [2_000, 5_000] });
  } finally {
    // Temizlik — GLOBAL/singleton ayar, diğer testleri ETKİLEMESİN (proje kökü CLAUDE.md
    // "b8003 test verisi" ilkesiyle AYNI ruh: fixture izole/temiz bırakılmalı).
    await patchAdminTelehealthThemeSettings(adminToken, original);
    const restored = await getAdminTelehealthThemeSettings(adminToken);
    expect(restored).toEqual(original);
  }
});

// =============================================================================
// Test 2 — masaüstü (1280px): genişletilmiş takvim kartı sayfa/ebeveyn konteynerini AŞMIYOR, gün
// hücrelerinin YENİ boyutu (`h-14` @ `sm:` breakpoint, ~56px) KABA bir kontrolle doğrulanır.
// =============================================================================
test("masaüstü (1280px) — genişletilmiş takvim kartı taşma YARATMIYOR, gün hücreleri büyüdü", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({
    baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:3100",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  try {
    await gotoDoctorDetail(page, async () => {
      await expect(page.getByRole("heading", { name: "Müsaitlik ve Randevu" })).toBeVisible();
    });

    // Takvim kartı konteyneri — "Önceki ay" düğmesinin (başlık satırı → kart) 2. atası.
    const prevMonthButton = page.getByRole("button", { name: "Önceki ay" });
    await expect(prevMonthButton).toBeVisible();
    const calendarCard = prevMonthButton.locator("xpath=ancestor::div[2]");
    const cardBox = await calendarCard.boundingBox();
    expect(cardBox).not.toBeNull();

    const viewportSize = page.viewportSize();
    expect(viewportSize).not.toBeNull();
    // Kart, viewport genişliğini AŞMAMALI (dış grid + iç `1fr/1fr` oranıyla birlikte taşma yok).
    expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(viewportSize!.width + 1);

    // Sayfa genelinde de yatay taşma YOK.
    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(hasHorizontalOverflow).toBe(false);

    // Gün hücresi boyutu — "seçili" gün (sayfa ilk açıldığında en yakın müsait güne otomatik
    // seçilir) `h-14` (`sm:` breakpoint, 1280px bu eşiği AŞAR) → ~56px. Piksel-mükemmel ZORUNLU
    // DEĞİL (görev talimatı) — eski `h-10/h-11` (~40-44px) boyutundan BELİRGİN ŞEKİLDE büyük
    // olduğunu doğrulayan KABA bir aralık kullanılır.
    const selectedDay = page.getByRole("button", { name: /seçili/ }).first();
    await expect(selectedDay).toBeVisible();
    const dayBox = await selectedDay.boundingBox();
    expect(dayBox).not.toBeNull();
    expect(dayBox!.height).toBeGreaterThanOrEqual(48);
    expect(dayBox!.height).toBeLessThanOrEqual(64);
  } finally {
    await context.close();
  }
});

// =============================================================================
// Test 3 — mobil (375px): takvim/sayfa yatay scroll/taşma YARATMIYOR.
// =============================================================================
test("mobil (375px) — genişletilmiş takvim yatay scroll/taşma YARATMIYOR", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({
    baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:3100",
    viewport: { width: 375, height: 812 },
  });
  const page = await context.newPage();
  try {
    await gotoDoctorDetail(page, async () => {
      await expect(page.getByRole("heading", { name: "Müsaitlik ve Randevu" })).toBeVisible();
    });

    const selectedDay = page.getByRole("button", { name: /seçili/ }).first();
    await expect(selectedDay).toBeVisible();

    const overflowInfo = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      bodyScrollWidth: document.body.scrollWidth,
    }));
    expect(
      overflowInfo.scrollWidth,
      `document.documentElement.scrollWidth (${overflowInfo.scrollWidth}) window.innerWidth'i (${overflowInfo.innerWidth}) AŞMAMALI`
    ).toBeLessThanOrEqual(overflowInfo.innerWidth + 1);
    expect(overflowInfo.bodyScrollWidth).toBeLessThanOrEqual(overflowInfo.innerWidth + 1);
  } finally {
    await context.close();
  }
});
