import { describe, expect, it } from "vitest";
import { resolvePostLoginPath } from "@/lib/post-login-destination";

describe("resolvePostLoginPath", () => {
  it("`next` güvenli bir site-içi yol ise KESİN öncelikli döner (doktor OLMAYAN hesapta)", () => {
    expect(
      resolvePostLoginPath({ next: "/products/some-slug", doctorProfileId: null, telehealthEnabled: true })
    ).toBe("/products/some-slug");
  });

  // Doktor hesabı + telehealth açıkken `/doctor` altında OLMAYAN güvenli bir `next` bile
  // YOK SAYILIR — `doctor-portal-route-guard.tsx` zaten doktoru `/doctor/**` DIŞINA hiç
  // bırakmıyor, giriş anında bu kuralla ÇELİŞMEMESİ gerekir (bkz. `post-login-destination.ts`
  // dosya başı yorumu, `f3e591e` — kasıtlı öncelik değişikliği).
  it("doktor hesabı + telehealth açık + `next` `/doctor` altında DEĞİLSE YOK SAYILIR → /doctor", () => {
    expect(
      resolvePostLoginPath({ next: "/products/some-slug", doctorProfileId: "doctor-1", telehealthEnabled: true })
    ).toBe("/doctor");
  });

  it("doktor hesabı + telehealth açık + `next` zaten `/doctor` altındaysa KORUNUR", () => {
    expect(
      resolvePostLoginPath({ next: "/doctor/bookings", doctorProfileId: "doctor-1", telehealthEnabled: true })
    ).toBe("/doctor/bookings");
  });

  it("doktor hesabı + telehealth açık + `next` yok/güvensiz → /doctor", () => {
    expect(resolvePostLoginPath({ next: null, doctorProfileId: "doctor-1", telehealthEnabled: true })).toBe("/doctor");
  });

  it("doktor olmayan/`telehealth` kapalı hesap → /dashboard varsayılanı", () => {
    expect(resolvePostLoginPath({ next: null, doctorProfileId: null, telehealthEnabled: true })).toBe("/dashboard");
    expect(resolvePostLoginPath({ next: null, doctorProfileId: "doctor-1", telehealthEnabled: false })).toBe(
      "/dashboard"
    );
  });

  it("`next` güvensiz (open redirect adayı) ise YOK SAYILIR", () => {
    expect(
      resolvePostLoginPath({ next: "//evil.com", doctorProfileId: "doctor-1", telehealthEnabled: true })
    ).toBe("/doctor");
    expect(resolvePostLoginPath({ next: "//evil.com", doctorProfileId: null, telehealthEnabled: true })).toBe(
      "/dashboard"
    );
  });
});
