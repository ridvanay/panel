import { test, expect } from "@playwright/test";
import { getCachedAdminSession, getAdminSettings, patchSiteSettings, getSiteModules, patchSiteModule } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";
import { ensureTelehealthModuleWithDoctors, listAllAdminDoctors, getPublicDoctorSlotsRaw, defaultSlotRangeISODates, createAppointmentRaw } from "./support/telehealth-fixtures";

/**
 * qa-agent — Görev (2026-09-15) "Admin randevu yeniden planlama + e-posta bildirimi + sağ alt
 * canlı destek widget'ı" görev talimatı §2. `SiteSettings.liveChatEnabled/liveChatProvider/
 * liveChatScriptId` admin toggle'ı + `LiveChatWidget` (`components/site/live-chat-widget.tsx`)
 * bileşenini gerçek tarayıcı + gerçek backend zincirinde doğrular. **PAYLAŞIMLI demo ortamına**
 * (`telehealth-admin-demo-payment-toggle.spec.ts` İLE AYNI gerekçe) karşı çalışır — bu yüzden
 * `beforeAll`/`afterAll` DB bayrağını başlangıç değerine geri getirir ve dosyanın SON testi ayrıca
 * `liveChatEnabled`in KAPALI bırakıldığını AÇIKÇA doğrular (görev talimatı — "paylaşımlı demo
 * ortamı" notu, bağlayıcı).
 *
 * `/consultation/{id}` sayfası için GERÇEK bir randevu — `telehealth-consultation.spec.ts::
 * bookRealAppointment` İLE AYNI desen (paylaşımlı `telehealth-clinic` demo doktoru, tek-slot
 * `POST /appointments`, ödeme durumu ÖNEMSİZ — yalnızca sayfanın GERÇEKTEN yüklendiği ve widget'ın
 * HİÇ görünmediği doğrulanır).
 */
test.describe.configure({ mode: "serial" });

let adminToken: string;
let initialTelehealthEnabled: boolean;
let initialLiveChatEnabled: boolean;
let initialLiveChatProvider: string;
let bookableDoctorSlug: string;
let consultationAppointmentId: string;
let consultationAccessToken: string;

async function bookRealAppointmentForConsultation(): Promise<{ id: string; accessToken: string }> {
  const { from, to } = defaultSlotRangeISODates(30);
  const slotsRes = await getPublicDoctorSlotsRaw(bookableDoctorSlug, from, to);
  const slot = (slotsRes.data ?? []).find((s) => s.available);
  if (!slot) throw new Error("qa-agent: canlı destek widget testi için müsait slot bulunamadı.");
  const res = await createAppointmentRaw({
    doctorSlug: bookableDoctorSlug,
    startsAt: slot.startsAt,
    patientName: "QA E2E Canlı Destek Widget Hastası",
    patientEmail: `qa-e2e-live-chat-widget-${Date.now()}@example.com`,
  });
  if (res.status !== 201 || !res.data) {
    throw new Error(`qa-agent: canlı destek widget testi için randevu oluşturulamadı: ${res.status} ${JSON.stringify(res.error)}`);
  }
  return { id: res.data.id, accessToken: res.data.accessToken };
}

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(90_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;

  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  await ensureTelehealthModuleWithDoctors(adminToken);

  const doctors = await listAllAdminDoctors(adminToken);
  const { from, to } = defaultSlotRangeISODates(30);
  for (const doctor of doctors) {
    const slotsRes = await getPublicDoctorSlotsRaw(doctor.slug, from, to);
    if (slotsRes.status === 200 && (slotsRes.data ?? []).some((s) => s.available)) {
      bookableDoctorSlug = doctor.slug;
      break;
    }
  }
  if (!bookableDoctorSlug) throw new Error("qa-agent: canlı destek widget testi için müsait slotu olan bir doktor bulunamadı.");
  const consultationAppointment = await bookRealAppointmentForConsultation();
  consultationAppointmentId = consultationAppointment.id;
  consultationAccessToken = consultationAppointment.accessToken;

  const settings = await getAdminSettings(adminToken);
  initialLiveChatEnabled = Boolean(settings.liveChatEnabled);
  initialLiveChatProvider = typeof settings.liveChatProvider === "string" ? settings.liveChatProvider : "internal";
  // Testin kendi kontrollü/deterministik başlangıcı — önceki bir koşum AÇIK bırakmış olabilir
  // (paylaşımlı demo ortamı); "varsayılan KAPALI" iddiası (madde 1) buna bağımlı kalmasın diye
  // açıkça KAPALI'ya çekilir.
  if (initialLiveChatEnabled) {
    await patchSiteSettings(adminToken, { liveChatEnabled: false });
  }
});

