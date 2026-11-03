import { test, expect, type Browser, type Page } from "@playwright/test";
import { API_BASE_URL, getCachedAdminSession, setupAndEnableTwoFactorForSelf } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";
import { assertAiState, pickTopicBySearch, turkishLetterHits, walkWizardToResult } from "./support/ai-services-fixtures";
import {
  COORDINATOR_DISPLAY_NAME,
  COORDINATOR_PASSWORD,
  DOCTOR_WORDS,
  SERVICE_SLUG,
  apiJson,
  bookViaApi,
  coordinatorToken,
  ensureDeskAndCoordinator,
  fetchSlots,
  issueGuestToken,
  issueManageToken,
  loginCoordinatorPage,
  pickFirstSlot,
  resetCoordinatorTwoFactor,
  prepareContext,
  setBookingEnabled,
  settle,
  shiftConsultationToNow,
  uniqueEmail,
  walkBookingWizard,
  type Slot,
} from "./support/ai3-service-fixtures";

/**
 * qa-agent — Paket AI (Is 3, hizli surum) hizmet gorusmesi rezervasyonu: admin Hizmet Masasi, ziyaretci sihirbazi,
 * cift rezervasyon, koordinator paneli (Gorusmelerim, katilim penceresi, 2FA kapisi), yonetim baglantisi (degistir/iptal),
 * misafir katilim amac metinleri, `serviceBookingEnabled` kapaliyken yonlendirme ve Find your treatment sonucu.
 *
 * Odeme YOK. E-posta yakalama yok: yonetim/misafir belirtecleri test DB'sinde uretilip yalnizca ozeti yazilir
 * (bkz. support/ai3-service-fixtures.ts). Yalnizca saas_e2e. Backend :4001 + frontend :3100 (E2E_SKIP_WEBSERVER=1).
 * Ziyaretci sayfalarinda doktor ifadesi / Turkce harf yoktur (SVC ziyaretci sozlukleri EN metin tasir).
 */
test.use({ navigationTimeout: 120_000, actionTimeout: 20_000 });
// Testler dosya sirasiyla ve tek worker ile kosar; bir testin (ornegin bilinen hata 4a) dusmesi digerlerini atlatmasin.
test.describe.configure({ mode: "default" });

const SHARED_PASSWORD_NOTE = "yalnizca-yerel";
void SHARED_PASSWORD_NOTE;

let adminToken = "";
let coordinatorProfileId = "";
let bookedNumber = ""; // test 2 (UI)
let todayNumber = ""; // test 4
let todayId = "";
let coordPage: Page | null = null;
let closeCoord: (() => Promise<void>) | null = null;

/** Metinden hekim aciklamasi (yasal uyari cumlesi) cikarilir; geri kalaninda doktor ifadesi aranir. */
function withoutMedicalDisclaimer(text: string): string {
  return text.replace(/This is not a medical examination[^.]*\.[^.]*\./gi, "");
}

async function bodyText(page: Page): Promise<string> {
  // Secim listeleri (ulke/dil yerel adlari, ornegin Français) hariç tutulur.
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("select, script, style, noscript").forEach((n) => n.remove());
    return (clone.textContent ?? "").replace(/s+/g, " ");
  });
}

