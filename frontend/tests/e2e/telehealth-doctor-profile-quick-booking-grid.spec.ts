import { test, expect, type Page } from "@playwright/test";
import { getCachedAdminSession, getSiteModules, patchSiteModule } from "./support/api";
import {
  ensureTelehealthModuleWithDoctors,
  createAdminDoctorFixture,
  deleteAdminDoctorFixture,
  type CreatedFixtureDoctor,
} from "./support/telehealth-fixtures";

/**
 * qa-agent — orkestratörün bu turdaki DOĞRUDAN görev talimatı (CLAUDE.md standart akışından
 * BAĞIMSIZ daraltılmış akış: frontend-agent → ui-designer → qa-agent): `/doctors/[slug]` sayfasının
 * YENİ 2 kolonlu düzeni (sol `lg:col-span-8` 4-sekmeli `DoctorProfileTabs`, sağ `lg:col-span-4`
 * sticky `DoctorQuickBookingCard`) + hero avatarının GERÇEKTEN yuvarlak (`rounded-full`) olması e2e
 * doğrulaması. `telehealth-doctor-profile-redesign.spec.ts` (eski tek-kolon/3-sekme varsayımlı
 * testler, BU TURDA ÇALIŞTIRILDI — HİÇBİRİ kırılmadı, güncelleme GEREKMEDİ) VE
 * `telehealth-doctor-identity.spec.ts` madde (h) (dört sekmeden üçünün içerik doğruluğu, ZATEN
 * `cvEntries`/`publications` dolu bir fixture doktorla kapsanıyor) İLE ÇAKIŞMAZ — bu dosya SADECE bu
 * turun YENİ iddialarını (sağ kart dolu+sticky, "Uzmanlık Alanları" 4. sekmesi, mobil stacking/taşma)
 * kapsar.
 *
 * Kapsam (görev talimatının qa maddesiyle BİREBİR):
 *   1) Masaüstü (1280px) — sağ sütun (`DoctorQuickBookingCard`) BOŞ DEĞİL, sol sekmelerle YAN YANA;
 *      `#randevu` bölümüne scroll edildiğinde `position: sticky` sayesinde EKRANDA SABİT kalır.
 *   2) 4 sekmenin HER BİRİNE tıklandığında ilgili içerik (veya boş-durum) doğru render olur, konsol
 *      hatası (`pageerror`) OLMAZ.
 *   3) Mobil (375px) — sağ kart sekme içeriğinin ALTINA akar, yatay taşma OLMAZ.
 *
 * qa-agent bulgusu geçmişi — bu turda BAŞLANGIÇTA İKİ bug BULUNDUĞU düşünüldü (`test.fail()` ile
 * işaretlendi, frontend-agent'a raporlandı — proje kökü CLAUDE.md madde 6). SONRAKİ bir orkestratör
 * turunda madde (1b)'nin ASIL kök nedeninin UYGULAMA KODU değil, TESTİN KENDİ BEKLENTİSİ olduğu
 * netleşti (bkz. madde 1b testinin kendi içindeki güncel yorum):
 *   (1b) [DÜZELTİLDİ — TEST BEKLENTİSİ, APP BUG DEĞİL] `#randevu`'ya kadar scroll edildiğinde kartın
 *        HÂLÂ görünür olmasını bekleyen ORİJİNAL test YANLIŞTI — `#randevu`, 2-kolonlu sticky
 *        grid'in TAMAMEN DIŞINDA/ALTINDA AYRI bir section'dır, sticky kartın orada kaybolması
 *        (BookingWizard'ın KENDİ sticky özet paneline yer açması) KASITLI/DOĞRU davranıştır. Test
 *        artık kartın KENDİ grid satırı İÇİNDE (uzun "Özgeçmiş" sekmesiyle genişletilmiş "kayma
 *        payı") makul bir mesafe kaydırıldığında sticky kaldığını doğruluyor — `test.fail()`
 *        KALDIRILDI, uygulama kodu (`page.tsx`/`doctor-quick-booking-card.tsx`/
 *        `doctor-profile-tabs.tsx`) DEĞİŞMEDİ.
 *   (3b) mobilde (375px) 4 sekmeli `TabsList` SIĞMIYOR, `w-fit`/`whitespace-nowrap` yüzünden
 *        SAYFA GENELİNDE yatay taşmaya neden oluyor (diğer sayfalarda — `/`, `/doctors`,
 *        `/products` — AYNI viewport'ta taşma YOK, bu KESİNLİKLE bu turun 4. sekmesiyle ilgili).
 *        Bu bug frontend-agent tarafından DÜZELTİLDİ (bkz. madde 3b testinin kendi yorumu).
 */
