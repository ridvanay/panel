import { test, expect, type Page } from "@playwright/test";
import { authenticator } from "otplib";
import { getCachedAdminSession, getSiteModules, patchSiteModule, getFixtureUserToken, setupAndEnableTwoFactorForSelf, setMaintenanceMode } from "./support/api";
import { resetFixtureUserToBaseline, adminGetUserByEmail } from "./support/admin-users-fixtures";
import { ensureTelehealthModuleWithDoctors, createAdminDoctorFixture, deleteAdminDoctorFixture, setDoctorAvailabilityRaw, linkDoctorUserRaw, type CreatedFixtureDoctor } from "./support/telehealth-fixtures";

/**
 * qa-agent — `.claude/architect-scope-doctor-subdomain.md` §7.4, bağlayıcı 14 senaryolu tablo.
 * Gerçek backend (`saas_e2e`, port 4001) + gerçek Next.js dev sunucusu (`playwright.config.ts`
 * `webServer`, port 3100, `NEXT_PUBLIC_DOCTOR_URL=http://doktor.siteadi.localhost:3100` DAHİL) ile
 * çalışır. `*.siteadi.localhost` zinciri tarayıcı (Chromium) tarafından OTOMATİK 127.0.0.1'e
 * çözülür — hosts dosyası GEREKMEZ (§6.1 deney satırı 6).
 *
 * Senaryo 13 (`NEXT_PUBLIC_DOCTOR_URL` TANIMSIZ — geriye dönük uyumluluk) BİLİNÇLİ OLARAK BU
 * DOSYADA DEĞİL, `doctor-subdomain-backward-compat.spec.ts`'te — `NEXT_PUBLIC_DOCTOR_URL` bir
 * dev-sunucu BAŞLANGICINDA inline edilen sabittir, bu dosyanın paylaştığı `webServer`'ı (§6.4
 * matrisi zaten AÇIK yapılandırmayla başlatır) devre dışı bırakamaz; ayrı bir sunucu GEREKİR (bkz.
 * o dosyanın başlık yorumu).
 *
 * Senaryo 14 (mevcut `doctor-console-dashboard-layout.spec.ts`/`doctor-panel-session-lifecycle.spec.ts`
 * regresyonu) bu dosyanın KAPSAMI DIŞINDA — ayrıca, değiştirilmeden çalıştırılır (qa-agent final
 * raporu).
 *
 * Hatırlatma (proje hafıza notu): ürün/blog/portföy 60sn ISR gecikmesi bir bug DEĞİLDİR — bu dosya
 * o tür sayfaların İÇERİĞİNİ değil, yalnızca proxy'nin YÖNLENDİRME/REWRITE DAVRANIŞINI (host/URL/
 * status kodu) doğruladığından bu türden bir "staleness" riski taşımaz.
 */
test.describe.configure({ mode: "serial" });

const SITE_ORIGIN = process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100";
const DOCTOR_ORIGIN = process.env.E2E_DOCTOR_FRONTEND_URL ?? "http://doktor.siteadi.localhost:3100";
const API_BASE_URL = process.env.E2E_API_URL ?? "http://localhost:4001/api/v1";

const FIXTURE_PASSWORD = "QaE2eSubdomainIsolation12345!";
const RUN_SUFFIX = Date.now().toString(36);
const DOCTOR_USER_EMAIL = `qa-e2e-doctor-subdomain-${RUN_SUFFIX}@example.com`;
const DOCTOR_TITLE = "Dr.";
const DOCTOR_FULL_NAME = `QA E2E Doktor Subdomain ${RUN_SUFFIX}`;

