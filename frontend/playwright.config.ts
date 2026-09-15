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
 *
 * **`.claude/architect-scope-doctor-subdomain.md` §6.4/§7.4 — host şeması `siteadi.localhost`'a
 * taşındı.** `baseURL` ve `webServer.command`'ın env'leri o dokümanın "E2E (`playwright.config.ts`)"
 * sütunu BİREBİR uygulanır:
 *   - `NEXT_PUBLIC_SITE_URL`/`baseURL`  → `http://siteadi.localhost:3100`
 *   - `NEXT_PUBLIC_DOCTOR_URL` (YENİ)   → `http://doktor.siteadi.localhost:3100`
 *   - `NEXT_PUBLIC_API_URL`             → `http://siteadi.localhost:4001/api/v1`
 *   - `INTERNAL_API_URL` (bare-metal'de ZORUNLU, §6.1/§6.4 — Node.js `*.localhost`'u ÇÖZEMEZ,
 *     yalnızca tarayıcı çözer) → `http://localhost:4001/api/v1`
 *   - `NEXT_PUBLIC_INTERNAL_MEDIA_URL` (next/image optimize edicinin sunucu-taraflı fetch'i,
 *     AYNI Node çözümleme kısıtı) → `http://localhost:4001`
 * `*.siteadi.localhost` zinciri tarayıcı (Chromium) tarafından OTOMATİK 127.0.0.1'e çözülür —
 * hosts dosyası/yönetici hakkı GEREKMEZ (§6.1 deney satırı 6, `next.config.ts::allowedDevOrigins`
 * ile birlikte doğrulandı).
 *
 * **Geriye dönük uyumluluk senaryosu (§7.4 madde 13 — `NEXT_PUBLIC_DOCTOR_URL` tanımsız):**
 * `NEXT_PUBLIC_DOCTOR_URL` bir build/dev-server BAŞLANGICINDA inline edilen sabittir; bu
 * webServer'ı ETKİLEMEDEN ayrı bir sunucu gerektirir. Bu yüzden AYRI bir dosyada
 * (`tests/e2e/doctor-subdomain-backward-compat.spec.ts`) ele alınır — o dosyanın başlığındaki
 * manuel çalıştırma talimatına bakın (`doctor-panel-session-lifecycle.spec.ts`'in `E2E_SKIP_WEBSERVER`
 * deseniyle AYNI felsefe).
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
    baseURL: process.env.E2E_FRONTEND_URL ?? "http://siteadi.localhost:3100",
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
      // qa-agent bulgusu (2026-09-15, gerçek yerel LiveKit turu) — `telehealth-consultation-
      // livekit-live.spec.ts` BİLEREK burada ÇALIŞTIRILMAZ (`chrome-livekit-media` projesine
      // devredilir, bkz. aşağıdaki proje tanımı ve o dosyanın başlığı).
      testIgnore: /telehealth-consultation-livekit-live\.spec\.ts/,
    },
    {
      // qa-agent — `.claude/architect-scope-telehealth-template.md` §4.4 gerçek yerel LiveKit
      // doğrulama turu (2026-09-15). GERÇEK kamera/mikrofon track'i publish eden testler İÇİN
      // (`telehealth-consultation-livekit-live.spec.ts`) — Playwright'ın VARSAYILAN bundled
      // Chromium'u bu Windows makinesinde `--use-fake-device-for-media-stream`'i DESTEKLEMİYOR:
      // headless → `getUserMedia` `NotSupportedError` (elle doğrulandı, `LiveKitRoom`in bağlantı
      // durumu SONSUZA KADAR "Bağlanıyor…"da TAKILI KALIYOR — websocket bağlantısı GERÇEKTEN
      // kuruluyor ama yerel track publish hatası `ConnectionState.Connected`'e geçişi ENGELLİYOR);
      // headed bundled Chromium → audio fake device çalışıyor AMA video → `NotFoundError`.
      // Sistemde kurulu GERÇEK Google Chrome (`channel: "chrome"`, headed) İKİSİNİ DE destekliyor.
      // `permissions: ["camera","microphone"]` (context izni) `--use-fake-ui-for-media-permissions`
      // bayrağıyla BİRLİKTE gerekir — TEK BAŞINA hiçbiri yeterli değildir (elle doğrulandı).
      name: "chrome-livekit-media",
      testMatch: /telehealth-consultation-livekit-live\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        headless: false,
        permissions: ["camera", "microphone"],
        launchOptions: {
          args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-permissions"],
        },
      },
      dependencies: ["setup"],
    },
  ],
  webServer: process.env.E2E_SKIP_WEBSERVER
    ? undefined
    : {
        command:
          `npx cross-env ` +
          `NEXT_PUBLIC_API_URL=http://siteadi.localhost:4001/api/v1 ` +
          `NEXT_PUBLIC_SITE_URL=http://siteadi.localhost:3100 ` +
          `NEXT_PUBLIC_DOCTOR_URL=http://doktor.siteadi.localhost:3100 ` +
          `INTERNAL_API_URL=http://localhost:4001/api/v1 ` +
          `NEXT_PUBLIC_INTERNAL_MEDIA_URL=http://localhost:4001 ` +
          `REVALIDATE_SECRET=${E2E_REVALIDATE_SECRET} next dev -p 3100`,
        // qa-agent bulgusu (bu tur, KRİTİK): Playwright'ın `webServer.url` hazır-mı kontrolü test
        // RUNNER'ININ KENDİ Node.js sürecinde çalışır — `.claude/architect-scope-doctor-subdomain.md`
        // §6.1'in belgelediği AYNI kısıt (Node'un OS çözümleyicisi `*.localhost` ZİNCİRİNİ ÇÖZEMEZ,
        // yalnızca tarayıcı çözer) burada da geçerli: `url: "http://siteadi.localhost:3100"` DENENDİ,
        // Node `fetch failed`/`ENOTFOUND` ile SESSİZCE hiç bağlanamadı ve `webServer` 60sn sonra
        // "Timed out waiting ... from config.webServer" ile PATLADI (sunucunun kendisi `curl` ile
        // doğrulandığı gibi GERÇEKTEN 776ms'de hazırdı — sorun sunucuda DEĞİL, probun host adını
        // çözememesindeydi). Düzeltme: hazır-mı probu Node'un ÇÖZEBİLDİĞİ `localhost`'a yapılır —
        // AYNI süreç (`next dev -p 3100`), yalnızca `Host` header'ına göre dallanan `proxy.ts` §3.1
        // [0] açısından `localhost:3100` ile `siteadi.localhost:3100` FARK ETMEZ (ikisi de "ana
        // host" dalına düşer, isDoctorHostname() ikisinde de false) — yalnızca HAZIR-MI kontrolü
        // içindir, gerçek testler (tarayıcı içinde çalışır, `*.localhost`'u SORUNSUZ çözer, §6.1
        // deney satırı 6) `baseURL`/mutlak URL'ler üzerinden doğru host'ları KULLANMAYA DEVAM EDER.
        url: "http://localhost:3100",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
