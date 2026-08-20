import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { PostEditor } from "@/components/admin/blog/post-editor";
import { BuilderCanvas } from "@/components/admin/page-builder/builder-canvas";
import { BlockList } from "@/components/admin/page-builder/block-list";
import { createBlock } from "@/lib/page-builder/registry";
import type { GalleryBlock, PageNode } from "@/lib/page-builder/types";
import type { Media } from "@/lib/api/types";

vi.mock("@/lib/api/media", () => ({
  listMedia: vi.fn(),
  uploadMedia: vi.fn(),
  updateMediaAltText: vi.fn(),
  // §10.11 Medya Kütüphanesi — Klasör Sistemi: `MediaPicker` açılışta `listMediaFolders`'ı da çeker.
  listMediaFolders: vi.fn(() => Promise.resolve([])),
}));

const mediaApi = await import("@/lib/api/media");

const axeOptions = { rules: { region: { enabled: false } } };

const sampleMedia: Media = {
  id: "media-a11y-1",
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

describe("İçerik editörü — a11y", () => {
  it("PostEditor (zengin metin düzenleyici araç çubuğu) kritik/ciddi a11y ihlali içermez", async () => {
    const { container } = render(<PostEditor content="<p>merhaba</p>" onChange={() => {}} />);

    // TipTap async mount olur; araç çubuğu düğmelerinden biri render olana kadar bekle.
    expect(await screen.findByLabelText("Kalın")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("BlockList (blok/düzen ekleme düğmeleri) kritik/ciddi a11y ihlali içermez", async () => {
    const { container } = render(
      <BlockList onAddLayout={() => {}} targetLabel="Sayfa (kök)" />
    );
    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("BuilderCanvas — her blok tipi (hero/text/image/gallery/cta/heading/button/icon-box/divider/video/accordion/tabs) birlikte render edildiğinde kritik/ciddi a11y ihlali içermez", async () => {
    const galleryBlock = createBlock("gallery") as GalleryBlock;
    galleryBlock.data.images = [{ url: "https://example.com/a.png", alt: "Örnek" }];

    const nodes: PageNode[] = [
      createBlock("hero"),
      createBlock("text"),
      createBlock("image"),
      galleryBlock,
      createBlock("cta"),
      createBlock("heading"),
      createBlock("button"),
      createBlock("icon-box"),
      createBlock("divider"),
      createBlock("video"),
      createBlock("accordion"),
      createBlock("tabs"),
    ];

    const { container } = render(
      <BuilderCanvas nodes={nodes} onChange={() => {}} selectedContainerId={null} onSelectContainer={() => {}} />
    );

    expect(await screen.findByLabelText("Kalın")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("BuilderCanvas — boş blok listesinde a11y ihlali içermez", async () => {
    const { container } = render(
      <BuilderCanvas nodes={[]} onChange={() => {}} selectedContainerId={null} onSelectContainer={() => {}} />
    );
    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  // §Faz 2 içerik editörü — zorunlu alt-metin dialoğu, "Vazgeç"/"Ekle" gibi ek etkileşimli
  // öğeler içerir (bkz. post-editor.tsx). Yalnızca araç çubuğunun a11y'sini kapsayan yukarıdaki
  // testten AYRI: dialog açıkken (Faz 2'nin asıl UI'ı) denetim yapılır.
  it("PostEditor — görsel alt-metin dialoğu açıkken kritik/ciddi a11y ihlali içermez", async () => {
    vi.mocked(mediaApi.listMedia).mockResolvedValue({ items: [sampleMedia], meta: { nextCursor: null } });

    const { container } = render(<PostEditor content="<p>merhaba</p>" onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText("Görsel ekle"));

    const item = await screen.findByLabelText(`${sampleMedia.filename} seç`);
    fireEvent.click(item);

    expect(await screen.findByText("Alt metin ekle")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  // Faz 5 — dolu (başlık hücreleri metinli) bir tablo içeriği a11y denetiminden geçmeli.
  // NOT: "Tablo ekle" araç çubuğu düğmesiyle YENİ eklenen bir tablo, kullanıcı henüz hiçbir
  // şey yazmadan başlık hücreleri (`<th>`) BOŞ gelir — bu, jest-axe'in `empty-table-header`
  // kuralını anında ihlal eder (bkz. görev raporu: BULUNDU AMA DÜZELTİLMEDİ, frontend-agent'a
  // yönlendirilmeli). Bu, editör içi GEÇİCİ bir taslak durumudur (yayınlanan/kaydedilen içerik
  // değil); burada gerçekçi/dolu bir tablo render'ının a11y'si doğrulanır.
  it("PostEditor — başlık hücreleri dolu bir tablo içeriğinde kritik/ciddi a11y ihlali içermez", async () => {
    const tableContent =
      '<table><thead><tr><th>Ad</th><th>Soyad</th></tr></thead><tbody><tr><td>Ayşe</td><td>Yılmaz</td></tr></tbody></table>';
    const { container } = render(<PostEditor content={tableContent} onChange={() => {}} />);

    await waitFor(() => {
      expect(container.querySelector("table")).toBeInTheDocument();
    });

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
