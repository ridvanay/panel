/**
 * qa-agent — Paket AI (Is 3) hizmet gorusmesi e2e yardimcilari. YALNIZCA saas_e2e (E2E_DATABASE_URL) uzerinde calisir.
 * Masa/koordinator kurulumu admin API'siyle IDEMPOTENT yapilir; yonetim ve misafir belirtecleri e-postayla alinamadigi icin
 * (yalnizca SHA-256 ozeti saklanir) test DB'sinde taze belirtec uretilip ozeti yazilir.
 */
import { execFileSync } from "node:child_process";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import crypto from "node:crypto";
import path from "node:path";
import { API_BASE_URL, getFixtureUserToken } from "./api";
import { adminGetUserByEmail, adminUpdateRole } from "./admin-users-fixtures";

const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/saas_e2e?schema=public";
const BACKEND_DIR = path.resolve(__dirname, "../../../../backend");

export const COORDINATOR_EMAIL = "qa-ai3-coordinator@example.com";
export const COORDINATOR_PASSWORD = "Zx9!Lantern-Orbit-742";
export const COORDINATOR_DISPLAY_NAME = "Ayşe K.";
export const SERVICE_SLUG = "surgical-oncology";
export const SERVICE_NAME = "Surgical Oncology";

/** Yazma amacli SQL (cikti okunmaz). saas_e2e disina ASLA yazmaz. */
export function execSql(sql: string): void {
  if (!/saas_e2e/.test(E2E_DATABASE_URL)) throw new Error("qa-agent: yalnizca saas_e2e uzerinde SQL calistirilir.");
  execFileSync("npx", ["prisma", "db", "execute", "--stdin", `--url=${E2E_DATABASE_URL}`], {
    cwd: BACKEND_DIR,
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function authHeaders(token: string): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

export async function apiJson<T = unknown>(pathname: string, init: RequestInit & { token?: string } = {}): Promise<{ status: number; retryAfter?: number; body: { data?: T; error?: { code?: string; message?: string } } }> {
  const { token, ...rest } = init;
  const res = await fetch(`${API_BASE_URL}${pathname}`, { ...rest, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rest.headers ?? {}) } });
  let body: { data?: T; error?: { code?: string; message?: string } } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* bos govde */
  }
  const ra = Number(res.headers.get("retry-after"));
  return { status: res.status, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : undefined, body };
}

export interface DeskSetup {
  coordinatorUserId: string;
  coordinatorProfileId: string;
}

/**
 * Masayi 7/24 (Europe/Istanbul), 30 dk, en erken +2 saat olarak kurar; koordinator EDITOR hesabini olusturur/atar;
 * genel anahtari (`serviceBookingEnabled`) acar. Idempotent. Doktor profili OLMAYAN bir EDITOR kullanilir.
 */
export async function ensureDeskAndCoordinator(adminToken: string, languages: string[] = ["en", "ar"]): Promise<DeskSetup> {
  await getFixtureUserToken(COORDINATOR_EMAIL, COORDINATOR_PASSWORD, "QA AI3 Coordinator");
  const user = await adminGetUserByEmail(adminToken, COORDINATOR_EMAIL);
  if (!user) throw new Error("qa-agent: koordinator fixture kullanicisi bulunamadi.");
  if (user.role !== "EDITOR") await adminUpdateRole(adminToken, user.id, "EDITOR");

  const hours = [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 1410 }));
  const put = await apiJson("/admin/service-desk/hours", { method: "PUT", token: adminToken, body: JSON.stringify({ hours }) });
  if (put.status !== 200) throw new Error(`qa-agent: saatler yazilamadi (${put.status}) ${JSON.stringify(put.body)}`);

  const list = await apiJson<Array<{ id: string; userId: string; isActive: boolean }>>("/admin/service-desk/coordinators", { token: adminToken });
  let profile = list.body.data?.find((c) => c.userId === user.id);
  if (!profile) {
    const created = await apiJson<{ id: string }>("/admin/service-desk/coordinators", {
      method: "POST",
      token: adminToken,
      body: JSON.stringify({ userId: user.id, displayName: COORDINATOR_DISPLAY_NAME, languages }),
    });
    if (created.status !== 201) throw new Error(`qa-agent: koordinator eklenemedi (${created.status}) ${JSON.stringify(created.body)}`);
    profile = { id: created.body.data!.id, userId: user.id, isActive: true };
  } else if (!profile.isActive) {
    await apiJson(`/admin/service-desk/coordinators/${profile.id}`, { method: "PATCH", token: adminToken, body: JSON.stringify({ isActive: true }) });
  }
  const patch = await apiJson("/admin/service-desk", { method: "PATCH", token: adminToken, body: JSON.stringify({ serviceBookingEnabled: true }) });
  if (patch.status !== 200) throw new Error(`qa-agent: rezervasyon anahtari acilamadi (${patch.status}) ${JSON.stringify(patch.body)}`);
  return { coordinatorUserId: user.id, coordinatorProfileId: profile.id };
}

