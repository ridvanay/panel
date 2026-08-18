import { test, expect, type Page } from "@playwright/test";
import { API_BASE_URL, getCachedAdminSession } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";
import {
  adminGetUserByEmail,
  registerFixtureUser,
  resetFixtureUserToBaseline,
  type FixtureAdminUser,
} from "./support/admin-users-fixtures";

/**
 * qa-agent — kullanıcının admin kullanıcı yönetimi bug raporunda AÇIKÇA istediği 3 regresyon
 * senaryosunun (a/b/c) gerçek tarayıcı + gerçek backend + gerçek Postgres (saas_e2e) üzerinden
 * doğrulanması. Bu dosya backend'in `tests/integration/admin-users.test.ts` +
 * `admin-users-soft-delete.test.ts` (Fastify `app.inject`, HTTP katmanı/tarayıcı YOK) ve
 * frontend'in `tests/unit/a11y-admin-users.test.tsx` (component testi, `usersAdminApi` MOCK'lı,
 * gerçek backend YOK) ile kapsanmayan tek katmanı kapatır: gerçek buton tıklaması → gerçek
 * `fetch` → gerçek route handler → gerçek DB satırı → tabloya yansıma zinciri.
 *
 * (a) tek admin varken kendini silmeye/rol düşürmeye çalış → engellenmeli
 * (b) 2+ admin varken birini sil/düzenle → başarılı olmalı
 * (c) admin olmayan bir kullanıcıyı sil/düzenle → başarılı olmalı
 *
 * NOT (sıra ÖNEMLİ): (a) testi dosyadaki DİĞER testlerden ÖNCE çalışmalıdır — sistemde
 * qa-e2e-admin'den BAŞKA aktif admin OLMAMASI gerekir (aksi halde "son admin" kuralı yerine
 * yanlışlıkla "en az bir admin daha var" dalına düşer). `beforeAll` bunu, önceki başarısız bir
 * koşumdan kalmış olası fixture admin'lerini temizleyerek garanti eder.
 *
 * NOT (auth): bu dosya `support/admin-session.ts`'teki desenle kendi context/login'ini kurar
 * (bkz. o dosyanın başlığı — refresh-token rotasyonu nedeniyle paylaşılan bir storageState
 * GÜVENİLİR DEĞİL).
 */
// NOT — `retries` BİLİNÇLİ OLARAK ayarlanmıyor (diğer bazı spec dosyalarının aksine, ör.
// `admin-blog-tags.spec.ts`). qa-agent bulgusu: bu dosyanın `beforeAll`'ı `createAuthenticatedPage`
// ile GERÇEK bir UI login'i yapıyor; `auth.setup.ts` de (bu dosyadan HEMEN önce, aynı "setup"
// projesinde) hem `ensureAdminSession()` (doğrudan `fetch`) hem GERÇEK bir UI login'i yapıyor —
// yani bu dosya çalışmaya başlamadan önce `/auth/login` kotasının (`AUTH_RATE_LIMIT`, 5/dk, bkz.
// `auth.routes.ts`) bir kısmı ZATEN tüketilmiş oluyor. `beforeAll` bir nedenden (yavaş/soğuk
// `next dev` derlemesi, geçici ağ gecikmesi) BAŞARISIZ olursa, retry bu dosyanın TÜM testlerini
// tekrar dener ve HER retry `beforeAll`'ı (dolayısıyla login'i) YENİDEN tetikler — bu, kotayı
// DÜZELTMEK yerine hızla TÜKETEN kendi kendini besleyen bir sarmal oluşturuyor (qa-agent'ın yerel
// koşumunda gözlemlendi: `beforeAll` bir kez 429/timeout aldığında retry'lar durumu
// İYİLEŞTİRMEK yerine KÖTÜLEŞTİRDİ). CI'da (temiz, tek seferlik koşum) bu risk çok daha düşüktür
// ama önlem burada YİNE DE ALINMIYOR — kök neden ortam/kota etkileşimi (uygulama kodu DEĞİL),
// bu yüzden gerçek bir başarısızlık sessizce gizlenmesin diye retry EKLENMEDİ.

const EDITOR_EMAIL = "qa-e2e-users-editor-target@example.com";
const ADMIN_CANDIDATE_EMAIL = "qa-e2e-users-admin-candidate@example.com";
const FIXTURE_PASSWORD = "QaE2eFixture12345!";

