import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PostEditor } from "@/components/admin/blog/post-editor";
import type { Media } from "@/lib/api/types";

// `handleInsertImage`/`handleMediaSelect` artık MediaPicker açıyor — önceki turda
// `window.prompt` kullanan implementasyonun yerini aldı (bkz. post-editor.tsx).
// Faz 2: seçim sonrası doğrudan eklemek yerine zorunlu alt-metin onay dialoğu açılır ve
// onaylandığında `updateMediaAltText` ile kalıcı hale getirilir.
vi.mock("@/lib/api/media", () => ({
  listMedia: vi.fn(),
  updateMediaAltText: vi.fn(),
  // §10.11 Medya Kütüphanesi — Klasör Sistemi: `MediaPicker` açılışta `listMediaFolders`'ı da çeker.
  listMediaFolders: vi.fn(() => Promise.resolve([])),
}));

const mediaApi = await import("@/lib/api/media");

const sampleMedia: Media = {
  id: "media-1",
  url: "https://example.com/uploads/photo.png",
  filename: "photo.png",
  mimeType: "image/png",
  sizeBytes: 1024,
  altText: null,
  width: null,
  height: null,
  folderId: null,
  createdAt: "2026-07-31T00:00:00.000Z",
};

const sampleMediaWithAlt: Media = {
  ...sampleMedia,
  id: "media-2",
  filename: "photo-with-alt.png",
  altText: "Önceden girilmiş açıklama",
};

describe("PostEditor — görsel ekleme MediaPicker entegrasyonu", () => {
  beforeEach(() => {
    vi.mocked(mediaApi.listMedia).mockReset();
    vi.mocked(mediaApi.updateMediaAltText).mockReset();
  });

  it("'Görsel ekle' tıklanınca window.prompt DEĞİL, MediaPicker modalı açılır", async () => {
    vi.mocked(mediaApi.listMedia).mockResolvedValue({ items: [], meta: { nextCursor: null } });
    const promptSpy = vi.spyOn(window, "prompt");

    render(<PostEditor content="<p>merhaba</p>" onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText("Görsel ekle"));

    expect(promptSpy).not.toHaveBeenCalled();
    expect(await screen.findByText("Görsel Seç")).toBeInTheDocument();
  });

  it("kütüphaneden bir görsel seçilince alt metin dialoğu açılır; boşken 'Ekle' devre dışıdır ve editöre eklenmez", async () => {
    vi.mocked(mediaApi.listMedia).mockResolvedValue({ items: [sampleMedia], meta: { nextCursor: null } });
    const handleChange = vi.fn();

    render(<PostEditor content="<p>merhaba</p>" onChange={handleChange} />);
    fireEvent.click(screen.getByLabelText("Görsel ekle"));

    const item = await screen.findByLabelText(`${sampleMedia.filename} seç`);
    fireEvent.click(item);

    // MediaPicker kapanmış, alt metin dialoğu açılmış olmalı.
    await waitFor(() => {
      expect(screen.queryByText("Görsel Seç")).not.toBeInTheDocument();
    });
    expect(await screen.findByText("Alt metin ekle")).toBeInTheDocument();

    const addButton = screen.getByRole("button", { name: "Ekle" });
    expect(addButton).toBeDisabled();
    expect(handleChange).not.toHaveBeenCalled();
    expect(mediaApi.updateMediaAltText).not.toHaveBeenCalled();
  });

  it("alt metin girilip onaylanınca updateMediaAltText çağrılır, görsel alt attribute'uyla editöre eklenir ve dialog kapanır", async () => {
    vi.mocked(mediaApi.listMedia).mockResolvedValue({ items: [sampleMedia], meta: { nextCursor: null } });
    vi.mocked(mediaApi.updateMediaAltText).mockResolvedValue({ ...sampleMedia, altText: "Ürün fotoğrafı" });
    const handleChange = vi.fn();
    const user = userEvent.setup();

    render(<PostEditor content="<p>merhaba</p>" onChange={handleChange} />);
    fireEvent.click(screen.getByLabelText("Görsel ekle"));

    const item = await screen.findByLabelText(`${sampleMedia.filename} seç`);
    fireEvent.click(item);

    const input = await screen.findByLabelText(/^Alt metin\*?$/);
    await user.type(input, "Ürün fotoğrafı");
    await user.click(screen.getByRole("button", { name: "Ekle" }));

    await waitFor(() => {
      expect(mediaApi.updateMediaAltText).toHaveBeenCalledWith(sampleMedia.id, "Ürün fotoğrafı");
    });
    await waitFor(() => {
      expect(handleChange).toHaveBeenCalledWith(expect.stringContaining(sampleMedia.url));
    });
    expect(handleChange).toHaveBeenCalledWith(expect.stringContaining('alt="Ürün fotoğrafı"'));
    await waitFor(() => {
      expect(screen.queryByText("Alt metin ekle")).not.toBeInTheDocument();
    });
  });

  it("daha önce alt metni olan bir görsel seçildiğinde giriş alanı ön dolu gelir", async () => {
    vi.mocked(mediaApi.listMedia).mockResolvedValue({ items: [sampleMediaWithAlt], meta: { nextCursor: null } });

    render(<PostEditor content="<p>merhaba</p>" onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText("Görsel ekle"));

    const item = await screen.findByLabelText(`${sampleMediaWithAlt.filename} seç`);
    fireEvent.click(item);

    const input = await screen.findByLabelText(/^Alt metin\*?$/);
    expect(input).toHaveValue(sampleMediaWithAlt.altText);
    expect(screen.getByRole("button", { name: "Ekle" })).not.toBeDisabled();
  });

  it("'Vazgeç' ile kapatılırsa görsel editöre eklenmez", async () => {
    vi.mocked(mediaApi.listMedia).mockResolvedValue({ items: [sampleMedia], meta: { nextCursor: null } });
    const handleChange = vi.fn();
    const user = userEvent.setup();

    render(<PostEditor content="<p>merhaba</p>" onChange={handleChange} />);
    fireEvent.click(screen.getByLabelText("Görsel ekle"));

    const item = await screen.findByLabelText(`${sampleMedia.filename} seç`);
    fireEvent.click(item);

    await screen.findByText("Alt metin ekle");
    await user.click(screen.getByRole("button", { name: "Vazgeç" }));

    await waitFor(() => {
      expect(screen.queryByText("Alt metin ekle")).not.toBeInTheDocument();
    });
    expect(handleChange).not.toHaveBeenCalled();
    expect(mediaApi.updateMediaAltText).not.toHaveBeenCalled();
  });
});