test.afterAll(async () => {
  // Görev talimatı (bağlayıcı) — paylaşımlı demo ortamı KAPALI durumunda bırakılmalı; orijinal
  // durum AÇIK olsa bile (olağan dışı bir önceki koşum), bu turun SONUCU her zaman KAPALI'dır
  // (dosyanın SON testi bunu zaten AÇIKÇA doğruluyor — bkz. aşağıdaki "temizlik" testi).
  await patchSiteSettings(adminToken, {
    liveChatEnabled: false,
    liveChatProvider: initialLiveChatProvider as "internal" | "crisp" | "tawkto",
  }).catch(() => undefined);
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

// =============================================================================
// 1) Varsayılan durum — liveChatEnabled KAPALIYKEN widget HİÇ render edilmez.
// =============================================================================
test("madde 1: liveChatEnabled KAPALIYKEN ana sayfada ve hasta portalında widget HİÇ render edilmez", async ({ page }) => {
  test.setTimeout(120_000);
  const settings = await getAdminSettings(adminToken);
  expect(settings.liveChatEnabled).toBe(false);

  // `beforeAll` bir önceki koşumun AÇIK bıraktığı bayrağı KAPATMIŞ olabilir — `fetchSiteSettingsServer()`
  // `revalidate: 60` önbellekli olduğundan (proje belleği: 60sn eventual-consistency, toPass+reload
  // ile YOKLANIR) bu negatif iddia da AYNI toleransla doğrulanır.
  await expect(async () => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Canlı destek sohbetini aç" })).toHaveCount(0);
  }).toPass({ timeout: 45_000, intervals: [2_000, 5_000] });

  await expect(async () => {
    await page.goto("/patient", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Canlı destek sohbetini aç" })).toHaveCount(0);
  }).toPass({ timeout: 45_000, intervals: [2_000, 5_000] });
});

// =============================================================================
// 2) Admin panelinden AÇ (internal sağlayıcı) — ana sayfada/hasta portalında ikon görünür, panel
// açılır (selamlama dahil), mesaj GERÇEK backend'e (`POST /support/sessions`) gönderilir ve
// SAYFA YENİLENİNCE `sessionStorage` token'ı ile KALICI olarak geri gelir.
//
// qa-agent — `.claude/architect-scope-support-desk-and-reminders.md` §3.1 turu (2026-09-16)
// `InternalChatPanel`'in istemci taraflı mock'unu (`AUTO_REPLY_TEXT`, `setTimeout`) KALDIRDI ve
// widget'ı gerçek, kalıcı, sunucu taraflı bir sohbet sistemine bağladı — bu testin ESKİ "sabit
// otomatik yanıt gelir" iddiası bu YÜZDEN artık YANLIŞTIR (regresyon değil, BİLİNÇLİ davranış
// değişikliği — bkz. [ASD] §3.1 "önceki kararın bilinçli olarak tersine çevrilmesi"). qa-agent
// bu turda testi GERÇEK backend akışına göre GÜNCELLEDİ (§4.8 madde 12 kalıcılık kanıtı dahil).
test("madde 2: admin panelinden 'Canlı Destek' AÇILIR (internal) — widget ikonu görünür, panel açılır, mesaj GERÇEK backend'e gönderilir ve sayfa yenilenince KALICI kalır", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const { page: adminPage, close } = await createAuthenticatedPage(browser);
  try {
    await adminPage.goto("/admin/settings");
    const toggle = adminPage.getByRole("switch", { name: "Canlı Destek Widget'ı" });
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");

    // Sağlayıcı varsayılanı zaten "Dahili" (internal) — DEĞİŞTİRİLMEZ (görev talimatı).
    const providerSelect = adminPage.getByLabel("Sağlayıcı");
    await expect(providerSelect).toHaveValue("internal");

    await adminPage.getByRole("button", { name: "Kaydet" }).click();
    await expect(adminPage.getByLabel("Notifications alt+T").getByText("Ayarlar kaydedildi.")).toBeVisible({ timeout: 10_000 });
  } finally {
    await close();
  }

  // Sunucu taze okuma — cache'siz.
  const afterOn = await getAdminSettings(adminToken);
  expect(afterOn.liveChatEnabled).toBe(true);
  expect(afterOn.liveChatProvider).toBe("internal");

  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    // `fetchSiteSettingsServer()` `next: { revalidate: 60 }` ile önbelleklidir (`server-settings.ts`)
    // — `products/blog/portfolio` İLE AYNI beklenen 60sn eventual-consistency (proje belleği:
    // "revalidate 60s staleness, e2e testleri toPass+reload ile YOKLAMALI, reaktif DÜZELTİLMEMELİ").
    const trigger = page.getByRole("button", { name: "Canlı destek sohbetini aç" });
    await expect(async () => {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(trigger).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 75_000, intervals: [2_000, 5_000] });
    await trigger.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText("Merhaba! Randevu veya teknik konularda size nasıl yardımcı olabiliriz?")).toBeVisible();

    // KVKK/sağlık uyarısı SÜREKLİ görünür (kapatılamaz) — [ASD] §3.7 / compliance-notes-support-desk.md §4.
    await expect(
      dialog.getByText("Lütfen sağlık durumunuza ilişkin ayrıntı paylaşmayın; tıbbi konular için randevu oluşturun.")
    ).toBeVisible();

    const messageInput = dialog.getByLabel("Mesajınızı yazın");
    const sendButton = dialog.getByRole("button", { name: "Mesajı gönder" });
    const testMessage = `qa-agent test mesajı — randevumu değiştirmek istiyorum. (${Date.now().toString(36)})`;
    const [createSessionResponse] = await Promise.all([
      page.waitForResponse((res) => /\/support\/sessions$/.test(res.url()) && res.request().method() === "POST"),
      (async () => {
        await messageInput.fill(testMessage);
        await sendButton.click();
      })(),
    ]);
    expect(createSessionResponse.status(), "qa-agent: POST /support/sessions 201 dönmeli (GERÇEK backend).").toBe(201);
    await expect(dialog.getByText(testMessage)).toBeVisible();

    // Kalıcılık kanıtı ([ASD] §3.5 madde 12 — eski istemci taraflı mock'un DÜŞTÜĞÜ yer): sayfa
    // YENİLENİNCE mesaj `sessionStorage` token'ıyla backend'den GERİ GELİR, KAYBOLMAZ.
    await page.reload({ waitUntil: "domcontentloaded" });
    await trigger.click();
    const reopenedDialog = page.getByRole("dialog");
    await expect(reopenedDialog).toBeVisible({ timeout: 10_000 });
    await expect(reopenedDialog.getByText(testMessage)).toBeVisible({ timeout: 10_000 });

    // Kapatma butonu çalışır.
    await reopenedDialog.getByRole("button", { name: "Sohbeti kapat" }).click();
    await expect(reopenedDialog).toHaveCount(0);
  } finally {
    await context.close();
  }

  // Hasta portalında da (`/patient`) AYNI şekilde görünür.
  const patientContext = await browser.newContext();
  const patientPage = await patientContext.newPage();
  try {
    await expect(async () => {
      await patientPage.goto("/patient", { waitUntil: "domcontentloaded" });
      await expect(patientPage.getByRole("button", { name: "Canlı destek sohbetini aç" })).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 45_000, intervals: [2_000, 5_000] });
  } finally {
    await patientContext.close();
  }
});

