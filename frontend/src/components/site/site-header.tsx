"use client";

import Link from "next/link";
import { ChevronDown, ShoppingCart } from "lucide-react";
import { useCartOptional } from "@/context/cart-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NavigationItemDto, SitePage, SiteSettings } from "@/lib/api/types";

interface SiteHeaderProps {
  settings: SiteSettings;
  pages: SitePage[];
  /** Doluysa header menüsü bunu kullanır; boş/undefined ise `pages` + sabit "Blog" linkine düşer (geriye dönük uyumluluk). */
  navigationItems?: NavigationItemDto[];
  ctaLabel?: string | null;
  ctaHref?: string | null;
}

interface NavNode {
  id: string;
  href: string;
  label: string;
  children: { id: string; href: string; label: string }[];
}

/**
 * §10.10.1: `navigationItems` düz bir dizidir, ağaç `parentId` ile kurulur. Maksimum derinlik
 * 2 (kök + bir alt seviye) — backend zaten bunu garanti ediyor (kök olmayan bir öğe yalnızca
 * kök bir öğeyi işaret edebilir), bu yüzden tek geçişli bir gruplama yeterlidir.
 */
function buildNavTree(items: NavigationItemDto[]): NavNode[] {
  const roots = items.filter((item) => item.parentId === null).sort((a, b) => a.order - b.order);
  return roots.map((root) => ({
    id: root.id,
    href: root.href,
    label: root.label,
    children: items
      .filter((item) => item.parentId === root.id)
      .sort((a, b) => a.order - b.order)
      .map((child) => ({ id: child.id, href: child.href, label: child.label })),
  }));
}

export function SiteHeader({ settings, pages, navigationItems, ctaLabel, ctaHref }: SiteHeaderProps) {
  // `useCartOptional`: bu bileşen `admin/navigation/page.tsx`'teki canlı önizlemede
  // `CartProvider` OLMADAN da render edilir (admin layout'unda sepet KASTEN yok) — o durumda
  // rozet sessizce 0 gösterir, hata fırlatmaz.
  const itemCount = useCartOptional()?.itemCount ?? 0;
  const navTree: NavNode[] =
    navigationItems && navigationItems.length > 0
      ? buildNavTree(navigationItems)
      : [
          ...pages.map((page) => ({ id: `page-${page.id}`, href: `/${page.slug}`, label: page.title, children: [] })),
          { id: "fallback-blog", href: "/blog", label: "Blog", children: [] },
        ];

  const showCta = Boolean(ctaLabel && ctaHref);

  return (
    <header className="border-b border-border bg-surface/80 backdrop-blur">
      <nav
        className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6"
        aria-label="Site gezinme"
      >
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold text-foreground">
          {settings.logoUrl && (
            // Konteyner (`h-8 w-8 shrink-0 overflow-hidden`) + `object-contain`: logo görselinin
            // gerçek (intrinsic) boyutu/en-boy oranı ne olursa olsun sabit 32x32px kutuya
            // sığdırılmış gösterilir, asla taşmaz/büyümez. `shrink-0`: header dar bir viewport'ta
            // sıkışırsa flexbox'ın img'yi orantısızca küçültmesini engeller.
            <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded">
              {/* eslint-disable-next-line @next/next/no-img-element -- logo URL'si medya kütüphanesinden gelir, next/image remotePatterns henüz tanımlı değil */}
              <img src={settings.logoUrl} alt="" className="h-full w-full object-contain" />
            </span>
          )}
          {settings.siteName}
        </Link>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          {navTree.map((link) =>
            link.children.length > 0 ? (
              <DropdownMenu key={link.id}>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      className="flex items-center gap-1 text-foreground/70 outline-none hover:text-foreground focus-visible:text-foreground"
                    />
                  }
                >
                  {link.label}
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {link.children.map((child) => (
                    <DropdownMenuItem key={child.id} render={<Link href={child.href} />}>
                      {child.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Link key={link.id} href={link.href} className="text-foreground/70 hover:text-foreground">
                {link.label}
              </Link>
            )
          )}
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
