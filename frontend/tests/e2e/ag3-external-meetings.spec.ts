import fs from "node:fs";
import path from "node:path";
import { chromium, test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, API_BASE_URL, getCachedAdminSession, getFixtureUserToken } from "./support/api";
import { createAuthenticatedPage, createAuthenticatedPageAs } from "./support/admin-session";
import { adminGetUserByEmail, adminUpdateRole } from "./support/admin-users-fixtures";
import { turkishLetterHits } from "./support/ai-services-fixtures";
import {
  DOCTOR_WORDS,
  apiJson,
  bookViaApi,
  ensureDeskAndCoordinator,
  execSql,
  fetchSlots,
  prepareContext,
  settle,
  uniqueEmail,
} from "./support/ai3-service-fixtures";

/**
 * qa-agent — Paket AG (Is 3, kalan): harici goruntulu toplanti (admin Toplantilar, misafir giris, ev sahibi odasi,
 * bagli toplanti rozeti, meeting-host anahtari). Yalnizca saas_e2e; backend :4001 (EXTERNAL_MEETINGS_ENABLED=true) +
 * frontend :3100 (E2E_SKIP_WEBSERVER=1). Odeme/gercek e-posta yok. Ekran goruntuleri docs/prompts/2026-11-03-AG3-ekran/.
 *
 * Misafir baglantisi yalnizca olusturma/yeniden uretme yanitinda doner (duz belirtec saklanmaz); bu yuzden baglanti
 * UI kartindan okunur veya API yanitindan alinir. Toplanti zamani yalnizca test kayitlari icin DB'de kaydirilir.
 */
// Panel ve site AYNI ana bilgisayar adinda olmali (ev sahibi "Katil" tam sayfa gecisi oturumu siteadi.localhost'ta ister; varsayilan localhost:3100 oturumu dusurur).
process.env.E2E_FRONTEND_URL ??= "http://siteadi.localhost:3100";
test.use({ navigationTimeout: 120_000, actionTimeout: 20_000 });
test.describe.configure({ mode: "default" });

const SHOT_DIR = path.resolve(__dirname, "../../../docs/prompts/2026-11-03-AG3-ekran");
const EDITOR_EMAIL = "qa-ag3-editor@example.com";
const EDITOR_PASSWORD = "Zx9!Lantern-Orbit-742";
const EDITOR_NAME = "QA AG3 Editor";
const PREFIX = "QA AG3";
const FRONT = process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100";

let adminToken = "";
let editorUserId = "";
let uiMeetingId = "";
let uiLink = ""; // test 1 ile olusan misafir baglantisi (yol + #mg_)
let apiArLink = "";
let apiArMeetingId = "";
let editorTitle = "";
let editorMeetingId = "";
let svcNumber = "";
let svcMeetingId = "";
const created: string[] = [];

function shot(page: Page, name: string, fullPage = true) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  return page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage });
}

async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("select, script, style, noscript").forEach((n) => n.remove());
    return (clone.textContent ?? "").replace(/\s+/g, " ");
  });
}

/** Ziyaretci/misafir sayfasinda Turkce harf ve doktor ifadesi olmamali. */
async function expectVisitorClean(page: Page, label: string) {
  const text = await bodyText(page);
  expect(turkishLetterHits(text), `Turkce harf (${label})`).toEqual([]);
  expect(text, `doktor ifadesi (${label})`).not.toMatch(DOCTOR_WORDS);
}

async function newGuest(browser: Browser, width: number): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: FRONT, viewport: { width, height: width < 600 ? 800 : 900 } });
  await prepareContext(context);
  return { context, page: await context.newPage() };
}

type ListItem = Record<string, unknown> & { id: string; title?: string; maxParticipants?: number; serviceConsultation?: { consultationNumber?: string } | null };