// =============================================================================
// 3) `/consultation/*` gizleme — video oda kontrollerinin ÜSTÜNE BİNMEMESİ İÇİN KRİTİK.
// =============================================================================
test("madde 3 [KRİTİK]: liveChatEnabled AÇIKKEN bile GERÇEK /consultation/{id} sayfasında widget HİÇ görünmez", async ({ page }) => {
  test.setTimeout(120_000);
  const settings = await getAdminSettings(adminToken);
  expect(settings.liveChatEnabled, "qa-agent: bu test bir önceki testin AÇTIĞI duruma bağımlıdır.").toBe(true);

  await expect(async () => {
    await page.goto(`/consultation/${consultationAppointmentId}?t=${consultationAccessToken}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /ile Görüşme$/ })).toBeVisible();
  }).toPass({ timeout: 75_000, intervals: [2_000, 5_000] });

  // Sayfa GERÇEKTEN yüklendi (randevu bilgileri görünür) — widget (açık olsa dahi) HİÇ render edilmez.
  await expect(page.getByRole("button", { name: "Canlı destek sohbetini aç" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: /Destek$/ })).toHaveCount(0);
});

// =============================================================================
// 4) Temizlik — liveChatEnabled TEKRAR KAPATILIR, ortam varsayılan (kapalı) durumuna DÖNER.
// =============================================================================
test("madde 4 (temizlik): liveChatEnabled TEKRAR KAPATILIR — paylaşımlı demo ortamı varsayılan (kapalı) durumda bırakılır", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { page, close } = await createAuthenticatedPage(browser);
  try {
    await page.goto("/admin/settings");
    const toggle = page.getByRole("switch", { name: "Canlı Destek Widget'ı" });
    await expect(toggle).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expect(page.getByLabel("Notifications alt+T").getByText("Ayarlar kaydedildi.")).toBeVisible({ timeout: 10_000 });
  } finally {
    await close();
  }

  const afterOff = await getAdminSettings(adminToken);
  expect(afterOff.liveChatEnabled, "qa-agent: paylaşımlı demo ortamı KAPALI bırakılmalı (görev talimatı, bağlayıcı).").toBe(false);

  const context = await browser.newContext();
  const verifyPage = await context.newPage();
  try {
    await expect(async () => {
      await verifyPage.goto("/", { waitUntil: "domcontentloaded" });
      await expect(verifyPage.getByRole("button", { name: "Canlı destek sohbetini aç" })).toHaveCount(0);
    }).toPass({ timeout: 75_000, intervals: [2_000, 5_000] });
  } finally {
    await context.close();
  }
});