let page: Page;
let closeSession: () => Promise<void>;
let adminToken: string;
let adminSelfId: string;
let adminSelfEmail: string;

async function cleanupFixtures() {
  // İdempotent zemin — önceki başarısız/tamamlanmış bir koşumdan kalmış olabilir. VIEWER/ACTIVE
  // temel durumuna SIFIRLAR (SİLMEZ) — bkz. `resetFixtureUserToBaseline()` başlığı: bir e-posta
  // BİR KEZ silinince `POST /auth/register`'a bir daha kabul edilmiyor, bu yüzden "sil ve
  // unut" yerine "geri yükle + sıfırla" gerekiyor.
  await resetFixtureUserToBaseline(adminToken, ADMIN_CANDIDATE_EMAIL);
  await resetFixtureUserToBaseline(adminToken, EDITOR_EMAIL);
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(60_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  adminSelfId = session.userId;
  adminSelfEmail = session.email;
  await cleanupFixtures();
  ({ page, close: closeSession } = await createAuthenticatedPage(browser));
});

test.afterAll(async () => {
  await cleanupFixtures();
  if (closeSession) await closeSession();
});

async function rowFor(target: Page, email: string) {
  await target.getByLabel("İsim veya e-posta ara").fill(email);
  const row = target.getByRole("row", { name: new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
  await expect(row).toBeVisible();
  return row;
}

test("senaryo (a): sistemin tek aktif admini kendi hesabını silemez, rolünü düşüremez, askıya alamaz", async () => {
  // Ön koşul doğrulaması — bu noktada sistemde qa-e2e-admin'den başka aktif ADMIN OLMAMALI
  // (bkz. dosya başlığındaki sıra notu).
  await page.goto("/admin/users");
  const selfRow = await rowFor(page, adminSelfEmail);

  // UI, backend'in `assertNotLastActiveAdmin` + self-check kurallarını ÖNCEDEN öngörüp bu üç
  // aksiyonu devre dışı bırakır (bkz. `app/admin/users/page.tsx` `isLastActiveAdmin`/`isSelf`) —
  // bu qa-e2e'nin bu koşumdaki GERÇEK admin sayısına göre HESAPLANDIĞINI doğrular (a11y unit
  // testi `tests/unit/a11y-admin-users.test.tsx` bunu MOCK veriyle yapar, burada gerçek backend
  // state'i kullanılıyor).
  await expect(selfRow.getByRole("button", { name: "Kendi hesabınızı silemezsiniz." })).toBeDisabled();
  await expect(selfRow.getByRole("combobox", { name: /rolü/ })).toBeDisabled();
  await expect(selfRow.getByRole("button", { name: "Sistemde en az bir yönetici kalmalı." })).toBeDisabled();

  // İstemci tarafı devre dışı bırakma tek savunma HATTI değil — backend'e doğrudan (UI'yi
  // atlayarak) istek atıp defense-in-depth'i doğruluyoruz (bkz. `admin-locale-management.spec.ts`
  // AYNI desen).
  const authHeader = { Authorization: `Bearer ${adminToken}` };

  const selfDelete = await page.request.delete(`${API_BASE_URL}/admin/users/${adminSelfId}`, { headers: authHeader });
  expect(selfDelete.status()).toBe(409);

  const selfRoleChange = await page.request.patch(`${API_BASE_URL}/admin/users/${adminSelfId}/role`, {
    headers: authHeader,
    data: { role: "EDITOR" },
  });
  expect(selfRoleChange.status()).toBe(409);

  const selfSuspend = await page.request.patch(`${API_BASE_URL}/admin/users/${adminSelfId}/status`, {
    headers: authHeader,
    data: { status: "SUSPENDED" },
  });
  expect(selfSuspend.status()).toBe(409);
});

test("senaryo (c): admin olmayan bir kullanıcının rolü ve durumu panelden başarıyla değiştirilebilir", async () => {
  await registerFixtureUser(EDITOR_EMAIL, FIXTURE_PASSWORD, "QA E2E Editor Target");

  await page.goto("/admin/users");
  let row = await rowFor(page, EDITOR_EMAIL);
  await expect(row.getByRole("combobox", { name: /rolü/ })).toHaveValue("VIEWER");
  await expect(row.getByText("aktif", { exact: true })).toBeVisible();

  // Rol değişikliği — gerçek Select + onay diyaloğu.
  await row.getByRole("combobox", { name: /rolü/ }).selectOption("EDITOR");
  const roleDialog = page.getByRole("dialog", { name: "Rolü değiştir" });
  await expect(roleDialog).toBeVisible();
  await roleDialog.getByRole("button", { name: "Rolü Değiştir" }).click();
  await expect(page.getByText("Rol güncellendi.")).toBeVisible();

  row = await rowFor(page, EDITOR_EMAIL);
  await expect(row.getByRole("combobox", { name: /rolü/ })).toHaveValue("EDITOR");

  // Durum değişikliği (askıya al) — gerçek buton + onay diyaloğu.
  await row.getByRole("button", { name: "Askıya Al" }).click();
  const statusDialog = page.getByRole("dialog", { name: "Kullanıcıyı askıya al" });
  await expect(statusDialog).toBeVisible();
  await statusDialog.getByRole("button", { name: "Askıya Al" }).click();
  await expect(page.getByText("Kullanıcı askıya alındı.")).toBeVisible();

  row = await rowFor(page, EDITOR_EMAIL);
  await expect(row.getByText("askıda", { exact: true })).toBeVisible();

  // Durumu geri al (aktifleştir) — aynı uç, ters yön; ikisinin de admin-olmayan hedefte
  // başarılı olduğunu doğrular.
  await row.getByRole("button", { name: "Aktifleştir" }).click();
  const reactivateDialog = page.getByRole("dialog", { name: "Kullanıcıyı aktifleştir" });
  await reactivateDialog.getByRole("button", { name: "Aktifleştir" }).click();
  await expect(page.getByText("Kullanıcı aktifleştirildi.")).toBeVisible();

  row = await rowFor(page, EDITOR_EMAIL);
  await expect(row.getByText("aktif", { exact: true })).toBeVisible();
});

test("senaryo (c) devamı: admin olmayan bir kullanıcı panelden silinip geri yüklenebilir", async () => {
  await page.goto("/admin/users");
  const row = await rowFor(page, EDITOR_EMAIL);

  await row.getByRole("button", { name: "Sil" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Kullanıcıyı sil" });
  await deleteDialog.getByRole("button", { name: "Kullanıcıyı Sil" }).click();
  await expect(page.getByText(/silindi\. Gerekirse/)).toBeVisible();

  // Varsayılan listede artık görünmüyor.
  await page.getByLabel("İsim veya e-posta ara").fill(EDITOR_EMAIL);
  await expect(page.getByText(EDITOR_EMAIL)).not.toBeVisible();

  // "Silinen kullanıcıları göster" ile tekrar görünür ve geri yüklenebilir.
  await page.getByRole("switch", { name: "Silinen kullanıcıları göster" }).click();
  const deletedRow = await rowFor(page, EDITOR_EMAIL);
  await expect(deletedRow.getByText("silindi", { exact: true })).toBeVisible();

  await deletedRow.getByRole("button", { name: "Geri Yükle" }).click();
  const restoreDialog = page.getByRole("dialog", { name: "Kullanıcıyı geri yükle" });
  await restoreDialog.getByRole("button", { name: "Geri Yükle" }).click();
  await expect(page.getByText(/geri yüklendi\./)).toBeVisible();

  const restoredRow = await rowFor(page, EDITOR_EMAIL);
  await expect(restoredRow.getByText("aktif", { exact: true })).toBeVisible();
});

test("senaryo (b): 2+ admin varken biri diğerinin rolünü/durumunu değiştirebilir ve silebilir (başarılı)", async () => {
  await registerFixtureUser(ADMIN_CANDIDATE_EMAIL, FIXTURE_PASSWORD, "QA E2E Admin Candidate");

  await page.goto("/admin/users");
  let row = await rowFor(page, ADMIN_CANDIDATE_EMAIL);

  // Önce VIEWER'dan ADMIN'e yükseltiyoruz (bu ADIM, senaryo (c)'nin rol-değişikliği başarı
  // yolunu BİR KEZ DAHA, farklı bir hedef rolle sınıyor VE bu testin geri kalanı için "2 aktif
  // admin" ön koşulunu kurar).
  await row.getByRole("combobox", { name: /rolü/ }).selectOption("ADMIN");
  await page.getByRole("dialog", { name: "Rolü değiştir" }).getByRole("button", { name: "Rolü Değiştir" }).click();
  await expect(page.getByText("Rol güncellendi.")).toBeVisible();

  row = await rowFor(page, ADMIN_CANDIDATE_EMAIL);
  await expect(row.getByRole("combobox", { name: /rolü/ })).toHaveValue("ADMIN");
  await expect(row.getByText("aktif", { exact: true })).toBeVisible();

  const candidate = (await adminGetUserByEmail(adminToken, ADMIN_CANDIDATE_EMAIL)) as FixtureAdminUser;
  expect(candidate.role).toBe("ADMIN");
  expect(candidate.status).toBe("ACTIVE");

  // (b) diğer admin'i normal şekilde askıya alabilme — artık 2 aktif admin var, "son admin"
  // kuralı adminCandidate için TETİKLENMEMELİ.
  await row.getByRole("button", { name: "Askıya Al" }).click();
  await page.getByRole("dialog", { name: "Kullanıcıyı askıya al" }).getByRole("button", { name: "Askıya Al" }).click();
  await expect(page.getByText("Kullanıcı askıya alındı.")).toBeVisible();
  row = await rowFor(page, ADMIN_CANDIDATE_EMAIL);
  await expect(row.getByText("askıda", { exact: true })).toBeVisible();

  // Tekrar aktifleştir (2. aktif admin durumuna dönsün) — bir sonraki adım için gerekli.
  await row.getByRole("button", { name: "Aktifleştir" }).click();
  await page.getByRole("dialog", { name: "Kullanıcıyı aktifleştir" }).getByRole("button", { name: "Aktifleştir" }).click();
  await expect(page.getByText("Kullanıcı aktifleştirildi.")).toBeVisible();

  // REGRESYON DÜZELTMESİ (önceden burada "buton tıklanabilir kalıyor" bulgusu belgeleniyordu,
  // frontend-agent'a yönlendirilmişti — artık frontend-agent tarafından düzeltildi): backend
  // `PATCH /status`'te "kendi hesabını askıya alma" kontrolü admin SAYISINDAN BAĞIMSIZ, koşulsuz
  // bir kontroldür (`admin-users.routes.ts` satır ~204-206, `assertNotLastActiveAdmin`
  // ÇAĞRILMADAN ÖNCE). `app/admin/users/page.tsx`'teki istemci-taraflı devre dışı bırakma artık
  // durum butonu için de `isSelf`'e bakıyor (bkz. `statusDisabled = isSelf || isLastActiveAdmin`
  // — silme butonundaki `deleteDisabled` ile AYNI desen) — bu yüzden 2+ aktif admin varken bile
  // kendi satırındaki "Askıya Al" butonu artık DEVRE DIŞI kalır.
  await page.goto("/admin/users");
  const selfRow = await rowFor(page, adminSelfEmail);
  await expect(
    selfRow.getByRole("button", { name: "Kendi hesabınızın durumunu değiştiremezsiniz." })
  ).toBeDisabled();

  // İstemci tarafı devre dışı bırakma tek savunma HATTI değil — backend'e doğrudan (UI'yi
  // atlayarak) istek atıp defense-in-depth'i doğruluyoruz (senaryo (a) testindeki DOĞRUDAN API
  // doğrulamasıyla aynı desen).
  const selfSuspendAttempt = await page.request.patch(`${API_BASE_URL}/admin/users/${adminSelfId}/status`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { status: "SUSPENDED" },
  });
  expect(selfSuspendAttempt.status()).toBe(409);

  await expect
    .poll(async () => {
      const fresh = await adminGetUserByEmail(adminToken, adminSelfEmail);
      return fresh?.status;
    })
    .toBe("ACTIVE");

  // Hesabımız hâlâ aktif olduğundan oturum düşmedi — sayfa hâlâ erişilebilir olmalı.
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: "Kullanıcılar" })).toBeVisible();

  // (b) diğer admin'i normal şekilde silebilme.
  row = await rowFor(page, ADMIN_CANDIDATE_EMAIL);
  await row.getByRole("button", { name: "Sil" }).click();
  await page.getByRole("dialog", { name: "Kullanıcıyı sil" }).getByRole("button", { name: "Kullanıcıyı Sil" }).click();
  await expect(page.getByText(/silindi\. Gerekirse/)).toBeVisible();

  await page.getByLabel("İsim veya e-posta ara").fill(ADMIN_CANDIDATE_EMAIL);
  await expect(page.getByText(ADMIN_CANDIDATE_EMAIL)).not.toBeVisible();
});
