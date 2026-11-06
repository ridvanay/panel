import crypto from "node:crypto";
import { test, expect, type Page, type Request } from "@playwright/test";
import { ADMIN_EMAIL, getCachedAdminSession, getFixtureUserToken } from "./support/api";
import { dbRows } from "./support/blog-preview-fixtures";
import { createBlogPost } from "./support/blog-fixtures";

/**
 * Paket AP — gizli token'lar adres çubuğunda yalnızca `#` parçasında: sayfa okur, adresten siler, API'ye
 * `X-Access-Token` başlığı / POST gövdesiyle gönderir. Her akışta kanıtlanan: (1) akış çalışır, (2) sayfa
 * yüklendikten sonra adres çubuğunda token yok, (3) tarayıcının yaptığı HİÇBİR isteğin adresinde token yok.
 * Eski bağlantılar (gönderilmiş e-postalar) 2026-12-21'e kadar çalışır ve hemen yeni biçime çevrilir.
 * Token satırları `saas_e2e`'ye bilinen özetle (SHA-256) eklenir; testten sonra silinir.
 */
const API = process.env.E2E_API_URL ?? "http://localhost:4001/api/v1";
const FRONTEND = process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100";
const RUN = Date.now().toString(36);
const sha256 = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");
const newToken = () => crypto.randomBytes(32).toString("base64url");
const q = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** Sayfanın yaptığı tüm isteklerin adresleri (gövde/başlık hariç). */
function captureRequestUrls(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (r: Request) => urls.push(r.url()));
  return urls;
}

function expectNoTokenInUrls(urls: string[], token: string) {
  const leaked = urls.filter((u) => u.includes(token) || u.includes(encodeURIComponent(token)));
  expect(leaked, "token hiçbir istek adresinde olmamalı").toEqual([]);
}

test.describe.configure({ mode: "serial" });
test.use({ navigationTimeout: 60_000, actionTimeout: 20_000 });

test.describe("şifre sıfırlama", () => {
  const email = `qa-ap-reset-${RUN}@example.com`;
  const NEW_PASSWORD = "ApYeniSifre.2026!";
  let userId = "";

  test.beforeAll(async () => {
    await getFixtureUserToken(email, "ApEskiSifre.2026!", "AP Reset");
    userId = dbRows<{ id: string }>(`SELECT id FROM users WHERE email = ${q(email)}`)[0]!.id;
  });
  test.afterAll(() => {
    dbRows(`DELETE FROM password_reset_tokens WHERE "userId" = ${q(userId)} RETURNING id`);
  });

  function insertResetToken(raw: string) {
    dbRows(`INSERT INTO password_reset_tokens (id, "userId", "tokenHash", "expiresAt") VALUES (${q(crypto.randomUUID())}, ${q(userId)}, ${q(sha256(raw))}, now() + interval '1 hour') RETURNING id`);
  }

  test("#token= ile şifre değişir; adres ve istek adreslerinde token yok", async ({ page }) => {
    const raw = newToken();
    insertResetToken(raw);
    const urls = captureRequestUrls(page);
    await page.goto(`/reset-password#token=${raw}`);
    await expect(page.locator("#password")).toBeVisible();
    expect(page.url()).not.toContain(raw);
    await page.locator("#password").fill(NEW_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/login/);
    expectNoTokenInUrls(urls, raw);
    const login = await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: NEW_PASSWORD }) });
    expect(login.status).toBe(200);
  });

  test("eski ?token= bağlantısı çalışır ve adres hemen temizlenir", async ({ page }) => {
    const raw = newToken();
    insertResetToken(raw);
    await page.goto(`/reset-password?token=${raw}`);
    await expect(page.locator("#password")).toBeVisible();
    await expect.poll(() => page.url()).not.toContain(raw);
  });
});

