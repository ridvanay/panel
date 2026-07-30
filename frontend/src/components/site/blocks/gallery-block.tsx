import type { GalleryBlock } from "@/lib/page-builder/types";

export function GalleryBlockView({ block }: { block: GalleryBlock }) {
  return (
    <div className="grid grid-cols-2 gap-2 px-4 py-8 sm:px-6 md:grid-cols-3">
      {block.data.images.map((image, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- URL, medya kütüphanesinden gelecek, next/image remotePatterns henüz tanımlı değil
        <img key={i} src={image.url} alt={image.alt} className="aspect-square w-full object-cover" />
      ))}
    </div>
  );
}