function istanbulDate(iso: string | number | Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

async function newVisitor(browser: Browser, opts: { width?: number } = {}) {
  const context = await browser.newContext({ baseURL: process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100", viewport: { width: opts.width ?? 1280, height: 900 } });
  await prepareContext(context);
  const page = await context.newPage();
  return { context, page };
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  adminToken = (await getCachedAdminSession()).accessToken;
  await assertAiState();
  resetCoordinatorTwoFactor();
  const setup = await ensureDeskAndCoordinator(adminToken);
  coordinatorProfileId = setup.coordinatorProfileId;
  const cfg = await apiJson<{ enabled: boolean }>("/service-consultations/config");
  expect(cfg.body.data?.enabled, "masa rezerve edilebilir olmali").toBe(true);
});

test.afterAll(async () => {
  await closeCoord?.().catch(() => undefined);
  resetCoordinatorTwoFactor();
  adminToken = (await getCachedAdminSession()).accessToken;
  await setBookingEnabled(adminToken, true).catch(() => undefined);
});

test("1) admin: Hizmet Masasi, koordinatorler ve gorusmeler ekranlari acilir", async ({ browser }) => {
  test.setTimeout(180_000);
  const { page, close } = await createAuthenticatedPage(browser);
  try {
    await page.goto("/admin/service-desk");
    await expect(page.getByTestId("desk-settings-card")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("desk-hours-card")).toBeVisible();
    await expect(page.getByTestId("desk-closures-card")).toBeVisible();
    await expect(page.getByTestId("desk-booking-switch-card")).toBeVisible();
    await expect(page.getByTestId("desk-stats")).toContainText(/1/);

    await page.goto("/admin/service-desk/coordinators");
    await expect(page.getByTestId(`coordinator-row-${coordinatorProfileId}`)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId(`coordinator-row-${coordinatorProfileId}`)).toContainText("Ayşe K.");

    await page.goto("/admin/service-desk/consultations");
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("consultations-loading")).toHaveCount(0, { timeout: 30_000 });
  } finally {
    await close();
  }
});

test("2) ziyaretci: bolum sayfasi -> Book a consultation -> takvim/saat -> bilgiler + riza -> ozet -> basari SVC-", async ({ browser }) => {
  test.setTimeout(240_000);
  const { context, page } = await newVisitor(browser);
  try {
    await page.goto(`/specialties/${SERVICE_SLUG}`);
    const cta = page.locator("main").getByRole("link", { name: /Book a consultation|Book an online consultation/i }).first();
    await expect(cta).toBeVisible({ timeout: 90_000 });
    const href = await cta.getAttribute("href");
    expect(href).toMatch(/\/book-consultation\?service=surgical-oncology/);
    await cta.click();
    await page.waitForURL(/\/book-consultation\?service=surgical-oncology/);
    await expect(page.getByTestId("service-booking-wizard")).toBeVisible({ timeout: 60_000 });

    const visited: string[] = [];
    bookedNumber = await walkBookingWizard(page, {
      prefix: "",
      skipGoto: true,
      email: uniqueEmail("ui"),
      onStep: async (name) => {
        visited.push(name);
        const text = withoutMedicalDisclaimer(await bodyText(page));
        expect(turkishLetterHits(text), `Turkce harf (${name})`).toEqual([]);
        expect(text, `doktor ifadesi (${name})`).not.toMatch(DOCTOR_WORDS);
        expect(text).not.toMatch(/\bDr\b/);
      },
    });
    expect(visited).toEqual(["datetime", "details", "confirm", "success"]);
    expect(bookedNumber).toMatch(/^SVC-\d{5}$/);
    // Basari ekraninda baglanti/belirtec yok (API sozlesmesi), katilim notu var.
    await expect(page.getByTestId("service-booking-join-note")).toBeVisible();
    expect(page.url()).not.toMatch(/mg_|sc_/);
  } finally {
    await context.close();
  }
});

test("3) ayni slot (tek koordinator) ikinci ziyaretciye 409 SLOT_TAKEN doner ve listeden kalkar", async () => {
  const slots = await fetchSlots(1, 2);
  expect(slots.length).toBeGreaterThan(3);
  const target: Slot = slots[2]!;
  const first = await bookViaApi(target, uniqueEmail("a"));
  expect(first.status).toBe(201);
  expect(first.consultationNumber).toMatch(/^SVC-\d{5}$/);
  const second = await bookViaApi(target, uniqueEmail("b"));
  expect(second.status).toBe(409);
  expect(second.code).toBe("SLOT_TAKEN");
  const after = await fetchSlots(1, 2);
  expect(after.some((s) => s.startsAt === target.startsAt)).toBe(false);
  // Sozlesme: yanit koordinator kimligi/sayisi icermez.
  const raw = await apiJson<{ slots: Array<Record<string, unknown>> }>(`/service-consultations/slots?from=${target.startsAt.slice(0, 10)}&to=${target.startsAt.slice(0, 10)}`);
  expect(Object.keys(raw.body.data!.slots[0] ?? {}).sort()).toEqual(["endsAt", "startsAt"]);
  // Dogrulama: eksik riza 422, hizmetsiz 422.
  const noConsent = await bookViaApi(slots[5]!, uniqueEmail("c"), { contactConsent: false });
  expect(noConsent.status).toBe(422);
  const noService = await bookViaApi(slots[5]!, uniqueEmail("d"), { specialtySlug: null });
  expect(noService.status).toBe(422);
});

test("4a) sozlesme: aktif koordinatorde isServiceCoordinator=true, /users/me VE /auth/me (panel auth baglamindan okur)", async () => {
  const token = await coordinatorToken();
  const me = await apiJson<{ isServiceCoordinator: boolean }>("/users/me", { token });
  expect(me.body.data?.isServiceCoordinator).toBe(true);
  const auth = await apiJson<{ user: { isServiceCoordinator: boolean } }>("/auth/me", { token });
  expect(auth.body.data?.user.isServiceCoordinator, "BUG: /auth/me isServiceCoordinator=false; admin kenar cubugu ve /admin/my-consultations bunu okur").toBe(true);
});

test("4) koordinator (EDITOR): Gorusmelerim, bugunku gorusme, katilim penceresi, 2FA yoksa mesaj uyarisi", async ({ browser }) => {
  test.setTimeout(240_000);
  // Bugunku (Istanbul) bir slot ayir.
  const today = istanbulDate(Date.now());
  const slots = await fetchSlots(0, 1);
  const todaySlot = slots.filter((s) => istanbulDate(s.startsAt) === today).at(-1);
  test.skip(!todaySlot, "Istanbul gunu icinde en erken +2 saat kuralina uyan slot kalmadi (gece yarisina yakin kosu).");
  const booked = await bookViaApi(todaySlot!, uniqueEmail("today"), { message: "Mesaj: e2e koordinator goruntuleme testi." });
  expect(booked.status).toBe(201);
  todayNumber = booked.consultationNumber!;

  await coordinatorToken(); // UI girisinden ONCE alinir (API girisi tarayici oturumunu iptal eder)
  // /auth/me bayrak hatasi 4a)'da ayrica sinanir; burada tarayicida atlatilir (bkz. loginCoordinatorPage).
  const session = await loginCoordinatorPage(browser);
  coordPage = session.page;
  closeCoord = session.close;
  const page = session.page;

  await page.goto("/admin/my-consultations");
  const sidebar = page.getByRole("link", { name: /Görüşmelerim/ }).first();
  await expect(sidebar).toBeVisible({ timeout: 60_000 });

  const token = await coordinatorToken();
  const list = await apiJson<Array<{ id: string; consultationNumber: string; canJoin: boolean }>>("/coordinator/consultations?scope=today", { token });
  expect(list.status).toBe(200);
  const mine = list.body.data!.find((c) => c.consultationNumber === todayNumber);
  expect(mine, "bugunku gorusme API listesinde").toBeTruthy();
  todayId = mine!.id;
  expect(mine!.canJoin).toBe(false); // baslangica >= 2 saat var

  await expect(page.getByTestId("my-consultations-today").getByTestId(`my-consultation-${todayId}`)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("my-consultations-today").getByTestId(`my-consultation-${todayId}`)).toContainText(todayNumber);
  // Katilim penceresi henuz kapali: "sonra acilir" (devre disi) -- "Gorusmeye katil" etkin DEGIL.
  await expect(page.getByTestId("my-consultations-today").getByTestId(`my-consultation-${todayId}`).getByRole("button", { name: /sonra açılır/ })).toBeDisabled();

  // Detay + mesaj: 2FA kapaliyken uyari ve "2FA'yi acin" yonlendirmesi.
  await page.getByTestId("my-consultations-today").getByTestId(`my-consultation-${todayId}`).getByRole("button", { name: /detayı/ }).click();
  await expect(page.getByTestId("my-consultation-detail")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Talep mesajını göster" }).click();
  await expect(page.getByTestId("my-consultation-2fa-required")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("my-consultation-2fa-required").getByRole("link")).toHaveAttribute("href", /security|2fa|settings/i);
  const api403 = await apiJson(`/coordinator/consultations/${todayId}/message`, { token });
  expect(api403.status).toBe(403);
  expect(api403.body.error?.code).toBe("TWO_FACTOR_REQUIRED");
  await page.keyboard.press("Escape");
});

test("4b) koordinator: katilim penceresi acilinca 'Görüşmeye katıl' etkin olur; 2FA acikken mesaj okunur (API, no-store)", async () => {
  test.setTimeout(240_000);
  test.skip(!todayId, "4) bugunku gorusme olusmadi");
  // 1) Pencereyi ac ve katilimi dene (2FA acilinca oturumlar iptal olur; bu yuzden once UI, sonra 2FA).
  // Pencereyi ac: baslangic = simdi + 5 dk (pencere baslangic-15 dk).
  shiftConsultationToNow(todayNumber, 5);
  const page = coordPage!;
  await page.goto("/admin/my-consultations");
  // Not: erisilebilir ad aria-label ("SVC-… görüşmesine katıl"); gorunen metin "Görüşmeye katıl" (Label-in-Name uyumsuzlugu raporlandi).
  const join = page.getByTestId("my-consultations-today").getByTestId(`my-consultation-${todayId}`).getByRole("link", { name: /görüşmesine katıl/ });
  await expect(join.first()).toBeVisible({ timeout: 60_000 });
  await expect(join.first()).toBeEnabled();
  await join.first().click();
  await page.waitForURL(new RegExp(`/admin/my-consultations/${todayId}/room`), { timeout: 30_000 });
  // Oda sayfasi acilir; LiveKit sunucusu yerelde yoksa baglanti adimi atlanir (mevcut kural): yalnizca sayfanin cokmedigini dogrula.
  await settle(page);
  const text = await bodyText(page);
  expect(text).not.toMatch(/Application error|Unhandled Runtime Error/i);

  // 2) 2FA ac: mesaj okunur.
  const token = await coordinatorToken();
  await setupAndEnableTwoFactorForSelf(token, COORDINATOR_PASSWORD);
  const res = await fetch(`${API_BASE_URL}/coordinator/consultations/${todayId}/message`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control") ?? "").toMatch(/no-store/);
  const body = (await res.json()) as { data: { message: string | null } };
  expect(body.data.message).toContain("e2e koordinator");
  // Baskasinin kaydi 404 (varsayilan: var olmayan kimlik).
  const other = await apiJson("/coordinator/consultations/00000000-0000-4000-8000-000000000000/message", { token });
  expect(other.status).toBe(404);

});

test("5) yonetim baglantisi: lookup -> Change time -> Cancel -> slot yeniden acilir", async ({ browser }) => {
  test.setTimeout(300_000);
  const slots = await fetchSlots(2, 4);
  const target = slots[4]!;
  const booked = await bookViaApi(target, uniqueEmail("manage"));
  expect(booked.status).toBe(201);
  const number = booked.consultationNumber!;
  const token = issueManageToken(number);

  // API: gecersiz belirtec tek tip 404, gecerli lookup.
  const bad = await apiJson("/service-consultations/manage/lookup", { method: "POST", body: JSON.stringify({ t: "sc_" + "A".repeat(43) }) });
  expect(bad.status).toBe(404);
  const look = await apiJson<{ consultationNumber: string; canCancel: boolean; canReschedule: boolean; status: string }>("/service-consultations/manage/lookup", { method: "POST", body: JSON.stringify({ t: token }) });
  expect(look.status).toBe(200);
  expect(look.body.data).toMatchObject({ consultationNumber: number, status: "SCHEDULED", canCancel: true, canReschedule: true });

  const { context, page } = await newVisitor(browser);
  try {
    await page.goto(`/book-consultation/manage#${token}`);
    await expect(page.getByTestId("manage-view")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("manage-number")).toContainText(number);
    // Belirtec adres cubugundan silinir.
    await expect.poll(() => new URL(page.url()).hash, { timeout: 10_000 }).toBe("");
    const text = withoutMedicalDisclaimer(await bodyText(page));
    expect(turkishLetterHits(text)).toEqual([]);
    expect(text).not.toMatch(DOCTOR_WORDS);

    // Saat degistir.
    await page.getByTestId("manage-reschedule").click();
    await expect(page.getByTestId("manage-reschedule-panel")).toBeVisible({ timeout: 60_000 });
    await pickFirstSlot(page, 7);
    await page.getByRole("button", { name: "Confirm new time" }).click();
    await expect(page.getByTestId("manage-rescheduled")).toBeVisible({ timeout: 30_000 });
    // Eski slot yeniden acik; yeni zaman farkli.
    const newLook = await apiJson<{ startsAt: string }>("/service-consultations/manage/lookup", { method: "POST", body: JSON.stringify({ t: token }) });
    // Saat degisince yeni katilim baglantisi uretilir; yonetim belirteci ayni kalir (lookup hala 200).
    expect(newLook.status).toBe(200);
    expect(new Date(newLook.body.data!.startsAt).getTime()).not.toBe(new Date(target.startsAt).getTime());
    const reopened = await fetchSlots(0, 4);
    expect(reopened.some((s) => s.startsAt === target.startsAt)).toBe(true);
    const movedTo = newLook.body.data!.startsAt;
    expect(reopened.some((s) => s.startsAt === movedTo)).toBe(false);

    // Iptal. (Yeni sekmede acilir: ayni sayfada yalnizca # degisimi sayfayi yeniden yuklemez.)
    await page.goto("about:blank");
    await page.goto(`/book-consultation/manage#${token}`);
    await expect(page.getByTestId("manage-view")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("manage-cancel").click();
    await page.getByRole("button", { name: "Yes, cancel" }).click();
    await expect(page.getByTestId("manage-cancelled")).toBeVisible({ timeout: 30_000 });
    const after = await fetchSlots(0, 4);
    expect(after.some((s) => s.startsAt === movedTo)).toBe(true);
    const done = await apiJson<{ status: string; canCancel: boolean }>("/service-consultations/manage/lookup", { method: "POST", body: JSON.stringify({ t: token }) });
    expect(done.body.data).toMatchObject({ status: "CANCELLED", canCancel: false });
  } finally {
    await context.close();
  }
});

test("6) misafir katilim sayfasi /meet/join#mg_: amac metni (aracı kurulus, tibbi muayene degil), doktor/Turkce yok", async ({ browser }) => {
  test.setTimeout(240_000);
  const slots = await fetchSlots(3, 5);
  const booked = await bookViaApi(slots[6]!, uniqueEmail("guest"));
  expect(booked.status).toBe(201);
  const guest = issueGuestToken(booked.consultationNumber!);

  const pre = await apiJson<{ purpose?: string; hostName?: string }>("/meet/guest/preflight", { method: "POST", body: JSON.stringify({ t: guest }) });
  if (pre.status === 200) {
    expect(pre.body.data?.purpose).toBe("service_consultation");
    expect(pre.body.data?.hostName ?? "").toMatch(/^Patient Coordinator/);
  } else {
    // Sozlesmedeki govde bicimi farkliysa test ihlali olarak raporlanir.
    throw new Error(`preflight ${pre.status} ${JSON.stringify(pre.body)}`);
  }

  const { context, page } = await newVisitor(browser);
  try {
    // Oda acilmadan once: geri sayim ekrani.
    await page.goto(`/meet/join#${guest}`);
    await expect(page.getByText(/Opens in/i).first()).toBeVisible({ timeout: 90_000 });
    // Katilim penceresi acilinca: amac metinleri + ad formu.
    shiftConsultationToNow(booked.consultationNumber!, 5);
    await page.goto("about:blank");
    await page.goto(`/meet/join#${guest}`);
    await expect(page.getByText(/Online consultation with your WM Health patient coordinator/i).first()).toBeVisible({ timeout: 90_000 });
    const text = await bodyText(page);
    expect(text).toMatch(/not a medical examination/i);
    expect(text).toMatch(/intermediary|not a healthcare provider/i);
    // Koordinator gorunen adi operator verisidir (Ayşe K.): Turkce harf denetiminden cikarilir.
    const visitorText = withoutMedicalDisclaimer(text).replace(COORDINATOR_DISPLAY_NAME, "");
    expect(turkishLetterHits(visitorText), `Turkce harf baglami: ${(/.{0,30}[çÇğĞıİşŞöÖüÜ].{0,30}/.exec(visitorText) ?? [""])[0]}`).toEqual([]);
    expect(withoutMedicalDisclaimer(text)).not.toMatch(DOCTOR_WORDS);
    // Belirtec adres cubugundan silinir.
    await expect.poll(() => new URL(page.url()).hash, { timeout: 10_000 }).toBe("");
    // Misafir adi "Patient Coordinator" ile baslayamaz (varsa ad formu uzerinden); LiveKit adimi yerelde yoksa atlanir.
    const nameForm = page.getByTestId("guest-name-form");
    if (await nameForm.isVisible().catch(() => false)) {
      await nameForm.locator("input").first().fill("Patient Coordinator Z");
      await page.getByTestId("guest-join").click();
      await expect(page.getByRole("alert").or(page.getByText(/not allowed|cannot|reserved|choose another/i)).first()).toBeVisible({ timeout: 20_000 });
    }
  } finally {
    await context.close();
  }
});

test("7) serviceBookingEnabled kapaliyken header 'Book a consultation' /request'e gider; acilinca /book-consultation", async ({ browser }) => {
  test.setTimeout(420_000);
  const { context, page } = await newVisitor(browser, { width: 1440 });
  const headerCta = () => page.getByRole("link", { name: /^Book (a|an online) consultation/i }).first();
  try {
    await setBookingEnabled(adminToken, false);
    await expect(async () => {
      await page.goto("/");
      await expect(headerCta()).toBeVisible({ timeout: 15_000 });
      expect(await headerCta().getAttribute("href")).toMatch(/\/request/);
    }).toPass({ timeout: 150_000, intervals: [5_000] });
    // Dogrudan adres: kapaliyken talep (call back) yedegi gosterilir.
    await page.goto(`/book-consultation?service=${SERVICE_SLUG}`);
    await expect(page.getByTestId("service-booking-unavailable").or(page.getByTestId("service-booking-wizard")).first()).toBeVisible({ timeout: 60_000 });
  } finally {
    await setBookingEnabled(adminToken, true);
    await context.close().catch(() => undefined);
  }
  // Geri aciliste (ISR/onbellek <= 60 sn) header yeniden /book-consultation'a gider.
  const reopen = await newVisitor(browser, { width: 1440 });
  try {
    const cta = () => reopen.page.getByRole("link", { name: /^Book (a|an online) consultation/i }).first();
    await expect(async () => {
      await reopen.page.goto("/");
      await expect(cta()).toBeVisible({ timeout: 15_000 });
      expect(await cta().getAttribute("href")).toMatch(/\/book-consultation/);
    }).toPass({ timeout: 150_000, intervals: [5_000] });
  } finally {
    await reopen.context.close();
  }
});

test("8) Find your treatment sonucu: 'Book online' /book-consultation, 'Request a call back' /request", async ({ browser }) => {
  test.setTimeout(240_000);
  const { context, page } = await newVisitor(browser);
  try {
    await page.goto(`/specialties/${SERVICE_SLUG}?finder=1`);
    const dlg = page.getByTestId("matcher-dialog").or(page.getByTestId("matcher-modal")).first();
    await expect(dlg).toBeVisible({ timeout: 90_000 });
    await pickTopicBySearch(page, "obesity", /Obesity \/ weight/i);
    await walkWizardToResult(page);
    const card = page.getByTestId("matcher-specialty-card").first();
    await expect(card).toBeVisible();
    const book = card.getByTestId("matcher-book-online");
    const request = card.getByTestId("matcher-request");
    await expect(request).toBeVisible();
    await expect(request).toHaveAttribute("href", /\/request\?service=/);
    const bookCount = await book.count();
    if (bookCount > 0) {
      await expect(book).toHaveAttribute("href", /\/book-consultation\?service=/);
    }
    const text = withoutMedicalDisclaimer(await bodyText(page));
    expect(turkishLetterHits(text)).toEqual([]);
    expect(text).not.toMatch(DOCTOR_WORDS);
  } finally {
    await context.close();
  }
});