test.describe("blog önizleme", () => {
  let adminToken = "";
  let postId = "";
  let shareToken = "";
  const title = `QA AP Önizleme ${RUN}`;

  test.beforeAll(async () => {
    adminToken = (await getCachedAdminSession()).accessToken;
    postId = (await createBlogPost(adminToken, { title, status: "DRAFT" })).id;
    const res = await fetch(`${API}/admin/blog/${postId}/preview-link`, { method: "POST", headers: { authorization: `Bearer ${adminToken}` } });
    shareToken = ((await res.json()) as { data: { token: string } }).data.token;
  });
  test.afterAll(async () => {
    await fetch(`${API}/admin/blog/${postId}`, { method: "DELETE", headers: { authorization: `Bearer ${adminToken}` } });
    await fetch(`${API}/admin/blog/${postId}/permanent`, { method: "DELETE", headers: { authorization: `Bearer ${adminToken}` } });
  });

  test("#t= ile taslak görünür; adres temizlenir; yenilemede de görünür (çerez); Referrer-Policy no-referrer", async ({ page }) => {
    const urls = captureRequestUrls(page);
    const res = await page.goto(`/blog/preview/${postId}#t=${encodeURIComponent(shareToken)}`);
    expect(res?.headers()["referrer-policy"]).toBe("no-referrer");
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    expect(page.url()).toMatch(new RegExp(`/blog/preview/${postId}$`));
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    expectNoTokenInUrls(urls, shareToken);
    const cookies = await page.context().cookies();
    const cookie = cookies.find((c) => c.name === `blog_preview_${postId}`);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Strict");
    expect(cookie?.path).toBe(`/blog/preview/${postId}`);
  });

  test("Nginx benzeri ortam: frontend origin'indeki /api/* backend'e gider; önizleme akışı yine çalışır", async ({ page }) => {
    // Canlı Nginx: `location /api/ { proxy_pass http://127.0.0.1:4000; }` — yol aynen backend'e gider; frontend'in
    // kendi /api/* rotalarına dışarıdan erişilemez. Yerel ortamda bu görünmediği için burada taklit edilir.
    const frontendOrigin = new URL(FRONTEND).origin;
    const backendOrigin = new URL(API).origin;
    const forwarded: string[] = [];
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== frontendOrigin) return route.continue();
      forwarded.push(url.pathname);
      const response = await route.fetch({ url: `${backendOrigin}${url.pathname}${url.search}` });
      return route.fulfill({ response });
    });
    await page.context().clearCookies();
    await page.goto("/");
    // Taklit devrede: frontend'in kendi /api/health rotası artık backend'e gider (orada yok → 404).
    expect(await page.evaluate(() => fetch("/api/health").then((r) => r.status))).toBe(404);

    await page.goto(`/blog/preview/${postId}#t=${encodeURIComponent(shareToken)}`);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    expect(page.url()).toMatch(new RegExp(`/blog/preview/${postId}$`));
    expect(forwarded).toEqual(["/api/health"]);
  });

  test("eski ?t= çalışır, adres temizlenir; geçersiz belirteç 404", async ({ page }) => {
    await page.goto(`/blog/preview/${postId}?t=${encodeURIComponent(shareToken)}`);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect.poll(() => page.url()).not.toContain("t=");

    // dil önekli yol: çerez o yola kapsanır
    await page.goto(`/ar/blog/preview/${postId}#t=${encodeURIComponent(shareToken)}`);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    expect(page.url()).toMatch(new RegExp(`/ar/blog/preview/${postId}$`));
    expect((await page.context().cookies()).some((c) => c.path === `/ar/blog/preview/${postId}`)).toBe(true);

    await page.context().clearCookies();
    await page.goto(`/blog/preview/${postId}#t=s_gecersiz-belirtec`);
    await expect(page.getByRole("heading", { level: 1, name: title })).toHaveCount(0);
    await expect(page.getByText(/not found|404/i).first()).toBeVisible();
  });
});

