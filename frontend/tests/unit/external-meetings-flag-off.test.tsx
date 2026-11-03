import { describe, expect, it, vi } from "vitest";

/**
 * `EXTERNAL_MEETINGS_ENABLED = false` (kapatma anahtarı): AG ekranları (admin Toplantılar, doktor portalı toplantıları)
 * `notFound()` döner. Varsayılan artık `true` olduğundan kapalı durum bayrak mock'lanarak korunur.
 */
vi.mock("@/lib/feature-flags", () => ({ EXTERNAL_MEETINGS_ENABLED: false }));

class NotFoundError extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundError("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/admin/meetings",
}));
vi.mock("@/components/meetings/meetings-manager", () => ({ MeetingsManager: () => <div data-testid="meetings-manager" /> }));
vi.mock("@/components/site/telehealth/doctor-portal-shell", () => ({ DoctorPortalShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

import { EXTERNAL_MEETINGS_ENABLED } from "@/lib/feature-flags";
import AdminMeetingsPage from "@/app/admin/meetings/page";
import DoctorMeetingsPage from "@/app/[lang]/(doctor)/doctor/meetings/page";

describe("harici toplantılar bayrağı kapalı", () => {
  it("mock bayrak kapalıdır", () => {
    expect(EXTERNAL_MEETINGS_ENABLED).toBe(false);
  });

  it("/admin/meetings notFound() fırlatır", () => {
    expect(() => AdminMeetingsPage()).toThrow(NotFoundError);
  });

  it("/{lang}/doctor/meetings notFound() fırlatır", () => {
    expect(() => DoctorMeetingsPage()).toThrow(NotFoundError);
  });
});
