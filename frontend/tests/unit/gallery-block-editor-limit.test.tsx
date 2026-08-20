import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GalleryBlockEditor } from "@/components/admin/page-builder/blocks/gallery-block";
import { GALLERY_MAX_IMAGES, type GalleryBlock } from "@/lib/page-builder/types";

/**
 * qa-agent — 30 görsel limiti (`GALLERY_MAX_IMAGES`) PRAGMATİK bir kararla e2e/Playwright
 * SEVİYESİNDE DEĞİL, burada component seviyesinde test edilir: gerçekten 30 dosya
 * yükleyip/seçip bir Playwright suite'ini yavaşlatmak/kırılganlaştırmak yerine, `GalleryBlockEditor`'a
 * doğrudan 30 (veya limite yakın) öğelik bir `images` state'i verilip "Görsel Ekle" butonunun
 * disabled davranışı ve `MediaPicker`'a geçirilen `maxSelection`'ın doğru hesaplandığı doğrulanır
 * (bkz. `frontend/tests/e2e/admin-page-builder-gallery.spec.ts` dosya başlığındaki AYNI gerekçe).
 * Desen: `frontend/tests/unit/media-picker-multiple.test.tsx` ile BİREBİR aynı (mock `@/lib/api/media`).
 */
vi.mock("@/lib/api/media", () => ({
  listMedia: vi.fn(),
  uploadMedia: vi.fn(),
  listMediaFolders: vi.fn(() => Promise.resolve([])),
}));

const mediaApi = await import("@/lib/api/media");

function makeImages(count: number): { url: string; alt: string }[] {
  return Array.from({ length: count }, (_, i) => ({ url: `https://example.com/img-${i}.png`, alt: `Görsel ${i}` }));
}

function makeBlock(imageCount: number): GalleryBlock {
  return { id: "b1", type: "gallery", data: { images: makeImages(imageCount), layout: "grid" } };
}

describe("GalleryBlockEditor — GALLERY_MAX_IMAGES (30) limiti (component-seviyesinde, e2e YERİNE)", () => {
  beforeEach(() => {
    vi.mocked(mediaApi.listMedia).mockReset();
    vi.mocked(mediaApi.listMedia).mockResolvedValue({ items: [], meta: { nextCursor: null } });
  });

  it("limite ulaşılınca (30/30) 'Görsel Ekle' butonu disabled olur ve uyarı title'ı gösterir", () => {
    render(<GalleryBlockEditor block={makeBlock(GALLERY_MAX_IMAGES)} onChange={vi.fn()} />);

    expect(screen.getByText(`${GALLERY_MAX_IMAGES} / ${GALLERY_MAX_IMAGES}`)).toBeInTheDocument();
    const addButton = screen.getByRole("button", { name: "Görsel Ekle" });
    expect(addButton).toBeDisabled();
    expect(addButton).toHaveAttribute("title", "En fazla 30 görsel eklenebilir.");
  });

  it("limitin altındayken (28/30) buton enabled kalır ve MediaPicker'ın maxSelection'ı kalan boşluğa (2) eşitlenir", async () => {
    const user = userEvent.setup();
    render(<GalleryBlockEditor block={makeBlock(GALLERY_MAX_IMAGES - 2)} onChange={vi.fn()} />);

    const addButton = screen.getByRole("button", { name: "Görsel Ekle" });
    expect(addButton).not.toBeDisabled();

    await user.click(addButton);

    // `MediaPicker`'ın kendi açıklaması `maxSelection`'ı yansıtır (bkz. `media-picker.tsx`
    // `Kütüphaneden birden çok görsel seçin (en fazla ${maxSelection})`) — 30 - 28 = 2.
    expect(await screen.findByText(/en fazla 2\)/)).toBeInTheDocument();
  });

  it("limite yakınken (25/30, nearLimit eşiği) sayaç uyarı stiliyle (text-warning) render edilir", () => {
    render(<GalleryBlockEditor block={makeBlock(GALLERY_MAX_IMAGES - 5)} onChange={vi.fn()} />);

    const counter = screen.getByText(`${GALLERY_MAX_IMAGES - 5} / ${GALLERY_MAX_IMAGES}`);
    expect(counter).toHaveClass("text-warning");
    expect(screen.getByRole("button", { name: "Görsel Ekle" })).not.toBeDisabled();
  });

  it("limitten uzakken (10/30) sayaç uyarı stiline SAHİP DEĞİLDİR", () => {
    render(<GalleryBlockEditor block={makeBlock(10)} onChange={vi.fn()} />);

    const counter = screen.getByText(`10 / ${GALLERY_MAX_IMAGES}`);
    expect(counter).not.toHaveClass("text-warning");
  });
});