test.describe("yorum daveti", () => {
  let bookingId = "";
  const inserted: string[] = [];

  test.beforeAll(() => {
    const row = dbRows<{ id: string }>(
      `SELECT b.id FROM appointment_bookings b WHERE EXISTS (SELECT 1 FROM appointments a WHERE a."bookingId" = b.id)
       AND NOT EXISTS (SELECT 1 FROM testimonial_invites i WHERE i."bookingId" = b.id)
       AND NOT EXISTS (SELECT 1 FROM testimonials t WHERE t."bookingId" = b.id) AND b."archivedAt" IS NULL LIMIT 1`
    )[0];
    test.skip(!row, "saas_e2e'de davet eklenebilecek randevu yok");
    bookingId = row!.id;
  });
  test.afterAll(() => {
    if (inserted.length) dbRows(`DELETE FROM testimonial_invites WHERE id IN (${inserted.map(q).join(",")}) RETURNING id`);
  });

  function insertInvite(raw: string) {
    const id = crypto.randomUUID();
    dbRows(`DELETE FROM testimonial_invites WHERE "bookingId" = ${q(bookingId)} RETURNING id`);
    dbRows(`INSERT INTO testimonial_invites (id, "bookingId", "tokenHash", "expiresAt") VALUES (${q(id)}, ${q(bookingId)}, ${q(sha256(raw))}, now() + interval '1 day') RETURNING id`);
    inserted.push(id);
  }

  test("/review#<token>: form açılır (lookup POST gövdesiyle), adres ve istek adreslerinde token yok", async ({ page }) => {
    const raw = newToken();
    insertInvite(raw);
    const urls = captureRequestUrls(page);
    const lookup = page.waitForRequest((r) => r.url().endsWith("/reviews/invite/lookup") && r.method() === "POST");
    await page.goto(`/review#${raw}`);
    const req = await lookup;
    expect(JSON.parse(req.postData() ?? "{}")).toEqual({ token: raw });
    expect((await req.response())?.status()).toBe(200);
    await expect(page.locator("form")).toBeVisible();
    expect(page.url()).toMatch(/\/review$/);
    expectNoTokenInUrls(urls, raw);
  });

  test("eski /review/<token> bağlantısı çalışır ve adres /review'a çevrilir", async ({ page }) => {
    const raw = newToken();
    insertInvite(raw);
    await page.goto(`/review/${raw}`);
    await expect(page.locator("form")).toBeVisible();
    await expect.poll(() => page.url()).toMatch(/\/review$/);
  });
});

test.describe("kullanıcı daveti", () => {
  const email = `qa-ap-invite-${RUN}@example.com`;
  const PASSWORD = "ApDavet.2026!";
  let orgId = "";
  const raw = newToken();

  test.beforeAll(async () => {
    await getFixtureUserToken(email, PASSWORD, "AP Davetli");
    const ownerId = dbRows<{ id: string }>(`SELECT id FROM users WHERE email = ${q(ADMIN_EMAIL)}`)[0]!.id;
    orgId = crypto.randomUUID();
    dbRows(`INSERT INTO organizations (id, name, slug, "ownerId", "updatedAt") VALUES (${q(orgId)}, 'QA AP Org', ${q(`qa-ap-org-${RUN}`)}, ${q(ownerId)}, now()) RETURNING id`);
    dbRows(`INSERT INTO invitations (id, "organizationId", email, role, "tokenHash", "expiresAt", "updatedAt") VALUES (${q(crypto.randomUUID())}, ${q(orgId)}, ${q(email)}, 'MEMBER', ${q(sha256(raw))}, now() + interval '1 day', now()) RETURNING id`);
  });
  test.afterAll(() => {
    dbRows(`DELETE FROM organizations WHERE id = ${q(orgId)} RETURNING id`);
  });

  test("oturumsuz açılır → giriş bağlantısında token yok → girişten sonra aynı sekmede kabul edilir", async ({ page }) => {
    const urls = captureRequestUrls(page);
    await page.goto(`/invitations/accept#${raw}`);
    const loginLink = page.getByRole("link", { name: "Giriş yap" });
    await expect(loginLink).toBeVisible();
    expect(await loginLink.getAttribute("href")).toBe(`/login?next=${encodeURIComponent("/invitations/accept")}`);
    expect(page.url()).toMatch(/\/invitations\/accept$/);

    await loginLink.click();
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/invitations\/accept$/);
    const accept = page.waitForRequest((r) => r.url().endsWith("/invitations/accept") && r.method() === "POST");
    await page.getByRole("button", { name: "Daveti kabul et" }).click();
    const req = await accept;
    expect(JSON.parse(req.postData() ?? "{}")).toEqual({ token: raw });
    await expect(page.getByText("Davet kabul edildi")).toBeVisible();
    expectNoTokenInUrls(urls, raw);
  });
});

