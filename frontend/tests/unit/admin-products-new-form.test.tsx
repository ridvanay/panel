import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NewProductPage from "@/app/admin/products/new/page";
import type { User } from "@/lib/api/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api/products", () => ({
  listProductCategories: vi.fn(),
  createProduct: vi.fn(),
}));

vi.mock("@/lib/api/users-admin", () => ({
  listAdminUsers: vi.fn(),
}));

let mockUser: User;
vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({ user: mockUser }),
}));

const productsApi = await import("@/lib/api/products");

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "editor@example.com",
    name: "Editör Kullanıcı",
    avatarUrl: null,
    emailVerifiedAt: "2026-01-01T00:00:00.000Z",
    role: "EDITOR",
    createdAt: "2026-01-01T00:00:00.000Z",
    twoFactorEnabled: false,
    ...overrides,
  };
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^Başlık/), "Test Ürün");
  const priceInput = screen.getByLabelText(/^Fiyat \(TL\)/);
  await user.clear(priceInput);
  await user.type(priceInput, "100");
}

describe("NewProductPage — form validasyonu", () => {
  it("fiyat 0 veya negatifse gönderim engellenir ve hata mesajı gösterilir", async () => {
    mockUser = makeUser();
    vi.mocked(productsApi.listProductCategories).mockResolvedValue([]);
    const user = userEvent.setup();

    render(<NewProductPage />);

    await user.type(screen.getByLabelText(/^Başlık/), "Test Ürün");
    const priceInput = screen.getByLabelText(/^Fiyat \(TL\)/);
    await user.clear(priceInput);
    await user.type(priceInput, "0");

    await user.click(screen.getByRole("button", { name: "Oluştur ve devam et" }));

    expect(await screen.findByText("Fiyat 0'dan büyük olmalı.")).toBeInTheDocument();
    expect(productsApi.createProduct).not.toHaveBeenCalled();
  });

  it("indirimli fiyat normal fiyattan küçük değilse gönderim engellenir", async () => {
    mockUser = makeUser();
    vi.mocked(productsApi.listProductCategories).mockResolvedValue([]);
    const user = userEvent.setup();

    render(<NewProductPage />);

    await fillRequiredFields(user);
    const discountInput = screen.getByLabelText("İndirimli fiyat (TL)");
    await user.type(discountInput, "150");

    await user.click(screen.getByRole("button", { name: "Oluştur ve devam et" }));

    expect(await screen.findByText("İndirimli fiyat, normal fiyattan küçük olmalıdır.")).toBeInTheDocument();
    expect(productsApi.createProduct).not.toHaveBeenCalled();
  });

  it("geçerli değerlerle gönderildiğinde priceCents kuruşa çevrilerek createProduct çağrılır", async () => {
    mockUser = makeUser();
    vi.mocked(productsApi.listProductCategories).mockResolvedValue([]);
    vi.mocked(productsApi.createProduct).mockResolvedValue({
      id: "product-1",
      title: "Test Ürün",
      slug: "test-urun",
      excerpt: null,
      descriptionHtml: "",
      priceCents: 10000,
      currency: "TRY",
      taxRatePercent: null,
      discountPriceCents: null,
      sku: null,
      stockQuantity: 0,
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
    });
    const user = userEvent.setup();

    render(<NewProductPage />);

    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Oluştur ve devam et" }));

    await waitFor(() => {
      expect(productsApi.createProduct).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Test Ürün", priceCents: 10000, currency: "TRY" })
      );
    });
  });
});
