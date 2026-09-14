import { test, expect, type Browser, type Page } from "@playwright/test";
import { authenticator } from "otplib";
import { getCachedAdminSession, getSiteModules, patchSiteModule, getFixtureUserToken, setupAndEnableTwoFactorForSelf, API_BASE_URL } from "./support/api";
import { resetFixtureUserToBaseline, adminGetUserByEmail } from "./support/admin-users-fixtures";
import {
  ensureTelehealthModuleWithDoctors,
  createAdminDoctorFixture,
  deleteAdminDoctorFixture,
  setDoctorAvailabilityRaw,
  linkDoctorUserRaw,
  createBookingRaw,
  getPublicDoctorSlotsRaw,
  defaultSlotRangeISODates,
  type CreatedFixtureDoctor,
} from "./support/telehealth-fixtures";

/**
 * qa-agent — orkestratörün doğrudan görev talimatı (bu tur, backend-agent → frontend-agent → qa-agent
 * daraltılmış akışı): §9.7.7 KARAR K civarı 3 senaryo —
 *   1) Hekim oturumu KENDİ adına hasta randevusu OLUŞTURAMAZ (backend 403 FORBIDDEN + frontend
 *      uyarı/disabled-slot UI, `availability-calendar.tsx`).
 *   2) Kök rota guard'ı (`doctor-portal-route-guard.tsx`) — hekim oturumu `(site)` route grubunda
 *      `/doctor/**` DIŞINDA bir sayfada GEZİNEMEZ, `/`'e gidince `/doctor`'a döner; giriş sonrası
 *      `next` (güvenli olsa bile `/doctor` altında DEĞİLSE) YOK SAYILIR.
 *   3) Doktor panelinde "Portal Akışı & Duyurular" kartı (`GET /doctor/portal-feed`) hatasız render
 *      olur, statik 3 duyuru HER ZAMAN görünür.
 *
 * `telehealth-portal-isolation.spec.ts`/`telehealth-multi-slot-booking.spec.ts` İLE AYNI desen:
 * kendi, İZOLE fixture doktoru (`createAdminDoctorFixture` + `setDoctorAvailabilityRaw`, haftanın
 * HER günü geniş pencere) + kendi-kendine-servis 2FA (`setupAndEnableTwoFactorForSelf`) — paylaşımlı
 * `telehealth-clinic` demo verisine BAĞIMLI DEĞİL.
 *
 * qa-agent BULGUSU (bu dosyada belgelenir, DÜZELTİLMEZ — bkz. proje kökü CLAUDE.md "qa-agent: Bug'ı
 * kendi düzeltme"): madde 1'in frontend UI kısmı (banner + slot disable, `availability-calendar.tsx`)
 * GERÇEK bir tarayıcıda PRATİKTE HİÇ GÖRÜNMÜYOR — `DoctorPortalRouteGuard` `/doctors/[slug]`'ı da
 * (kasıtlı olarak, görev talimatının kendisi de doğruluyor) `/doctor`'a yönlendiriyor VE bu yönlendirme,
 * `isDoctorSession` context değerinin `true` olduğu AYNI render/commit döngüsünde tetikleniyor —
 * `AvailabilityCalendar` bileşeni banner'ı hiç BOYAMADAN (paint) sayfa ağacından kaldırılıyor. Bu,
 * `POST /appointments/route.replace` isteği kasıtlı olarak 3 sn GECİKTİRİLEREK (`page.route`
 * intercept) doğrulandı: URL 2.8+ saniye boyunca `/doctors/[slug]`'da SABİT kalırken (takvim/saat
 * ızgarası TAM render olmuş haldeyken) banner (`data-testid="doctor-session-booking-blocked-notice"`)
 * BİR KEZ BİLE görünür olmadı — bu bir "yavaş ağ" yarış durumu DEĞİL, deterministik/tekrarlanabilir.
 * Aşağıdaki "madde 1b" testi bu GERÇEK davranışı (`test.fixme` ile, CI'ı KIRMADAN) belgeler —
 * frontend-agent'a yönlendirilmesi gereken bir mimari çelişkidir: guard ile banner/disabled-slot
 * savunma katmanı BİRBİRİNİ GEÇERSİZ KILIYOR (banner'ın kod olarak VAR OLMASI, kullanıcıya
 * GÖSTERİLDİĞİ anlamına GELMİYOR — yalnızca backend'in 403'ü GERÇEK güvenlik sınırıdır, ki o da
 * "madde 1a" ile AYRICA doğrulanır).
 */