export async function setBookingEnabled(adminToken: string, enabled: boolean): Promise<void> {
  const res = await apiJson("/admin/service-desk", { method: "PATCH", token: adminToken, body: JSON.stringify({ serviceBookingEnabled: enabled }) });
  if (res.status !== 200) throw new Error(`qa-agent: serviceBookingEnabled=${enabled} yazilamadi (${res.status})`);
}

export interface Slot {
  startsAt: string;
  endsAt: string;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Genel uygun slotlar (from = bugun UTC, to = +offset gun). */
export async function fetchSlots(fromOffsetDays = 0, toOffsetDays = 3): Promise<Slot[]> {
  const from = new Date(Date.now() + fromOffsetDays * 86_400_000);
  const to = new Date(Date.now() + toOffsetDays * 86_400_000);
  const res = await apiJson<{ slots: Slot[] }>(`/service-consultations/slots?from=${ymd(from)}&to=${ymd(to)}`);
  if (res.status !== 200) throw new Error(`qa-agent: slotlar alinamadi (${res.status}) ${JSON.stringify(res.body)}`);
  return res.body.data!.slots;
}

export function uniqueEmail(tag: string): string {
  return `qa-ai3-${tag}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`;
}

export interface BookingResult {
  status: number;
  code?: string;
  consultationNumber?: string;
  startsAt?: string;
  retryAfter?: number;
}

/**
 * IP basina GUNLUK 10 rezervasyon tavani (sozlesme, DB tabanli: `consultation_requests.ipAddress`) tekrarli yerel kosularda
 * dolar. Yalnizca saas_e2e test kayitlarinin IP alani temizlenir (kayit silinmez) - tavan testi ayri bir kontrol.
 */
export function releaseIpBookingBudget(): void {
  execSql(`UPDATE "consultation_requests" SET "ipAddress" = NULL WHERE "id" IN (SELECT "requestId" FROM "service_consultations" WHERE "requestId" IS NOT NULL);`);
}

/** Ziyaretci rezervasyonu (API). Odeme yok; test e-postasi example.com. */
export async function bookViaApi(slot: Slot, email: string, extra: Record<string, unknown> = {}): Promise<BookingResult> {
  // Sozlesme: 5/dk IP siniri. 429 alirsak (onceki testlerin istekleri) pencere kapanana dek bekleyip yeniden dene.
  for (let attempt = 0; attempt < 12; attempt++) {
    const r = await bookOnce(slot, email, extra);
    if (r.status !== 429) return r;
    if ((r.retryAfter ?? 0) >= 3600 || r.retryAfter === undefined && r.code === "RATE_LIMITED" && attempt === 0) releaseIpBookingBudget();
    await new Promise((res) => setTimeout(res, (r.retryAfter ?? 10) * 1000 + 2_000));
  }
  return bookOnce(slot, email, extra);
}

async function bookOnce(slot: Slot, email: string, extra: Record<string, unknown>): Promise<BookingResult> {
  const res = await apiJson<{ consultationNumber: string; startsAt: string }>("/service-consultations", {
    method: "POST",
    body: JSON.stringify({
      specialtySlug: SERVICE_SLUG,
      country: "DE",
      contactLanguage: "en",
      needsInterpreter: false,
      preferredContactChannel: "email",
      fullName: "QA Visitor",
      email,
      message: "QA mesaji: kontrol amacli ornek not.",
      contactConsent: true,
      healthDataConsent: true,
      locale: "en",
      startsAt: slot.startsAt,
      patientTimeZone: "Europe/Berlin",
      ...extra,
    }),
  });
  return { status: res.status, code: res.body.error?.code, consultationNumber: res.body.data?.consultationNumber, startsAt: res.body.data?.startsAt, retryAfter: res.retryAfter };
}

/** SVC-00012 -> 12 */
export function seqOf(consultationNumber: string): number {
  const m = /^SVC-(\d+)$/.exec(consultationNumber);
  if (!m) throw new Error(`qa-agent: gecersiz gorusme numarasi ${consultationNumber}`);
  return Number(m[1]);
}

/** Yonetim baglantisi icin taze `sc_` belirteci uretir ve yalnizca ozetini DB'ye yazar (cikti: belirtec). */
export function issueManageToken(consultationNumber: string): string {
  const token = `sc_${crypto.randomBytes(32).toString("base64url")}`;
  execSql(`UPDATE "service_consultations" SET "manageTokenHash" = '${sha256(token)}' WHERE "seq" = ${seqOf(consultationNumber)};`);
  return token;
}

/** Misafir katilim baglantisi icin taze `mg_` belirteci uretir ve yalnizca ozetini DB'ye yazar. */
export function issueGuestToken(consultationNumber: string): string {
  const token = `mg_${crypto.randomBytes(32).toString("base64url")}`;
  execSql(
    `UPDATE "external_meetings" SET "guestTokenHash" = '${sha256(token)}', "guestTokenCreatedAt" = now() WHERE "id" = (SELECT "meetingId" FROM "service_consultations" WHERE "seq" = ${seqOf(consultationNumber)});`
  );
  return token;
}

/** Gorusmeyi katilim penceresi acik olacak sekilde kaydirir (baslangic = simdi + startInMin). Yalnizca test kaydi. */
export function shiftConsultationToNow(consultationNumber: string, startInMin = 5): void {
  const seq = seqOf(consultationNumber);
  execSql(
    `UPDATE "service_consultations" SET "startsAt" = now() + interval '${startInMin} minutes', "endsAt" = now() + interval '${startInMin + 30} minutes' WHERE "seq" = ${seq};
     UPDATE "external_meetings" SET "startsAt" = now() + interval '${startInMin} minutes', "endsAt" = now() + interval '${startInMin + 30} minutes' WHERE "id" = (SELECT "meetingId" FROM "service_consultations" WHERE "seq" = ${seq});`
  );
}

/** Koordinator (EDITOR) icin API token. */
let cachedCoordinatorToken: { token: string; at: number } | null = null;
export async function coordinatorToken(): Promise<string> {
  // Ayni kullanici icin API girisi tarayici oturumunu iptal eder (tek kullanimlik yenileme zinciri); bu yuzden onbellege alinir.
  if (cachedCoordinatorToken && Date.now() - cachedCoordinatorToken.at < 10 * 60_000) return cachedCoordinatorToken.token;
  const token = await getFixtureUserToken(COORDINATOR_EMAIL, COORDINATOR_PASSWORD, "QA AI3 Coordinator");
  cachedCoordinatorToken = { token, at: Date.now() };
  return token;
}

export function forgetCoordinatorToken(): void {
  cachedCoordinatorToken = null;
}

/** Ziyaretci sayfalarinda Turkce harf / doktor ifadesi kontrolu icin desenler. */
export const TURKISH_CHARS = /[ıİğĞşŞçÇöÖüÜ]/;
export const DOCTOR_WORDS = /\b(doctors?|physicians?|Dr\.|Prof\.|Op\. Dr)\b|طبيب|أطباء|الأطباء|دكتور/i;

// ---------------------------------------------------------------------------------------------------------------
// UI yardimcilari
// ---------------------------------------------------------------------------------------------------------------

/** Kaspersky enjeksiyonunu bloke eder, yerel medya URL'lerini 4001'e yonlendirir. */
export async function prepareContext(context: BrowserContext): Promise<void> {
  await context.route(/kaspersky-labs\.com/, (r) => r.abort());
  await context.route(/\/uploads\//, async (route) => {
    const u = new URL(route.request().url());
    try {
      await route.fulfill({ response: await route.fetch({ url: `http://localhost:4001${u.pathname}${u.search}` }) });
    } catch {
      await route.continue();
    }
  });
}