async function fetchList(token: string, url: string): Promise<ListItem[]> {
  const out: ListItem[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i++) {
    const res = await fetch(`${API_BASE_URL}${url}${url.includes("?") ? "&" : "?"}${cursor ? `cursor=${encodeURIComponent(cursor)}` : ""}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await res.json()) as { data: ListItem[] | { items?: ListItem[]; nextCursor?: string | null }; meta?: { nextCursor?: string | null } };
    const items = Array.isArray(body.data) ? body.data : (body.data?.items ?? []);
    out.push(...items);
    cursor = body.meta?.nextCursor ?? (Array.isArray(body.data) ? null : (body.data?.nextCursor ?? null));
    if (!cursor) break;
  }
  return out;
}

function shiftMeeting(id: string, startInMin: number, durationMin = 30) {
  execSql(
    `UPDATE "external_meetings" SET "startsAt" = now() + interval '${startInMin} minutes', "endsAt" = now() + interval '${startInMin + durationMin} minutes' WHERE "id" = '${id}';`
  );
}

function guestPath(link: string): string {
  const u = new URL(link, FRONT);
  return `${u.pathname}${u.hash}`;
}

async function createViaApi(token: string, title: string, locale = "en", extra: Record<string, unknown> = {}) {
  const startsAt = new Date(Date.now() + 3 * 3_600_000).toISOString();
  const res = await apiJson<{ meeting: { id: string }; guestLink: string }>("/meetings", {
    method: "POST",
    token,
    body: JSON.stringify({ title, startsAt, durationMin: 30, maxParticipants: 4, locale, ...extra }),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  created.push(res.body.data!.meeting.id);
  return res.body.data!;
}

async function cancelAllQaMeetings(token: string) {
  for (const it of await fetchList(token, "/meetings?scope=upcoming")) {
    if (String(it.title).startsWith(PREFIX) && !it.serviceConsultation) await apiJson(`/meetings/${it.id}/cancel`, { method: "POST", token, body: "{}" });
  }
}

async function rowByText(page: Page, text: string) {
  const row = page.getByTestId("meeting-row").filter({ hasText: text }).first();
  for (let i = 0; i < 6; i++) {
    if (await row.isVisible().catch(() => false)) break;
    const more = page.getByRole("button", { name: "Daha fazla yükle" });
    if (!(await more.isVisible().catch(() => false))) break;
    await more.click();
    await page.waitForTimeout(500);
  }
  await expect(row).toBeVisible({ timeout: 30_000 });
  return row;
}

/** Bir test dustugunde worker yeniden basladigindan modul durumu kaybolur: UI toplantisi API'den yeniden bulunur/uretilir. */
async function ensureUi(): Promise<void> {
  if (uiMeetingId && uiLink) return;
  adminToken ||= (await getCachedAdminSession()).accessToken;
  const m = (await fetchList(adminToken, "/meetings?scope=upcoming")).find((x) => String(x.title).startsWith(PREFIX + " UI meeting"));
  if (!m) {
    const c = await createViaApi(adminToken, `${PREFIX} UI meeting ${Date.now().toString(36)}`);
    uiMeetingId = c.meeting.id;
    uiLink = guestPath(c.guestLink);
    return;
  }
  uiMeetingId = m.id;
  const r = await apiJson<{ guestLink: string }>(`/meetings/${m.id}/guest-link`, { method: "POST", token: adminToken, body: JSON.stringify({ locale: "en" }) });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  uiLink = guestPath(r.body.data!.guestLink);
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  adminToken = (await getCachedAdminSession()).accessToken;
  const flags = await apiJson("/meetings?scope=upcoming", { token: adminToken });
  expect(flags.status, "EXTERNAL_MEETINGS_ENABLED=true olmali (GET /meetings 200)").toBe(200);
  await cancelAllQaMeetings(adminToken);

  // Ikinci ev sahibi: EDITOR (meeting-host yetkisi UI'dan test 6'da yonetilir; burada API ile hazirlanir).
  await getFixtureUserToken(EDITOR_EMAIL, EDITOR_PASSWORD, EDITOR_NAME);
  const u = await adminGetUserByEmail(adminToken, EDITOR_EMAIL);
  if (!u) throw new Error("editor fixture bulunamadi");
  if (u.role !== "EDITOR") await adminUpdateRole(adminToken, u.id, "EDITOR");
  editorUserId = u.id;
  const grant = await apiJson(`/admin/users/${editorUserId}/meeting-host`, { method: "PATCH", token: adminToken, body: JSON.stringify({ enabled: true }) });
  expect(grant.status, JSON.stringify(grant.body)).toBe(200);
  const editorToken = await getFixtureUserToken(EDITOR_EMAIL, EDITOR_PASSWORD, EDITOR_NAME);
  editorTitle = `${PREFIX} editor meeting ${Date.now().toString(36)}`;
  const em = await createViaApi(editorToken, editorTitle);
  editorMeetingId = em.meeting.id;

  // Hizmete bagli (AI3) toplanti.
  await ensureDeskAndCoordinator(adminToken);
  const slots = await fetchSlots(2, 5);
  const booked = await bookViaApi(slots[3]!, uniqueEmail("ag3"));
  expect(booked.status).toBe(201);
  svcNumber = booked.consultationNumber!;
});

test.afterAll(async () => {
  adminToken = (await getCachedAdminSession()).accessToken;
  await cancelAllQaMeetings(adminToken).catch(() => undefined);
  // Editor meeting-host yetkisi: sonraki kosular icin kapali birakilir (S3: gelecek toplantilar iptal olur).
  if (editorUserId) await apiJson(`/admin/users/${editorUserId}/meeting-host`, { method: "PATCH", token: adminToken, body: JSON.stringify({ enabled: false }) }).catch(() => undefined);
});

test("1) admin: sidebar Toplantilar -> Yeni toplanti formu (S9 uyarisi, sinir 4, 2-8) -> baglanti karti", async ({ browser }) => {
  test.setTimeout(240_000);
  const { page, close } = await createAuthenticatedPage(browser);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: FRONT }).catch(() => undefined);
    await page.goto("/admin");
    const nav = page.getByRole("link", { name: "Toplantılar", exact: true });
    await expect(nav).toBeVisible({ timeout: 90_000 });
    await nav.click();
    await page.waitForURL(/\/admin\/meetings/, { timeout: 60_000 });
    await expect(page.getByTestId("meetings-new")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("meetings-skeleton")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("meetings-2fa-advice")).toBeVisible(); // S2: 2FA'siz ev sahibine bilgilendirme
    await settle(page);
    await shot(page, "01-admin-toplantilar-liste");

    await page.getByTestId("meetings-new").click();
    const dlg = page.getByTestId("meeting-form-dialog");
    await expect(dlg).toBeVisible();
    await expect(page.getByTestId("meeting-title-warning")).toContainText("Hasta adı yazmayın");
    const cap = dlg.locator("#meeting-capacity");
    await expect(cap).toHaveValue("4");
    const caps = await cap.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(caps).toEqual(["2", "3", "4", "5", "6", "7", "8"]);
    await settle(page);
    await shot(page, "02-admin-yeni-toplanti-formu");

    // Bos baslik -> dogrulama hatasi (olusturma yok).
    await page.getByTestId("meeting-form-submit").click();
    await expect(dlg.getByText("3 ile 120 karakter arasında bir başlık girin.")).toBeVisible();
    await shot(page, "03-admin-yeni-toplanti-hata", false);

    const title = `${PREFIX} UI meeting ${Date.now().toString(36)}`;
    await dlg.locator("#meeting-title").fill(title);
    // Baslangic: 3 saat sonra (varsayilan "sonraki tam saat" katilim penceresine denk gelebilir).
    const start = new Date(Date.now() + 3 * 3_600_000);
    const p2 = (v: number) => String(v).padStart(2, "0");
    await dlg.locator("#meeting-date").fill(`${start.getFullYear()}-${p2(start.getMonth() + 1)}-${p2(start.getDate())}`);
    await dlg.locator("#meeting-time").fill(`${p2(start.getHours())}:${p2(start.getMinutes())}`);
    await dlg.locator("#meeting-note").fill("Ozel not: yalnizca ev sahibi gorur");
    await page.getByTestId("meeting-form-submit").click();

    const card = page.getByTestId("meeting-link-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    const link = await card.locator("#meeting-guest-link").inputValue();
    expect(link).toMatch(/\/en\/meet\/join#mg_[A-Za-z0-9_-]{43}$/);
    uiLink = guestPath(link);
    await expect(page.getByTestId("meeting-link-once-warning")).toBeVisible();

    await page.getByTestId("meeting-copy-link").click();
    await expect(page.getByTestId("meeting-copy-status")).toBeVisible();
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    if (clip !== null) expect(clip).toBe(link);

    // E-postayla gonder (S5): gecersiz adres -> hata; gecerli -> gonderildi veya (saglayici yoksa) basarisiz mesaji.
    await card.locator("#meeting-invite-email").fill("not-an-email");
    await page.getByTestId("meeting-send-invite").click();
    await expect(card.getByText("Geçerli bir e-posta adresi girin.")).toBeVisible();
    await card.locator("#meeting-invite-email").fill("qa-ag3-guest@example.com");
    await page.getByTestId("meeting-send-invite").click();
    await expect(page.getByTestId("meeting-invite-sent").or(page.getByTestId("meeting-invite-failed"))).toBeVisible({ timeout: 30_000 });
    await settle(page);
    await shot(page, "04-admin-baglanti-karti", false);
    await page.getByTestId("meeting-link-done").click();

    // Listede gorunur; ev sahibi satirinda "Yeni misafir bağlantısı" uyarisi onay penceresinde.
    const row = await rowByText(page, title);
    await expect(row.getByTestId("meeting-join-disabled")).toBeVisible(); // pencere acik degil
    await expect(row.getByTestId("meeting-new-link")).toBeVisible();
    await expect(row.getByTestId("meeting-edit")).toBeVisible();
    await expect(row.getByTestId("meeting-cancel")).toBeVisible();
    await row.getByTestId("meeting-new-link").click();
    const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog")).filter({ hasText: "Yeni misafir bağlantısı üretilsin mi?" });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("eski bağlantıyı geçersiz kılar");
    await shot(page, "05-admin-yeni-baglanti-uyarisi", false);
    await confirm.getByRole("button", { name: "Vazgeç" }).click();

    const mine = (await fetchList(adminToken, "/meetings?scope=upcoming")).find((m) => m.title === title);
    expect(mine, "toplanti API listesinde").toBeTruthy();
    expect(mine!.maxParticipants).toBe(4);
    uiMeetingId = mine!.id;
    created.push(uiMeetingId);
    // Sozlesme: liste/DTO belirtec veya ozet icermez.
    expect(JSON.stringify(mine)).not.toMatch(/mg_|TokenHash|guestToken"/);
  } finally {
    await close();
  }
});

test("2) misafir: gecersiz baglanti tek tip ekran; yaklasan geri sayim; ad dogrulamasi; ev sahibi yokken bekleme (EN 1440/390, AR RTL)", async ({ browser }) => {
  test.setTimeout(420_000);
  await ensureUi();
  const ar = await createViaApi(adminToken, `${PREFIX} AR meeting ${Date.now().toString(36)}`, "ar");
  apiArLink = guestPath(ar.guestLink);
  apiArMeetingId = ar.meeting.id;
  expect(apiArLink).toMatch(/^\/ar\/meet\/join#mg_/);

  // --- Gecersiz baglanti: bicimce gecerli ama bilinmeyen belirtec ve bicimce gecersiz belirtec ayni ekrani gosterir.
  // Paket AM: belirtecSIZ adres (adres cubugundan kopyalanmis) artik ayri "tam baglanti gerekli" ekranini gosterir.
  const g = await newGuest(browser, 1440);
  try {
    await g.page.goto("/en/meet/join");
    await expect(g.page.getByTestId("guest-needs-link")).toBeVisible({ timeout: 90_000 });
    await expect(g.page.getByTestId("guest-invalid")).toHaveCount(0);
    const texts: string[] = [];
    for (const [i, url] of ["/en/meet/join#mg_" + "A".repeat(43), "/en/meet/join#garbage"].entries()) {
      await g.page.goto("about:blank");
      await g.page.goto(url);
      await expect(g.page.getByTestId("guest-invalid")).toBeVisible({ timeout: 90_000 });
      texts.push(((await g.page.getByTestId("guest-invalid").innerText()) ?? "").replace(/\s+/g, " "));
      if (i === 0) {
        await settle(g.page);
        await expectVisitorClean(g.page, "invalid");
        await shot(g.page, "20-misafir-en-1440-gecersiz-baglanti");
      }
    }
    expect(new Set(texts).size, "gecersiz baglanti ekrani tek tip olmali").toBe(1);
    expect(texts[0]).toContain("This link is not valid");
  } finally {
    await g.context.close();
  }

  // --- Yaklasan: baslangica 3 saat var -> geri sayim, ad formu yok.
  shiftMeeting(uiMeetingId, 180);
  const up = await newGuest(browser, 1440);
  try {
    await up.page.goto(uiLink);
    await expect(up.page.getByTestId("guest-upcoming")).toBeVisible({ timeout: 90_000 });
    await expect(up.page.getByTestId("guest-countdown")).toContainText(/Opens in/);
    await expect(up.page.getByTestId("guest-name-form")).toHaveCount(0);
    await expect.poll(() => new URL(up.page.url()).hash, { timeout: 10_000 }).toBe(""); // belirtec adres cubugundan silinir
    await expectVisitorClean(up.page, "upcoming");
    await shot(up.page, "21-misafir-en-1440-yaklasan");
  } finally {
    await up.context.close();
  }

  // --- Katilim penceresi acik: ad formu + dogrulama + bekleme.
  shiftMeeting(uiMeetingId, 5);
  shiftMeeting(apiArMeetingId, 5);
  const variants: Array<{ lang: "en" | "ar"; width: number; link: string; tag: string }> = [
    { lang: "en", width: 1440, link: uiLink, tag: "en-1440" },
    { lang: "en", width: 390, link: uiLink, tag: "en-390" },
    { lang: "ar", width: 1440, link: apiArLink, tag: "ar-1440" },
    { lang: "ar", width: 390, link: apiArLink, tag: "ar-390" },
  ];
  let n = 22; // 22.. bilgisel sira (dosya adi on eki)
  for (const v of variants) {
    const guest = await newGuest(browser, v.width);
    try {
      const page = guest.page;
      // Gecersiz baglanti (tek tip ekran) bu dil/genislikte de gosterilir.
      await page.goto(`/${v.lang}/meet/join#mg_${"B".repeat(43)}`);
      await expect(page.getByTestId("guest-invalid")).toBeVisible({ timeout: 90_000 });
      await expectVisitorClean(page, `invalid ${v.tag}`);
      if (v.lang === "ar") await expect(page.locator('div[dir="rtl"][lang="ar"]').first()).toBeVisible();
      await shot(page, `${n++}-misafir-${v.tag}-gecersiz-baglanti`);
      await page.goto("about:blank");
      await page.goto(v.link);
      const form = page.getByTestId("guest-name-form");
      await expect(form).toBeVisible({ timeout: 90_000 });
      await expect.poll(() => new URL(page.url()).hash, { timeout: 10_000 }).toBe("");
      if (v.lang === "ar") {
        await expect(page.locator('div[dir="rtl"][lang="ar"]').first()).toBeVisible();
      } else {
        await expect(page.locator('div[dir="ltr"][lang="en"]').first()).toBeVisible();
        await expect(form).toContainText(/Hosted by/);
      }
      await expect(page.getByTestId("guest-privacy")).toBeVisible();
      await settle(page);
      await expectVisitorClean(page, `name ${v.tag}`);
      await shot(page, `${n++}-misafir-${v.tag}-ad`);

      const input = form.locator("input").first();
      if (v.lang === "en") {
        await input.fill("A");
        await page.getByTestId("guest-join").click();
        await expect(form.getByText("Enter at least 2 characters.")).toBeVisible();
        await input.fill("Coordinator X");
        await page.getByTestId("guest-join").click();
        await expect(form.getByText("This name is not allowed. Please choose another one.")).toBeVisible();
        await input.fill("Patient Coordinator Z");
        await page.getByTestId("guest-join").click();
        await expect(form.getByText("This name is not allowed. Please choose another one.")).toBeVisible();
        await input.fill("x".repeat(41));
        await page.getByTestId("guest-join").click();
        await expect(form.getByText("The name can be at most 40 characters.")).toBeVisible();
        await shot(page, `${n++}-misafir-${v.tag}-ad-hata`, false);
      }
      await input.fill("Maya Lee");
      await page.getByTestId("guest-join").click();
      // Ev sahibi odada degil: bekleme ekrani (lobi yok, S8).
      await expect(page.getByTestId("guest-waiting")).toBeVisible({ timeout: 60_000 });
      await settle(page);
      await expectVisitorClean(page, `waiting ${v.tag}`);
      await shot(page, `${n++}-misafir-${v.tag}-bekleme`);
    } finally {
      await guest.context.close();
    }
  }
});