let adminToken: string;
let initialTelehealthEnabled: boolean;
let doctorFixture: CreatedFixtureDoctor;
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
    title: DOCTOR_TITLE,
    fullName: DOCTOR_FULL_NAME,
    bio: "qa-agent — hekim portalı subdomain izolasyonu e2e fixture doktoru (§7.4).",
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

  const doctorUserToken = await getFixtureUserToken(DOCTOR_USER_EMAIL, FIXTURE_PASSWORD, "QA E2E Doktor Subdomain");
  const doctorUser = await adminGetUserByEmail(adminToken, DOCTOR_USER_EMAIL);
  if (!doctorUser) throw new Error("qa-agent: doktor fixture kullanıcısı oluşturulamadı.");
  await linkDoctorUserRaw(adminToken, doctorFixture.id, doctorUser.id);
  // §5.4/§9.7.7 KAPI — 2FA kapalıyken `/doctor/me` `403 TWO_FACTOR_REQUIRED` döner (backend-agent,
  // `telehealth.portal.routes.ts`); doktor portalına erişebilmek için ÖNCE 2FA açılmalı.
  const twoFactor = await setupAndEnableTwoFactorForSelf(doctorUserToken);
  doctorTotpSecret = twoFactor.secret;
});

test.afterAll(async () => {
  await cleanupFixtures();
  if (doctorFixture) await deleteAdminDoctorFixture(adminToken, doctorFixture.id).catch(() => undefined);
  await patchSiteModule(adminToken, "telehealth", initialTelehealthEnabled).catch(() => undefined);
});

async function fetchLocales(): Promise<{ code: string; enabled: boolean }[]> {
  const res = await fetch(`${API_BASE_URL}/locales`);
  const body = (await res.json()) as { data: { code: string; enabled: boolean }[] };
  return body.data ?? [];
}

// =============================================================================
// Grup B — doktor host oturum yaşam döngüsü (senaryo 1, 2, 4, 5, 6, 10, 11, 12)
// =============================================================================

let doctorPage: Page;

test.afterAll(async () => {
  await doctorPage?.close();
});

test("senaryo 4: doktor host'ta /login hekim giriş ekranını gösterir, URL /login olarak kalır", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  doctorPage = await context.newPage();

  const response = await doctorPage.goto(`${DOCTOR_ORIGIN}/login`);
  expect(response?.status()).toBe(200);
  expect(new URL(doctorPage.url()).pathname).toBe("/login");
  await expect(doctorPage.getByRole("heading", { name: "Hekim Girişi" })).toBeVisible();
  // §4 KARARI — hekimler kendi kendine kayıt olmaz: "Kayıt olun" bağlantısı BURADA YOK
  // (`(auth)/login`'in AKSİNE — `AuthPageShell`'in `footer` prop'u bu sayfada hiç verilmiyor).
  await expect(doctorPage.getByRole("link", { name: "Kayıt olun" })).toHaveCount(0);
});