test.describe("hasta rezervasyonu / fatura / görüşme (sayfa kapıları)", () => {
  let bookingId = "";
  let appointmentId = "";
  let oldHash: string | null = null;
  const raw = newToken();

  test.beforeAll(() => {
    const row = dbRows<{ id: string; hash: string | null; appt: string }>(
      `SELECT b.id, b."accessTokenHash" AS hash, (SELECT a.id FROM appointments a WHERE a."bookingId" = b.id ORDER BY a."startsAt" LIMIT 1) AS appt
       FROM appointment_bookings b WHERE EXISTS (SELECT 1 FROM appointments a WHERE a."bookingId" = b.id AND a."endsAt" > now()) AND b."archivedAt" IS NULL LIMIT 1`
    )[0];
    test.skip(!row, "saas_e2e'de ileri tarihli randevulu rezervasyon yok");
    ({ id: bookingId, hash: oldHash, appt: appointmentId } = row!);
    // Geçici: bilinen token — test sonunda eski özet geri yazılır.
    dbRows(`UPDATE appointment_bookings SET "accessTokenHash" = ${q(sha256(raw))} WHERE id = ${q(bookingId)} RETURNING id`);
  });
  test.afterAll(() => {
    if (bookingId) dbRows(`UPDATE appointment_bookings SET "accessTokenHash" = ${oldHash === null ? "NULL" : q(oldHash)} WHERE id = ${q(bookingId)} RETURNING id`);
  });

  test("rezervasyon #t=: API başlıkla 200, adres temizlenir; fatura aynı sekmede depodan; görüşme #t=", async ({ page }) => {
    const urls = captureRequestUrls(page);
    const bookingReq = page.waitForRequest((r) => new URL(r.url()).pathname.endsWith(`/appointments/bookings/${bookingId}`) && r.method() === "GET");
    await page.goto(`/patient/bookings/${bookingId}#t=${raw}`);
    const req = await bookingReq;
    expect(req.headers()["x-access-token"]).toBe(raw);
    expect((await req.response())?.status()).toBe(200);
    await expect.poll(() => page.url()).toMatch(new RegExp(`/patient/bookings/${bookingId}$`));

    const invoiceReq = page.waitForRequest((r) => new URL(r.url()).pathname.endsWith(`/appointments/bookings/${bookingId}/invoice`));
    await page.goto(`/patient/bookings/${bookingId}/invoice`);
    expect((await invoiceReq).headers()["x-access-token"]).toBe(raw);

    const apptReq = page.waitForRequest((r) => new URL(r.url()).pathname.endsWith(`/appointments/${appointmentId}`) && r.method() === "GET");
    await page.goto(`/consultation/${appointmentId}#t=${raw}`);
    expect((await apptReq).headers()["x-access-token"]).toBe(raw);
    await expect.poll(() => page.url()).toMatch(new RegExp(`/consultation/${appointmentId}$`));
    expectNoTokenInUrls(urls, raw);
  });

  test("eski ?t= rezervasyon bağlantısı çalışır ve adres temizlenir", async ({ page }) => {
    const bookingReq = page.waitForRequest((r) => new URL(r.url()).pathname.endsWith(`/appointments/bookings/${bookingId}`) && r.method() === "GET");
    await page.goto(`/patient/bookings/${bookingId}?t=${raw}`);
    const req = await bookingReq;
    expect(req.headers()["x-access-token"]).toBe(raw);
    expect(new URL(req.url()).search).toBe("");
    await expect.poll(() => page.url()).not.toContain(raw);
  });
});
