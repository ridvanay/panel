import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * qa-agent (2026-09-17) — `PUBLIC_URL` fail-closed boot koruması. Kök neden: `config/env.ts`
 * eskiden `PUBLIC_URL`'e `.default("http://localhost:4000")` veriyordu — production'da bu
 * değişken unutulunca SESSİZCE bu varsayılana düşülüyor, `mappers/index.ts::absolutizeMediaUrl`
 * (Medya Kütüphanesi/ürün görselleri/doktor avatarları HEPSİ bu TEK fonksiyondan geçer) gerçek
 * kullanıcıların tarayıcısına `http://localhost:4000/uploads/...` (kendi makineleri) döndürüyor,
 * ERR_CONNECTION_REFUSED/404 ile sonuçlanıyordu. Düzeltme `ENABLE_DEMO_PAYMENTS` İLE AYNI iki
 * katmanlı ilke: (1) varsayılan KALDIRILDI — eksikse Zod parse ANINDA hata (`DATABASE_URL` İLE
 * AYNI desen), (2) production'da AÇIKÇA `localhost`/`127.0.0.1`'e ayarlanmışsa AYRICA (savunma
 * derinliği — biri yine de yanlışlıkla böyle ayarlayabilir) `process.exit(1)`.
 *
 * `config/env.ts` modül yükleme anında `process.exit(1)` çağırabildiğinden (ÇAĞIRAN process'i de
 * öldürür) `env-demo-payments-boot-guard.test.ts` İLE AYNI desen: ayrı bir alt process'te
 * (`tests/fixtures/import-env-only.ts`, `npx tsx` ile) çalıştırılır.
 */

const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/import-env-only.ts");
const TSX_CLI = path.resolve(__dirname, "../../node_modules/tsx/dist/cli.mjs");

function runEnvFixture(overrides: Record<string, string | undefined>) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return spawnSync(process.execPath, [TSX_CLI, FIXTURE_PATH], { cwd: path.resolve(__dirname, "../.."), env, encoding: "utf8" });
}

describe("config/env.ts — PUBLIC_URL fail-closed boot koruması", () => {
  it("PUBLIC_URL geçersiz (boş string) → boot BAŞARISIZ olur (process.exit(1), varsayılan YOK — DATABASE_URL İLE AYNI ilke)", () => {
    // NOT: `PUBLIC_URL: undefined` (anahtarı env'den SİLME) test EDİLMEZ — `config/env.ts`
    // `import "dotenv/config"` ile ÇOCUK process'in KENDİ cwd'sindeki `.env` dosyasını (gerçek
    // bir değer taşıyan) okur ve boşluğu doldurur, bu yüzden "tanımsız" senaryosunu spawn edilen
    // process seviyesinde GÜVENİLİR biçimde simüle etmenin yolu şemayı GEÇERSİZ bir değerle
    // (boş string, `.url()` reddeder) zorlamaktır — sonuç (Zod hatası → exit 1) AYNI.
    const result = runEnvFixture({ PUBLIC_URL: "" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("PUBLIC_URL");
  });

  it("NODE_ENV=production + PUBLIC_URL=http://localhost:4000 → boot BAŞARISIZ olur (gürültülü hata, gerçek kullanıcı tarayıcısına localhost sızmaz)", () => {
    const result = runEnvFixture({ NODE_ENV: "production", PUBLIC_URL: "http://localhost:4000" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("PUBLIC_URL");
    expect(result.stderr).toContain("localhost");
  });

  it("NODE_ENV=production + PUBLIC_URL=http://127.0.0.1:4000 → boot BAŞARISIZ olur (localhost İLE AYNI risk, ayrıca kontrol edilir)", () => {
    const result = runEnvFixture({ NODE_ENV: "production", PUBLIC_URL: "http://127.0.0.1:4000" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("PUBLIC_URL");
  });

  it("NODE_ENV=production + PUBLIC_URL=https://api.example.com (gerçek domain) → boot BAŞARILI", () => {
    // `FRONTEND_URL` bilinçli olarak gerçek bir domain'e override edilir — bu test PUBLIC_URL'i
    // doğrular, `.env.test`'in FRONTEND_URL değerine (yerel test sabiti, localhost olabilir) bağımlı
    // OLMAMALIDIR (bkz. `env-frontend-url-boot-guard.test.ts` — FRONTEND_URL'in KENDİ
    // production/localhost koruması AYRI test edilir).
    const result = runEnvFixture({
      NODE_ENV: "production",
      PUBLIC_URL: "https://api.example.com",
      FRONTEND_URL: "https://wmhealthistanbul.com",
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({ ok: true, publicUrl: "https://api.example.com" });
  });

  it("NODE_ENV=development + PUBLIC_URL=http://localhost:4000 → boot BAŞARILI (localhost guard'ı SADECE production'da)", () => {
    const result = runEnvFixture({ NODE_ENV: "development", PUBLIC_URL: "http://localhost:4000" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({ ok: true, publicUrl: "http://localhost:4000" });
  });
});
