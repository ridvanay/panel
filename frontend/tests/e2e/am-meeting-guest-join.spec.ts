import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { chromium, test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, API_BASE_URL, getCachedAdminSession } from "./support/api";
import { apiJson, execSql, prepareContext, settle } from "./support/ai3-service-fixtures";

/**
 * qa-agent — Paket AM (ACIL): harici toplantida misafir girisi. Yalnizca saas_e2e; backend :4001 (TRUST_PROXY=true,
 * komut satiri env'i) + frontend :3100 (E2E_SKIP_WEBSERVER=1) + yerel Docker LiveKit. Gercek Chrome + sahte medya.
 *
 * Farkli IP simulasyonu: her tarayici baglamina `extraHTTPHeaders: { "X-Forwarded-For": <ip> }` verilir (TRUST_PROXY=true
 * iken backend `request.ip` bu degerdir). Test 0 bunun gercekten calistigini kanitlar (IP basina "gecersiz belirtec" kovasi:
 * tarayicidan tuketilen kova, ayni XFF ile dogrudan istekte dolu; baska XFF'te bos).
 * Her senaryo: ekran, HTTP kodlari, DB misafir satiri sayisi, LiveKit katilimci sayisi. Sonuclar "AMRES" on ekli satirlara yazilir.
 * Ekran goruntuleri docs/prompts/2026-11-04-AM-ekran/.
 */
process.env.E2E_FRONTEND_URL ??= "http://siteadi.localhost:3100";
test.use({ navigationTimeout: 120_000, actionTimeout: 20_000 });
test.describe.configure({ mode: "default" });

const FRONT = process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100";
const BROWSER_API = process.env.E2E_BROWSER_API_URL ?? "http://siteadi.localhost:4001/api/v1";
const SHOT_DIR = path.resolve(__dirname, "../../../docs/prompts/2026-11-04-AM-ekran");
const BACKEND_DIR = path.resolve(__dirname, "../../../backend");
const PREFIX = "QA AM";
const NET = "203.0.113."; // RFC 5737 TEST-NET-3

let adminToken = "";
let chrome: Browser;
const created: string[] = [];

function res(label: string, data: Record<string, unknown>) {
  console.log(`AMRES ${label} ${JSON.stringify(data)}`);
  test.info().annotations.push({ type: label, description: JSON.stringify(data).slice(0, 900) });
}

function shot(page: Page, name: string, fullPage = false) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  return page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage });
}

function psql(sql: string): string {
  return execFileSync("docker", ["exec", "claudecodeproje-db-1", "psql", "-U", "postgres", "-d", "saas_e2e", "-At", "-c", sql], { encoding: "utf8" }).trim();
}
const dbGuestRows = (meetingId: string) => Number(psql(`select count(*) from external_meeting_guests where "meetingId"='${meetingId}'`));
const dbRoomName = (meetingId: string) => psql(`select "roomName" from external_meetings where id='${meetingId}'`);

function shiftMeeting(id: string, startInMin: number, durationMin = 30) {
  execSql(`UPDATE "external_meetings" SET "startsAt" = now() + interval '${startInMin} minutes', "endsAt" = now() + interval '${startInMin + durationMin} minutes' WHERE "id" = '${id}';`);
}

// --- LiveKit (sunucu SDK'si backend'den) ---
const backendRequire = createRequire(path.join(BACKEND_DIR, "package.json"));
interface LkPart {
  identity: string;
  state: number;
}
async function lkParticipants(room: string): Promise<LkPart[]> {
  const { RoomServiceClient } = backendRequire("livekit-server-sdk");
  const client = new RoomServiceClient("http://localhost:7880", process.env.LIVEKIT_API_KEY ?? "devkey", process.env.LIVEKIT_API_SECRET ?? "secret_livekit_local_dev_key_32bytes");
  const list = (await client.listParticipants(room)) as Array<{ identity: string; state: number }>;
  return list.map((p) => ({ identity: p.identity, state: Number(p.state) }));
}
/** state: 1 JOINED, 2 ACTIVE. Kapasiteye sayilanlar. */
const counted = (l: LkPart[]) => l.filter((p) => p.state === 1 || p.state === 2);