test("3) ev sahibi: Katil penceresi -> oda sayfasi acilir; bekleyen misafir panelde gorunur", async ({ browser }) => {
  test.setTimeout(300_000);
  await ensureUi();
  shiftMeeting(uiMeetingId, 5);
  // Gercek Chrome + sahte kamera/mikrofon (varsayilan Chromium bunu desteklemiyor; bkz. playwright.config chrome-livekit-media). Yoksa varsayilan tarayici.
  const chrome = await chromium
    .launch({ channel: "chrome", headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-permissions"] })
    .catch(() => null);
  // Kamera/mikrofon izni context duzeyinde verilir (sahte cihaz bayragi tek basina yetmez).
  const hostCtx = await (chrome ?? browser).newContext({ baseURL: FRONT, permissions: ["camera", "microphone"] });
  const page = await hostCtx.newPage();
  const close = async () => void (await hostCtx.close());
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 30_000 });
  test.info().annotations.push({ type: "browser", description: chrome ? "chrome (sahte medya)" : "chromium (medyasiz)" });
  const diag: string[] = [];
  page.on("console", (m) => { if (/livekit|room|rtc|ice|signal|connect|websocket|fail|error/i.test(m.text())) diag.push(`${m.type()}: ${m.text().slice(0, 240)}`); });
  page.on("websocket", (w) => { diag.push(`ws open ${w.url().slice(0, 100)}`); w.on("close", () => diag.push("ws close")); });
  page.on("requestfailed", (r) => diag.push(`requestfailed ${r.url().slice(0, 100)} ${r.failure()?.errorText}`));
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/admin/meetings");
    const row = await rowByText(page, PREFIX + " UI meeting");
    const join = row.getByTestId("meeting-join");
    await expect(join).toBeVisible({ timeout: 60_000 }); // pencere acik -> "Katil" etkin baglanti
    await shot(page, "06-admin-toplanti-katil-penceresi", false);
    await join.click();
    await page.waitForURL(new RegExp(`/meet/${uiMeetingId}`), { timeout: 90_000, waitUntil: "commit" });
    await expect(page.getByTestId("host-room-prejoin")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("host-room-join")).toBeEnabled();
    await settle(page);
    await shot(page, "40-ev-sahibi-oda-hazirlik");
    await page.getByTestId("host-room-join").click();
    // LiveKit yerelde yoksa/baglanamazsa mevcut kural: oda adimi atlanir; sayfa cokmemeli.
    const room = page.getByTestId("host-room");
    const opened = await room.waitFor({ state: "visible", timeout: 45_000 }).then(() => true).catch(() => false);
    await settle(page);
    const text = await bodyText(page);
    expect(text).not.toMatch(/Application error|Unhandled Runtime Error/i);
    test.info().annotations.push({ type: "host-room", description: opened ? "host-room acildi" : "host-room acilmadi (LiveKit/medya) - hazirlik ekraninda kaldi" });
    await shot(page, opened ? "41-ev-sahibi-oda" : "41-ev-sahibi-oda-baglanamadi");
    if (!opened) test.info().annotations.push({ type: "room-diag", description: JSON.stringify(diag.slice(0, 25)).slice(0, 1500) });
    if (chrome) expect(opened, "sahte medyali Chrome ile ev sahibi odasi acilmali (LiveKit yerelde calisiyor)").toBe(true);
    if (opened) {
      await expect(page.getByTestId("meeting-participants-panel")).toBeVisible();
      // Oda aciksa bir misafir (API) katilir; panelde gorunur (bekleyen ya da odadaki). Test 2'deki bekleme satirlari
      // zaman asimina ugrayabildiginden (zamanlama bagimliligi) burada taze katilim kullanilir.
      const join = await apiJson("/meet/guest/join", { method: "POST", body: JSON.stringify({ t: uiLink.split("#")[1], name: "Maya Lee" }) });
      expect(join.status, JSON.stringify(join.body)).toBe(200);
      const status = (join.body.data as { status?: string } | undefined)?.status;
      test.info().annotations.push({ type: "guest-join-status", description: String(status) });
      const guests = await apiJson<Array<{ displayName: string; waiting: boolean }>>(`/meetings/${uiMeetingId}/guests`, { token: adminToken });
      expect(guests.body.data?.some((g) => g.displayName === "Maya Lee")).toBe(true);
      // Bekleyen misafir panelde listelenir; ev sahibi odadaysa katilim hemen "ready" olabilir (panel yalnizca LiveKit'te bagli olanlari gosterir).
      if (status === "waiting") await expect(page.getByTestId("meeting-participants-panel")).toContainText("Maya Lee", { timeout: 30_000 });
      await settle(page);
      await shot(page, "41-ev-sahibi-oda");
    }
  } finally {
    await close();
    await chrome?.close();
  }
});

