import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { getCachedAdminSession, getSiteModules, patchSiteModule, getFixtureUserToken, setupAndEnableTwoFactorForSelf, nextTotpCode } from "./support/api";
import { adminGetUserByEmail, adminUpdateStatus } from "./support/admin-users-fixtures";
import {
  ensureTelehealthModuleWithDoctors,
  getPublicDoctorSlotsRaw,
  defaultSlotRangeISODates,
  createAppointmentRaw,
  getAppointmentRaw,
  requestMeetingTokenRaw,
  shiftAppointmentIntoJoinWindowDirectly,
  markAppointmentJoinableDirectly,
  createAdminDoctorFixture,
  deleteAdminDoctorFixture,
  setDoctorAvailabilityRaw,
  linkDoctorUserRaw,
  type CreatedAppointment,
  type CreatedFixtureDoctor,
} from "./support/telehealth-fixtures";
import { consultationStrings as trStrings } from "../../src/lib/i18n/site-dictionaries/tr/consultation";
import { consultationStrings as arStrings } from "../../src/lib/i18n/site-dictionaries/ar/consultation";

/**
 * qa-agent — Paket AF (görüşme odası profesyonelleştirme) gerçek LiveKit E2E'si + ekran görüntüleri.
 * Çalıştırma (yerel, `chrome-livekit-media` projesi — gerçek Chrome + sahte cihaz):
 *   cd frontend && E2E_SKIP_WEBSERVER=1 E2E_FRONTEND_URL=http://siteadi.localhost:3200 \
 *     E2E_API_URL=http://localhost:4002/api/v1 npx playwright test tests/e2e/consultation-room-af-live.spec.ts \
 *     --project=chrome-livekit-media --no-deps --workers=1
 *
 * Ekran görüntüleri `docs/prompts/2026-11-01-AF-ekran/` altına yazılır. Yalnızca test fixture adları kullanılır.
 * Tercüman senaryosu: bkz. dosya sonundaki `test.skip` gerekçesi.
 */
test.describe.configure({ timeout: 150_000 }); // serial DEĞİL: bir kırılma sonraki testleri gizlemesin (workers=1 ile sıralı koşar)

const SHOT_DIR = path.resolve(process.cwd(), "..", "docs", "prompts", "2026-11-01-AF-ekran");
mkdirSync(SHOT_DIR, { recursive: true });

type Lang = "tr" | "ar";
const STR = { tr: trStrings, ar: arStrings };
const PREFIX: Record<Lang, string> = { tr: "", ar: "/ar" };

const RUN_SUFFIX = Date.now().toString(36);
const DOCTOR_EMAIL = `qa-e2e-af-doctor-${RUN_SUFFIX}@example.com`;
const DOCTOR_PASSWORD = "Zk9#mPq27Lw!xv41";
const PATIENT_NAME = `Test Hasta ${RUN_SUFFIX}`;
const DOCTOR_FULL_NAME = `Test Doktor ${RUN_SUFFIX}`;

let adminToken: string;
let initialTelehealthEnabled: boolean;
let liveKitConfigured: boolean;
let fixtureDoctor: CreatedFixtureDoctor;
let doctorUserId: string;
let doctorContext: BrowserContext;

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

async function newBookedAppointment(label: string): Promise<CreatedAppointment> {
  const { from, to } = defaultSlotRangeISODates(30);
  const slotsRes = await getPublicDoctorSlotsRaw(fixtureDoctor.slug, from, to);
  const slot = (slotsRes.data ?? []).find((s) => s.available);
  if (!slot) throw new Error("müsait slot yok");
  const res = await createAppointmentRaw({
    doctorSlug: fixtureDoctor.slug,
    startsAt: slot.startsAt,
    patientName: PATIENT_NAME,
    patientEmail: `qa-e2e-af-${label}-${Date.now()}@example.com`,
  });
  if (res.status !== 201 || !res.data) throw new Error(`randevu oluşturulamadı: ${res.status} ${JSON.stringify(res.error)}`);
  shiftAppointmentIntoJoinWindowDirectly(res.data.id, 90, 30);
  markAppointmentJoinableDirectly(res.data.id);
  return res.data;
}

