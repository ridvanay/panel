import Link from "next/link";
import type { PortfolioItem } from "@/lib/api/types";

interface PortfolioCardProps {
  item: PortfolioItem;
}

/** `ProductCard` ile BİREBİR aynı görsel patern (bkz. site/product-card.tsx), fiyat YERİNE müşteri adı gösterilir. */
export function PortfolioCard({ item }: PortfolioCardProps) {
  return (
    <Link
      href={`/portfolio/${item.slug}`}
      className="block overflow-hidden rounded-lg border border-border transition-colors hover:bg-surface-muted"
    >
      <div className="relative aspect-square w-full bg-surface-muted">
        {item.coverMedia && (
          // eslint-disable-next-line @next/next/no-img-element -- kapak URL'si medya kütüphanesinden gelir, next/image remotePatterns henüz tanımlı değil
          <img
            src={item.coverMedia.url}
            alt={item.coverMedia.altText ?? ""}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        )}
      </div>
      <div className="p-4">
        <h3 className="text-lg font-semibold text-foreground">{item.title}</h3>
        {item.clientName && <p className="mt-1 text-sm text-foreground/60">{item.clientName}</p>}
        {item.summary && <p className="mt-1 line-clamp-2 text-sm text-foreground/60">{item.summary}</p>}
      </div>
    </Link>
  );
}
