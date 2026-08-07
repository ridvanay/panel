"use client";

import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { useCartOptional } from "@/context/cart-context";
import type { NavigationItemDto, SitePage, SiteSettings } from "@/lib/api/types";

interface SiteHeaderProps {
  settings: SiteSettings;
  pages: SitePage[];
  /** Doluysa header menüsü bunu kullanır; boş/undefined ise `pages` + sabit "Blog" linkine düşer (geriye dönük uyumluluk). */
  navigationItems?: NavigationItemDto[];
  ctaLabel?: string | null;
  ctaHref?: string | null;
}

export function SiteHeader({ settings, pages, navigationItems, ctaLabel, ctaHref }: SiteHeaderProps) {
  // `useCartOptional`: bu bileşen `admin/navigation/page.tsx`'teki canlı önizlemede
  // `CartProvider` OLMADAN da render edilir (admin layout'unda sepet KASTEN yok) — o durumda
  // rozet sessizce 0 gösterir, hata fırlatmaz.
  const itemCount = useCartOptional()?.itemCount ?? 0;
  const navLinks =
    navigationItems && navigationItems.length > 0
      ? navigationItems.map((item) => ({ href: item.href, label: item.label }))
      : [...pages.map((page) => ({ href: `/${page.slug}`, label: page.title })), { href: "/blog", label: "Blog" }];

  const showCta = Boolean(ctaLabel && ctaHref);

  return (
    <header className="border-b border-border bg-surface/80 backdrop-blur">
      <nav
        className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6"
        aria-label="Site gezinme"
      >
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold text-foreground">
          {settings.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- logo URL'si medya kütüphanesinden gelir, next/image remotePatterns henüz tanımlı değil
            <img src={settings.logoUrl} alt="" className="h-8 w-8 rounded object-contain" />
          )}
          {settings.siteName}
        </Link>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          {navLinks.map((link) => (
            <Link key={`${link.href}-${link.label}`} href={link.href} className="text-foreground/70 hover:text-foreground">
              {link.label}
            </Link>
          ))}
          {showCta && (
            <Link
              href={ctaHref as string}
              className="rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/80"
            >
              {ctaLabel}
            </Link>
          )}
          <Link
            href="/cart"
            aria-label={`Sepet, ${itemCount} ürün`}
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-foreground/70 transition-colors hover:bg-surface-muted hover:text-foreground"
          >
            <ShoppingCart className="h-5 w-5" />
            {itemCount > 0 && (
              <span
                aria-hidden="true"
                className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
              >
                {itemCount > 99 ? "99+" : itemCount}
              </span>
            )}
          </Link>
        </div>
      </nav>
    </header>
  );
}
