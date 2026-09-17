import { describe, expect, it } from "vitest";
import { resolvePostLoginPath } from "@/lib/post-login-destination";

describe("resolvePostLoginPath", () => {
  it("`next` güvenli bir site-içi yol ise KESİN öncelikli döner (doktor OLMAYAN, panel-DIŞI hesapta)", () => {
    expect(
      resolvePostLoginPath({ next: "/products/some-slug", doctorProfileId: null, telehealthEnabled: true, role: "USER" })
    ).toBe("/products/some-slug");
  });

  // Doktor hesabı + telehealth açıkken `/doctor` altında OLMAYAN güvenli bir `next` bile
  // YOK SAYILIR — `doctor-portal-route-guard.tsx` zaten doktoru `/doctor/**` DIŞINA hiç
  // bırakmıyor, giriş anında bu kuralla ÇELİŞMEMESİ gerekir (bkz. `post-login-destination.ts`
  // dosya başı yorumu, `f3e591e` — kasıtlı öncelik değişikliği).
  it("doktor hesabı + telehealth açık + `next` `/doctor` altında DEĞİLSE YOK SAYILIR → /doctor", () => {
    expect(
      resolvePostLoginPath({
        next: "/products/some-slug",
        doctorProfileId: "doctor-1",
        telehealthEnabled: true,
        role: "USER",
      })
    ).toBe("/doctor");
  });

  it("doktor hesabı + telehealth açık + `next` zaten `/doctor` altındaysa KORUNUR", () => {
    expect(
      resolvePostLoginPath({
        next: "/doctor/bookings",
        doctorProfileId: "doctor-1",
        telehealthEnabled: true,
        role: "USER",
      })
    ).toBe("/doctor/bookings");
  });

  it("doktor hesabı + telehealth açık + `next` yok/güvensiz → /doctor", () => {
    expect(
      resolvePostLoginPath({ next: null, doctorProfileId: "doctor-1", telehealthEnabled: true, role: "USER" })
    ).toBe("/doctor");
  });

  it("doktor olmayan/`telehealth` kapalı, panel-DIŞI (CUSTOMER/USER) hesap → /patient/appointments varsayılanı", () => {
    expect(resolvePostLoginPath({ next: null, doctorProfileId: null, telehealthEnabled: true, role: "USER" })).toBe(
      "/patient/appointments"
    );
    expect(
      resolvePostLoginPath({ next: null, doctorProfileId: "doctor-1", telehealthEnabled: false, role: "USER" })
    ).toBe("/patient/appointments");
  });

  it("`next` güvensiz (open redirect adayı) ise YOK SAYILIR", () => {
    expect(
      resolvePostLoginPath({ next: "//evil.com", doctorProfileId: "doctor-1", telehealthEnabled: true, role: "USER" })
    ).toBe("/doctor");
    expect(
      resolvePostLoginPath({ next: "//evil.com", doctorProfileId: null, telehealthEnabled: true, role: "USER" })
    ).toBe("/patient/appointments");
  });

  it("panel rolü (ADMIN) → /admin, `next` yok/güvensiz", () => {
    expect(resolvePostLoginPath({ next: null, doctorProfileId: null, telehealthEnabled: false, role: "ADMIN" })).toBe(
      "/admin"
    );
  });

  it("panel rolü (MANAGER/EDITOR) → /admin", () => {
    expect(
      resolvePostLoginPath({ next: null, doctorProfileId: null, telehealthEnabled: false, role: "MANAGER" })
    ).toBe("/admin");
    expect(
      resolvePostLoginPath({ next: null, doctorProfileId: null, telehealthEnabled: false, role: "EDITOR" })
    ).toBe("/admin");
  });

  it("CUSTOMER rolü → /patient/appointments", () => {
    expect(
      resolvePostLoginPath({ next: null, doctorProfileId: null, telehealthEnabled: false, role: "CUSTOMER" })
    ).toBe("/patient/appointments");
  });

  it("panel rolü + `next` `/admin` altındaysa KORUNUR", () => {
    expect(
      resolvePostLoginPath({
        next: "/admin/blog",
        doctorProfileId: null,
        telehealthEnabled: false,
        role: "MANAGER",
      })
    ).toBe("/admin/blog");
  });

  it("panel rolü + `next` `/admin` DIŞINDaysa YOK SAYILIR → /admin", () => {
    expect(
      resolvePostLoginPath({
        next: "/products/some-slug",
        doctorProfileId: null,
        telehealthEnabled: false,
        role: "ADMIN",
      })
    ).toBe("/admin");
  });

  it("`next` `/dashboard` altındaysa (panel rolü OLMAYAN kullanıcı için) YOK SAYILIR → /patient/appointments", () => {
    expect(
      resolvePostLoginPath({ next: "/dashboard", doctorProfileId: null, telehealthEnabled: false, role: "USER" })
    ).toBe("/patient/appointments");
    expect(
      resolvePostLoginPath({
        next: "/dashboard/org-1/billing",
        doctorProfileId: null,
        telehealthEnabled: false,
        role: "CUSTOMER",
      })
    ).toBe("/patient/appointments");
  });
});