test("4) yeni misafir baglantisi uretilince eski baglanti gecersiz; yenisi calisir", async ({ browser }) => {
  test.setTimeout(300_000);
  await ensureUi();
  shiftMeeting(uiMeetingId, 5);
  const { page, close } = await createAuthenticatedPage(browser);
  const old = await newGuest(browser, 1440);
  const fresh = await newGuest(browser, 1440);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/admin/meetings");
    const row = await rowByText(page, PREFIX + " UI meeting");
    await row.getByTestId("meeting-new-link").click();
    const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog")).filter({ hasText: "Yeni misafir bağlantısı üretilsin mi?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Yeni bağlantı üret" }).click();
    const card = page.getByTestId("meeting-link-card");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText("Yeni misafir bağlantısı");
    const newLink = guestPath(await card.locator("#meeting-guest-link").inputValue());
    expect(newLink).not.toBe(uiLink);
    await shot(page, "07-admin-yeni-baglanti-uretildi", false);

    await old.page.goto(uiLink);
    await expect(old.page.getByTestId("guest-invalid")).toBeVisible({ timeout: 90_000 });
    await expect(old.page.getByTestId("guest-name-form")).toHaveCount(0);
    await fresh.page.goto(newLink);
    await expect(fresh.page.getByTestId("guest-name-form")).toBeVisible({ timeout: 90_000 });
    uiLink = newLink;
  } finally {
    await old.context.close();
    await fresh.context.close();
    await close();
  }
});