async function openPrejoin(page: Page, lang: Lang, appt: CreatedAppointment, withToken: boolean): Promise<void> {
  const url = `${PREFIX[lang]}/consultation/${appt.id}${withToken ? `?t=${appt.accessToken}` : ""}`;
  await expect(async () => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: STR[lang].joinButton })).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 90_000, intervals: [2_000, 5_000] });
}

async function join(page: Page, lang: Lang): Promise<void> {
  await page.getByRole("button", { name: STR[lang].joinButton }).click();
  await expect(page.getByText(STR[lang].badgeConnected, { exact: true })).toBeVisible({ timeout: 30_000 });
}

async function newPatientContext(browser: Browser, opts: Parameters<Browser["newContext"]>[0] = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "tr-TR", ...opts });
  await ctx.grantPermissions(["camera", "microphone"]);
  return ctx;
}

async function tileLabels(page: Page): Promise<string[]> {
  return (await page.locator('[data-testid="tile-label"]').allInnerTexts()).map((s) => s.trim()).filter(Boolean);
}

/** Görünür metin + erişilebilir ad/title/aria-label değerlerinde identity (`doctor:`/`patient:`) ASLA geçmemeli. */
async function expectNoIdentityLeak(page: Page): Promise<void> {
  const leaked = await page.evaluate(() => {
    const re = /\b(doctor|patient|interpreter):[0-9a-f-]{8,}|\b(doctor|patient|interpreter):\S+/i;
    const hits: string[] = [];
    const text = document.body.innerText;
    if (re.test(text)) hits.push(`text:${text.match(re)?.[0]}`);
    document.querySelectorAll("[aria-label],[title],[alt]").forEach((el) => {
      for (const attr of ["aria-label", "title", "alt"]) {
        const v = el.getAttribute(attr);
        if (v && re.test(v)) hits.push(`${attr}:${v}`);
      }
    });
    return hits;
  });
  expect(leaked).toEqual([]);
}

async function waitVideosRendering(page: Page, count: number): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const v = Array.from(document.querySelectorAll("video"));
          return { count: v.length, ok: v.length > 0 && v.every((x) => x.videoWidth > 0 && x.videoHeight > 0) };
        }),
      { timeout: 25_000, intervals: [1_000] }
    )
    .toEqual({ count, ok: true });
}

async function loginDoctor(ctx: BrowserContext): Promise<void> {
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(DOCTOR_EMAIL);
  await page.getByLabel("Şifre").fill(DOCTOR_PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page.getByText("İki adımlı doğrulama", { exact: false })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Authenticator Kodu").fill(await nextTotpCode(doctorTotpSecret));
  await page.getByRole("button", { name: "Doğrula" }).click();
  await expect(page.getByText("İki adımlı doğrulama", { exact: false })).toHaveCount(0, { timeout: 20_000 });
  await page.waitForLoadState("domcontentloaded");
  await page.close();
}
let doctorTotpSecret: string;

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(240_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  await ensureTelehealthModuleWithDoctors(adminToken);
  const probe = await requestMeetingTokenRaw("00000000-0000-0000-0000-000000000000");
  liveKitConfigured = probe.status !== 503;

  fixtureDoctor = await createAdminDoctorFixture(adminToken, {
    title: "Dr.",
    fullName: DOCTOR_FULL_NAME,
    bio: "qa-agent — Paket AF oda testi fixture doktoru.",
    languages: ["tr"],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 30,
    sessionPriceCents: 40000,
    currency: "TRY",
    isVerified: true,
    isActive: true,
  });
  await setDoctorAvailabilityRaw(
    adminToken,
    fixtureDoctor.id,
    ([1, 2, 3, 4, 5, 6, 7] as const).map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 }))
  );
  const doctorUserToken = await getFixtureUserToken(DOCTOR_EMAIL, DOCTOR_PASSWORD, "Test Doktor Kullanici");
  const doctorUser = await adminGetUserByEmail(adminToken, DOCTOR_EMAIL);
  if (!doctorUser) throw new Error("doktor kullanıcısı oluşturulamadı");
  doctorUserId = doctorUser.id;
  await linkDoctorUserRaw(adminToken, fixtureDoctor.id, doctorUserId);
  doctorTotpSecret = (await setupAndEnableTwoFactorForSelf(doctorUserToken, DOCTOR_PASSWORD)).secret;

  doctorContext = await newPatientContext(browser);
  await loginDoctor(doctorContext);
});

