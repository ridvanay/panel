import { Node, mergeAttributes } from "@tiptap/core";

/**
 * §10.15 — Blog TipTap editörünün Galeri node'u. Serileştirme KESİN HTML iskeletiyle
 * BİREBİR: `<div class="blog-gallery blog-gallery--{layout}"><figure
 * class="blog-gallery__item"><img src="…" alt="…" loading="lazy"></figure>…</div>`
 * (bkz. ARCHITECTURE.md §10.15.2 + shared-types.ts). Sınıf adları KONTRATIN PARÇASIDIR —
 * `backend/src/lib/html-sanitize.ts` allow-list'i (`img`: src/alt/loading, `*`: id/class)
 * ve bu node'un `parseHTML`'i buna bağlıdır, DEĞİŞTİRİLEMEZ.
 *
 * Medya id'leri HTML'e YAZILMAZ (`data-*` sanitizer tarafından sessizce silinir — §10.15.2
 * "doğrulanmış tuzak"). Galerinin kimliği URL'lerdir; `items[].src`/`alt` DOM'dan
 * `parseHTML` ile geri okunur (round-trip: kaydet → yeniden yükle → editör aynı galeriyi
 * gösterir).
 */

export interface BlogGalleryItem {
  src: string;
  alt: string;
}

/** v1'de yalnızca "grid" — carousel REDDEDİLDİ (§10.15.2), alan ileriye dönük tutuldu. */
export type BlogGalleryLayout = "grid";

export interface BlogGalleryAttrs {
  items: BlogGalleryItem[];
  layout: BlogGalleryLayout;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blogGallery: {
      /** Boş galeri (0 görsel) serileştirilmez — çağıran taraf en az 1 öğe göndermelidir. */
      insertBlogGallery: (attrs: BlogGalleryAttrs) => ReturnType;
    };
  }
}

function parseItemsFromElement(element: HTMLElement): BlogGalleryItem[] {
  const figures = Array.from(element.querySelectorAll(":scope > figure.blog-gallery__item"));
  const items: BlogGalleryItem[] = [];
  for (const figure of figures) {
    const img = figure.querySelector("img");
    if (!img) continue;
    items.push({ src: img.getAttribute("src") ?? "", alt: img.getAttribute("alt") ?? "" });
  }
  return items;
}

export const BlogGallery = Node.create({
  name: "blogGallery",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      // Bellekte tutulan node attrs — HTML'e AYRI bir öznitelik olarak YAZILMAZ (`renderHTML`
      // burada boş döner), `renderHTML(node)` bunları `<figure><img>` çocukları olarak basar.
      items: {
        default: [] as BlogGalleryItem[],
        parseHTML: (element) => parseItemsFromElement(element as HTMLElement),
        renderHTML: () => ({}),
      },
      layout: {
        default: "grid" as BlogGalleryLayout,
        parseHTML: () => "grid" as BlogGalleryLayout,
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div.blog-gallery" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const items = (node.attrs.items ?? []) as BlogGalleryItem[];
    const layout = (node.attrs.layout ?? "grid") as BlogGalleryLayout;
    const attrs = mergeAttributes(HTMLAttributes, {
      class: `blog-gallery blog-gallery--${layout}`,
      role: "group",
      "aria-label": `Galeri (${items.length} görsel)`,
    });
    const children = items.map((item) => [
      "figure",
      { class: "blog-gallery__item" },
      ["img", { src: item.src, alt: item.alt, loading: "lazy" }],
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ProseMirror'ın iç içe dizi tabanlı DOMOutputSpec'i tip düzeyinde tam ifade edilemiyor.
    return ["div", attrs, ...children] as any;
  },

  addCommands() {
    return {
      insertBlogGallery:
        (attrs: BlogGalleryAttrs) =>
        ({ commands }) => {
          // §10.15.2 — boş galeri (0 görsel) serileştirilmez, node hiç eklenmez.
          if (!attrs.items || attrs.items.length === 0) return false;
          return commands.insertContent({
            type: this.name,
            attrs: { items: attrs.items, layout: attrs.layout ?? "grid" },
          });
        },
    };
  },
});
