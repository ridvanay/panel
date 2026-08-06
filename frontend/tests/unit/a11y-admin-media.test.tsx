import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import AdminMediaPage from "@/app/admin/media/page";
import type { Media, Page } from "@/lib/api/types";

vi.mock("@/lib/api/media", () => ({
  listMedia: vi.fn(),
  uploadMedia: vi.fn(),
  deleteMedia: vi.fn(),
}));

const mediaApi = await import("@/lib/api/media");

const axeOptions = { rules: { region: { enabled: false } } };

const items: Media[] = [
  {
    id: "media-1",
    url: "https://example.com/media/kapak.png",
    filename: "kapak.png",
    mimeType: "image/png",
    sizeBytes: 204800,
    createdAt: "2026-08-01T10:00:00.000Z",
  },
  {
    id: "media-2",
    url: "https://example.com/media/banner.jpg",
    filename: "banner.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 512000,
    createdAt: "2026-08-02T10:00:00.000Z",
  },
  {
    id: "media-3",
    url: "https://example.com/media/logo.svg",
    filename: "logo.svg",
    mimeType: "image/svg+xml",
    sizeBytes: 10240,
    createdAt: "2026-08-03T10:00:00.000Z",
  },
];

const mediaPage: Page<Media> = { items, meta: { nextCursor: null } };

describe("AdminMediaPage — a11y", () => {
  it("birden çok görsel içeren galeri yüklendikten sonra kritik/ciddi a11y ihlali içermez", async () => {
    vi.mocked(mediaApi.listMedia).mockResolvedValue(mediaPage);

    const { container } = render(<AdminMediaPage />);

    expect(await screen.findByText("kapak.png")).toBeInTheDocument();
    expect(screen.getByText("banner.jpg")).toBeInTheDocument();
    expect(screen.getByText("logo.svg")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("bir görsel seçilip toplu işlem çubuğu göründükten sonra da kritik/ciddi a11y ihlali içermez", async () => {
    vi.mocked(mediaApi.listMedia).mockResolvedValue(mediaPage);

    const user = userEvent.setup();
    const { container } = render(<AdminMediaPage />);

    await screen.findByText("kapak.png");
    await user.click(screen.getByRole("checkbox", { name: "banner.jpg öğesini seç" }));

    expect(await screen.findByText("1 seçili")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
