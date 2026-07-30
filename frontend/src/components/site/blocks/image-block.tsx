import type { ImageBlock } from "@/lib/page-builder/types";

export function ImageBlockView({ block }: { block: ImageBlock }) {
  // eslint-disable-next-line @next/next/no-img-element -- URL, medya kütüphanesinden gelecek, next/image remotePatterns henüz tanımlı değil
  return <img src={block.data.url} alt={block.data.alt} className="w-full" />;
}
