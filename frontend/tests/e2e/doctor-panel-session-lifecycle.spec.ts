import path from "node:path";
import crypto from "node:crypto";
import { tmpdir } from "node:os";
import { writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { authenticator } from "otplib";
import { test, expect, type Browser, type Page } from "@playwright/test";

/**
 * qa-agent — bu turun görev talimatı (orkestratörün doğrudan isteği, koddaki `git status`
 * özetinde görülen "Seansı Tamamla" + "Kazançlarım" tadilatı için). Bu dosya, projenin geri
 * kalan e2e suite'inden (`saas_e2e` + backend `localhost:4001` + frontend `localhost:3100`,
 * bkz. `playwright.config.ts` dosya başlığı) BİLİNÇLİ OLARAK FARKLI bir ortama karşı çalışır:
 * koordinatörün talimatı GEREĞİ zaten ayakta olan geliştirme Docker Compose yığınına
 * (backend `localhost:4000`, frontend `localhost:3000`, Postgres `saas_dev`, host'a `5432` ile
 * expose edilir) ve orada ÖNCEDEN VAR OLAN, gerçek bir UAT doktor hesabına/rezervasyonuna karşı
 * çalışır (bkz. aşağıdaki sabitler — `.claude/` UAT notlarıyla AYNI hesap/booking).
 *
 * ÇALIŞTIRMA (bu dosya TEK BAŞINA, diğer `telehealth-*`/admin suite'inin AYRI `saas_e2e` ortamını
 * gerektirmeyecek şekilde):
 *   cd frontend
 *   E2E_FRONTEND_URL=http://localhost:3000 E2E_SKIP_WEBSERVER=1 npx playwright test \
 *     tests/e2e/doctor-panel-session-lifecycle.spec.ts --project=chromium --no-deps
 *
 * `E2E_SKIP_WEBSERVER` — `playwright.config.ts`'in varsayılan `webServer`'ı (yeni bir `next dev`
 * süreci, port 3100, `NEXT_PUBLIC_API_URL=localhost:4001`'e sabitlenmiş) BU DOSYA İÇİN YANLIŞ
 * hedefi işaret eder; zaten Docker'da ayakta olan `localhost:3000`'e karşı çalışılır.
 * `--no-deps` — `auth.setup.ts` (`saas_e2e`'ye karşı bir ADMIN fixture login'i) bu dosyanın
 * İHTİYACI DEĞİLDİR; atlanmazsa ayakta olmayan `localhost:4001`'e istek atıp suite'i baştan
 * düşürür (bu dosya kendi doktor login'ini KENDİSİ, GERÇEK 2FA ile yapar, `storageState` paylaşımı
 * hiç kullanılmaz — dosyanın geri kalan `support/*` yardımcılarından bağımsız olmasının nedeni budur).
 *
 * DB doğrulamaları `support/telehealth-fixtures.ts::shiftAppointmentIntoJoinWindowDirectly`/
 * `getAppointmentDocumentStoragePathDirectly` İLE AYNI "gerçek backend'in KENDİ
 * `@prisma/client`'ını doğrudan `require()` eden geçici, bağımsız bir CommonJS betiği" deseniyle,
 * ama GERÇEK `backend/` dizinine (e2e-özel DEĞİL) ve `saas_dev` veritabanına karşı yapılır —
 * `backend/src` veya `backend/scripts` İÇİNE HİÇBİR ŞEY YAZILMAZ (betik `os.tmpdir()`'a yazılıp
 * işlem sonunda silinir, ajan sınır ihlali OLMASIN diye, bkz. proje kökü CLAUDE.md).
 *
 * Kapsam (bkz. final qa-agent raporu, `TEST_COVERAGE.md`):
 *   1) Doktor 2FA login akışı — GERÇEK TOTP kodu (`otplib`, backend'in KENDİ `lib/totp.ts`
 *      sarmalayıcısı İLE AYNI kütüphane) ile `/doctor` portalına erişim.
 *   2) `BKG-MTYFI44Y-78B2` — "Tıbbi Belgeler (1)" rozeti + hasta notu göstergesi (StickyNote ikonu)
 *      doktor randevu listesinde görünür.
 *   3) Belge/not modalı — hasta notu "Görüntüle" ile açığa çıkar; görsel belge önizlemesi
 *      (`uat_test_document.png`, `<img>` `object-contain`) ağ hatası/kırık görsel OLMADAN render olur.
 *   4) "Seansı Tamamla" — epikriz notu girilip gönderilince `AppointmentStatusBadge` "Tamamlandı"ya
 *      döner; DB'de `status='COMPLETED'` VE `consultationNoteCiphertext` DOLU (şifreli değer
 *      OKUNMAZ/ÇÖZÜLMEZ, yalnızca NOT NULL doğrulanır — KVKK disiplinine uygun).
 *   5) `/doctor/earnings` — brüt/komisyon(`PLATFORM_COMMISSION_RATE_PERCENT`, docker-compose
 *      backend'inde override edilmediği için varsayılan %15)/net tutar + tamamlanan seans satırı.
 */
test.describe.configure({ mode: "serial" });

const DOCTOR_EMAIL = "uat.doctor.elif@example.com";
const DOCTOR_PASSWORD = "UatDoctor!2026";
const DOCTOR_TOTP_SECRET = "JBSWY3DPEHPK3PXP";

const TARGET_BOOKING_NUMBER = "BKG-MTYFI44Y-78B2";
const TARGET_PATIENT_NAME = "Rıdvan Ay";
/**
 * `BKG-MTYFI44Y-78B2`'nin İKİ randevusu (2 slot). `booking-list-view.tsx::BookingActions`
 * yalnızca `booking.appointments[0]`'ın durumuna bakar — ama Prisma'nın `include: { appointments:
 * true }` ilişki sırası `startsAt`'e göre GARANTİLİ DEĞİLDİR (qa-agent bulgusu, bu turda: yalnızca
 * ilk slotu `IN_PROGRESS`e çekmek "Seansı Tamamla" butonunun GÖRÜNMEMESİNE yol açtı — API'nin
 * `appointments[0]`'ı fiilen İKİNCİ slotu döndürüyordu). Düzeltme: HER İKİ randevu da
 * `IN_PROGRESS`e çekilir (hangisi `appointments[0]` olursa olsun buton görünür); "Seansı Tamamla"
 * yalnızca BİRİNİ (API'nin ilk döndürdüğünü) `COMPLETED`e taşıyacağından doğrulama adımı İKİSİNİ
 * DE okuyup TAM OLARAK BİRİNİN tamamlandığını doğrular (bkz. adım 4 testi).
 */
const TARGET_APPOINTMENT_IDS = ["90762fea-4ff8-4cf7-bfcd-b3ce31a1303a", "aae5d4ed-8f77-4461-aab5-b40389c92305"];
const TARGET_DOCUMENT_FILENAME = "uat_test_document.png";
const EXPECTED_SESSION_PRICE_CENTS = 45000; // ₺450,00 — DB'den bu turda doğrulandı (bkz. final rapor).

const CONSULTATION_NOTE = `QA e2e — otomatik epikriz notu (${new Date().toISOString()}). Hasta stabil, kontrol önerildi.`;

// ---------------------------------------------------------------------------
// DB yardımcıları — `saas_dev`'e (host'a expose edilmiş Postgres, `docker-compose.yml`) karşı,
// backend'in KENDİ `@prisma/client`'ı ile. `prisma db execute` SELECT sonucu DÖNDÜRMEZ (yalnızca
// DDL/DML) — bu yüzden OKUMA için ayrı bir geçici CommonJS betiği kullanılır (bkz. dosya başlığı).
// ---------------------------------------------------------------------------
const DEV_DATABASE_URL = process.env.DEV_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/saas_dev?schema=public";
const BACKEND_DIR = path.resolve(process.cwd(), "..", "backend");
const PRISMA_CLIENT_ABS_PATH = path.join(BACKEND_DIR, "node_modules", "@prisma", "client");

function runSqlDirectly(sql: string): void {
  execFileSync("npx", ["prisma", "db", "execute", "--stdin", `--url=${DEV_DATABASE_URL}`], {
    cwd: BACKEND_DIR,
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
}

function runReadOnlyPrismaScript<T>(body: string, args: string[]): T {
  const scriptPath = path.join(tmpdir(), `qa-e2e-doctor-panel-read-${crypto.randomUUID()}.cjs`);
  const script = `
const { PrismaClient } = require(${JSON.stringify(PRISMA_CLIENT_ABS_PATH)});
const prisma = new PrismaClient({ datasources: { db: { url: ${JSON.stringify(DEV_DATABASE_URL)} } } });
(async () => {
  ${body}
  await prisma.$disconnect();
})().catch(async (err) => { await prisma.$disconnect(); process.stderr.write(String(err && err.stack || err)); process.exit(1); });
`;
  writeFileSync(scriptPath, script, "utf-8");
  try {
    const stdout = execFileSync("node", [scriptPath, ...args], { encoding: "utf-8" });
    return JSON.parse(stdout) as T;
  } finally {
    unlinkSync(scriptPath);
  }
}

interface AppointmentDbRow {
  status: string;
  hasConsultationNote: boolean;
}

function readAppointmentDirectly(appointmentId: string): AppointmentDbRow {
  return runReadOnlyPrismaScript<AppointmentDbRow>(
    `
    const row = await prisma.appointment.findUniqueOrThrow({
      where: { id: process.argv[2] },
      select: { status: true, consultationNoteCiphertext: true },
    });
    process.stdout.write(JSON.stringify({ status: row.status, hasConsultationNote: row.consultationNoteCiphertext !== null }));
    `,
    [appointmentId]
  );
}

/** §13.4.1 (`booking-list-view.tsx::isSessionCompletable`) — "Seansı Tamamla" `SCHEDULED`'ta
 * YALNIZCA katılım penceresi KAPANDIYSA görünür. Hedef randevu bu turda GELECEKTE (2026-09-14,
 * "bugün" 2026-09-12) olduğundan pencere henüz AÇILMADI bile — görev talimatının öngördüğü gibi
 * DB'de doğrudan `IN_PROGRESS`e çekilir (`shiftAppointmentIntoJoinWindowDirectly` İLE AYNI "gerçek
 * randevu, yalnızca durumu/zamanlaması test edilebilir kılınır" felsefesi).
 *
 * KOŞULSUZ SIFIRLAR (durum ne olursa olsun, `COMPLETED` DAHİL): bu test dosyası TEKRAR
 * ÇALIŞTIRILABİLİR olmalı (CI'da/manuel yeniden koşumda) — önceki bir koşumdan `COMPLETED` +
 * dolu `consultationNoteCiphertext` kalmışsa "Seansı Tamamla" butonu hiç GÖRÜNMEZ ve adım 4
 * baştan başarısız olur (ilk elden gözlemlenen bir fixture kırılganlığı). Bu yüzden HER koşum
 * öncesi her iki hedef randevu da temiz bir `IN_PROGRESS` + `consultationNoteCiphertext = NULL`
 * durumuna döndürülür.
 */
function resetAppointmentToInProgress(appointmentId: string): void {
  const esc = (value: string) => value.replace(/'/g, "''");
  runSqlDirectly(
    `UPDATE "appointments" SET "status" = 'IN_PROGRESS', "endedAt" = NULL, "consultationNoteCiphertext" = NULL, "consultationNoteUpdatedAt" = NULL WHERE id = '${esc(appointmentId)}';`
  );
}

function ensureAppointmentsAreCompletable(appointmentIds: string[]): void {
  for (const id of appointmentIds) resetAppointmentToInProgress(id);
}

/**
 * Backend'in `GET /doctor/earnings` mantığının (`telehealth.portal.routes.ts`) BİREBİR aynı
 * hesaplaması — satır bazında yuvarla, SONRA topla. Sabit `%15` bu dosyanın geri kalanındaki AYNI
 * varsayım (`PLATFORM_COMMISSION_RATE_PERCENT` docker-compose backend'inde override EDİLMEZ).
 * Test, sayfada GÖRÜNEN toplamı bu bağımsız hesaplamayla karşılaştırır — DOĞRU DEĞER bir sabit
 * yerine "o an DB'de gerçekten ne varsa" olduğundan, bu turun DIŞINDA (paylaşılan dev DB'de) başka
 * `COMPLETED` randevu birikmiş olsa bile test KIRILMAZ.
 */
function readDoctorCompletedTotalsDirectly(doctorId: string): { grossCents: number; commissionCents: number; netCents: number; count: number } {
  return runReadOnlyPrismaScript(
    `
    const rows = await prisma.appointment.findMany({
      where: { doctorId: process.argv[2], status: "COMPLETED" },
      select: { priceCents: true },
    });
    let grossCents = 0, commissionCents = 0, netCents = 0;
    for (const row of rows) {
      const rowCommission = Math.round((row.priceCents * 15) / 100);
      grossCents += row.priceCents;
      commissionCents += rowCommission;
      netCents += row.priceCents - rowCommission;
    }
    process.stdout.write(JSON.stringify({ grossCents, commissionCents, netCents, count: rows.length }));
    `,
    [doctorId]
  );
}

const DOCTOR_PROFILE_ID = "d7ceb8f4-b19e-4492-8a3c-524652fac98e"; // elif-aydemir, doctor_profiles.id (bkz. önceki UAT turu).

// ---------------------------------------------------------------------------
// 2FA login yardımcısı — `(auth)/login/page.tsx`'in GERÇEK iki adımlı akışı (`requiresTwoFactor`
// → "Doğrulama Kodu" ekranı). `otplib`'in `authenticator.generate()`'i backend'in KENDİ
// `lib/totp.ts::verifyTotp` sarmalayıcısının (`authenticator.verify`) BEKLEDİĞİ AYNI RFC 6238
// TOTP algoritmasını (30sn adım, ±1 pencere toleransı) üretir.
// ---------------------------------------------------------------------------
async function loginDoctorWithTwoFactor(browser: Browser, email: string, password: string, totpSecret: string): Promise<Page> {
  const page = await browser.newPage();
  await page.goto("/doctor");
  await page.waitForURL(/\/login\?next=/, { timeout: 15_000 });

  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill(password);
  await page.getByRole("button", { name: "Giriş yap" }).click();

  await expect(page.getByText("Kimlik doğrulama uygulamanızdaki 6 haneli kodu", { exact: false })).toBeVisible({ timeout: 15_000 });
  const code = authenticator.generate(totpSecret);
  await page.getByLabel("Doğrulama Kodu").fill(code);
  await page.getByRole("button", { name: "Doğrula" }).click();

  await page.waitForURL(/\/doctor$/, { timeout: 15_000 });
  return page;
}

let doctorPage: Page;

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(60_000);
  ensureAppointmentsAreCompletable(TARGET_APPOINTMENT_IDS);
  doctorPage = await loginDoctorWithTwoFactor(browser, DOCTOR_EMAIL, DOCTOR_PASSWORD, DOCTOR_TOTP_SECRET);
});

test.afterAll(async () => {
  await doctorPage?.close();
});

test("adım 1-2: 2FA login ile /doctor portalına erişim, booking listesinde 'Tıbbi Belgeler (1)' rozeti ve hasta notu göstergesi görünür", async () => {
  await expect(doctorPage.getByRole("heading", { name: "Randevularım" })).toBeVisible({ timeout: 15_000 });

  const row = doctorPage.locator("tr", { hasText: TARGET_PATIENT_NAME });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await expect(row.getByText("Tıbbi Belgeler (1)", { exact: true })).toBeVisible();
  // StickyNote göstergesi — `Tooltip` tetikleyicisi bir ikon `<span>`'dır, erişilebilir isim
  // TAŞIMAZ; `booking-documents-dialog.tsx`'teki AYNI ikonu DEĞİL, satırın kendi göstergesini
  // (`BookingDocumentsIndicator`, `bg-primary/10 text-primary` dairesi) DOM'da VARLIĞIYLA doğrular.
  await expect(row.locator("span.rounded-full.bg-primary\\/10")).toBeVisible();

  // Diğer booking (`BKG-MTYFXVWQ-A3C0`, belge/not YOK) — KONTRAST: rozet HİÇ görünmez.
  const otherRow = doctorPage.locator("tr", { hasText: "Ridvan Ay Test2" });
  if (await otherRow.count()) {
    await expect(otherRow.getByText(/Tıbbi Belgeler/)).toHaveCount(0);
  }
});

test("adım 3: belge/not modalı — hasta notu 'Görüntüle' ile açığa çıkar, görsel belge önizlemesi hatasız render olur", async () => {
  const row = doctorPage.locator("tr", { hasText: TARGET_PATIENT_NAME });
  await row.getByRole("button", { name: /Tıbbi Belgeler/ }).click();

  const dialog = doctorPage.getByRole("dialog", { name: "Tıbbi Belgeler" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  // Hasta notu — varsayılan GİZLİ, "Görüntüle" tıklanana kadar İÇERİK ÇEKİLMEZ (§13.3).
  await expect(dialog.getByText("Hasta Notu", { exact: true })).toBeVisible();
  const revealButton = dialog.getByRole("button", { name: "Görüntüle" });
  await expect(revealButton).toBeVisible();
  await revealButton.click();
  await expect(revealButton).toHaveCount(0, { timeout: 15_000 });
  const noteParagraph = dialog.locator("p.whitespace-pre-line");
  await expect(noteParagraph).toBeVisible();
  const noteText = (await noteParagraph.textContent())?.trim();
  expect(noteText, "hasta notu boş göründü — beklenen bir metin yoktu").toBeTruthy();

  // Belge önizlemesi — GERÇEK ağ isteği (`GET /appointments/documents/{id}/content`) 200 dönüyor
  // VE görsel `<img>` (next/image DEĞİL, blob: URL) hatasız yükleniyor (kırık resim/network hatası
  // YOK — `naturalWidth > 0` gerçek bir bitmap'in decode edildiğinin kanıtıdır).
  await expect(dialog.getByText(TARGET_DOCUMENT_FILENAME)).toBeVisible({ timeout: 15_000 });
  const img = dialog.locator(`img[alt="${TARGET_DOCUMENT_FILENAME}"]`);
  await expect(img).toBeVisible({ timeout: 15_000 });
  const naturalWidth = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth);
  expect(naturalWidth, "belge önizlemesi kırık görünüyor (naturalWidth 0)").toBeGreaterThan(0);
  await expect(dialog.getByText("Sunucuya ulaşılamadı", { exact: false })).toHaveCount(0);

  await doctorPage.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });
});

test("adım 4: 'Seansı Tamamla' — epikriz notu girilir, rozet 'Tamamlandı'ya döner, DB'de status=COMPLETED ve not şifreli olarak dolu", async () => {
  const row = doctorPage.locator("tr", { hasText: TARGET_PATIENT_NAME });
  await row.getByRole("button", { name: "Seansı Tamamla" }).click();

  const dialog = doctorPage.getByRole("dialog", { name: "Seansı Tamamla" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  await dialog.getByLabel(/Epikriz \/ Konsültasyon Notu/).fill(CONSULTATION_NOTE);
  await dialog.getByRole("button", { name: "Seansı Tamamla" }).click();

  await expect(dialog).not.toBeVisible({ timeout: 20_000 });
  await expect(row.locator("span", { hasText: "Tamamlandı" })).toBeVisible({ timeout: 20_000 });
  // "Seansı Tamamla" butonu artık YOK (§13.4.1 — yalnızca IN_PROGRESS/pencere-kapandı SCHEDULED'ta gösterilir).
  await expect(row.getByRole("button", { name: "Seansı Tamamla" })).toHaveCount(0);

  await expect(async () => {
    const rows = TARGET_APPOINTMENT_IDS.map((id) => ({ id, ...readAppointmentDirectly(id) }));
    const completed = rows.filter((r) => r.status === "COMPLETED");
    const stillInProgress = rows.filter((r) => r.status === "IN_PROGRESS");
    expect(completed, `tam olarak 1 randevu COMPLETED bekleniyordu: ${JSON.stringify(rows)}`).toHaveLength(1);
    expect(stillInProgress, `diğer slotun DOKUNULMAMIŞ (IN_PROGRESS) kalması bekleniyordu: ${JSON.stringify(rows)}`).toHaveLength(1);
    expect(completed[0]!.hasConsultationNote, "consultationNoteCiphertext NULL kaldı — not yazılmamış").toBe(true);
  }).toPass({ timeout: 15_000, intervals: [500, 1_000, 2_000] });
});

test("adım 5: /doctor/earnings — brüt/komisyon(%15)/net tutar ve tamamlanan seans satırı doğru görünür", async () => {
  await doctorPage.getByRole("link", { name: "Kazançlarım" }).click();
  await doctorPage.waitForURL(/\/doctor\/earnings$/, { timeout: 15_000 });
  await expect(doctorPage.getByRole("heading", { name: "Kazançlarım" })).toBeVisible({ timeout: 15_000 });

  // Beklenen toplam, TEK seansın sabit fiyatı DEĞİL — o an DB'de doktora ait TÜM `COMPLETED`
  // randevuların gerçek toplamıdır (bkz. `readDoctorCompletedTotalsDirectly` başlık yorumu).
  const totals = readDoctorCompletedTotalsDirectly(DOCTOR_PROFILE_ID);
  expect(totals.count, "en az bu turda tamamlanan 1 seans bekleniyordu").toBeGreaterThanOrEqual(1);

  const fmt = (cents: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(cents / 100);
  const grossFmt = fmt(totals.grossCents);
  const commissionFmt = fmt(totals.commissionCents);
  const netFmt = fmt(totals.netCents);

  // Bu turda TAM OLARAK BEKLENEN tek-seans matematiği (₺450 seans ücreti, %15) — dev DB'de
  // BAŞKA `COMPLETED` randevu birikmemişse doğrulanır; birikmişse yalnızca bu ikinci kontrol
  // atlanır (`totals.count === 1` koşulu), ana doğrulama (yukarıdaki dinamik toplam) HER
  // KOŞULDA geçerlidir.
  if (totals.count === 1) {
    expect(totals.grossCents).toBe(EXPECTED_SESSION_PRICE_CENTS);
    expect(grossFmt).toBe("₺450,00");
    expect(commissionFmt).toBe("₺67,50");
    expect(netFmt).toBe("₺382,50");
  }

  await expect(doctorPage.getByText("Platform Komisyonu (%15)", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(doctorPage.getByText(grossFmt, { exact: true }).first()).toBeVisible();
  await expect(doctorPage.getByText(commissionFmt, { exact: true }).first()).toBeVisible();
  await expect(doctorPage.getByText(netFmt, { exact: true }).first()).toBeVisible();

  // Tamamlanan seanslar tablosunda bu turda tamamladığımız randevunun satırı görünür olmalı —
  // TOPLAM satır sayısı DEĞİL, hasta adıyla eşleşen İLK satırın (bu turun kendi seansı, ₺450/
  // ₺67,50/₺382,50 tek-seans tutarları — birden fazla `COMPLETED` seans birikse bile HER satır
  // AYNI tek-seans fiyatını taşır, çünkü `sessionPriceCents` bu doktor için sabittir).
  const sessionRow = doctorPage.locator("tr", { hasText: TARGET_PATIENT_NAME }).first();
  await expect(sessionRow).toBeVisible({ timeout: 15_000 });
  await expect(sessionRow.getByText("₺450,00", { exact: true })).toBeVisible();
  await expect(sessionRow.getByText("₺67,50", { exact: true })).toBeVisible();
  await expect(sessionRow.getByText("₺382,50", { exact: true })).toBeVisible();
});
