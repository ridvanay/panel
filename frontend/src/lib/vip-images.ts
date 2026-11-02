/**
 * Paket AJ (AJ-3) — VIP sayfası görselleri, mevcut CMS/medya altyapısıyla yönetilir (yeni model YOK).
 * Panelde `vip-accommodation-transfer` slug'lı bir sayfa oluşturulup içine Galeri (ya da Görsel) blokları
 * konur; görseller sırayla 6 karta (transfer, konaklama, koordinatör, şehir içi, refakatçi, iyileşme) bağlanır.
 * Sayfa kendi yolunu (statik rota) gölgelediği için ayrıca ziyaretçiye gösterilmez.
 */
export type VipImage = { url: string; alt: string };

export const VIP_IMAGE_SLOTS = 6;
export const VIP_IMAGE_PAGE_SLUG = "vip-accommodation-transfer";

function isSafeImageUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const value = url.trim();
  if (!value) return false;
  if (value.startsWith("//")) return false;
  return value.startsWith("/") || /^https?:\/\//i.test(value);
}

function collect(node: unknown, out: VipImage[], depth: number): void {
  if (out.length >= VIP_IMAGE_SLOTS || depth > 6 || !node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out, depth + 1);
    return;
  }
  const block = node as { type?: unknown; data?: unknown; children?: unknown };
  const data = (block.data ?? {}) as { url?: unknown; alt?: unknown; images?: unknown };
  if (block.type === "gallery" && Array.isArray(data.images)) {
    for (const image of data.images as { url?: unknown; alt?: unknown }[]) {
      if (out.length >= VIP_IMAGE_SLOTS) break;
      if (isSafeImageUrl(image?.url)) out.push({ url: image.url.trim(), alt: typeof image.alt === "string" ? image.alt : "" });
    }
  } else if (block.type === "image" && isSafeImageUrl(data.url)) {
    out.push({ url: data.url.trim(), alt: typeof data.alt === "string" ? data.alt : "" });
  }
  if (block.children) collect(block.children, out, depth + 1);
}

/** Blok ağacından en çok 6 görseli, belge sırasıyla çıkarır; güvensiz URL'ler (`javascript:`, `//host`) atlanır. */
export function extractVipImages(blocks: unknown): VipImage[] {
  const out: VipImage[] = [];
  collect(blocks, out, 0);
  return out;
}
