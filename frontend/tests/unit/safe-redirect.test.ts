import { describe, expect, it } from "vitest";
import { isSafeInternalPath } from "@/lib/safe-redirect";

/**
 * §customer-portal — security-agent'ın `/login?next=` open-redirect denetiminin bekçi testi.
 * `frontend/src/lib/safe-redirect.ts` yorumunda anlatılan bypass vektörlerinin GERÇEKTEN
 * reddedildiğini doğrular (`isSafeInternalPath` çağrı yerleri: `login/page.tsx`, `register/page.tsx`).
 */
describe("isSafeInternalPath — open-redirect koruması", () => {
  it("site-içi göreli bir path'i kabul eder", () => {
    expect(isSafeInternalPath("/hesabim/adreslerim")).toBe(true);
    expect(isSafeInternalPath("/hesabim/siparislerim?tab=1")).toBe(true);
  });

  it("protokol-göreli mutlak URL'i (`//evil.com`) REDDEDER", () => {
    expect(isSafeInternalPath("//evil.com")).toBe(false);
    expect(isSafeInternalPath("//evil.com/phish")).toBe(false);
  });

  it("ters slash normalize bypass'ını (`/\\evil.com`) REDDEDER", () => {
    expect(isSafeInternalPath("/\\evil.com")).toBe(false);
  });

  it("mutlak/harici URL'leri (http/https/protokolsüz olmayan) REDDEDER", () => {
    expect(isSafeInternalPath("https://evil.com")).toBe(false);
    expect(isSafeInternalPath("http://evil.com")).toBe(false);
    expect(isSafeInternalPath("evil.com")).toBe(false);
  });

  it("boş/null/undefined değerleri REDDEDER", () => {
    expect(isSafeInternalPath("")).toBe(false);
    expect(isSafeInternalPath(null)).toBe(false);
    expect(isSafeInternalPath(undefined)).toBe(false);
  });
});
