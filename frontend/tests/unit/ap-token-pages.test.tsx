import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * Paket AP — şifre sıfırlama, yorum daveti ve kullanıcı daveti sayfaları: token `#` parçasından okunur, adres
 * çubuğunda kalmaz; eski biçim (sorgu / yol) geçiş süresince okunup yeni biçime çevrilir.
 */
const mocks = vi.hoisted(() => ({
  authStatus: "unauthenticated" as "loading" | "authenticated" | "unauthenticated",
  resetPassword: vi.fn(),
  getReviewInvite: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ status: mocks.authStatus }) }));
vi.mock("@/components/auth/auth-page-shell", () => ({ AuthPageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/auth/auth-link", () => ({ AuthLink: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/lib/api/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/api/auth")>()), resetPassword: (...a: unknown[]) => mocks.resetPassword(...a) }));
vi.mock("@/lib/api/reviews", async (orig) => ({ ...(await orig<typeof import("@/lib/api/reviews")>()), getReviewInvite: (...a: unknown[]) => mocks.getReviewInvite(...a) }));

import ResetPasswordPage from "@/app/(auth)/reset-password/page";
import { ReviewInvitePage } from "@/components/site/reviews/review-invite-view";
import { AcceptInvitationView } from "@/components/dashboard/accept-invitation-view";
import { LEGACY_TOKEN_IN_URL_UNTIL } from "@/lib/access-token-url";

function goTo(url: string) {
  window.history.replaceState(null, "", url);
}
const currentUrl = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-10T00:00:00.000Z") });
  window.sessionStorage.clear();
  mocks.authStatus = "unauthenticated";
  mocks.resetPassword.mockReset().mockResolvedValue(undefined);
  mocks.getReviewInvite.mockReset().mockResolvedValue({ doctorName: "Dr. X" });
});
afterEach(() => {
  vi.useRealTimers();
  goTo("/");
});

describe("şifre sıfırlama", () => {
  it("#token= okunur, adres temizlenir, form görünür", async () => {
    goTo("/reset-password#token=RESET-NEW");
    render(<ResetPasswordPage />);
    await waitFor(() => expect(document.querySelector('button[type="submit"]')).not.toBeNull());
    expect(currentUrl()).toBe("/reset-password");
    expect(window.sessionStorage.getItem("reset-password-token")).toBe("RESET-NEW");
  });

  it("eski ?token= geçiş süresinde okunur ve silinir; süre dolunca geçersiz bağlantı", async () => {
    goTo("/reset-password?token=RESET-OLD");
    const first = render(<ResetPasswordPage />);
    await waitFor(() => expect(document.querySelector('button[type="submit"]')).not.toBeNull());
    expect(currentUrl()).toBe("/reset-password");
    first.unmount();

    window.sessionStorage.clear();
    vi.setSystemTime(new Date(LEGACY_TOKEN_IN_URL_UNTIL.getTime() + 1000));
    goTo("/reset-password?token=RESET-OLD");
    render(<ResetPasswordPage />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(document.querySelector('button[type="submit"]')).toBeNull();
    expect(currentUrl()).toBe("/reset-password");
  });
});

describe("yorum daveti", () => {
  it("/review#<token>: token okunur, adres temizlenir, lookup token ile çağrılır", async () => {
    goTo("/en/review#REVIEW-TOKEN-NEW");
    render(<ReviewInvitePage />);
    await waitFor(() => expect(mocks.getReviewInvite).toHaveBeenCalledWith("REVIEW-TOKEN-NEW"));
    expect(currentUrl()).toBe("/en/review");
  });

  it("eski /review/<token>: adres /review'a çevrilir (optout korunur)", async () => {
    goTo("/en/review/REVIEW-TOKEN-OLD?optout=1");
    render(<ReviewInvitePage legacyPathToken="REVIEW-TOKEN-OLD" optOut />);
    await waitFor(() => expect(currentUrl()).toBe("/en/review?optout=1"));
  });
});

describe("kullanıcı daveti", () => {
  it("oturumsuz kullanıcı: giriş/kayıt bağlantısında token YOK; token sekmede bekler", async () => {
    goTo("/invitations/accept#INVITE-TOKEN");
    render(<AcceptInvitationView />);
    const login = await screen.findByRole("link", { name: "Giriş yap" });
    expect(login.getAttribute("href")).toBe(`/login?next=${encodeURIComponent("/invitations/accept")}`);
    expect(document.body.innerHTML).not.toContain("INVITE-TOKEN");
    expect(currentUrl()).toBe("/invitations/accept");
    expect(window.sessionStorage.getItem("invitation-token")).toBe("INVITE-TOKEN");
  });

  it("eski /invitations/<token>/accept: adres /invitations/accept'e çevrilir", async () => {
    mocks.authStatus = "authenticated";
    goTo("/invitations/OLD-INVITE/accept");
    render(<AcceptInvitationView legacyPathToken="OLD-INVITE" />);
    await waitFor(() => expect(currentUrl()).toBe("/invitations/accept"));
    expect(screen.getByRole("button", { name: "Daveti kabul et" })).toBeEnabled();
  });
});