export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
  await page.waitForTimeout(400);
}

export const BOOKING_STEPS = ["service", "datetime", "details", "confirm", "success"] as const;
export type BookingStepName = (typeof BOOKING_STEPS)[number];

/** Takvimde ilk uygun gunu secer (gerekirse) ve ilk uygun saati tiklar. */
export async function pickFirstSlot(page: Page, skip = 0): Promise<void> {
  const slots = page.locator("button[data-slot-nav]:not([aria-disabled='true'])");
  if ((await slots.count()) === 0) {
    const day = page.locator("button:has([data-testid='day-slot-count']), button:has-text('Earliest')").first();
    await expect(day).toBeVisible({ timeout: 20_000 });
    await day.click();
  }
  await expect(slots.first()).toBeVisible({ timeout: 20_000 });
  await slots.nth(skip).click();
}

export interface WalkOptions {
  prefix: "" | "/ar";
  /** Hizmet onceden secili gelsin (varsayilan evet). false: adim 1'den baslar ve hizmet secilir. */
  preselect?: boolean;
  email: string;
  fullName?: string;
  message?: string;
  /** Her adim gorunur olduktan sonra cagrilir (ekran goruntusu icin). */
  onStep?: (name: BookingStepName) => Promise<void>;
  /** Sayfa zaten sihirbazdaysa goto yapma. */
  skipGoto?: boolean;
  /** Slot sirasi (ayni slotu cakistirmamak icin). */
  slotIndex?: number;
}