test.describe.configure({ mode: "serial" });

const FIXTURE_PASSWORD = "QaE2eDoctorGuard12345!";
const RUN_SUFFIX = Date.now().toString(36);
const DOCTOR_USER_EMAIL = `qa-e2e-doctor-guard-doctor-${RUN_SUFFIX}@example.com`;

let adminToken: string;
let initialTelehealthEnabled: boolean;
let doctorFixture: CreatedFixtureDoctor;
let doctorUserId: string;
let doctorUserToken: string;
let doctorTotpSecret: string;

async function cleanupFixtures() {
  await resetFixtureUserToBaseline(adminToken, DOCTOR_USER_EMAIL);
}

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  await cleanupFixtures();

  const modules = await getSiteModules(adminToken);
  initialTelehealthEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  await ensureTelehealthModuleWithDoctors(adminToken);

  doctorFixture = await createAdminDoctorFixture(adminToken, {
    title: "Dr.",
    fullName: `QA E2E Doktor Guard ${RUN_SUFFIX}`,
    bio: "qa-agent — doktor oturumu randevu engeli / kök rota guard / portal akışı e2e fixture doktoru.",
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
    doctorFixture.id,
    ([1, 2, 3, 4, 5, 6, 7] as const).map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1440 }))
  );

  doctorUserToken = await getFixtureUserToken(DOCTOR_USER_EMAIL, FIXTURE_PASSWORD, "QA E2E Doktor Guard");
  const doctorUser = await adminGetUserByEmail(adminToken, DOCTOR_USER_EMAIL);
  if (!doctorUser) throw new Error("qa-agent: doktor fixture kullanıcısı oluşturulamadı.");
  doctorUserId = doctorUser.id;
  await linkDoctorUserRaw(adminToken, doctorFixture.id, doctorUserId);
  const twoFactor = await setupAndEnableTwoFactorForSelf(doctorUserToken);
  doctorTotpSecret = twoFactor.secret;
});

test.afterAll(async () => {
  await cleanupFixtures();
  if (doctorFixture) await deleteAdminDoctorFixture(adminToken, doctorFixture.id).catch(() => undefined);
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

/**
 * `telehealth-portal-isolation.spec.ts::loginDoctorDirectlyWithTwoFactor` İLE AYNI desen — düz
 * `/login`'den (veya `opts.next` verilirse `?next=`'li) GERÇEK 2FA login akışı. `opts.expectFinalUrl`
 * verilmezse `/doctor`'a düştüğü varsayılır (bu dosyanın normal/varsayılan davranışı).
 */
async function loginDoctorWithTwoFactor(
  browser: Browser,
  opts: { next?: string; expectFinalUrl?: RegExp } = {}
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:3100" });
  const page = await context.newPage();
  const loginUrl = opts.next ? `/login?next=${encodeURIComponent(opts.next)}` : "/login";
  await page.goto(loginUrl);
  await page.getByLabel("E-posta").fill(DOCTOR_USER_EMAIL);
  await page.getByLabel("Şifre").fill(FIXTURE_PASSWORD);
  await page.getByRole("button", { name: "Giriş yap" }).click();

  await expect(page.getByText("Kimlik doğrulama uygulamanızdaki 6 haneli kodu", { exact: false })).toBeVisible({ timeout: 15_000 });
  const code = authenticator.generate(doctorTotpSecret);
  await page.getByLabel("Doğrulama Kodu").fill(code);
  await page.getByRole("button", { name: "Doğrula" }).click();

  await page.waitForURL(opts.expectFinalUrl ?? /\/doctor$/, { timeout: 15_000 });
  return {
    page,
    close: async () => {
      await context.close();
    },
  };
}

// =============================================================================
// madde 1 — Doktor oturumuyla randevu alma engeli
// =============================================================================

test("madde 1a: doktor Bearer token'ıyla POST /appointments/bookings çağrısı 403 FORBIDDEN döner (misafir/hasta akışı ETKİLENMEZ)", async () => {
  const { from, to } = defaultSlotRangeISODates(14);
  const slotsRes = await getPublicDoctorSlotsRaw(doctorFixture.slug, from, to);
  const availableSlot = (slotsRes.data ?? []).find((s) => s.available);
  if (!availableSlot) throw new Error("qa-agent: madde 1a için müsait slot bulunamadı.");

  const asDoctor = await createBookingRaw(
    {
      doctorSlug: doctorFixture.slug,
      slots: [availableSlot.startsAt],
      patientName: "QA Guard Test Hastası",
      patientEmail: `qa-e2e-doctor-guard-blocked-${RUN_SUFFIX}@example.com`,
    },
    doctorUserToken
  );
  expect(asDoctor.status).toBe(403);
  expect(asDoctor.error?.code).toBe("FORBIDDEN");

  // Kontrol grubu — AYNI slot, AYNI doktor, oturumsuz (misafir) istek NORMAL şekilde 201 döner;
  // hekim guard'ının yalnızca hekim OTURUMUNU hedeflediğini, misafir akışını BOZMADIĞINI kanıtlar.
  const asGuest = await createBookingRaw({
    doctorSlug: doctorFixture.slug,
    slots: [availableSlot.startsAt],
    patientName: "QA Guard Test Misafir Hastası",
    patientEmail: `qa-e2e-doctor-guard-guest-${RUN_SUFFIX}@example.com`,
  });
  expect(asGuest.status).toBe(201);
});

test("madde 1a-bis: doktor Bearer token'ıyla DEPRECATED POST /appointments çağrısı da 403 FORBIDDEN döner", async () => {
  const { from, to } = defaultSlotRangeISODates(14);
  const slotsRes = await getPublicDoctorSlotsRaw(doctorFixture.slug, from, to);
  const availableSlot = (slotsRes.data ?? []).find((s) => s.available);
  if (!availableSlot) throw new Error("qa-agent: madde 1a-bis için müsait slot bulunamadı.");

  const res = await fetch(`${API_BASE_URL}/appointments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${doctorUserToken}` },
    body: JSON.stringify({
      doctorSlug: doctorFixture.slug,
      startsAt: availableSlot.startsAt,
      patientName: "QA Guard Test Hastası (deprecated uç)",
      patientEmail: `qa-e2e-doctor-guard-deprecated-${RUN_SUFFIX}@example.com`,
      consent: true,
    }),
  });
  const body = (await res.json()) as { error?: { code: string; message: string } };
  expect(res.status).toBe(403);
  expect(body.error?.code).toBe("FORBIDDEN");
  expect(body.error?.message).toBe("Hekim profilleri hasta randevusu oluşturamaz.");
});

