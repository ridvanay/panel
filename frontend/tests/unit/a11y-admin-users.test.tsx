import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import AdminUsersPage from "@/app/admin/users/page";
import type { AdminUser, User } from "@/lib/api/types";

vi.mock("@/lib/api/users-admin", () => ({
  listAdminUsers: vi.fn(),
  listAllAdminUsers: vi.fn(),
  createAdminUser: vi.fn(),
  updateUserRole: vi.fn(),
  updateUserStatus: vi.fn(),
}));

let mockUser: User;
vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({ user: mockUser }),
}));

const usersAdminApi = await import("@/lib/api/users-admin");

const axeOptions = { rules: { region: { enabled: false } } };

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

const adminUsers: AdminUser[] = [
  {
    id: "user-1",
    email: "admin@example.com",
    name: "Admin Kullanıcı",
    avatarUrl: null,
    emailVerifiedAt: "2026-01-01T00:00:00.000Z",
    role: "ADMIN",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "ACTIVE",
    lastLoginAt: "2026-08-01T10:00:00.000Z",
  },
  {
    id: "user-2",
    email: "editor@example.com",
    name: "Editor Kullanıcı",
    avatarUrl: null,
    emailVerifiedAt: "2026-01-02T00:00:00.000Z",
    role: "EDITOR",
    createdAt: "2026-01-02T00:00:00.000Z",
    status: "ACTIVE",
    lastLoginAt: null,
  },
  {
    id: "user-3",
    email: "viewer@example.com",
    name: "Viewer Kullanıcı",
    avatarUrl: null,
    emailVerifiedAt: null,
    role: "VIEWER",
    createdAt: "2026-01-03T00:00:00.000Z",
    status: "SUSPENDED",
    lastLoginAt: "2026-07-15T09:30:00.000Z",
  },
];

describe("AdminUsersPage — a11y", () => {
  it("ADMIN/EDITOR/VIEWER rollerini ve aktif/askıda durumları içeren kullanıcı listesi yüklendikten sonra kritik/ciddi a11y ihlali içermez", async () => {
    mockUser = makeUser();
    vi.mocked(usersAdminApi.listAdminUsers).mockResolvedValue({ items: adminUsers, meta: { nextCursor: null } });

    const { container } = render(<AdminUsersPage />);

    expect(await screen.findByText("Admin Kullanıcı")).toBeInTheDocument();
    expect(screen.getByText("Editor Kullanıcı")).toBeInTheDocument();
    expect(screen.getByText("Viewer Kullanıcı")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("kullanıcı seçilip toplu işlem çubuğu göründükten sonra da kritik/ciddi a11y ihlali içermez", async () => {
    mockUser = makeUser();
    vi.mocked(usersAdminApi.listAdminUsers).mockResolvedValue({ items: adminUsers, meta: { nextCursor: null } });

    const user = userEvent.setup();
    const { container } = render(<AdminUsersPage />);

    await screen.findByText("Admin Kullanıcı");
    await user.click(screen.getByRole("checkbox", { name: "Editor Kullanıcı kullanıcısını seç" }));

    expect(await screen.findByText("1 seçili")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
