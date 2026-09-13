import { describe, expect, it } from "vitest";
import { resolvePostLoginPath } from "@/lib/post-login-destination";

describe("resolvePostLoginPath", () => {
  it("`next` güvenli bir site-içi yol ise KESİN öncelikli döner (doktor olsa bile)", () => {
    expect(
      resolvePostLoginPath({ next: "/products/some-slug", doctorProfileId: "doctor-1", telehealthEnabled: true })
    ).toBe("/products/some-slug");
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