test.describe.configure({ mode: "serial" });

const RUN_SUFFIX = Date.now().toString(36);
let adminToken: string;
let initialTelehealthEnabled: boolean;
let richDoctor: CreatedFixtureDoctor;
let emptyDoctor: CreatedFixtureDoctor;
/** `CreatedFixtureDoctor` (API yanıtı) `bio` alanını taşımaz (dar `FixtureDoctor` arayüzü) — o
 * yüzden gönderilen `bio` metni burada AYRICA (BAĞIMSIZ) sabitlenir, testte geri okunur. */
const EMPTY_DOCTOR_BIO = "qa-agent — grid görevi, boş-durum mesajlarını doğrulamak içindir.";

/** `telehealth-booking-wizard-grid-layout.spec.ts::gotoAndWaitReady` İLE BİREBİR AYNI — public
 * doktor sayfası ISR'dir (`next: { revalidate: 60 }`, proje belleği "60sn eventual consistency"). */
async function gotoAndWaitReady(page: Page, url: string, ready: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await ready();
  }).toPass({ timeout: 75_000, intervals: [2_000, 5_000] });
}

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;

  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  await ensureTelehealthModuleWithDoctors(adminToken);

  // `telehealth-doctor-identity.spec.ts` madde (h) İLE AYNI desen — "Uzmanlık Alanları" sekmesinin
  // GERÇEK içerik (specialty rozeti + CERTIFICATE/MEMBERSHIP/AWARD listesi) dalını da tetiklemek
  // için `cvEntries`'e madde (h)'nin KAPSAMADIĞI bu üç türü EKLER.
  richDoctor = await createAdminDoctorFixture(adminToken, {
    title: "Prof. Dr.",
    fullName: `QA Grid Zengin Icerik ${RUN_SUFFIX}`,
    bio: "qa-agent — grid görevi, 4 sekmenin TAMAMININ dolu içerik dalını doğrulamak içindir.",
    aboutHtml: "<h2>Klinik Yaklaşım</h2><p>QA_GRID_ABOUT_HTML_MARKER — biyografi detayı.</p>",
    languages: ["tr", "en"],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 40,
    sessionPriceCents: 60000,
    currency: "TRY",
    isVerified: true,
    isActive: true,
    subSpecialty: "QA Alt Uzmanlık Merkezi",
    cvEntries: [
      { kind: "EXPERIENCE", title: "QA Grid Kıdemli Hekim", organization: "QA Grid Hastanesi", startYear: 2018, endYear: null },
      { kind: "CERTIFICATE", title: "QA Grid Sertifikası", organization: "QA Grid Kurumu", startYear: 2019, endYear: null },
      { kind: "MEMBERSHIP", title: "QA Grid Derneği Üyeliği", organization: "QA Grid Derneği", startYear: 2020, endYear: null },
      { kind: "AWARD", title: "QA Grid Başarı Ödülü", organization: "QA Grid Vakfı", startYear: 2021, endYear: 2021 },
    ],
    publications: [{ kind: "INTERNATIONAL_ARTICLE", title: "QA Grid Uluslararası Makale", venue: "QA Grid Int J", year: 2022 }],
  });

  // Boş-durum dalları için — `aboutHtml`/`cvEntries`/`publications`/`subSpecialty` YOK, `bio` HARİÇ.
  emptyDoctor = await createAdminDoctorFixture(adminToken, {
    title: "Dr.",
    fullName: `QA Grid Bos Icerik ${RUN_SUFFIX}`,
    bio: EMPTY_DOCTOR_BIO,
    languages: [],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 30,
    sessionPriceCents: 45000,
    currency: "TRY",
    isActive: true,
  });
});

