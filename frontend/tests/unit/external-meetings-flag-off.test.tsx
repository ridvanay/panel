import { describe, expect, it, vi } from "vitest";

/**
 * AI İş 3 hızlı sürüm — `EXTERNAL_MEETINGS_ENABLED = false`: AG ekranları (admin Toplantılar, doktor portalı toplantıları)
 * `notFound()` döner. Bayrak değeri gerçek modülden okunur (sabit `false`), mock'lanmaz.
 */
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
  it("varsayılan olarak kapalıdır", () => {
    expect(EXTERNAL_MEETINGS_ENABLED).toBe(false);
  });

  it("/admin/meetings notFound() fırlatır", () => {
    expect(() => AdminMeetingsPage()).toThrow(NotFoundError);
  });

  it("/{lang}/doctor/meetings notFound() fırlatır", () => {
    expect(() => DoctorMeetingsPage()).toThrow(NotFoundError);
  });
});