test("5) ADMIN 'Tum toplantilar': baskasinin toplantisi + iptal var/katil yok; hizmete bagli toplanti rozeti ve iptal yok", async ({ browser }) => {
  test.setTimeout(300_000);
  const all = await fetchList(adminToken, "/admin/meetings?scope=upcoming");
  const svc = all.find((m) => m.serviceConsultation?.consultationNumber === svcNumber);
  expect(svc, `${svcNumber} /admin/meetings listesinde`).toBeTruthy();
  svcMeetingId = svc!.id;
  expect(JSON.stringify(all)).not.toMatch(/mg_[A-Za-z0-9_-]{20}|TokenHash/); // gozetim listesi belirtec icermez

  // Sozlesme: ADMIN baskasinin toplantisina ev sahibi olarak giremez; hizmete bagli toplanti iptal edilemez (409).
  const otherToken = await apiJson(`/meetings/${editorMeetingId}/host-token`, { method: "POST", token: adminToken, body: "{}" });
  expect([403, 404], `admin baska toplantiya host-token almamali (${otherToken.status})`).toContain(otherToken.status);
  const svcCancel = await apiJson(`/admin/meetings/${svcMeetingId}/cancel`, { method: "POST", token: adminToken, body: "{}" });
  expect(svcCancel.status).toBe(409);
  expect(svcCancel.body.error?.code).toBe("MEETING_MANAGED_BY_SERVICE_DESK");

  const { page, close } = await createAuthenticatedPage(browser);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/admin/meetings");
    await expect(page.getByTestId("meetings-new")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Tüm toplantılar" }).click();
    await expect(page.getByTestId("meetings-admin-note")).toBeVisible();

    const other = await rowByText(page, editorTitle);
    await expect(other).toContainText(`Ev sahibi: ${EDITOR_NAME}`);
    await expect(other.getByTestId("meeting-cancel")).toBeVisible();
    await expect(other.getByTestId("meeting-join")).toHaveCount(0);
    await expect(other.getByTestId("meeting-join-disabled")).toHaveCount(0);
    await expect(other.getByTestId("meeting-new-link")).toHaveCount(0);
    await expect(other.getByTestId("meeting-edit")).toHaveCount(0);

    const linked = await rowByText(page, svcNumber);
    await expect(linked.getByTestId("meeting-service-badge")).toContainText(`Service consultation · ${svcNumber}`);
    await expect(linked.getByTestId("meeting-service-note")).toBeVisible();
    await expect(linked.getByTestId("meeting-cancel")).toHaveCount(0);
    await expect(linked.getByTestId("meeting-join")).toHaveCount(0);
    await settle(page);
    await linked.scrollIntoViewIfNeeded();
    await shot(page, "08-admin-tum-toplantilar-svc-rozeti", false);

    // Baskasinin toplantisini ADMIN iptal eder (S4).
    const victim = await createViaApi(await getFixtureUserToken(EDITOR_EMAIL, EDITOR_PASSWORD, EDITOR_NAME), `${PREFIX} admin-cancel ${Date.now().toString(36)}`);
    await page.reload();
    await page.getByRole("button", { name: "Tüm toplantılar" }).click();
    const vrow = await rowByText(page, "admin-cancel");
    await vrow.getByTestId("meeting-cancel").click();
    const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog")).filter({ hasText: "Bu toplantı iptal edilsin mi?" });
    await expect(confirm).toBeVisible();
    await shot(page, "09-admin-iptal-onayi", false);
    await confirm.getByRole("button", { name: "Toplantıyı iptal et" }).click();
    await expect(page.getByTestId("meetings-notice")).toContainText("Toplantı iptal edildi.");
    const after = (await fetchList(adminToken, "/admin/meetings?scope=past")).find((m) => m.id === victim.meeting.id);
    expect(after?.status).toBe("CANCELLED");
  } finally {
    await close();
  }
});