test("senaryo 1+2+10+12: doktor host'ta giriş sonrası — SiteHeader/Footer YOK, minimal bar VAR, X-Robots-Tag noindex, tek /doctor/me + tek /doctor/portal-feed", async () => {
  await doctorPage.getByLabel("E-posta").fill(DOCTOR_USER_EMAIL);
  await doctorPage.getByLabel("Şifre").fill(FIXTURE_PASSWORD);
  await doctorPage.getByRole("button", { name: "Giriş yap" }).click();

  await expect(doctorPage.getByText("Kimlik doğrulama uygulamanızdaki 6 haneli kodu", { exact: false })).toBeVisible({ timeout: 15_000 });
  const code = authenticator.generate(doctorTotpSecret);
  await doctorPage.getByLabel("Doğrulama Kodu").fill(code);
  await doctorPage.getByRole("button", { name: "Doğrula" }).click();

  // Giriş hedefi (`resolvePostLoginPath`) `/doctor`'dır — LoginForm zaten doktor host'unda olduğumuzu
  // (`isDoctorHostname`) tespit eder, cross-origin `window.location.assign` TETİKLENMEZ (§5.6),
  // sıradan bir istemci içi navigasyon (`router.replace`) yeterlidir.
  await doctorPage.waitForURL(/\/doctor$/, { timeout: 15_000 });
  // qa-agent bulgusu (bu tur, test-timing): giriş sonrası istemci-içi yönlendirmenin (`router.replace`)
  // KENDİ `/doctor/me`+`/doctor/portal-feed` fetch'leri henüz TAMAMLANMADAN aşağıdaki dinleyici
  // eklenirse, o ilk sayfa yüklemesinin GEÇ tamamlanan istekleri de yakalanıp SAYIMI BOZUYORDU
  // (gerçek bir çift-istek hatası DEĞİL — iki AYRI sayfa yüklemesinin isteklerinin karışmasıydı).
  // Düzeltme: sayaç, `networkidle` ile bu İLK yüklemenin tamamen durulmasını bekledikten SONRA
  // takılır; ölçülen TEK yükleme aşağıdaki AÇIK "/" navigasyonudur (senaryo 12'nin gerçek amacı).
  await doctorPage.waitForLoadState("networkidle");

  // Ağ izleme (senaryo 12) — portal ana sayfasının TAM sayfa yüklemesi (root "/") başına
  // `GET /doctor/me` VE `GET /doctor/portal-feed` TAM OLARAK birer kez atılmalı (§5.4 invariant 1/4).
  const doctorMeRequests: string[] = [];
  const portalFeedRequests: string[] = [];
  const onRequest = (req: import("@playwright/test").Request) => {
    if (req.method() !== "GET") return;
    const url = req.url();
    if (url.includes("/doctor/me")) doctorMeRequests.push(url);
    if (url.includes("/doctor/portal-feed")) portalFeedRequests.push(url);
  };
  doctorPage.on("request", onRequest);

  // Senaryo 1 — doktor host kökü ("/") 200 döner, `/doctor` içeriğine REWRITE edilir, ziyaretçinin
  // gördüğü URL "/" olarak KALIR (redirect DEĞİL).
  const rootResponse = await doctorPage.goto(`${DOCTOR_ORIGIN}/`, { waitUntil: "networkidle" });
  doctorPage.off("request", onRequest);

  expect(rootResponse?.status()).toBe(200);
  expect(new URL(doctorPage.url()).origin).toBe(new URL(DOCTOR_ORIGIN).origin);
  expect(new URL(doctorPage.url()).pathname).toBe("/");
  await expect(doctorPage.getByRole("heading", { name: "Doktor Konsolu" })).toBeVisible({ timeout: 15_000 });

  // Senaryo 10 — doktor host'undan dönen HER yanıta `X-Robots-Tag: noindex, nofollow` eklenir.
  expect(rootResponse?.headers()["x-robots-tag"]).toBe("noindex, nofollow");

  // Senaryo 12.
  expect(doctorMeRequests, `/doctor/me tam olarak 1 kez beklenirdi: ${JSON.stringify(doctorMeRequests)}`).toHaveLength(1);
  // qa-agent bulgusu (BUG — frontend-agent'a yönlendirildi, qa-agent BURADA DÜZELTMEZ, bkz. final
  // rapor): `GET /doctor/portal-feed` (ve KARDEŞ istekler `GET /doctor/overview` + `GET /doctor/bookings`,
  // hepsi `DoctorBookingsPanel`/`DoctorPortalFeedCard`'ın İÇİNDE) her `/doctor` sayfa yüklemesinde
  // TUTARLI şekilde 2 KEZ atılıyor — `GET /doctor/me` (bir üst katmanda, `DoctorPortalProvider`'da)
  // İSE AYNI yüklemede KESİN 1 kez atılıyor. Bu asimetri React StrictMode'un TÜM effect'leri eşit
  // ikiye katlaması teorisiyle ÇELİŞİYOR (StrictMode doğru olsaydı `/doctor/me` de 2 olurdu) — kök
  // neden muhtemelen `DoctorPortalShell`'in `/doctor`'a self-referential `<Link>`ları (nav şeridi +
  // `DoctorTopBar` logosu, HER İKİSİ DE görünür alanda) İÇİN Next.js App Router'ın otomatik
  // prefetch'inin `DoctorBookingsPanel` alt ağacını bir kez daha (gizli/önbellek segmenti olarak)
  // mount edip GERÇEK bir ikinci ağ isteği tetiklemesi — ama KESİN teşhis frontend-agent'ındır.
  // §5.4 invariant 4'ü ("İkinci `GET /doctor/portal-feed` YASAK") İHLAL EDİYOR — bilinçli olarak
  // BEKLENEN `toHaveLength(1)` DEĞERİNDE BIRAKILDI (test doğru şekilde KIRIK KALMALI, kırmızıyı
  // yeşile boyayıp bug'ı gizlemek qa-agent'ın görevi DEĞİL).
  expect(portalFeedRequests, `/doctor/portal-feed tam olarak 1 kez beklenirdi: ${JSON.stringify(portalFeedRequests)}`).toHaveLength(1);

  // Senaryo 2 — `(doctor)` ağacında `SiteHeader`/`SiteFooter` HİÇ YOK; minimal bar (logo, hekim
  // adı+unvanı, bildirim, çıkış) VAR.
  await expect(doctorPage.locator('nav[aria-label="Site gezinme"]')).toHaveCount(0);
  await expect(doctorPage.locator("footer")).toHaveCount(0);
  await expect(doctorPage.getByLabel(/Hekim Portalı/)).toBeVisible();
  await expect(doctorPage.getByText(`${DOCTOR_TITLE} ${DOCTOR_FULL_NAME}`)).toBeVisible();
  await expect(doctorPage.getByLabel("Portal Akışı ve Duyurular")).toBeVisible();
  await expect(doctorPage.getByRole("button", { name: "Çıkış yap" })).toBeVisible();
});