test.afterAll(async () => {
  for (const doc of [richDoctor, emptyDoctor]) {
    if (doc) await deleteAdminDoctorFixture(adminToken, doc.id).catch(() => undefined);
  }
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

// =============================================================================
// madde 1a — masaüstü (1280px): sağ sütun dolu + sol sekmelerle YAN YANA (PASS — bu kısım doğru
// çalışıyor).
// =============================================================================
test("madde 1a: masaüstü (1280px) — sağ 'Hızlı Randevu' kartı BOŞ DEĞİL, sol sekmelerle YAN YANA render olur", async ({ browser }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({
    baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:3100",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  try {
    await gotoAndWaitReady(page, `/doctors/${richDoctor.slug}`, async () => {
      await expect(page.getByRole("heading", { level: 1 })).toContainText(richDoctor.fullName, { timeout: 5_000 });
    });
    await page.waitForTimeout(500);

    // Sağ kart — "Randevu Oluştur" CTA'sı + fiyat, boş DEĞİL.
    const quickBookingCard = page.locator("div", { has: page.getByRole("link", { name: "Randevu Oluştur" }) }).last();
    await expect(page.getByRole("link", { name: "Randevu Oluştur" })).toBeVisible();
    await expect(page.getByText("Online Görüşme / Randevu Al")).toBeVisible();

    const tabsList = page.getByRole("tablist");
    await expect(tabsList).toBeVisible();

    const [tabsBox, cardBox] = await Promise.all([tabsList.boundingBox(), quickBookingCard.boundingBox()]);
    expect(tabsBox, "sekme çubuğu render olmalı").not.toBeNull();
    expect(cardBox, "hızlı randevu kartı render olmalı").not.toBeNull();
    // YAN YANA — sekme çubuğunun üst kenarına YAKIN bir y'de başlar (AYNI grid satırı), kartın sol
    // kenarı sekme çubuğunun SAĞINDA (çakışma yok, iki AYRI kolon).
    expect(Math.abs(tabsBox!.y - cardBox!.y), "sekmeler ve kart AYNI grid satırında (yakın y) olmalı").toBeLessThan(80);
    expect(cardBox!.x, "kart sekmelerin SAĞINDA olmalı").toBeGreaterThan(tabsBox!.x + tabsBox!.width - 10);
  } finally {
    await context.close();
  }
});

// =============================================================================
// madde 1b — DÜZELTİLDİ (test beklentisi, APP BUG DEĞİL): sticky kartın DOĞRU sınırlar içinde
// (kendi grid satırı içinde, #randevu'ya DEĞİL) sticky çalıştığını doğrular.
// =============================================================================
test("madde 1b: masaüstü (1280px) — sticky 'Hızlı Randevu' kartı KENDİ grid satırı içinde (uzun 'Özgeçmiş' sekmesiyle) makul mesafe kaydırıldığında viewport'un üst kısmında KALIR", async ({
  browser,
}) => {
  // qa-agent DÜZELTMESİ (orkestratör talimatı, 2026-09-14) — bu testin ÖNCEKİ hâli `#randevu`
  // section'ına (2-kolonlu sticky grid'in TAMAMEN DIŞINDA/ALTINDA, `BookingWizard`'ın KENDİ AYRI
  // section'ı) scroll edildiğinde kartın HÂLÂ görünür olmasını BEKLİYORDU — bu YANLIŞ bir beklentiydi
  // (görev talimatının kendisindeki bir hataydı), UYGULAMA KODUNUN bir hatası DEĞİL.
  //
  // KÖK NEDEN (test beklentisi düzeltmesi): kartın sticky "kayma payı" (kayabileceği dikey mesafe),
  // kartın bulunduğu grid ALANININ (grid area — CSS Grid'de sticky'nin containing block'u `align-
  // self`'ten BAĞIMSIZ olarak grid alanının TAMAMIDIR) yüksekliği ile kartın KENDİ doğal yüksekliği
  // arasındaki farktır. Bu grid alanının yüksekliği, SOL sütundaki (`DoctorProfileTabs`,
  // `lg:col-span-8`) O AN AKTİF sekmenin içerik yüksekliğine bağlıdır (`base-ui` `Tabs`
  // primitive'i inaktif sekme içeriğini layout'a KATMAZ). `#randevu` section'ı bu grid'in TAMAMEN
  // DIŞINDA/ALTINDA, AYRI bir `<section>` olduğundan (page.tsx satır ~169), kart en fazla "kendi
  // grid satırının sonuna kadar" sticky kalabilir — `#randevu`'ya ulaşıldığında kart ZATEN o satırın
  // dışına çıkmış, normal akışla yukarı kaymış olur. Bu, section-scoped sticky sidebar'ların (ör.
  // e-ticaret "satın al" kutusunun ürün açıklaması bölümünde sticky kalıp yorumlar bölümünde
  // KALMAMASI gibi) BEKLENEN/DOĞRU davranışıdır — `#randevu` bölümünde bu rolü `BookingWizard`'ın
  // KENDİ sticky özet paneli (`DoctorServiceSummaryPanel`) ZATEN devralıyor; iki ayrı sticky panelin
  // aynı anda aynı section'da rekabet etmesi zaten istenmeyen bir durum olurdu.
  //
  // Bu test artık kartın GERÇEK/GEÇERLİ sticky "kayma payı" ARALIĞINDA (kendi grid satırı içinde)
  // doğru çalıştığını doğruluyor: varsayılan kısa "Doktor Hakkında" sekmesi YERİNE UZUN "Özgeçmiş"
  // sekmesine geçilir (richDoctor'ın `beforeAll`'da tanımlı DÖRT `cvEntries` girdisi grid satırını
  // belirgin şekilde uzatır), sonra `#randevu`'ya DEĞİL, sadece MAKUL bir miktar (450px) kaydırılır
  // — bu mesafenin `#randevu`'ya ULAŞMADIĞI (aşağıda) AYRICA doğrulanır.
  test.setTimeout(60_000);
  const context = await browser.newContext({
    baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:3100",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  try {
    await gotoAndWaitReady(page, `/doctors/${richDoctor.slug}`, async () => {
      await expect(page.getByRole("heading", { level: 1 })).toContainText(richDoctor.fullName, { timeout: 5_000 });
    });
    await page.waitForTimeout(500);

    // "Özgeçmiş" sekmesine geç — DÖRT `cvEntries` girdisi (bkz. beforeAll) varsayılan "Doktor
    // Hakkında" sekmesinden (kısa bio) belirgin şekilde UZUN, grid satırının (dolayısıyla sticky'nin
    // "kayma payı"nın) GERÇEKTEN test edilebilir olmasını sağlar.
    await page.getByRole("tab", { name: "Özgeçmiş" }).click();
    await expect(page.getByRole("tabpanel", { name: "Özgeçmiş" }).getByText("QA Grid Kıdemli Hekim")).toBeVisible();
    await page.waitForTimeout(200);

    const quickBookingCard = page.locator("div", { has: page.getByRole("link", { name: "Randevu Oluştur" }) }).last();
    const randevuSection = page.locator("#randevu");

    const [cardBoxBefore, randevuBoxBefore] = await Promise.all([
      quickBookingCard.boundingBox(),
      randevuSection.boundingBox(),
    ]);
    expect(cardBoxBefore, "kart scroll ÖNCESİ render olmalı").not.toBeNull();
    expect(randevuBoxBefore, "#randevu render olmalı").not.toBeNull();
    // scroll ÖNCESİ #randevu, viewport'un (900px) BELİRGİN ALTINDA olmalı — aksi halde aşağıdaki
    // "makul mesafe" scroll'u YANLIŞLIKLA #randevu'ya ulaşabilir (test hâlâ YANLIŞ senaryoyu
    // ölçebilir).
    expect(randevuBoxBefore!.y, "#randevu scroll ÖNCESİ viewport dışında (aşağıda) olmalı").toBeGreaterThan(700);

    // MAKUL bir mesafe kaydır — `#randevu`'ya DEĞİL, sadece "Özgeçmiş" sekmesinin uzattığı grid
    // satırının KENDİ içine. Bu, sticky'nin GERÇEK "kayma payı" olan bir aralıkta test edilmesini
    // sağlar; `#randevu`'ya kadar kaydırmak (eski/YANLIŞ beklenti) kartın KENDİ grid alanının
    // (yukarıdaki kök neden açıklamasına bakınız) dışına çıkmasına neden olur.
    // NOT (ölçüldü — `page.evaluate` ile ELLE doğrulandı): kartın kendi (sticky OLMASAYDI geçerli
    // olacak) belge-göreli üst konumu ~438px, `top-6`=24px olduğğundan kart YALNIZCA scrollY ≈
    // 414px'i geçtiğinde "yapışkanlaşır" (clamp olur) — 300px gibi KÜÇÜK bir scroll bu eşiğin
    // ALTINDA kalır (kart henüz normal akışta, sticky HENÜZ devrede değil, y=138 gibi ARA bir değer
    // verir). 450px, hem bu eşiğin (~414px) ÜZERİNDE hem de grid satırının/`#randevu`'nun ÇOK
    // ALTINDA (bkz. aşağıdaki #randevu doğrulaması) — kartın GERÇEKTEN clamp olmuş (top-6 civarı)
    // durumunu ölçer.
    const scrollAmount = 450;
    await page.evaluate((y) => window.scrollBy(0, y), scrollAmount);
    await page.waitForTimeout(300);

    // Kaydırma sonrası hâlâ `#randevu`'nun (belirgin şekilde) ÖNCESİNDEYİZ — bu, testin `#randevu`'ya
    // DEĞİL, tabs sütununun KENDİ İÇİNE scroll ettiğini garanti eder (yani aşağıdaki sticky
    // doğrulaması GERÇEKTEN geçerli aralıkta yapılıyor).
    const randevuBoxAfter = await randevuSection.boundingBox();
    expect(randevuBoxAfter, "#randevu scroll sonrası hâlâ render olmalı").not.toBeNull();
    expect(
      randevuBoxAfter!.y,
      "scroll sonrası #randevu HÂLÂ viewport'un belirgin altında olmalı (henüz oraya ulaşılmadı — bu #randevu'ya scroll testi DEĞİL)",
    ).toBeGreaterThan(300);

    const cardBoxAfter = await quickBookingCard.boundingBox();
    expect(cardBoxAfter, "scroll sonrası kart hâlâ render olmalı").not.toBeNull();
    // GERÇEK "sticky çalışıyor mu" doğrulaması — kart viewport'un üst kısmında (`top-6` ≈ 24px
    // civarında, makul tolerans) kalmalı; sticky ÇALIŞMASAYDI (normal akış), kart `scrollAmount`
    // kadar yukarı kaymış (negatife yakın bir y) olurdu.
    expect(cardBoxAfter!.y, "kart sticky sayesinde viewport'un üst kısmına YAKIN kalmalı").toBeGreaterThanOrEqual(0);
    expect(cardBoxAfter!.y, "kart sticky top-6 civarında kalmalı (kendi grid alanı içindeyken KAYBOLMAMALI)").toBeLessThan(100);
  } finally {
    await context.close();
  }
});

// =============================================================================
// madde 2 — 4 sekmenin HER BİRİ doğru içerik/boş-durum render eder, konsol hatası YOK.
// =============================================================================
test("madde 2: 4 sekme (Hakkında/Özgeçmiş/Bilimsel Yayınlar/Uzmanlık Alanları) DOLU içerikle doğru render olur, pageerror YOK", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await gotoAndWaitReady(page, `/doctors/${richDoctor.slug}`, async () => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText(richDoctor.fullName, { timeout: 5_000 });
  });

  // 4 sekme SAYICA doğru — TAM 4 tab (eski 3 sekmeli varsayımın GERÇEKTEN aşıldığının kanıtı).
  await expect(page.getByRole("tab")).toHaveCount(4);

  // ---- "Doktor Hakkında" (varsayılan aktif) ----
  await expect(page.getByRole("tab", { name: "Doktor Hakkında" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("QA_GRID_ABOUT_HTML_MARKER", { exact: false })).toBeVisible();

  // ---- "Özgeçmiş" ----
  await page.getByRole("tab", { name: "Özgeçmiş" }).click();
  const cvPanel = page.getByRole("tabpanel", { name: "Özgeçmiş" });
  await expect(cvPanel.getByText("QA Grid Kıdemli Hekim")).toBeVisible();
  // `cvEntries`'teki DÖRT girdinin ÜÇÜ (CERTIFICATE/MEMBERSHIP/AWARD, `ExpertisePanel`'in
  // KAPSADIĞI türler) DE `endYear: null` taşıdığından "Devam ediyor" metni burada BİRDEN FAZLA
  // kez render olur (strict-mode ihlali) — `.first()` yeterli, tekillik İDDİA EDİLMİYOR.
  await expect(cvPanel.getByText("Devam ediyor", { exact: false }).first()).toBeVisible();

  // ---- "Bilimsel Yayınlar" ----
  await page.getByRole("tab", { name: "Bilimsel Yayınlar" }).click();
  const pubPanel = page.getByRole("tabpanel", { name: "Bilimsel Yayınlar" });
  await expect(pubPanel.getByText("QA Grid Uluslararası Makale")).toBeVisible();
  await expect(pubPanel.getByText("Uluslararası Makaleler")).toBeVisible();

  // ---- "Uzmanlık Alanları" (YENİ sekme, bu turun asıl konusu) ----
  await page.getByRole("tab", { name: "Uzmanlık Alanları" }).click();
  const expertisePanel = page.getByRole("tabpanel", { name: "Uzmanlık Alanları" });
  await expect(expertisePanel.getByText("Uzmanlık Alanı", { exact: true })).toBeVisible();
  await expect(expertisePanel.getByText("QA Alt Uzmanlık Merkezi")).toBeVisible();
  await expect(expertisePanel.getByText("Sertifikalar & Üyelikler", { exact: false })).toBeVisible();
  await expect(expertisePanel.getByText("QA Grid Sertifikası")).toBeVisible();
  await expect(expertisePanel.getByText("QA Grid Derneği Üyeliği")).toBeVisible();
  await expect(expertisePanel.getByText("QA Grid Başarı Ödülü")).toBeVisible();
  // `CvTimeline`'ın dikey zaman çizelgesi (`<ol>`) BİREBİR TEKRARLANMAZ — bu panel kendi `<ul>`
  // grid'inde render eder (bkz. `doctor-profile-tabs.tsx::ExpertisePanel`).
  await expect(expertisePanel.locator("ol")).toHaveCount(0);

  expect(pageErrors, `sekmeler arası geçişte konsol hatası OLMAMALI: ${pageErrors.map((e) => e.message).join(", ")}`).toHaveLength(0);
});

test("madde 2 (boş-durum): içerik OLMAYAN doktorda 4 sekmenin tümü nötr boş-durum mesajı gösterir, pageerror YOK", async ({ page }) => {
  test.setTimeout(60_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await gotoAndWaitReady(page, `/doctors/${emptyDoctor.slug}`, async () => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText(emptyDoctor.fullName, { timeout: 5_000 });
  });

  // "Doktor Hakkında" — `bio` HER ZAMAN dolu (schema zorunlu kılar), boş-durum bu sekme için YOK.
  await expect(page.getByText(EMPTY_DOCTOR_BIO, { exact: false })).toBeVisible();

  await page.getByRole("tab", { name: "Özgeçmiş" }).click();
  await expect(page.getByText("Bu doktor için henüz özgeçmiş bilgisi paylaşılmamış.")).toBeVisible();

  await page.getByRole("tab", { name: "Bilimsel Yayınlar" }).click();
  await expect(page.getByText("Bu doktor için henüz bilimsel yayın paylaşılmamış.")).toBeVisible();

  await page.getByRole("tab", { name: "Uzmanlık Alanları" }).click();
  await expect(page.getByText("Bu doktor için henüz uzmanlık alanı bilgisi paylaşılmamış.")).toBeVisible();

  expect(pageErrors, `boş-durum sekmelerinde konsol hatası OLMAMALI: ${pageErrors.map((e) => e.message).join(", ")}`).toHaveLength(0);
});

// =============================================================================
// madde 3a — mobil (375px): sağ kart sekme içeriğinin ALTINA akar (PASS — bu kısım doğru
// çalışıyor).
// =============================================================================
test("madde 3a: mobil (375px) — 'Hızlı Randevu' kartı sekme içeriğinin ALTINA akar (dikey yığılma)", async ({ browser }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({
    baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:3100",
    viewport: { width: 375, height: 800 },
  });
  const page = await context.newPage();
  try {
    await gotoAndWaitReady(page, `/doctors/${richDoctor.slug}`, async () => {
      await expect(page.getByRole("heading", { level: 1 })).toContainText(richDoctor.fullName, { timeout: 5_000 });
    });
    await page.waitForTimeout(500);

    const tabsList = page.getByRole("tablist");
    await expect(tabsList).toBeVisible();
    const quickBookingHeading = page.getByText("Online Görüşme / Randevu Al");
    await expect(quickBookingHeading).toBeVisible();

    const [tabsBox, cardBox] = await Promise.all([tabsList.boundingBox(), quickBookingHeading.boundingBox()]);
    expect(tabsBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    // DÜŞEY yığılma — kart sekme çubuğunun ALTINDA (belirgin şekilde daha büyük bir y).
    expect(cardBox!.y, "mobilde 'Hızlı Randevu' kartı sekme çubuğunun ALTINA akmalı").toBeGreaterThan(tabsBox!.y + tabsBox!.height);

    // CTA hâlâ tıklanabilir/görünür durumda (grid çökmedi).
    await expect(page.getByRole("link", { name: "Randevu Oluştur" })).toBeVisible();
  } finally {
    await context.close();
  }
});

// =============================================================================
// madde 3b — BUG (frontend-agent VEYA ui-designer): mobilde (375px) 4-sekmeli `TabsList` yatay
// TAŞMAYA neden olur, TÜM SAYFA yatay kaydırılabilir hâle gelir.
// =============================================================================
test("madde 3b: BUG (frontend-agent/ui-designer) — mobilde (375px) 4 sekmeli TabsList SIĞMIYOR, SAYFA GENELİNDE yatay taşmaya neden oluyor", async ({
  browser,
}) => {
  // Kural gereği (proje kökü CLAUDE.md madde 6): qa-agent bug'ı KENDİ DÜZELTMEZ — BEKLENEN
  // davranış (mobilde yatay taşma YOK) yazılır; `test.fail()` bunun ŞU AN başarısız olduğunu
  // bilinçli olarak işaretler.
  //
  // KÖK NEDEN (`page.evaluate` ile taşan elemanlar TEK TEK bulundu, ELLE doğrulandı — hem bu
  // turun `richDoctor` fixture'ında HEM paylaşımlı demo doktoru `elif-aydemir`'de TEKRARLANDI;
  // `/doctors`, `/`, `/products` gibi BAŞKA sayfalarda AYNI viewport'ta yatay taşma YOK — bu
  // KESİNLİKLE bu turun 4. sekme eklenmesiyle İLGİLİ, site genelinde bir header/layout sorunu
  // DEĞİL): `doctor-profile-tabs.tsx`'teki `TabsList` (`components/ui/tabs.tsx`'in paylaşılan
  // `inline-flex w-fit` taban sınıfı) üç sekmeye göre tasarlanmıştı; DÖRDÜNCÜ "Uzmanlık Alanları"
  // sekmesi EKLENİNCE (her tetikleyici `whitespace-nowrap` + `px-3`/`sm:px-4` dolgu taşıyor,
  // `TAB_TRIGGER_CLASS`) çubuğun DOĞAL (sarmayan) genişliği ~530px'e çıkıyor — 375px'lik mobil
  // viewport'ta `TabsList`'in KENDİSİ (`overflow-x-auto`/`flex-wrap` YOK) sığmıyor ve `w-fit`
  // olduğu için KENDİ ebeveyn kolonunu (`lg:col-span-8`, mobilde tam genişlik) İTİYOR — bu da
  // `document.body.scrollWidth`'i (546px) `clientWidth`'in (375px) BELİRGİN ÜZERİNE çıkarıp SAYFA
  // GENELİNDE yatay bir kaydırma çubuğu ortaya çıkarıyor (header/hero DAHİL, kendileri taşmasa
  // BİLE `body` genişliği arttığı için).
  //
  // ÖNERİLEN DÜZELTME YÖNÜ (frontend-agent/ui-designer'a): mobilde `TabsList`'e yatay scroll
  // kapsülleme (`overflow-x-auto` + `flex-nowrap`, dokunmatik kaydırma) EKLEMEK YETERLİ olur — bu
  // hem `w-fit` taşmasını sayfa dışına SIZDIRMAZ hem de 4 sekmenin TAMAMINI erişilebilir tutar
  // (mevcut `Tabs` bileşeni `variant="line"` için BÖYLE bir mobil davranış TANIMLAMIYOR, bu sayfaya
  // özel bir `className` override'ı ile çözülebilir — global `tabs.tsx` DEĞİŞMEDEN).
  //
  // DÜZELTİLDİ (2026-09-14, frontend-agent — dar kapsamlı takip görevi, Seçenek A): Seçenek A
  // (önerilen düzeltme yönüyle BİREBİR) uygulandı — `doctor-profile-tabs.tsx`'teki `<TabsList>`
  // SADECE bu sayfaya özel `overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0` sarmalayıcı `<div>` içine
  // alındı, paylaşılan `components/ui/tabs.tsx` DEĞİŞMEDİ. `test.fail()` KALDIRILDI — test artık
  // GEÇMELİ.
  test.setTimeout(60_000);
  const context = await browser.newContext({
    baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:3100",
    viewport: { width: 375, height: 800 },
  });
  const page = await context.newPage();
  try {
    await gotoAndWaitReady(page, `/doctors/${richDoctor.slug}`, async () => {
      await expect(page.getByRole("heading", { level: 1 })).toContainText(richDoctor.fullName, { timeout: 5_000 });
    });
    await page.waitForTimeout(500);

    // Yatay taşma YOK (`document.body.scrollWidth <= viewport genişliği + küçük tolerans`).
    const overflowInfo = await page.evaluate(() => ({
      scrollWidth: document.body.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflowInfo.scrollWidth, "mobilde yatay taşma OLMAMALI").toBeLessThanOrEqual(overflowInfo.clientWidth + 2);
  } finally {
    await context.close();
  }
});
