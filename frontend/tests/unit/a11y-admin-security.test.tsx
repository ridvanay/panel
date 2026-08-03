import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import SecurityPage from "@/app/admin/settings/security/page";
import type { Session, TwoFactorSetupResponse, User } from "@/lib/api/types";

vi.mock("@/lib/api/security", () => ({
  listSessions: vi.fn(),
  setupTwoFactor: vi.fn(),
  enableTwoFactor: vi.fn(),
  disableTwoFactor: vi.fn(),
  regenerateBackupCodes: vi.fn(),
  revokeSession: vi.fn(),
  revokeOtherSessions: vi.fn(),
}));

const refreshSession = vi.fn();
let mockUser: User;
vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({ user: mockUser, refreshSession }),
}));

const securityApi = await import("@/lib/api/security");

const axeOptions = { rules: { region: { enabled: false } } };

const sessions: Session[] = [
  {
    id: "session-1",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    ipAddress: "127.0.0.1",
    createdAt: "2026-08-01T10:00:00.000Z",
    expiresAt: "2026-09-01T10:00:00.000Z",
    isCurrent: true,
  },
  {
    id: "session-2",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    ipAddress: "10.0.0.2",
    createdAt: "2026-07-20T10:00:00.000Z",
    expiresAt: "2026-08-20T10:00:00.000Z",
    isCurrent: false,
  },
];

const setupResponse: TwoFactorSetupResponse = {
  otpauthUrl: "otpauth://totp/Site:user@example.com?secret=ABC123&issuer=Site",
  qrCodeDataUrl: "data:image/png;base64,AAAA",
  setupToken: "setup-token-1",
};

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "admin@example.com",
    name: "Admin Kullanıcı",
    avatarUrl: null,
    emailVerifiedAt: "2026-01-01T00:00:00.000Z",
    role: "ADMIN",
    createdAt: "2026-01-01T00:00:00.000Z",
    twoFactorEnabled: false,
    ...overrides,
  };
}

describe("SecurityPage — a11y", () => {
  it("2FA kapalıyken oturum listesi yüklendikten sonra kritik/ciddi a11y ihlali içermez", async () => {
    mockUser = makeUser({ twoFactorEnabled: false });
    vi.mocked(securityApi.listSessions).mockResolvedValue(sessions);

    const { container } = render(<SecurityPage />);

    expect(await screen.findByText("Aktif Oturumlar")).toBeInTheDocument();
    await screen.findByText(/Mozilla\/5\.0 \(Windows/);

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("2FA kurulum diyaloğu (QR kod + doğrulama kodu) açıkken kritik/ciddi a11y ihlali içermez", async () => {
    mockUser = makeUser({ twoFactorEnabled: false });
    vi.mocked(securityApi.listSessions).mockResolvedValue(sessions);
    vi.mocked(securityApi.setupTwoFactor).mockResolvedValue(setupResponse);

    const user = userEvent.setup();
    const { container } = render(<SecurityPage />);

    await screen.findByText("Aktif Oturumlar");
    await user.click(screen.getByRole("button", { name: "Etkinleştir" }));

    expect(await screen.findByText("İki Faktörlü Doğrulamayı Etkinleştir")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
