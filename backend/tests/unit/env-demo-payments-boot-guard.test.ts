import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * `.claude/architect-scope-demo-payment-doctor-counters.md` İstek 1 §1.3 (bağlayıcı) —
 * `ENABLE_DEMO_PAYMENTS` gating'inin İLK katmanı: env doğrulaması.
 *
 * `config/env.ts` modül yükleme anında `NODE_ENV=production` VE `ENABLE_DEMO_PAYMENTS=true`
 * ise `process.exit(1)` çağırır — bu ÇAĞIRAN process'i (bu test dosyasının kendisi dahil) de
 * öldürür. Bu yüzden AYRI bir alt process'te (`tests/fixtures/import-env-only.ts`, `npx tsx`
 * ile) çalıştırılır; test yalnızca exit code + stdout/stderr'i doğrular.
 */

const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/import-env-only.ts");
// `node_modules/.bin/tsx` platforma göre `.cmd`/`.ps1` gerektirir (Windows) — bunun yerine tsx'in
// KENDİ CLI giriş noktası doğrudan `node` ile çalıştırılır (platformdan bağımsız, shell GEREKMEZ).
const TSX_CLI = path.resolve(__dirname, "../../node_modules/tsx/dist/cli.mjs");

function runEnvFixture(overrides: Record<string, string | undefined>) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return spawnSync(process.execPath, [TSX_CLI, FIXTURE_PATH], { cwd: path.resolve(__dirname, "../.."), env, encoding: "utf8" });
}

describe("config/env.ts — ENABLE_DEMO_PAYMENTS fail-closed boot koruması (§1.3)", () => {
  it("NODE_ENV=production + ENABLE_DEMO_PAYMENTS=true → boot BAŞARISIZ olur (process.exit(1), gürültülü hata)", () => {
    const result = runEnvFixture({ NODE_ENV: "production", ENABLE_DEMO_PAYMENTS: "true" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ENABLE_DEMO_PAYMENTS=true");
    expect(result.stderr).toContain("production");
  });

  it("NODE_ENV=production + ENABLE_DEMO_PAYMENTS=false (varsayılan) → boot BAŞARILI, isDemoPaymentsEnabled=false", () => {
    // `PUBLIC_URL` bilinçli olarak gerçek bir domain'e override edilir — bu test ENABLE_DEMO_PAYMENTS'i
    // doğrular, `.env.test`'in PUBLIC_URL değerine (yerel test sabiti) bağımlı OLMAMALIDIR (bkz.
    // `env-public-url-boot-guard.test.ts` — PUBLIC_URL'in KENDİ production/localhost koruması AYRI test edilir).
    const result = runEnvFixture({ NODE_ENV: "production", ENABLE_DEMO_PAYMENTS: undefined, PUBLIC_URL: "https://api.example.com" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({ ok: true, isDemoPaymentsEnabled: false });
  });

  it("NODE_ENV=development + ENABLE_DEMO_PAYMENTS=true → boot BAŞARILI, isDemoPaymentsEnabled=true (VE, iki bayrak birden)", () => {
    const result = runEnvFixture({ NODE_ENV: "development", ENABLE_DEMO_PAYMENTS: "true" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({ ok: true, isDemoPaymentsEnabled: true });
  });

  it("NODE_ENV=development + ENABLE_DEMO_PAYMENTS tanımsız (varsayılan false) → isDemoPaymentsEnabled=false (tek başına NODE_ENV YETERSİZ)", () => {
    const result = runEnvFixture({ NODE_ENV: "development", ENABLE_DEMO_PAYMENTS: undefined });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({ ok: true, isDemoPaymentsEnabled: false });
  });

  it("NODE_ENV=test + ENABLE_DEMO_PAYMENTS=true → boot BAŞARILI, isDemoPaymentsEnabled=true (staging/CI'nin development/test ile koşabileceği senaryo)", () => {
    const result = runEnvFixture({ NODE_ENV: "test", ENABLE_DEMO_PAYMENTS: "true" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({ ok: true, isDemoPaymentsEnabled: true });
  });
});
