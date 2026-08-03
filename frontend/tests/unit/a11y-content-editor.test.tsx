import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { PostEditor } from "@/components/admin/blog/post-editor";
import { BuilderCanvas } from "@/components/admin/page-builder/builder-canvas";
import { BlockList } from "@/components/admin/page-builder/block-list";
import { createBlock } from "@/lib/page-builder/registry";
import type { Block, GalleryBlock } from "@/lib/page-builder/types";

vi.mock("@/lib/api/media", () => ({ listMedia: vi.fn(), uploadMedia: vi.fn() }));

const axeOptions = { rules: { region: { enabled: false } } };

describe("İçerik editörü — a11y", () => {
  it("PostEditor (zengin metin düzenleyici araç çubuğu) kritik/ciddi a11y ihlali içermez", async () => {
    const { container } = render(<PostEditor content="<p>merhaba</p>" onChange={() => {}} />);

    // TipTap async mount olur; araç çubuğu düğmelerinden biri render olana kadar bekle.
    expect(await screen.findByLabelText("Kalın")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("BlockList (blok ekleme düğmeleri) kritik/ciddi a11y ihlali içermez", async () => {
    const { container } = render(<BlockList onAdd={() => {}} />);
    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("BuilderCanvas — her blok tipi (hero/text/image/gallery/cta) birlikte render edildiğinde kritik/ciddi a11y ihlali içermez", async () => {
    const galleryBlock = createBlock("gallery") as GalleryBlock;
    galleryBlock.data.images = [{ url: "https://example.com/a.png", alt: "Örnek" }];

    const blocks: Block[] = [createBlock("hero"), createBlock("text"), createBlock("image"), galleryBlock, createBlock("cta")];

    const { container } = render(<BuilderCanvas blocks={blocks} onChange={() => {}} />);

    expect(await screen.findByLabelText("Kalın")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("BuilderCanvas — boş blok listesinde a11y ihlali içermez", async () => {
    const { container } = render(<BuilderCanvas blocks={[]} onChange={() => {}} />);
    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