async function createMeeting(title: string, maxParticipants: number, locale = "en") {
  const startsAt = new Date(Date.now() + 3 * 3_600_000).toISOString();
  const r = await apiJson<{ meeting: { id: string }; guestLink: string }>("/meetings", {
    method: "POST",
    token: adminToken,
    body: JSON.stringify({ title: `${PREFIX} ${title} ${Date.now().toString(36)}`, startsAt, durationMin: 30, maxParticipants, locale }),
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const id = r.body.data!.meeting.id;
  created.push(id);
  shiftMeeting(id, 5); // katilim penceresi acik
  const u = new URL(r.body.data!.guestLink, FRONT);
  return { id, link: `${u.pathname}${u.hash}`, room: dbRoomName(id) };
}

async function newCtx(ip: string | null): Promise<BrowserContext> {
  const ctx = await chrome.newContext({
    baseURL: FRONT,
    viewport: { width: 1280, height: 800 },
    permissions: ["camera", "microphone"],
    ...(ip ? { extraHTTPHeaders: { "X-Forwarded-For": ip } } : {}),
  });
  await prepareContext(ctx);
  return ctx;
}

interface Hit {
  t: number;
  ep: string;
  status: number;
  ra?: number;
}
interface Guest {
  ctx: BrowserContext;
  page: Page;
  ip: string;
  name: string;
  hits: Hit[];
}

async function newGuest(ip: string, name: string): Promise<Guest> {
  const ctx = await newCtx(ip);
  const page = await ctx.newPage();
  const g: Guest = { ctx, page, ip, name, hits: [] };
  page.on("response", (r) => {
    if (r.request().method() !== "POST" || !r.url().includes("/meet/guest/")) return;
    const ra = Number(r.headers()["retry-after"]);
    g.hits.push({ t: Date.now(), ep: r.url().split("/meet/guest/")[1]!.split("?")[0]!, status: r.status(), ...(Number.isFinite(ra) && ra > 0 ? { ra } : {}) });
  });
  return g;
}

const SCREENS = ["meeting-room", "guest-full", "guest-waiting", "guest-invalid", "guest-needs-link", "guest-error", "guest-name-form"];
async function screen(page: Page, timeout = 90_000): Promise<string> {
  const loc = page.locator(SCREENS.map((s) => `[data-testid="${s}"]`).join(","));
  await loc.first().waitFor({ state: "visible", timeout });
  return (await loc.first().getAttribute("data-testid")) ?? "?";
}

async function guestEnter(g: Guest, link: string, timeout = 90_000): Promise<string> {
  await g.page.goto(link);
  const form = g.page.getByTestId("guest-name-form");
  await expect(form).toBeVisible({ timeout });
  await form.locator("input").first().fill(g.name);
  await g.page.getByTestId("guest-join").click();
  // ad formu hemen kapanir; sonuc ekrani
  await expect(form).toHaveCount(0, { timeout });
  return screen(g.page, timeout);
}

async function hostEnter(meetingId: string, ip: string | null): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await newCtx(ip);
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  // Oturum kurulumu sert gecisle yarisabilir ("Sign in to open this meeting"): oturum acik gorunene dek ayni sayfa yeniden yuklenir.
  await expect(async () => {
    await page.goto(`/meet/${meetingId}`);
    await expect(page.getByTestId("host-room-prejoin")).toBeVisible({ timeout: 40_000 });
  }).toPass({ timeout: 150_000, intervals: [1000] });
  await expect(page.getByTestId("host-room-join")).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("host-room-join").click();
  await expect(page.getByTestId("host-room")).toBeVisible({ timeout: 60_000 });
  return { ctx, page };
}

function statusSummary(guests: Guest[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of guests) for (const h of g.hits) out[`${h.ep}:${h.status}`] = (out[`${h.ep}:${h.status}`] ?? 0) + 1;
  return out;
}

async function expectLkCount(room: string, n: number, timeout = 60_000) {
  await expect
    .poll(async () => counted(await lkParticipants(room)).length, { timeout, intervals: [1000] })
    .toBe(n);
}

/** A / B / C ortak gövde: ev sahibi + 5 misafir, hepsi odada; bir misafir yeniler. */
async function roomScenario(browser: Browser, label: string, tag: string, ips: string[], hostIp: string) {
  void browser;
  const m = await createMeeting(label, 6);
  const host = await hostEnter(m.id, hostIp);
  const guests: Guest[] = [];
  try {
    for (let i = 0; i < 5; i++) guests.push(await newGuest(ips[i]!, `QA Guest ${tag}${i + 1}`));
    const screens = await Promise.all(guests.map((g) => guestEnter(g, m.link)));
    expect(screens, "tum misafirler odada").toEqual(Array(5).fill("meeting-room"));
    await expectLkCount(m.room, 6);
    expect(dbGuestRows(m.id)).toBe(5);
    const hits = statusSummary(guests);
    expect(Object.keys(hits).filter((k) => !/:200$/.test(k)), "200 disi guest yaniti yok").toEqual([]);
    await shot(guests[0]!.page, `${tag}-coklu-misafir-oda`);

    // Yenileme: ayni oda, ad formu yok, katilimci sayisi ayni, DB satiri artmaz, ayni LiveKit kimligi.
    const before = counted(await lkParticipants(m.room)).map((p) => p.identity).sort();
    const target = guests[2]!;
    const joinsBefore = target.hits.filter((h) => h.ep === "join").length;
    await target.page.reload();
    await expect(target.page.getByTestId("meeting-room")).toBeVisible({ timeout: 90_000 });
    await expect(target.page.getByTestId("guest-name-form")).toHaveCount(0);
    await expect(target.page.getByTestId("guest-invalid")).toHaveCount(0);
    await expect
      .poll(async () => (counted(await lkParticipants(m.room)).map((p) => p.identity).sort().join(",")), { timeout: 60_000, intervals: [1000] })
      .toBe(before.join(","));
    expect(counted(await lkParticipants(m.room)).length).toBe(6);
    expect(dbGuestRows(m.id)).toBe(5);
    const after = target.hits.filter((h) => h.ep === "join");
    expect(after.length, "yenilemede yeni join istegi").toBeGreaterThan(joinsBefore);
    expect(after[after.length - 1]!.status).toBe(200);
    await settle(target.page);
    await shot(target.page, `${tag}-yenileme-sonrasi-oda`);
    res(label, {
      screens,
      ips,
      http: statusSummary(guests),
      dbGuestRows: dbGuestRows(m.id),
      livekitCounted: counted(await lkParticipants(m.room)).length,
      livekitTotal: (await lkParticipants(m.room)).length,
      refresh: { screen: "meeting-room", nameForm: false, sameIdentities: true },
    });
  } finally {
    for (const g of guests) await g.ctx.close().catch(() => undefined);
    await host.ctx.close().catch(() => undefined);
  }
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  adminToken = (await getCachedAdminSession()).accessToken;
  chrome = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-permissions"] });
  const flags = await apiJson("/meetings?scope=upcoming", { token: adminToken });
  expect(flags.status, "GET /meetings 200 olmali").toBe(200);
});

