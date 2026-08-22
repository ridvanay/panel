import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewPortfolioItemPage from "@/app/admin/portfolio/new/page";
import type { User } from "@/lib/api/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api/portfolio", () => ({
  listPortfolioCategories: vi.fn(),
  createPortfolioItem: vi.fn(),
}));

vi.mock("@/lib/api/users-admin", () => ({
  listAdminUsers: vi.fn(),
}));

let mockUser: User;
vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({ user: mockUser }),
}));

const portfolioApi = await import("@/lib/api/portfolio");

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "editor@example.com",
    name: "Editör Kullanıcı",
    avatarUrl: null,
    emailVerifiedAt: "2026-01-01T00:00:00.000Z",
    role: "EDITOR",
    canUseAdvancedBuilder: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    twoFactorEnabled: false,
    ...overrides,
  };
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^Başlık/), "Test Proje");
}

describe("NewPortfolioItemPage — form validasyonu", () => {
  it("proje URL'si geçersizse gönderim engellenir ve hata mesajı gösterilir", async () => {
    mockUser = makeUser();
    vi.mocked(portfolioApi.listPortfolioCategories).mockResolvedValue([]);
    const user = userEvent.setup();

    render(<NewPortfolioItemPage />);

    await fillRequiredFields(user);
    const urlInput = screen.getByLabelText(/^Proje URL'si/);
    await user.type(urlInput, "gecersiz-url");

    await user.click(screen.getByRole("button", { name: "Oluştur ve devam et" }));

    expect(await screen.findByText("Geçerli bir URL girin (https://...).")).toBeInTheDocument();
    expect(portfolioApi.createPortfolioItem).not.toHaveBeenCalled();
  });

  it("geçerli değerlerle gönderildiğinde createPortfolioItem doğru alanlarla çağrılır", async () => {
    mockUser = makeUser();
    vi.mocked(portfolioApi.listPortfolioCategories).mockResolvedValue([]);
    vi.mocked(portfolioApi.createPortfolioItem).mockResolvedValue({
      id: "portfolio-1",
      title: "Test Proje",
      slug: "test-proje",
      summary: null,
      contentHtml: "",
      clientName: null,
      projectUrl: null,
      completedAt: null,
      order: 0,
      status: "DRAFT",
      category: null,
      coverMedia: null,
      images: [],
      seoTitle: null,
      seoDescription: null,
      ogTitle: null,
      ogImageUrl: null,
      canonicalUrl: null,
      noIndex: false,
      translations: {},
      publishedAt: null,
      scheduledAt: null,
      viewCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
      authorId: null,
      author: null,
      seoScore: 0,
      seoScoreIssues: [],
      localizations: [],
    });
    const user = userEvent.setup();

    render(<NewPortfolioItemPage />);

    await fillRequiredFields(user);
    const clientInput = screen.getByLabelText(/^Müşteri/);
    await user.type(clientInput, "Test Müşteri");

    await user.click(screen.getByRole("button", { name: "Oluştur ve devam et" }));

    await waitFor(() => {
      expect(portfolioApi.createPortfolioItem).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Test Proje", clientName: "Test Müşteri", order: 0 })
      );
    });
  });
});
