import Link from "next/link";
import type { SitePage, SiteSettings } from "@/lib/api/types";

interface SiteHeaderProps {
  settings: SiteSettings;
  pages: SitePage[];
}

export function SiteHeader({ settings, pages }: SiteHeaderProps) {
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
          {pages.map((page) => (
            <Link key={page.id} href={`/${page.slug}`} className="text-foreground/70 hover:text-foreground">
              {page.title}
            </Link>
          ))}
          <Link href="/blog" className="text-foreground/70 hover:text-foreground">
            Blog
          </Link>
        </div>
      </nav>
    </header>
  );
}