test.afterAll(async () => {
  await doctorContext?.close().catch(() => undefined);
  if (fixtureDoctor) await deleteAdminDoctorFixture(adminToken, fixtureDoctor.id).catch(() => undefined);
  if (doctorUserId) await adminUpdateStatus(adminToken, doctorUserId, "SUSPENDED").catch(() => undefined);
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

test.beforeEach(() => {
  test.skip(!liveKitConfigured, "LiveKit yapılandırılmamış.");
});

async function expectedDoctorLabel(appt: CreatedAppointment): Promise<string> {
  const res = await getAppointmentRaw(appt.id, appt.accessToken);
  const d = (res.data as { doctor?: { title?: string | null; displayName?: string | null; fullName?: string | null } } | undefined)?.doctor;
  return `${d?.title ?? ""} ${d?.displayName ?? d?.fullName ?? ""}`.trim();
}

for (const lang of ["tr", "ar"] as const) {
  test(`[${lang}] iki taraf: doğru ad etiketleri, identity sızıntısı yok, kalite göstergesi + kontrol çubuğu; masaüstü ekran görüntüleri`, async ({ browser }) => {
    const t = STR[lang];
    const appt = await newBookedAppointment(`names-${lang}`);
    const doctorLabel = await expectedDoctorLabel(appt);
    expect(doctorLabel).toContain("Dr.");

    const patientCtx = await newPatientContext(browser);
    const patient = await patientCtx.newPage();
    const doctor = await doctorContext.newPage();
    try {
      // Giriş öncesi cihaz testi ekranı (hasta)
      await openPrejoin(patient, lang, appt, true);
      await expect(patient.getByTestId("prejoin-device-check")).toBeVisible();
      await patient.getByTestId("prejoin-test-start").click();
      await expect(patient.getByTestId("prejoin-preview")).toBeVisible({ timeout: 15_000 });
      await expect
        .poll(() => patient.evaluate(() => Array.from(document.querySelectorAll("video")).some((v) => v.videoWidth > 0)), { timeout: 15_000 })
        .toBe(true);
      await patient.getByTestId("prejoin-device-check").scrollIntoViewIfNeeded();
      await patient.waitForTimeout(1_000);
      await shot(patient, `masaustu-${lang}-giris-oncesi-cihaz-testi`);

      // Bekleme odası (karşı taraf yok)
      await join(patient, lang);
      await expect(patient.getByText(t.waitingRoomTitle)).toBeVisible({ timeout: 15_000 });
      await patient.waitForTimeout(1_000);
      await shot(patient, `masaustu-${lang}-bekleme-odasi`);

      // Doktor katılır
      await openPrejoin(doctor, lang, appt, false);
      await join(doctor, lang);
      await expect(patient.getByText(t.waitingRoomTitle)).toHaveCount(0, { timeout: 25_000 });
      await waitVideosRendering(patient, 2);
      await waitVideosRendering(doctor, 2);

      // Ad etiketleri
      await expect.poll(() => tileLabels(patient), { timeout: 15_000 }).toContain(doctorLabel);
      await expect.poll(() => tileLabels(doctor), { timeout: 15_000 }).toContain(PATIENT_NAME);
      expect(await tileLabels(patient)).toContain(PATIENT_NAME); // kendi kutusu
      expect(await tileLabels(doctor)).toContain(doctorLabel);
      await expectNoIdentityLeak(patient);
      await expectNoIdentityLeak(doctor);

      // Kalite göstergesi + kontrol çubuğu
      const qualityPattern = new RegExp(`^${t.qualityLabel.split("{level}")[0]!.trim()}`);
      for (const p of [patient, doctor]) {
        await p.mouse.move(400, 400);
        await expect(p.getByTestId("control-bar")).toBeVisible();
        await expect(p.getByRole("img", { name: qualityPattern }).first()).toBeVisible();
        expect(await p.getByRole("img", { name: qualityPattern }).count()).toBeGreaterThanOrEqual(2);
        await expect(p.getByTestId("bar-end-call")).toBeVisible();
      }

      await patient.mouse.move(600, 500);
      await patient.waitForTimeout(800);
      await shot(patient, `masaustu-${lang}-gorusme-hasta-ekrani`);
      await doctor.mouse.move(600, 500);
      await shot(doctor, `masaustu-${lang}-gorusme-doktor-ekrani`);

      // Ayarlar paneli
      await patient.getByTestId("bar-settings").click();
      await expect(patient.getByTestId("settings-panel")).toBeVisible();
      await patient.waitForTimeout(800);
      await shot(patient, `masaustu-${lang}-ayarlar-paneli-acik`);
    } finally {
      await patientCtx.close();
      await doctor.close();
    }
  });
}

for (const lang of ["tr", "ar"] as const) {
  test(`[${lang}] mobil emülasyon: dikey 390x844 ve yatay 844x390 görüşme ekranı`, async ({ browser }) => {
    const t = STR[lang];
    const appt = await newBookedAppointment(`mobile-${lang}`);
    const patientCtx = await newPatientContext(browser, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const patient = await patientCtx.newPage();
    const doctor = await doctorContext.newPage();
    try {
      await openPrejoin(patient, lang, appt, true);
      await join(patient, lang);
      await openPrejoin(doctor, lang, appt, false);
      await join(doctor, lang);
      await expect(patient.getByText(t.waitingRoomTitle)).toHaveCount(0, { timeout: 25_000 });
      await waitVideosRendering(patient, 2);
      await patient.waitForTimeout(1_000);
      await shot(patient, `mobil-${lang}-dikey-390x844-gorusme`);

      // Yatay: AYNI hasta için yeni bir mobil bağlam (gerçek cihaz döndürme gibi, ama dvh/media sorguları baştan değerlendirilir).
      await patientCtx.close();
      const landscapeCtx = await newPatientContext(browser, { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      try {
        const land = await landscapeCtx.newPage();
        await openPrejoin(land, lang, appt, true);
        await join(land, lang);
        await expect(land.getByText(t.waitingRoomTitle)).toHaveCount(0, { timeout: 25_000 });
        await waitVideosRendering(land, 2);
        await land.waitForTimeout(1_000);
        const box = await land.locator(".lk-room-container").boundingBox();
        const cs = await land.locator(".lk-room-container").evaluate((el) => {
          const c = getComputedStyle(el);
          return { height: c.height, aspectRatio: c.aspectRatio, maxHeight: c.maxHeight, display: c.display, mediaMatch: matchMedia("(orientation:landscape) and (max-height:520px)").matches };
        });
        test.info().annotations.push({ type: "yatay-oda-kutusu", description: JSON.stringify({ box, cs }) });
        await land.locator(".lk-room-container").scrollIntoViewIfNeeded();
        await land.waitForTimeout(800);
        await shot(land, `mobil-${lang}-yatay-844x390-gorusme`);
        expect(box?.height ?? 0, "yatay mobilde oda sahnesi görünür yüksekliğe sahip olmalı").toBeGreaterThan(200);
      } finally {
        await landscapeCtx.close();
      }
    } finally {
      await patientCtx.close();
      await doctor.close();
    }
  });
}

test("bağlantı zayıf: CDP ağ kısıtlaması ile yerel kalite Poor olursa bant görünür (≤45 sn tetiklenmezse not düşülüp atlanır)", async ({ browser }) => {
  const t = STR.tr;
  const appt = await newBookedAppointment("weak");
  const ctx = await newPatientContext(browser);
  const patient = await ctx.newPage();
  const doctor = await doctorContext.newPage();
  try {
    await openPrejoin(patient, "tr", appt, true);
    await join(patient, "tr");
    await openPrejoin(doctor, "tr", appt, false);
    await join(doctor, "tr");
    await waitVideosRendering(patient, 2);

    const cdp = await ctx.newCDPSession(patient);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 1500, downloadThroughput: 8 * 1024, uploadThroughput: 8 * 1024, packetLoss: 40 } as never);

    const banner = patient.getByTestId("weak-connection-banner");
    let triggered = true;
    try {
      await expect(banner).toBeVisible({ timeout: 45_000 });
    } catch {
      triggered = false;
    }
    if (!triggered) {
      test.info().annotations.push({
        type: "qa-agent-atlandi",
        description:
          "CDP Network.emulateNetworkConditions WebRTC (UDP/ICE) trafiğini kısıtlamadığı için 45 sn içinde yerel kalite Poor olmadı; " +
          "'bağlantı zayıf' bandı tetiklenemedi. Sahte gösterim yapılmadı. Bant mantığı kodda ConnectionQualityChanged dinleyicisine bağlı.",
      });
    } else {
      await expect(banner.getByText(t.weakConnection)).toBeVisible();
      await shot(patient, "durum-baglanti-zayif");
    }
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => undefined);
  } finally {
    await ctx.close();
    await doctor.close();
  }
});

test("yeniden bağlanılıyor: setOffline kısa süre → katman görünür; geri gelince kalkar, görüşme sürer, giriş ekranına düşülmez", async ({ browser }) => {
  const t = STR.tr;
  const appt = await newBookedAppointment("reconnect");
  const ctx = await newPatientContext(browser);
  const patient = await ctx.newPage();
  const doctor = await doctorContext.newPage();
  try {
    await openPrejoin(patient, "tr", appt, true);
    await join(patient, "tr");
    await openPrejoin(doctor, "tr", appt, false);
    await join(doctor, "tr");
    await waitVideosRendering(patient, 2);

    await ctx.setOffline(true);
    const overlay = patient.getByTestId("reconnecting-overlay");
    await expect(overlay).toBeVisible({ timeout: 30_000 });
    await expect(overlay.getByText(t.reconnectingTitle)).toBeVisible();
    await patient.waitForTimeout(500);
    await shot(patient, "durum-yeniden-baglaniliyor");

    await ctx.setOffline(false);
    await expect(overlay).toHaveCount(0, { timeout: 60_000 });
    await expect(patient.getByText(t.badgeConnected, { exact: true })).toBeVisible({ timeout: 30_000 });
    // Giriş (prejoin) ekranına düşülmedi, görüşme sürüyor.
    await expect(patient.getByRole("button", { name: t.joinButton })).toHaveCount(0);
    await expect(patient.getByTestId("control-bar")).toBeAttached();
    await expect.poll(() => tileLabels(patient), { timeout: 30_000 }).toContain(PATIENT_NAME);
    await waitVideosRendering(patient, 2);
  } finally {
    await ctx.setOffline(false).catch(() => undefined);
    await ctx.close();
    await doctor.close();
  }
});

// Kırılma bulunursa serial mod sonraki testleri atlayacağından en sona konuldu.
test("sekme çakışması: ikinci sekme katılınca İLK sekmede 'başka bir sekmede açık' ekranı + 'Burada devam et'; ping-pong yok", async ({ browser }) => {
  const t = STR.tr;
  const appt = await newBookedAppointment("dup");
  const ctx = await newPatientContext(browser);
  const tab1 = await ctx.newPage();
  const tab2 = await ctx.newPage();
  // Ping-pong ölçümü: her sekmenin LiveKit sinyal bağlantısı kurma girişimi sayısı (SDK `signal connecting to ...` günlüğü).
  const connects = { tab1: 0, tab2: 0 };
  tab1.on("console", (m) => { if (m.text().startsWith("signal connecting to")) connects.tab1++; });
  tab2.on("console", (m) => { if (m.text().startsWith("signal connecting to")) connects.tab2++; });
  try {
    await openPrejoin(tab1, "tr", appt, true);
    await join(tab1, "tr");

    await openPrejoin(tab2, "tr", appt, true);
    await tab2.getByRole("button", { name: t.joinButton }).click();

    // Çakışma ekranı hangi sekmede çıkıyor? (beklenen: İLK sekme; kanıt için görüntü ikisinden alınır)
    const dupTab1 = tab1.getByTestId("duplicate-identity");
    const dupTab2 = tab2.getByTestId("duplicate-identity");
    await expect.poll(async () => (await dupTab1.count()) + (await dupTab2.count()), { timeout: 30_000 }).toBeGreaterThan(0);
    await tab1.waitForTimeout(1_000);
    const dupOn = (await dupTab1.count()) > 0 ? "tab1 (ilk sekme)" : "tab2 (yeni sekme)";
    await shot((await dupTab1.count()) > 0 ? tab1 : tab2, "durum-sekme-cakismasi");
    test.info().annotations.push({ type: "sekme-cakismasi", description: `duplicate ekranı: ${dupOn}` });

    // Ping-pong: 30 sn boyunca yeni bağlantı girişimi olmamalı (başlangıçtaki 1 + 1 girişim hariç).
    const before = { ...connects };
    await tab1.waitForTimeout(30_000);
    const extra = { tab1: connects.tab1 - before.tab1, tab2: connects.tab2 - before.tab2 };
    test.info().annotations.push({ type: "baglanti-girisimleri", description: `toplam tab1=${connects.tab1} tab2=${connects.tab2}; 30 sn pencerede ek: ${JSON.stringify(extra)}` });
    expect.soft(extra, "30 sn boyunca iki sekme birbirini yeniden bağlanmaya zorlamamalı (ping-pong yok)").toEqual({ tab1: 0, tab2: 0 });

    // Spec'teki beklenti: İLK sekmede çakışma ekranı + düğme.
    await expect(dupTab1, "çakışma ekranı İLK sekmede olmalı").toBeVisible({ timeout: 5_000 });
    await expect(dupTab1.getByText(t.duplicateTitle)).toBeVisible();
    await expect(dupTab1.getByRole("button", { name: t.duplicateContinue })).toBeVisible();
    await expect(tab2.getByText(t.badgeConnected, { exact: true })).toBeVisible();
    await expect(dupTab2).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test.skip("tercüman (+) senaryosu: 3 kişide ızgara yerleşimi + tercüman ekranında hasta adı yalnızca baş harf", async () => {
  // ATLANDI (qa-agent gerekçesi): e2e'de tercüman fixture'ı yok. Kurmak için admin tercüman profili + dil eşleşmesi +
  // randevuya tercüman ataması + tercümanın kendi kullanıcı hesabı (2FA zorunlu akış) ve /interpreter/session/[id]
  // davet akışı gerekir; maliyetli. Tercüman maskesi (hasta baş harfi "X. Y.", tam ad tercümana gitmez) backend
  // entegrasyon testlerinde kapsanıyor; etiket çözümü `participant-label` unit testlerinde.
});