/** Ziyaretci rezervasyon sihirbazini sonuna dek yurur; "SVC-..." numarasini doner. */
export async function walkBookingWizard(page: Page, o: WalkOptions): Promise<string> {
  const { prefix } = o;
  releaseIpBookingBudget();
  const url = o.preselect === false ? `${prefix}/book-consultation` : `${prefix}/book-consultation?service=${SERVICE_SLUG}`;
  if (!o.skipGoto) await page.goto(url);
  await expect(page.getByTestId("service-booking-wizard")).toBeVisible({ timeout: 90_000 });
  const cont = page.getByTestId("summary-continue");

  if (o.preselect === false) {
    await expect(page.getByTestId("booking-step-service")).toBeVisible();
    await settle(page);
    await o.onStep?.("service");
    // Hizmet secimi: ilk uygun radyo/dugme
    const picker = page.getByTestId("booking-step-service");
    const option = picker.locator(`input[type='radio'][value='${SERVICE_SLUG}'], [role='radio'][data-value='${SERVICE_SLUG}']`).first();
    if (await option.count()) await expect(async () => { await option.locator("xpath=ancestor::label[1]").click(); await expect(option).toBeChecked({ timeout: 2_000 }); }).toPass({ timeout: 30_000 });
    else await picker.getByText(SERVICE_NAME, { exact: false }).first().click();
    await cont.click();
  }

  await expect(page.getByTestId("booking-slots-loading")).toHaveCount(0, { timeout: 60_000 });
  await pickFirstSlot(page, o.slotIndex ?? 0);
  await settle(page);
  await o.onStep?.("datetime");
  await expect(cont).toBeEnabled();
  await cont.click();

  const details = page.getByTestId("booking-step-details");
  await expect(details).toBeVisible({ timeout: 20_000 });
  await details.locator("#booking-full-name").fill(o.fullName ?? "QA Visitor");
  await details.locator("#booking-email").fill(o.email);
  await details.locator("#booking-country").selectOption("DE");
  await details.locator("#booking-phone").fill("1512345678");
  await details.locator("#booking-message, textarea").first().fill(o.message ?? "QA test message for the coordinator.");
  await details.getByTestId("booking-consent-contact").check({ force: true });
  await details.getByTestId("booking-consent-health").check({ force: true });
  await settle(page);
  await o.onStep?.("details");
  await cont.click();

  await expect(page.getByTestId("booking-step-confirm")).toBeVisible({ timeout: 20_000 });
  await settle(page);
  await o.onStep?.("confirm");
  await cont.click();

  await expect(page.getByTestId("service-booking-success")).toBeVisible({ timeout: 30_000 });
  await settle(page);
  await o.onStep?.("success");
  const text = (await page.getByTestId("service-booking-number").innerText()).trim();
  const m = /SVC-\d+/.exec(text);
  if (!m) throw new Error(`qa-agent: basari numarasi okunamadi: "${text}"`);
  return m[0];
}

