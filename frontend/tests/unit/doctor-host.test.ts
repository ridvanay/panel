import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `.claude/architect-scope-doctor-subdomain.md` §5.5/§7.3 madde 12 — `lib/doctor-host.ts`
 * `NEXT_PUBLIC_SITE_URL`/`NEXT_PUBLIC_DOCTOR_URL` build-time env'lerine bağlı olduğu için modül
 * `vi.resetModules()` + dinamik `import()` İLE her testte TAZE okunur (`tests/unit/proxy-
 * maintenance-mode.test.ts`'teki AYNI desen).
 */

const ORIGINAL_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL;
const ORIGINAL_DOCTOR_URL = process.env.NEXT_PUBLIC_DOCTOR_URL;

function setEnv(siteUrl: string | undefined, doctorUrl: string | undefined) {
  if (siteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = siteUrl;
  if (doctorUrl === undefined) delete process.env.NEXT_PUBLIC_DOCTOR_URL;
  else process.env.NEXT_PUBLIC_DOCTOR_URL = doctorUrl;
}

describe("lib/doctor-host", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    setEnv(ORIGINAL_SITE_URL, ORIGINAL_DOCTOR_URL);
    vi.resetModules();
  });

  it("`NEXT_PUBLIC_DOCTOR_URL` tanımsızsa subdomain modu KAPALIDIR (§3.4 geriye dönük uyumluluk)", async () => {
    setEnv("http://siteadi.localhost:3000", undefined);
    const { isSubdomainModeEnabled, DOCTOR_ORIGIN, isDoctorHostname } = await import("@/lib/doctor-host");

    expect(isSubdomainModeEnabled()).toBe(false);
    expect(DOCTOR_ORIGIN).toBeNull();
    expect(isDoctorHostname("doktor.siteadi.localhost:3000")).toBe(false);
  });

  it("`NEXT_PUBLIC_DOCTOR_URL` geçerli ve ana site'tan farklı bir hostname'e çözülüyorsa subdomain modu AÇIKTIR", async () => {
    setEnv("http://siteadi.localhost:3000", "http://doktor.siteadi.localhost:3000");
    const { isSubdomainModeEnabled, DOCTOR_ORIGIN, isDoctorHostname } = await import("@/lib/doctor-host");

    expect(isSubdomainModeEnabled()).toBe(true);
    expect(DOCTOR_ORIGIN).toBe("http://doktor.siteadi.localhost:3000");
    expect(isDoctorHostname("doktor.siteadi.localhost:3000")).toBe(true);
    // Port'suz (`window.location.hostname` deseni) de eşleşmeli.
    expect(isDoctorHostname("doktor.siteadi.localhost")).toBe(true);
    // Ana site host'u doktor host'u OLARAK eşleşMEMELİ.
    expect(isDoctorHostname("siteadi.localhost:3000")).toBe(false);
  });

  it("§3.4 döngü koruması — `DOCTOR_HOST === SITE_HOST` ise subdomain modu KAPALI kabul edilir (hostname AYNIYSA port farkı ÖNEMSİZ)", async () => {
    setEnv("http://siteadi.localhost:3000", "http://siteadi.localhost:4000");
    const { isSubdomainModeEnabled, DOCTOR_ORIGIN, isDoctorHostname } = await import("@/lib/doctor-host");

    expect(isSubdomainModeEnabled()).toBe(false);
    expect(DOCTOR_ORIGIN).toBeNull();
    expect(isDoctorHostname("siteadi.localhost:4000")).toBe(false);
  });

  it("geçersiz bir `NEXT_PUBLIC_DOCTOR_URL` (parse edilemeyen URL) subdomain modunu SESSİZCE kapatır", async () => {
    setEnv("http://siteadi.localhost:3000", "not-a-valid-url");
    const { isSubdomainModeEnabled, DOCTOR_ORIGIN } = await import("@/lib/doctor-host");

    expect(isSubdomainModeEnabled()).toBe(false);
    expect(DOCTOR_ORIGIN).toBeNull();
  });

  it("`toDoctorOrigin` — hedef YALNIZCA `DOCTOR_ORIGIN`'den (env) türetilir, mutlak bir URL üretir", async () => {
    setEnv("http://siteadi.localhost:3000", "http://doktor.siteadi.localhost:3000");
    const { toDoctorOrigin } = await import("@/lib/doctor-host");

    expect(toDoctorOrigin("/doctor")).toBe("http://doktor.siteadi.localhost:3000/doctor");
    expect(toDoctorOrigin("/doctor/earnings")).toBe("http://doktor.siteadi.localhost:3000/doctor/earnings");
  });

  it("subdomain modu kapalıyken `toDoctorOrigin` istisna FIRLATMAZ, `SITE_ORIGIN`'e güvenli fallback yapar", async () => {
    setEnv("http://siteadi.localhost:3000", undefined);
    const { toDoctorOrigin, SITE_ORIGIN } = await import("@/lib/doctor-host");

    expect(() => toDoctorOrigin("/doctor")).not.toThrow();
    expect(toDoctorOrigin("/doctor")).toBe(`${SITE_ORIGIN}/doctor`);
  });
});
