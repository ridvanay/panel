import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { PortfolioItem } from "@/lib/api/types";
import { withLocalePrefix } from "@/lib/i18n/site-path";

interface PortfolioCardProps {
  item: PortfolioItem;
  activeLocaleCode?: string;
  defaultLocaleCode?: string;
}

/** `ProductCard` ile BİREBİR aynı görsel patern (bkz. site/product-card.tsx), fiyat YERİNE müşteri adı gösterilir. */
export function PortfolioCard({ item, activeLocaleCode, defaultLocaleCode }: PortfolioCardProps) {
  const href = activeLocaleCode
    ? withLocalePrefix(`/portfolio/${item.slug}`, activeLocaleCode, defaultLocaleCode ?? activeLocaleCode)
    : `/portfolio/${item.slug}`;

  return (
    <Link
      href={href}
      className="group block overflow-hidden rounded-lg border border-border shadow-sm transition-shadow transition-colors hover:bg-surface-muted hover:shadow-md"
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-surface-muted">
        {item.coverMedia && (
          // eslint-disable-next-line @next/next/no-img-element -- kapak URL'si medya kütüphanesinden gelir, next/image remotePatterns henüz tanımlı değil
          <img
            src={item.coverMedia.url}
            alt={item.coverMedia.altText ?? ""}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        )}
        <span
          aria-hidden="true"
          className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-[var(--site-surface)]/90 text-[var(--site-text)]"
        >
          <ArrowUpRight className="size-5" />
        </span>
      </div>
      <div className="p-4">
        <h3 className="text-lg font-semibold text-foreground transition-colors group-hover:text-[var(--site-primary)]">
          {item.title}
        </h3>
        {item.clientName && <p className="mt-1 text-sm text-foreground/60">{item.clientName}</p>}
        {item.summary && <p className="mt-1 line-clamp-2 text-sm text-foreground/60">{item.summary}</p>}
      </div>
    </Link>
  );
}