test("senaryo 5 [KRİTİK]: doktor host'ta sayfa YENİLENİNCE oturum AÇIK kalır (refresh cookie §6 deneyi)", async () => {
  await doctorPage.reload({ waitUntil: "networkidle" });

  // Bellek-içi access token bir tam sayfa yenilemesinde HER ZAMAN kaybolur — oturumun GERÇEKTEN
  // hayatta kaldığının tek kanıtı, `/auth/refresh` çerezinin taşınıp kimliğin YENİDEN kurulmasıdır.
  expect(new URL(doctorPage.url()).pathname, "reload sonrası /login'e düşülMEMELİ").not.toBe("/login");
  await expect(doctorPage.getByText(`${DOCTOR_TITLE} ${DOCTOR_FULL_NAME}`)).toBeVisible({ timeout: 15_000 });
  await expect(doctorPage.getByRole("heading", { name: "Doktor Konsolu" })).toBeVisible({ timeout: 15_000 });
});

test("senaryo 11: doktor host'u TEK DİLLİDİR — /tr/doctor, prefix'siz /doctor'a 307 ile döner", async () => {
  await doctorPage.goto(`${DOCTOR_ORIGIN}/tr/doctor`);
  expect(new URL(doctorPage.url()).origin).toBe(new URL(DOCTOR_ORIGIN).origin);
  expect(new URL(doctorPage.url()).pathname).toBe("/doctor");
});

test("senaryo 6: ana host'ta /doctor (subdomain modu açık) doktor host'una 307 ile devredilir, oturum KORUNUR", async () => {
  const response = await doctorPage.goto(`${SITE_ORIGIN}/doctor`);
  expect(new URL(doctorPage.url()).origin).toBe(new URL(DOCTOR_ORIGIN).origin);
  expect(new URL(doctorPage.url()).pathname).toBe("/doctor");
  expect(response?.status()).toBe(200);
  // Oturum korunmuş olmalı — hekim kimliği GÖRÜNÜR, `/login`'e düşülMEMİŞ (refresh cookie'nin
  // `siteadi.localhost` (ana host) ÜZERİNDEN başlayan bu navigasyonda da AYNI kayıt edilebilir
  // alan adı altında taşındığının kanıtı, §6.2/§6.3).
  await expect(doctorPage.getByText(`${DOCTOR_TITLE} ${DOCTOR_FULL_NAME}`)).toBeVisible({ timeout: 15_000 });
});

