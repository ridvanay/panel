import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import AdminModulesPage from "@/app/admin/modules/page";
import type { SiteModule, User } from "@/lib/api/types";

vi.mock("@/lib/api/modules", () => ({
  listModules: vi.fn(),
  updateModule: vi.fn(),
}));

vi.mock("@/lib/api/settings", () => ({
  getSettings: vi.fn(),
}));

let mockUser: User;
vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({ user: mockUser }),
}));

vi.mock("@/context/modules-context", () => ({
  useModules: () => ({ refetch: vi.fn() }),
}));

const modulesApi = await import("@/lib/api/modules");
const settingsApi = await import("@/lib/api/settings");

const axeOptions = { rules: { region: { enabled: false } } };

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "admin@example.com",
    name: "Admin Kullanıcı",
    avatarUrl: null,
    emailVerifiedAt: "2026-01-01T00:00:00.000Z",
    role: "ADMIN",
    canUseAdvancedBuilder: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    twoFactorEnabled: false,
    ...overrides,
  };
}

const modules: SiteModule[] = [
  {
    key: "products",
    label: "Ürünler",
    description: "Ürün kataloğu modülü.",
    enabled: true,
    updatedAt: "2026-08-01T10:00:00.000Z",
    updatedBy: { id: "user-1", name: "Admin Kullanıcı", email: "admin@example.com", avatarUrl: null },
  },
  {
    key: "portfolio",
    label: "Portfolyo",
    description: "Proje/portfolyo vitrini modülü.",
    enabled: false,
    updatedAt: null,
    updatedBy: null,
  },
];

describe("AdminModulesPage — a11y", () => {
  beforeEach(() => {
    // "Önerilen" rozeti için mevcut site şablonu çekilir — davranışı etkilemez, testler için sabit.
    vi.mocked(settingsApi.getSettings).mockResolvedValue({
      siteName: "Site",
      logoUrl: null,
      tagline: null,
      homePageId: null,
      siteTemplate: "SHOWCASE",
      headerLogoHeight: null,
      headerLogoMaxWidth: null,
    });
  });

  it("boş modül listesinde kritik/ciddi a11y ihlali içermez", async () => {
    mockUser = makeUser({ role: "ADMIN" });
    vi.mocked(modulesApi.listModules).mockResolvedValue([]);

    const { container } = render(<AdminModulesPage />);

    expect(await screen.findByText("Henüz kayıtlı modül yok")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("dolu modül listesinde (ADMIN) kritik/ciddi a11y ihlali içermez", async () => {
    mockUser = makeUser({ role: "ADMIN" });
    vi.mocked(modulesApi.listModules).mockResolvedValue(modules);

    const { container } = render(<AdminModulesPage />);

    expect(await screen.findByText("Ürünler")).toBeInTheDocument();
    expect(screen.getByText("Portfolyo")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("ADMIN olmayan bir kullanıcı için toggle'lar devre dışıdır ve a11y ihlali içermez", async () => {
    mockUser = makeUser({ role: "EDITOR" });
    vi.mocked(modulesApi.listModules).mockResolvedValue(modules);

    const { container } = render(<AdminModulesPage />);

    expect(await screen.findByText("Ürünler")).toBeInTheDocument();
    const switches = screen.getAllByRole("switch");
    for (const el of switches) {
      expect(el).toHaveAttribute("aria-disabled", "true");
    }

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("ADMIN kullanıcı toggle'a tıkladığında updateModule çağrılır", async () => {
    mockUser = makeUser({ role: "ADMIN" });
    vi.mocked(modulesApi.listModules).mockResolvedValue(modules);
    vi.mocked(modulesApi.updateModule).mockResolvedValue({ ...modules[0], enabled: false });

    const user = userEvent.setup();
    render(<AdminModulesPage />);

    await screen.findByText("Ürünler");
    const switches = screen.getAllByRole("switch");
    await user.click(switches[0]);

    expect(modulesApi.updateModule).toHaveBeenCalledWith("products", false);
  });
});
