import Link from "next/link";
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
        </div>
      </nav>
    </header>
  );
}
