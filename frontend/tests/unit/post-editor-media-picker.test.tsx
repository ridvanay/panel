import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PostEditor } from "@/components/admin/blog/post-editor";
import type { Media } from "@/lib/api/types";

// `handleInsertImage`/`handleMediaSelect` artık MediaPicker açıyor — önceki turda
// `window.prompt` kullanan implementasyonun yerini aldı (bkz. post-editor.tsx).
vi.mock("@/lib/api/media", () => ({
  listMedia: vi.fn(),
}));

const mediaApi = await import("@/lib/api/media");

const sampleMedia: Media = {
  id: "media-1",
  url: "https://example.com/uploads/photo.png",
  filename: "photo.png",
  mimeType: "image/png",
  sizeBytes: 1024,
  createdAt: "2026-07-31T00:00:00.000Z",
};

describe("PostEditor — görsel ekleme MediaPicker entegrasyonu", () => {
  beforeEach(() => {
    vi.mocked(mediaApi.listMedia).mockReset();
  });

  it("'Görsel ekle' tıklanınca window.prompt DEĞİL, MediaPicker modalı açılır", async () => {
    vi.mocked(mediaApi.listMedia).mockResolvedValue({ items: [], meta: { nextCursor: null } });
    const promptSpy = vi.spyOn(window, "prompt");

    render(<PostEditor content="<p>merhaba</p>" onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText("Görsel ekle"));

    expect(promptSpy).not.toHaveBeenCalled();
    expect(await screen.findByText("Görsel Seç")).toBeInTheDocument();
  });

  it("kütüphaneden bir görsel seçilince editöre eklenir ve modal kapanır", async () => {
    vi.mocked(mediaApi.listMedia).mockResolvedValue({ items: [sampleMedia], meta: { nextCursor: null } });
    const handleChange = vi.fn();

    render(<PostEditor content="<p>merhaba</p>" onChange={handleChange} />);
    fireEvent.click(screen.getByLabelText("Görsel ekle"));

    const item = await screen.findByLabelText(`${sampleMedia.filename} seç`);
    fireEvent.click(item);

    await waitFor(() => {
      expect(handleChange).toHaveBeenCalledWith(expect.stringContaining(sampleMedia.url));
    });
    await waitFor(() => {
      expect(screen.queryByText("Görsel Seç")).not.toBeInTheDocument();
    });
  });
});
