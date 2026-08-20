import type { BlockChrome, ImageBlock } from "@/lib/page-builder/types";

export function ImageBlockView({ block }: { block: ImageBlock; chrome: BlockChrome }) {
  // `chrome` bu blokta davranışsal fark YARATMAZ — bugün de gutter'sız (edge-to-edge), yalnızca
  // arayüz tutarlılığı için `BlockRenderer`'ın diğer yaprak görünümleriyle AYNI imzayı taşır.
  // eslint-disable-next-line @next/next/no-img-element -- URL, medya kütüphanesinden gelecek, next/image remotePatterns henüz tanımlı değil
  return <img src={block.data.url} alt={block.data.alt} className="w-full" />;
}
