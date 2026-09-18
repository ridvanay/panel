import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * backend-agent (2026-09-17) — `FRONTEND_URL` fail-closed boot koruması, `PUBLIC_URL` İLE BİREBİR
 * AYNI desen (bkz. `env-public-url-boot-guard.test.ts`). `FRONTEND_URL` CORS `origin` allow-list'ini
 * (plugins/security.ts) VE kullanıcıya giden e-posta linklerinin (şifre sıfırlama, hoş geldin,
 * randevu onayı vb. — `${env.FRONTEND_URL}/reset-password?token=...` gibi) taban adresini besler.
 * `.default("http://localhost:3000")` dev/test akışı için KORUNDU (kaldırılmadı) — bu test yalnızca
 * production'da bu varsayılanın (veya açıkça yazılmış aynı değerin) fark edilmeden geçmesini
 * engelleyen guard'ı doğrular.
 *
 * `config/env.ts` modül yükleme anında `process.exit(1)` çağırabildiğinden (ÇAĞIRAN process'i de
 * öldürür) `env-public-url-boot-guard.test.ts` İLE AYNI desen: ayrı bir alt process'te
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

describe("config/env.ts — FRONTEND_URL fail-closed boot koruması", () => {
  // NOT: `FRONTEND_URL: undefined` (anahtarı env'den SİLME) test EDİLMEZ — `env-public-url-boot-guard.test.ts`
  // İLE AYNI neden: `config/env.ts` `import "dotenv/config"` ile ÇOCUK process'in KENDİ cwd'sindeki
  // `.env` dosyasını okur ve boşluğu doldurur; bu repodaki `.env`'in FRONTEND_URL'i (`http://siteadi.localhost:3000`,
  // dev subdomain kurulumu için) hostname'i tam olarak "localhost" DEĞİL ("siteadi.localhost"), bu yüzden
  // "tanımsız" senaryosunu spawn edilen process seviyesinde GÜVENİLİR biçimde simüle etmek MÜMKÜN DEĞİL —
  // guard'ın varsayılanı DA yakaladığı aşağıdaki AÇIKÇA `http://localhost:3000` testiyle zaten doğrulanır
  // (varsayılanın kendisi zaten `http://localhost:3000`, birebir aynı değer).
  // NOT: repodaki `.env`'in `PUBLIC_URL`'i de `http://siteadi.localhost:4000` (dev subdomain
  // kurulumu) — `config/env.ts`'in PUBLIC_URL guard'ı ARTIK (bu tur itibarıyla, bkz.
  // `env-public-url-boot-guard.test.ts`) `*.localhost`'u DA yakaladığından, bu dosya SADECE
  // FRONTEND_URL'i test edebilmek için PUBLIC_URL'i her production senaryosunda AÇIKÇA gerçek bir
  // domain'e override eder (aksi halde PUBLIC_URL guard'ı FRONTEND_URL guard'ından ÖNCE devreye
  // girer ve stderr'de "FRONTEND_URL" değil "PUBLIC_URL" görünür).
  const REAL_PUBLIC_URL = "https://api.example.com";

  it("NODE_ENV=production + FRONTEND_URL=http://localhost:3000 (açıkça yazılmış, varsayılanla BİREBİR AYNI değer) → boot BAŞARISIZ olur (CORS tüm gerçek origin'i reddeder, e-posta linkleri kendi makinesine işaret eder)", () => {
    const result = runEnvFixture({ NODE_ENV: "production", PUBLIC_URL: REAL_PUBLIC_URL, FRONTEND_URL: "http://localhost:3000" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FRONTEND_URL");
    expect(result.stderr).toContain("localhost");
  });

  it("NODE_ENV=production + FRONTEND_URL=http://127.0.0.1:3000 → boot BAŞARISIZ olur (localhost İLE AYNI risk, ayrıca kontrol edilir)", () => {
    const result = runEnvFixture({ NODE_ENV: "production", PUBLIC_URL: REAL_PUBLIC_URL, FRONTEND_URL: "http://127.0.0.1:3000" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FRONTEND_URL");
  });

  it("NODE_ENV=production + FRONTEND_URL=http://siteadi.localhost:3000 → boot BAŞARISIZ olur (RFC 6761 *.localhost, .env.example placeholder'ı prod'a taşınmışsa da yakalanır)", () => {
    const result = runEnvFixture({ NODE_ENV: "production", PUBLIC_URL: REAL_PUBLIC_URL, FRONTEND_URL: "http://siteadi.localhost:3000" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FRONTEND_URL");
    expect(result.stderr).toContain("siteadi.localhost");
  });

  it("NODE_ENV=production + FRONTEND_URL=https://wmhealthistanbul.com (gerçek domain) → boot BAŞARILI", () => {
    const result = runEnvFixture({ NODE_ENV: "production", PUBLIC_URL: REAL_PUBLIC_URL, FRONTEND_URL: "https://wmhealthistanbul.com" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({ ok: true, frontendUrl: "https://wmhealthistanbul.com" });
  });

  it("NODE_ENV=development + FRONTEND_URL=http://localhost:3000 → boot BAŞARILI (localhost guard'ı SADECE production'da, mevcut dev akışı bozulmaz)", () => {
    const result = runEnvFixture({ NODE_ENV: "development", FRONTEND_URL: "http://localhost:3000" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({ ok: true, frontendUrl: "http://localhost:3000" });
  });

  it("NODE_ENV=test + FRONTEND_URL=http://localhost:3000 → boot BAŞARILI (localhost guard'ı SADECE production'da, mevcut test akışı bozulmaz)", () => {
    const result = runEnvFixture({ NODE_ENV: "test", FRONTEND_URL: "http://localhost:3000" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({ ok: true, frontendUrl: "http://localhost:3000" });
  });
});