/**
 * Koordinator (EDITOR) icin UI girisi. BILINEN HATA GECICI ATLATMASI: `/auth/me`, `/auth/login` ve `/auth/refresh`
 * yanitlarindaki kullanici `isServiceCoordinator:false` doner (yalnizca `/users/me` turetir); panel/kenar cubuk bayragi
 * auth baglamindan okudugu icin koordinator panele erisemez. `patchFlag=true` iken bu yanitlardaki bayrak TARAYICIDA
 * `true` yapilir; boylece panel akislari ve ekran goruntuleri alinabilir. Hata duzeldiginde atlatma zararsizdir.
 * Hatanin kendisi `4a)` testinde (API duzeyinde) ayri olarak dogrulanir.
 */
export async function loginCoordinatorPage(browser: Browser, opts: { width?: number; patchFlag?: boolean } = {}): Promise<{ page: Page; context: BrowserContext; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:3100", viewport: { width: opts.width ?? 1280, height: 900 } });
  await prepareContext(context);
  if (opts.patchFlag !== false) {
    // Tarayici ici fetch sarmalayici: Set-Cookie ve ag akisina dokunmaz, yalnizca JSON govdesindeki bayragi duzeltir.
    await context.addInitScript(() => {
      const original = window.fetch.bind(window);
      window.fetch = async (...args: Parameters<typeof fetch>) => {
        const res = await original(...args);
        const url = typeof args[0] === "string" ? args[0] : args[0] instanceof Request ? args[0].url : String(args[0]);
        if (!/\/api\/v1\/auth\/(me|login|refresh)(\?|$)/.test(url)) return res;
        try {
          const json = (await res.clone().json()) as { data?: { user?: { isServiceCoordinator?: boolean }; isServiceCoordinator?: boolean } };
          if (json.data?.user) json.data.user.isServiceCoordinator = true;
          else if (json.data && "isServiceCoordinator" in json.data) json.data.isServiceCoordinator = true;
          return new Response(JSON.stringify(json), { status: res.status, statusText: res.statusText, headers: res.headers });
        } catch {
          return res;
        }
      };
    });
  }
  const page = await context.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(COORDINATOR_EMAIL);
  await page.locator('input[type="password"]').fill(COORDINATOR_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 20_000 });
  return { page, context, close: async () => void (await context.close()) };
}

/** Koordinator fixture hesabinin 2FA'sini kapatir (yalnizca test hesabi; UI girisi TOTP istemesin). */
export function resetCoordinatorTwoFactor(): void {
  execSql(
    `UPDATE "users" SET "twoFactorEnabled" = false, "twoFactorSecret" = NULL, "twoFactorVerifiedAt" = NULL, "twoFactorLastUsedStep" = NULL WHERE email = '${COORDINATOR_EMAIL}';`
  );
}