test("6) kullanicilar ekraninda meeting-host anahtari: ver -> editorde Toplantilar gorunur; geri al -> gelecek toplanti iptal (S3)", async ({ browser }) => {
  test.setTimeout(420_000);
  // Temiz baslangic: yetki kapali (gelecek toplantilari iptal olur; test 5 bitti).
  const off = await apiJson(`/admin/users/${editorUserId}/meeting-host`, { method: "PATCH", token: adminToken, body: JSON.stringify({ enabled: false }) });
  expect(off.status).toBe(200);

  const admin = await createAuthenticatedPage(browser);
  const editor = await createAuthenticatedPageAs(browser, EDITOR_EMAIL, EDITOR_PASSWORD);
  try {
    const ap = admin.page;
    const ep = editor.page;
    await ap.setViewportSize({ width: 1440, height: 900 });
    await ep.setViewportSize({ width: 1440, height: 900 });

    // Yetkisiz EDITOR: menu yok, adrese gidince anlasilir uyari.
    await ep.goto("/admin");
    await expect(ep.getByRole("link", { name: "Tele-Sağlık" })).toBeVisible({ timeout: 90_000 }); // EDITOR /admin'den ilk izinli sayfaya yonlenir
    await settle(ep);
    await expect(ep.getByRole("link", { name: "Toplantılar", exact: true })).toHaveCount(0);
    await ep.goto("/admin/meetings");
    await expect(ep.getByTestId("meetings-forbidden")).toBeVisible({ timeout: 60_000 });

    // ADMIN: anahtar.
    await ap.goto("/admin/users");
    await ap.getByLabel("İsim veya e-posta ara").fill(EDITOR_EMAIL);
    const urow = ap.getByRole("row", { name: new RegExp(EDITOR_EMAIL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    await expect(urow).toBeVisible({ timeout: 60_000 });
    const sw = urow.getByRole("switch", { name: `Harici toplantı oluşturabilir: ${EDITOR_NAME}` });
    await expect(sw).toBeVisible();
    await expect(sw).not.toBeChecked();
    await sw.click();
    const grantDlg = ap.getByRole("alertdialog").or(ap.getByRole("dialog")).filter({ hasText: "Harici toplantı yetkisi verilsin mi?" });
    await expect(grantDlg).toBeVisible();
    await grantDlg.getByRole("button", { name: "Yetki ver" }).click();
    await expect(ap.getByText("Toplantı yetkisi verildi.")).toBeVisible({ timeout: 30_000 });
    // BULGU (frontend): MeetingHostToggle onChanged = load() arama terimini gecirmez; aktif aramada satir ilk sayfada degilse kaybolur.
    await ap.waitForTimeout(2_000);
    const stayed = await urow.isVisible().catch(() => false);
    if (!stayed) test.info().annotations.push({ type: "BUG", description: "users/page.tsx: anahtar degisince load() aramayi yok sayiyor; filtrelenen satir kayboldu (arama yeniden yazilinca gelir)" });
    await ap.getByLabel("İsim veya e-posta ara").fill("");
    await ap.getByLabel("İsim veya e-posta ara").fill(EDITOR_EMAIL);
    await expect(urow.getByRole("switch", { name: `Harici toplantı oluşturabilir: ${EDITOR_NAME}` })).toBeChecked({ timeout: 30_000 });
    await settle(ap);
    await shot(ap, "10-kullanicilar-meeting-host-anahtari", false);

    // EDITOR yeniden yuklenince menu gorunur; toplanti olusturabilir.
    await ep.goto("/admin");
    const link = ep.getByRole("link", { name: "Toplantılar", exact: true });
    await expect(link).toBeVisible({ timeout: 90_000 });
    await link.click();
    await ep.waitForURL(/\/admin\/meetings/);
    await expect(ep.getByTestId("meetings-new")).toBeVisible({ timeout: 60_000 });
    await expect(ep.getByRole("button", { name: "Tüm toplantılar" })).toHaveCount(0); // gozetim yalniz ADMIN
    const title = `${PREFIX} editor revoke ${Date.now().toString(36)}`;
    await ep.getByTestId("meetings-new").click();
    await ep.locator("#meeting-title").fill(title);
    await ep.getByTestId("meeting-form-submit").click();
    await expect(ep.getByTestId("meeting-link-card")).toBeVisible({ timeout: 30_000 });
    await ep.getByTestId("meeting-link-done").click();
    await shot(ep, "11-editor-toplantilar-yetki-verildi");
    const before = (await fetchList(adminToken, "/admin/meetings?scope=upcoming")).find((m) => m.title === title);
    expect(before?.status).toBe("SCHEDULED");

    // Geri al: gelecek toplanti iptal olur (S3).
    await ap.reload();
    await ap.getByLabel("İsim veya e-posta ara").fill(EDITOR_EMAIL);
    const urow2 = ap.getByRole("row", { name: new RegExp(EDITOR_EMAIL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    await expect(urow2).toBeVisible({ timeout: 60_000 });
    await urow2.getByRole("switch", { name: `Harici toplantı oluşturabilir: ${EDITOR_NAME}` }).click();
    const revokeDlg = ap.getByRole("alertdialog").or(ap.getByRole("dialog")).filter({ hasText: "Toplantı yetkisi kaldırılsın mı?" });
    await expect(revokeDlg).toBeVisible();
    await expect(revokeDlg).toContainText("Gelecekteki toplantıları iptal edilecek");
    await shot(ap, "12-kullanicilar-yetki-geri-al-uyarisi", false);
    await revokeDlg.getByRole("button", { name: "Yetkiyi kaldır" }).click();
    await expect(ap.getByText("Toplantı yetkisi kaldırıldı.")).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await fetchList(adminToken, "/admin/meetings?scope=past")).find((m) => m.title === title)?.status, { timeout: 30_000 })
      .toBe("CANCELLED");

    await ep.goto("/admin");
    await expect(ep.getByRole("link", { name: "Toplantılar", exact: true })).toHaveCount(0, { timeout: 60_000 });
    await ep.goto("/admin/meetings", { waitUntil: "commit" });
    await expect(ep.getByTestId("meetings-forbidden")).toBeVisible({ timeout: 60_000 });
  } finally {
    await admin.close();
    await editor.close();
  }
});
