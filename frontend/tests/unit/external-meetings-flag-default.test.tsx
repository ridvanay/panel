import { describe, expect, it, vi } from "vitest";

/**
 * AG İş 3 tamamlandı — `EXTERNAL_MEETINGS_ENABLED` varsayılanı `true`: bayrak gerçek modülden okunur (mock yok) ve AG
 * ekranları `notFound()` fırlatmaz. Kapalı durum `external-meetings-flag-off.test.tsx` içinde mock ile korunur.
 */
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/admin/meetings",
}));
vi.mock("@/components/meetings/meetings-manager", () => ({ MeetingsManager: () => <div data-testid="meetings-manager" /> }));
vi.mock("@/components/site/telehealth/doctor-portal-shell", () => ({ DoctorPortalShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

import { EXTERNAL_MEETINGS_ENABLED } from "@/lib/feature-flags";
import AdminMeetingsPage from "@/app/admin/meetings/page";
import DoctorMeetingsPage from "@/app/[lang]/(doctor)/doctor/meetings/page";

describe("harici toplantılar bayrağı varsayılan açık", () => {
  it("varsayılan olarak açıktır", () => {
    expect(EXTERNAL_MEETINGS_ENABLED).toBe(true);
  });

  it("/admin/meetings ve /{lang}/doctor/meetings notFound() fırlatmaz", () => {
    expect(() => AdminMeetingsPage()).not.toThrow();
    expect(() => DoctorMeetingsPage()).not.toThrow();
  });
});