// =============================================================================
// Grup C — doktor host'undan ana host'a devir, ana host regresyonları, bakım modu (senaryo 3, 7, 8, 9)
// =============================================================================

test("senaryo 3: doktor host'ta hasta/e-ticaret/kurumsal sayfalar ana host'a 307 ile devredilir, query korunur", async ({ page }) => {
  for (const path of ["/urunler", "/hakkimizda", "/blog"]) {
    await page.goto(`${DOCTOR_ORIGIN}${path}?ref=qa-e2e-doctor-subdomain`);
    const url = new URL(page.url());
    expect(url.origin, `${path} ana host'a devredilmeli`).toBe(new URL(SITE_ORIGIN).origin);
    expect(url.pathname, `${path} yolu KORUNMALI`).toBe(path);
    expect(url.searchParams.get("ref"), `${path} query KORUNMALI`).toBe("qa-e2e-doctor-subdomain");
  }
});

test("security-agent §7.6 (CWE-601): doktor host'ta `//evil.example` (protokol-göreli path, [9] catch-all) DIŞ DOMAİNE YÖNLENDİRMEZ", async ({ page }) => {
  // `page.goto` KULLANILMAZ — tarayıcı navigasyonu `//evil.example`'ı KENDİSİ protokol-göreli bir
  // referans olarak çözüp isteği hiç `doktor.*` host'una GÖNDERMEYEBİLİR (yanlış negatif riski).
  // Ham bir HTTP isteğiyle (`APIRequestContext`, redirect'i TAKİP ETMEDEN) sunucunun ürettiği
  // `Location` header'ını doğrudan doğruluyoruz — asıl saldırı yüzeyi zaten sunucu tarafıdır (proxy).
  const response = await page.request.get(`${DOCTOR_ORIGIN}//evil.example`, { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  const location = response.headers()["location"];
  expect(location, "Location header eksik olmamalı").toBeTruthy();
  const target = new URL(location!, DOCTOR_ORIGIN);
  // KRİTİK doğrulama: hedef GÜVENİLEN ana site origin'idir, `evil.example` DEĞİL.
  expect(target.hostname).not.toBe("evil.example");
  expect(target.origin).toBe(new URL(SITE_ORIGIN).origin);
});

test("senaryo 7: ana host'ta locale davranışı REGRESYON YOK (/, /tr, /en)", async ({ page }) => {
  const home = await page.goto("/");
  expect(home?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
  expect(new URL(page.url()).pathname).toBe("/");

  await page.goto("/tr");
  expect(new URL(page.url()).pathname, "/tr prefix'i 301 ile prefix'siz kanonik URL'e düşmeli").toBe("/");

  const locales = await fetchLocales();
  if (locales.some((l) => l.code === "en" && l.enabled)) {
    const en = await page.goto("/en");
    expect(en?.status()).toBe(200);
  }
});

test("senaryo 8: ana host'ta /login, /register, /forgot-password, /reset-password REGRESYON YOK (matcher genişledi)", async ({ page }) => {
  for (const path of ["/login", "/register", "/forgot-password", "/reset-password"]) {
    const response = await page.goto(path);
    expect(response?.status(), `${path} 200 dönmeli`).toBe(200);
    expect(new URL(page.url()).pathname, `${path} locale prefix'i ALMAMALI`).toBe(path);
  }
});

test.describe.serial("senaryo 9: bakım modu doktor host'unu KAPSAMAZ", () => {
  let token: string;

  test.beforeAll(async () => {
    token = (await getCachedAdminSession()).accessToken;
  });

  test.afterEach(async () => {
    await setMaintenanceMode(token, false);
  });

  test("bakım modu AÇIK: ana host 503, doktor host /doctor 200", async ({ page }) => {
    await setMaintenanceMode(token, true, "QA E2E doctor-subdomain-isolation bakım mesajı.");

    const mainResponse = await page.goto("/");
    expect(mainResponse?.status()).toBe(503);

    const doctorResponse = await page.goto(`${DOCTOR_ORIGIN}/doctor`);
    expect(doctorResponse?.status()).toBe(200);
  });
});
