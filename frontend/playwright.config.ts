import { defineConfig, devices } from "@playwright/test";

/**
 * qa-agent — E2E/entegrasyon test altyapısı (`.claude/architect-scope-i18n.md` §9 qa-agent
 * görev listesi). Gerçek bir tarayıcıyla, gerçek backend + Postgres'e karşı çalışır — vitest
 * birim testlerinin (frontend `tests/unit`, backend `tests/integration` — `app.inject`) ÜSTÜNE
 * eklenen uçtan uca katman.
 *
 * Yerel çalıştırma:
 *   1) Ayrı bir Postgres veritabanı gerekir (`saas_e2e` — backend/tests global-setup.ts'teki
 *      `saas_test` deseninin AYNISI, farklı isim, testlerle ÇAKIŞMASIN diye):
 *        docker exec <postgres-container> psql -U postgres -c "CREATE DATABASE saas_e2e;"
 *        cd backend && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/saas_e2e?schema=public npx prisma migrate deploy
 *   2) `backend/.env.e2e` (bu depoda örnek olarak eklendi — gerçek sırlar İÇERMEZ, yalnızca
 *      yerel/CI test sabitleri) ile backend'i ayrı portta (4001) başlat:
 *        cd backend && DOTENV_CONFIG_PATH=.env.e2e npx tsx src/server.ts
 *   3) `webServer` aşağıda frontend'i otomatik başlatır (3100), backend'i BAŞLATMAZ — CI'da
 *      devops-agent backend'i de bir `webServer`/servis adımı olarak eklemelidir (bkz.
 *      TEST_COVERAGE.md "CI entegrasyonu" notu).
 *   4) `npx playwright test`
 *
 * Bu dosya CI'a devops-agent tarafından entegre edilmelidir (`.github/workflows/ci.yml`) —
 * qa-agent kendi ci.yml'i DEĞİŞTİRMEZ (bkz. proje kökü CLAUDE.md ajan sınırları).
 */
/**
 * `.env.local`'daki `REVALIDATE_SECRET` (dev sabiti, `dev-revalidate-secret-change-me`)
 * `backend/.env.e2e`'deki değerle (`e2e-revalidate-secret`) EŞLEŞMEZ — Next.js `next dev`'in
 * kendisi `.env.local`'i otomatik yükler, bu yüzden aşağıdaki `webServer.command`'a env değişkeni
 * olarak ENJEKTE EDİLMEDİĞİ sürece e2e backend'inin `triggerGlobalRevalidation()` çağrısı (bkz.
 * `backend/src/lib/revalidate.ts`) frontend'in `POST /api/revalidate`'inden HER ZAMAN 401 alır
 * (sessizce `warn` loglanır, admin isteği bozulmaz — ama anlık yansıma da GERÇEKLEŞMEZ). qa-agent
 * bulgusu — bu turda düzeltildi: `E2E_REVALIDATE_SECRET` (varsayılan `backend/.env.e2e` ile
 * BİREBİR aynı) process env olarak geçirilir; process env `.env.local` dosya değerinin ÖNÜNE
 * geçer (Next.js önceliği).
 */
const E2E_REVALIDATE_SECRET = process.env.E2E_REVALIDATE_SECRET ?? "e2e-revalidate-secret";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // paylaşılan saas_e2e veritabanı — testler arası veri çakışmasını önlemek için sıralı
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_FRONTEND_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },
    {
      // NOT: `storageState` KASITLI OLARAK burada global set EDİLMEZ — backend'in tek kullanımlık
      // refresh-token rotasyonu (bkz. `tests/e2e/support/fixtures.ts` başlığı) her sayfa
      // yüklemesinde statik bir storageState dosyasını "reuse" olarak algılayıp TÜM oturumu
      // iptal eder. Admin (giriş gerektiren) testleri `support/fixtures.ts`'teki paylaşımlı,
      // worker-başına-BİR-KEZ context fixture'ını kullanır; public site testleri hiç auth
      // istemez, varsayılan `page` fixture'ıyla (çerezsiz) çalışır.
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
  webServer: process.env.E2E_SKIP_WEBSERVER
    ? undefined
    : {
        command:
          `npx cross-env NEXT_PUBLIC_API_URL=http://localhost:4001/api/v1 NEXT_PUBLIC_SITE_URL=http://localhost:3100 REVALIDATE_SECRET=${E2E_REVALIDATE_SECRET} next dev -p 3100`,
        url: "http://localhost:3100",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