test.afterAll(async () => {
  await chrome?.close().catch(() => undefined);
  adminToken = (await getCachedAdminSession()).accessToken;
  for (const id of created) await apiJson(`/meetings/${id}/cancel`, { method: "POST", token: adminToken, body: "{}" }).catch(() => undefined);
});

test("0) IP simulasyonu dogrulamasi: tarayici XFF'i backend'in request.ip'si olur; farkli XFF ayri kova", async () => {
  test.setTimeout(120_000);
  const octet = 200 + Math.floor(Math.random() * 50);
  const P = `${NET}${octet}`;
  const Q = `${NET}${octet === 249 ? 200 : octet + 1}`;
  const ctx = await newCtx(P);
  const page = await ctx.newPage();
  try {
    await page.goto("/en/meet/join");
    await expect(page.getByTestId("guest-needs-link")).toBeVisible({ timeout: 90_000 });
    const bad = `mg_${"Z".repeat(43)}`;
    const codes: number[] = await page.evaluate(async ({ url, token }) => {
      const out: number[] = [];
      for (let i = 0; i < 33; i++) {
        try {
          const r = await fetch(`${url}/meet/guest/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token, name: "Probe" }) });
          out.push(r.status);
        } catch {
          out.push(-1);
        }
      }
      return out;
    }, { url: BROWSER_API, token: bad });
    expect(codes.includes(-1), `tarayici istegi CORS/ag hatasi vermemeli: ${codes.join(",")}`).toBe(false);
    expect(codes.slice(0, 25).every((c) => c === 404)).toBe(true);
    expect(codes.includes(429), `33 gecersiz denemede 429 gorulmeli: ${codes.join(",")}`).toBe(true);

    const direct = async (xff: string | null) =>
      (await fetch(`${API_BASE_URL}/meet/guest/join`, { method: "POST", headers: { "Content-Type": "application/json", ...(xff ? { "X-Forwarded-For": xff } : {}) }, body: JSON.stringify({ t: bad, name: "Probe" }) })).status;
    const sameP = await direct(P);
    const otherQ = await direct(Q);
    const noXff = await direct(null);
    expect(sameP, "ayni XFF = ayni kova (tarayici istekleri P olarak gorulmus)").toBe(429);
    expect(otherQ, "farkli XFF = bos kova").toBe(404);
    expect(noXff, "XFF'siz (loopback) = ayri kova").toBe(404);
    res("0-ip-simulasyonu", { browserXff: P, browserCodes: codes.join(","), directSameXff: sameP, directOtherXff: otherQ, directNoXff: noXff });
  } finally {
    await ctx.close();
  }
});

test("A) ayni IP: ev sahibi + 5 misafir (max 6) hepsi odada; yenileme ayni odaya doner", async ({ browser }) => {
  test.setTimeout(420_000);
  const ip = `${NET}10`;
  await roomScenario(browser, "A-ayni-IP", "A", Array(5).fill(ip), ip);
});

test("B) farkli IP: ev sahibi + 5 misafir 5 farkli IP, hepsi odada; yenileme ayni sonuc", async ({ browser }) => {
  test.setTimeout(420_000);
  await roomScenario(browser, "B-farkli-IP", "B", [21, 22, 23, 24, 25].map((n) => `${NET}${n}`), `${NET}20`);
});

test("C) karisik: 3 misafir ayni IP + 2 farkli IP, hepsi odada; yenileme", async ({ browser }) => {
  test.setTimeout(420_000);
  const shared = `${NET}30`;
  await roomScenario(browser, "C-karisik-IP", "C", [shared, shared, shared, `${NET}31`, `${NET}32`], shared);
});

test("D) IP degisimi: ayni sekmede X-Forwarded-For degisir + yenileme -> ayni guestId/LiveKit kimligi", async () => {
  test.setTimeout(300_000);
  const A = `${NET}40`;
  const B = `${NET}41`;
  const C = `${NET}42`;
  const m = await createMeeting("D-IP-degisimi", 4);
  const host = await hostEnter(m.id, A);
  const g1 = await newGuest(A, "QA Guest D1");
  const g2 = await newGuest(C, "QA Guest D2");
  try {
    expect(await guestEnter(g1, m.link)).toBe("meeting-room");
    expect(await guestEnter(g2, m.link)).toBe("meeting-room");
    await expectLkCount(m.room, 3);
    const ids0 = counted(await lkParticipants(m.room)).map((p) => p.identity).sort();
    const steps: Array<{ ip: string; screen: string; sameIdentities: boolean; rows: number; lastJoin: number }> = [];
    for (const ip of [B, C, A]) {
      await g1.ctx.setExtraHTTPHeaders({ "X-Forwarded-For": ip });
      await g1.page.reload();
      await expect(g1.page.getByTestId("meeting-room")).toBeVisible({ timeout: 90_000 });
      await expect(g1.page.getByTestId("guest-name-form")).toHaveCount(0);
      await expect
        .poll(async () => counted(await lkParticipants(m.room)).map((p) => p.identity).sort().join(","), { timeout: 60_000, intervals: [1000] })
        .toBe(ids0.join(","));
      const joins = g1.hits.filter((h) => h.ep === "join");
      steps.push({ ip, screen: "meeting-room", sameIdentities: true, rows: dbGuestRows(m.id), lastJoin: joins[joins.length - 1]!.status });
      expect(steps[steps.length - 1]!.rows).toBe(2);
      expect(steps[steps.length - 1]!.lastJoin).toBe(200);
    }
    await shot(g1.page, "D-ip-degisimi-sonrasi-oda");
    res("D-IP-degisimi", { start: A, steps, livekitCounted: counted(await lkParticipants(m.room)).length, http: statusSummary([g1, g2]) });
  } finally {
    await g1.ctx.close().catch(() => undefined);
    await g2.ctx.close().catch(() => undefined);
    await host.ctx.close().catch(() => undefined);
  }
});

test("E) adres cubugu adresini yeni sekmede acma -> 'tam baglanti gerekli' (invalid DEGIL); EN + AR", async () => {
  test.setTimeout(300_000);
  const ip = `${NET}50`;
  const m = await createMeeting("E-tam-baglanti", 4);
  const host = await hostEnter(m.id, ip);
  const g = await newGuest(ip, "QA Guest E1");
  const extra: BrowserContext[] = [];
  try {
    expect(await guestEnter(g, m.link)).toBe("meeting-room");
    const copied = g.page.url(); // adres cubugundaki adres (belirtec silinmis)
    expect(copied).not.toContain("#mg_");
    // Ayni baglamda yeni sekme (sessionStorage sekmeye ozgu).
    const tab = await g.ctx.newPage();
    const tabHits: string[] = [];
    tab.on("request", (r) => void (r.url().includes("/meet/guest/") && tabHits.push(r.url())));
    await tab.goto(copied);
    await expect(tab.getByTestId("guest-needs-link")).toBeVisible({ timeout: 90_000 });
    await expect(tab.getByTestId("guest-invalid")).toHaveCount(0);
    await expect(tab.getByTestId("guest-name-form")).toHaveCount(0);
    await expect(tab.getByTestId("guest-needs-link")).toContainText("This page needs the full invitation link");
    expect(tabHits, "belirtecsiz sayfa backend'e istek atmamali").toEqual([]);
    await settle(tab);
    await shot(tab, "E-tam-baglanti-gerekli-EN");

    // Yeni baglam (baska kisiye gonderilen adres), AR.
    const ctxAr = await newCtx(`${NET}51`);
    extra.push(ctxAr);
    const ar = await ctxAr.newPage();
    await ar.goto("/ar/meet/join");
    await expect(ar.getByTestId("guest-needs-link")).toBeVisible({ timeout: 90_000 });
    await expect(ar.getByTestId("guest-invalid")).toHaveCount(0);
    await expect(ar.getByTestId("guest-needs-link")).toContainText("رابط الدعوة الكامل");
    await expect(ar.locator('div[dir="rtl"][lang="ar"]').first()).toBeVisible();
    await settle(ar);
    await shot(ar, "E-tam-baglanti-gerekli-AR");

    // Gecersiz (biçimce gecerli, bilinmeyen) belirtec hala "invalid".
    const inv = await ctxAr.newPage();
    await inv.goto(`/en/meet/join#mg_${"B".repeat(43)}`);
    await expect(inv.getByTestId("guest-invalid")).toBeVisible({ timeout: 90_000 });
    await expect(inv.getByTestId("guest-needs-link")).toHaveCount(0);
    res("E-tam-baglanti", { copiedUrl: copied.replace(/\/\/[^/]+/, "//<host>"), newTabScreen: "guest-needs-link", arScreen: "guest-needs-link", unknownTokenScreen: "guest-invalid", backendRequestsFromNewTab: tabHits.length, dbGuestRows: dbGuestRows(m.id) });
  } finally {
    for (const c of extra) await c.close().catch(() => undefined);
    await g.ctx.close().catch(() => undefined);
    await host.ctx.close().catch(() => undefined);
  }
});

for (const cfg of [
  { cap: 5, tag: "F5-ayni-IP", mixed: false },
  { cap: 6, tag: "F6-farkli-IP", mixed: true },
]) {
  test(`F) maxParticipants=${cfg.cap} (${cfg.mixed ? "farkli IP" : "ayni IP"}): sinirin 1 fazlasi -> full + Tekrar dene; biri cikinca girer`, async () => {
    test.setTimeout(420_000);
    const host_ip = `${NET}${cfg.mixed ? 60 : 70}`;
    const ipFor = (i: number) => (cfg.mixed ? `${NET}${61 + i}` : host_ip);
    const m = await createMeeting(cfg.tag, cfg.cap);
    const host = await hostEnter(m.id, host_ip);
    const guests: Guest[] = [];
    try {
      const seats = cfg.cap - 1; // ev sahibi 1 koltuk
      for (let i = 0; i < seats + 1; i++) guests.push(await newGuest(ipFor(i), `QA Guest ${cfg.tag}${i + 1}`));
      const inRoom = guests.slice(0, seats);
      const screens = await Promise.all(inRoom.map((g) => guestEnter(g, m.link)));
      expect(screens).toEqual(Array(seats).fill("meeting-room"));
      await expectLkCount(m.room, cfg.cap);

      const over = guests[seats]!;
      expect(await guestEnter(over, m.link)).toBe("guest-full");
      await expect(over.page.getByTestId("guest-full-retry")).toBeVisible();
      expect(over.hits.some((h) => h.ep === "join" && h.status === 409)).toBe(true);
      await settle(over.page);
      await shot(over.page, `${cfg.tag}-full-tekrar-dene`);
      // Hala doluyken tekrar dene -> yine full
      await over.page.getByTestId("guest-full-retry").click();
      await expect(over.page.getByTestId("guest-full")).toBeVisible({ timeout: 30_000 });
      // BULGU AM-QA-1: 409 MEETING_FULL yanitinda guestSession donmedigi icin her "Tekrar dene" yeni (admitted olmayan) misafir
      // satiri acar ve IP basina oturum kotasini tuketir. Burada yalniz gozlemlenir; kota tukenmesi F2 testinde.
      const rowsAfterFullRetry = dbGuestRows(m.id);
      expect(rowsAfterFullRetry).toBeGreaterThanOrEqual(seats + 1);

      // Biri cikar (duzgun ayrilma)
      const leaver = inRoom[1]!;
      await leaver.page.getByTestId("guest-bar-leave").click();
      await expect(leaver.page.getByTestId("guest-left")).toBeVisible({ timeout: 30_000 });
      await expectLkCount(m.room, cfg.cap - 1);
      await over.page.getByTestId("guest-full-retry").click();
      await expect(over.page.getByTestId("meeting-room")).toBeVisible({ timeout: 60_000 });
      await expectLkCount(m.room, cfg.cap);
      const rowsFinal = dbGuestRows(m.id);
      expect(rowsFinal).toBeGreaterThanOrEqual(seats + 1);
      res(`F-max${cfg.cap}`, {
        dbRows: { afterFullRetry: rowsAfterFullRetry, final: rowsFinal, admitted: Number(psql(`select count(*) from external_meeting_guests where "meetingId"='${m.id}' and "admittedAt" is not null`)), seatsExpected: seats },
        ips: cfg.mixed ? "farkli" : "ayni",
        inRoomScreens: screens.length,
        overflowScreen: "guest-full",
        overflowHttp: over.hits.filter((h) => h.ep === "join").map((h) => h.status),
        afterLeaveRetry: "meeting-room",
        dbGuestRows: dbGuestRows(m.id),
        livekitCounted: counted(await lkParticipants(m.room)).length,
      });
    } finally {
      for (const g of guests) await g.ctx.close().catch(() => undefined);
      await host.ctx.close().catch(() => undefined);
    }
  });
}

for (const mixed of [false, true]) {
  test(`G) ev sahibi yokken 4 misafir ${mixed ? "farkli IP" : "ayni IP"} 100 sn bekler; 429 yok / Retry-After'a uyulur; ev sahibi gelince <=10 sn`, async () => {
    test.setTimeout(480_000);
    const tag = mixed ? "G-farkli-IP" : "G-ayni-IP";
    const hostIp = `${NET}${mixed ? 90 : 80}`;
    const m = await createMeeting(tag, 6);
    const guests: Guest[] = [];
    let host: { ctx: BrowserContext; page: Page } | null = null;
    try {
      for (let i = 0; i < 4; i++) guests.push(await newGuest(mixed ? `${NET}${91 + i}` : hostIp, `QA Guest ${tag}${i + 1}`));
      const screens = await Promise.all(guests.map((g) => guestEnter(g, m.link)));
      expect(screens).toEqual(Array(4).fill("guest-waiting"));
      await shot(guests[0]!.page, `${tag}-bekleme`);
      const tStart = Date.now();
      // Sabit sure testin konusu: bekleme ekraninda 100 sn yoklama.
      await guests[0]!.page.waitForTimeout(100_000);
      for (const g of guests) await expect(g.page.getByTestId("guest-waiting")).toBeVisible();
      const all = guests.flatMap((g) => g.hits.map((h) => ({ ...h, who: g.name })));
      const n429 = all.filter((h) => h.status === 429);
      // Retry-After uyumu: her 429'dan sonraki ilk join istegi >= Retry-After
      let violations = 0;
      for (const g of guests) {
        const joins = g.hits.filter((h) => h.ep === "join");
        joins.forEach((h, idx) => {
          const next = joins[idx + 1];
          if (h.status === 429 && h.ra && next && next.t - h.t < h.ra * 1000 - 1500) violations++;
        });
      }
      expect(violations, "429 sonrasi Retry-After'a uyulmali").toBe(0);
      expect(n429.length, "bekleme yoklamasinda 429 beklenmez").toBe(0);

      host = await hostEnter(m.id, hostIp);
      const tHost = Date.now();
      const elapsed = await Promise.all(
        guests.map(async (g) => {
          await expect(g.page.getByTestId("meeting-room")).toBeVisible({ timeout: 30_000 });
          return (Date.now() - tHost) / 1000;
        })
      );
      const maxElapsed = Math.max(...elapsed);
      expect(maxElapsed, "ev sahibi gelince en gec ~10 sn").toBeLessThanOrEqual(10);
      await expectLkCount(m.room, 5);
      expect(dbGuestRows(m.id)).toBe(4);
      await shot(guests[0]!.page, `${tag}-ev-sahibi-gelince-oda`);
      res(tag, {
        waitedSec: Math.round((tHost - tStart) / 1000),
        totalPolls: all.length,
        http: statusSummary(guests),
        count429: n429.length,
        retryAfterViolations: violations,
        enterAfterHostSec: elapsed.map((x) => Math.round(x * 10) / 10),
        dbGuestRows: dbGuestRows(m.id),
        livekitCounted: counted(await lkParticipants(m.room)).length,
      });
    } finally {
      for (const g of guests) await g.ctx.close().catch(() => undefined);
      await host?.ctx.close().catch(() => undefined);
    }
  });
}

test("F2) BULGU AM-QA-1: 'dolu' denemeleri IP oturum kotasini tuketir; yer acilinca ayni IP'den yeni misafir girebilmeli", async () => {
  test.setTimeout(420_000);
  const ip = `${NET}100`;
  const m = await createMeeting("F2-kota", 3); // kota = max(20, 12) = 20
  const host = await hostEnter(m.id, ip);
  const guests: Guest[] = [await newGuest(ip, "QA Guest F2a"), await newGuest(ip, "QA Guest F2b")];
  try {
    expect(await Promise.all(guests.map((g) => guestEnter(g, m.link)))).toEqual(["meeting-room", "meeting-room"]);
    await expectLkCount(m.room, 3);
    const token = m.link.split("#")[1]!;
    const post = async (name: string, xff: string) => {
      const r = await fetch(`${API_BASE_URL}/meet/guest/join`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": xff }, body: JSON.stringify({ t: token, name }) });
      return r.status;
    };
    const codes: number[] = [];
    for (let i = 0; i < 24; i++) codes.push(await post(`Retry ${i}`, ip)); // oda dolu: hepsi 409
    const rowsAfterSpam = dbGuestRows(m.id);
    await guests[0]!.page.getByTestId("guest-bar-leave").click();
    await expect(guests[0]!.page.getByTestId("guest-left")).toBeVisible({ timeout: 30_000 });
    await expectLkCount(m.room, 2);
    const otherIp = await post("Control other IP", `${NET}101`);
    const sameIp = await post("Same IP after seat freed", ip);
    res("F2-kota-tukenmesi", { fullCodes: [...new Set(codes)], rowsAfterSpam, quota: 20, afterSeatFreed: { otherIp, sameIp } });
    expect(otherIp, "kontrol: baska IP girer").toBe(200);
    expect(sameIp, "ayni IP'den yer acilinca girebilmeli").toBe(200);
  } finally {
    for (const g of guests) await g.ctx.close().catch(() => undefined);
    await host.ctx.close().catch(() => undefined);
  }
});