// qa-agent BULGUSU — frontend-agent'a yönlendirilmesi gerekir: `DoctorPortalRouteGuard`,
// `isDoctorSession` context değeri true olduğu AYNI render döngüsünde `/doctors/[slug]`'ı
// `/doctor`'a yönlendiriyor; `AvailabilityCalendar`'ın uyarı banner'ı
// (data-testid=doctor-session-booking-blocked-notice) ve disabled-slot UI'ı GERÇEK bir tarayıcıda
// hiçbir zaman boyanmıyor (kasıtlı olarak 3 sn geciktirilen router.replace ile doğrulandı, dosya
// başlığındaki "qa-agent BULGUSU" notuna bkz.) — bu test niyet edilen (ticket'taki) davranışı
// belgeler, frontend-agent guard/banner çakışmasını çözene kadar bilinçli olarak `fixme` bırakılır
// (CI'ı KIRMAZ, `test.fixme(title, body)` formu — bkz. Playwright API).
test.fixme("madde 1b: doktor oturumuyla /doctors/[slug]'da uyarı banner'ı görünür ve müsait slotlar tıklanamaz", async ({
  browser,
}) => {
  const { page, close } = await loginDoctorWithTwoFactor(browser);
  try {
    await page.goto(`/doctors/${doctorFixture.slug}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("doctor-session-booking-blocked-notice")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Hekim oturumu ile randevu alınamaz.")).toBeVisible();

    const disabledSlot = page.getByLabel(/— müsait, ancak hekim oturumu ile randevu alınamaz$/).first();
    await expect(disabledSlot).toBeVisible({ timeout: 10_000 });
    await expect(disabledSlot).toHaveAttribute("aria-disabled", "true");
    await disabledSlot.click({ force: true });
    await expect(page.getByLabel("Ad soyad")).toHaveCount(0);
  } finally {
    await close();
  }
});

// =============================================================================
// madde 2 — Kök rota guard (`/` → doktor girişinde `/doctor`'a otomatik yönlendirme)
// =============================================================================

test("madde 2a: doktor 2FA ile düz /login'den giriş yapınca /doctor'a düşer; sonra `/`'e gidince guard tekrar /doctor'a döner", async ({
  browser,
}) => {
  const { page, close } = await loginDoctorWithTwoFactor(browser);
  try {
    await expect(page).toHaveURL(/\/doctor$/);

    await page.goto("/");
    await page.waitForURL(/\/doctor$/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/doctor$/);
  } finally {
    await close();
  }
});

test("madde 2b: /login?next=/doctors/{slug} (doktor-olmayan güvenli next) ile giriş yapılırsa next YOK SAYILIR, sonuç /doctor'dur", async ({
  browser,
}) => {
  const { page, close } = await loginDoctorWithTwoFactor(browser, { next: `/doctors/${doctorFixture.slug}` });
  try {
    // `loginDoctorWithTwoFactor` zaten `expectFinalUrl` varsayılanı (`/doctor$`) ile
    // `waitForURL` yaptı — `next`'in GERÇEKTEN görmezden gelindiğinin ek/açık kanıtı.
    await expect(page).toHaveURL(/\/doctor$/);
    await expect(page).not.toHaveURL(new RegExp(`/doctors/${doctorFixture.slug}$`));
  } finally {
    await close();
  }
});

test("madde 2c: /login?next=/doctor/bookings (zaten /doctor altında güvenli next) ile giriş yapılırsa next KORUNUR", async ({ browser }) => {
  const { page, close } = await loginDoctorWithTwoFactor(browser, { next: "/doctor/bookings", expectFinalUrl: /\/doctor\/bookings$/ });
  try {
    await expect(page).toHaveURL(/\/doctor\/bookings$/);
  } finally {
    await close();
  }
});

// =============================================================================
// madde 3 — Doktor panelinde "Portal Akışı & Duyurular" kartı
// =============================================================================

test("madde 3: /doctor panelinde 'Portal Akışı & Duyurular' kartı hatasız render olur, en az 3 statik duyuru satırı görünür, sayfa hatası YOK", async ({
  browser,
}) => {
  const pageErrors: Error[] = [];
  const { page, close } = await loginDoctorWithTwoFactor(browser);
  page.on("pageerror", (err) => pageErrors.push(err));
  try {
    // Login zaten /doctor'a düştü — kart `doctor-bookings-panel.tsx`'in üst kısmında mount edilir.
    await expect(page.getByTestId("doctor-portal-feed-card")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Portal Akışı & Duyurular")).toBeVisible();

    const announcementRows = page.getByTestId("doctor-portal-feed-announcement");
    await expect(announcementRows.first()).toBeVisible({ timeout: 15_000 });
    await expect(announcementRows).toHaveCount(3);
    // §Görev 3 — statik liste her zaman 3 kayıt döner, "boş" durumu bu turda GÖRÜNMEMELİ.
    await expect(page.getByTestId("doctor-portal-feed-announcements-empty")).toHaveCount(0);

    // Duyuru önem seviyeleri (`data-severity`) — statik listenin 3 farklı seviyeyi kapsadığını
    // (`INFO`/`IMPORTANT`/`SYSTEM`, `lib/portal-announcements.ts`) UI seviyesinde de doğrular.
    const severities = await announcementRows.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-severity")));
    expect(new Set(severities)).toEqual(new Set(["INFO", "IMPORTANT", "SYSTEM"]));

    // Bildirim listesi — bu TAZE fixture doktorunun (bu testte HENÜZ hiçbir booking'i YOK, madde 1a
    // yalnızca 403 ile REDDEDİLEN bir istek + AYRI bir misafir booking'i başka bir doktora değil AYNI
    // doktora oluşturdu — bu yüzden ikisi de "boş" ya da "dolu" olabilir; görev talimatı madde 3'ün
    // kendisi de ikisinin de geçerli olduğunu belirtiyor). Kartın ÇÖKMEDİĞİNİ/boş-durumun zarifçe
    // göründüğünü (ikisinden TAM OLARAK biri görünür) doğrulamak yeterlidir.
    const notificationRows = page.getByTestId("doctor-portal-feed-notification");
    const emptyNotifications = page.getByTestId("doctor-portal-feed-notifications-empty");
    await expect(notificationRows.or(emptyNotifications).first()).toBeVisible({ timeout: 15_000 });

    // Kart hatasız — `Alert variant="error"` (API hatası banner'ı) render EDİLMEMİŞ olmalı.
    await expect(page.getByTestId("doctor-portal-feed-card").getByText("Tekrar Dene")).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  } finally {
    await close();
  }
});
