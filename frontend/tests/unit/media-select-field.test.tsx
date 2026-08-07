import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { MediaSelectField } from "@/components/admin/media/media-select-field";
import type { Media } from "@/lib/api/types";

vi.mock("@/lib/api/media", () => ({ listMedia: vi.fn(), uploadMedia: vi.fn() }));

const mediaApi = await import("@/lib/api/media");

const axeOptions = { rules: { region: { enabled: false } } };

const sampleMedia: Media = {
  id: "media-1",
  url: "https://example.com/kapak.png",
  filename: "kapak.png",
  mimeType: "image/png",
  sizeBytes: 1024,
  altText: "Ürün kapak görseli",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("MediaSelectField", () => {
  it("hiçbir görsel seçili değilken önizleme/alt-metin göstermez, seçim yapılınca TAM `Media` nesnesini döner", async () => {
    vi.mocked(mediaApi.listMedia).mockResolvedValue({ items: [sampleMedia], meta: { nextCursor: null } });
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<MediaSelectField id="coverMedia" label="Kapak görseli" value={null} onChange={onChange} />);

    expect(screen.queryByText(/Alt metin/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Kütüphaneden Seç" }));
    await user.click(await screen.findByLabelText("kapak.png seç"));

    // Yalnızca URL değil, id + altText dahil TÜM `Media` nesnesi geri döner.
    expect(onChange).toHaveBeenCalledWith(sampleMedia);
  });

  it("seçili bir görsel varken alt-metnini SALT-OKUNUR gösterir ve 'Kaldır' ile temizlenebilir", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<MediaSelectField id="coverMedia" label="Kapak görseli" value={sampleMedia} onChange={onChange} />);

    expect(screen.getByText(/Ürün kapak görseli/)).toBeInTheDocument();
    // Alt-metin bir input/textarea DEĞİL, salt metin olarak gösterilir — değiştirilemez.
    expect(screen.queryByRole("textbox", { name: /alt/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Görseli kaldır" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("altText tanımlanmamış bir görsel için bunu belirtir", () => {
    render(
      <MediaSelectField id="coverMedia" label="Kapak görseli" value={{ ...sampleMedia, altText: null }} onChange={vi.fn()} />
    );

    expect(screen.getByText("Tanımlanmamış")).toBeInTheDocument();
  });

  it("seçili görsel varken kritik/ciddi a11y ihlali içermez", async () => {
    const { container } = render(
      <MediaSelectField id="coverMedia" label="Kapak görseli" value={sampleMedia} onChange={vi.fn()} required />
    );

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
