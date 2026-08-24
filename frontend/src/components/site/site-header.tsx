"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Heart, Receipt, ShoppingCart, User as UserIcon } from "lucide-react";
import { useCartOptional } from "@/context/cart-context";
import { useAuthOptional } from "@/context/auth-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LanguageSwitcher } from "@/components/site/language-switcher";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import type { Locale, NavigationItemDto, SiteButtonStyle, SitePage, SiteSettings } from "@/lib/api/types";
import { DEFAULT_HEADER_LOGO_HEIGHT } from "@/lib/site-settings/logo";
import { cn } from "@/lib/utils";

interface SiteHeaderProps {
  settings: SiteSettings;
  pages: SitePage[];
  /** Doluysa header menüsü bunu kullanır; boş/undefined ise `pages` + sabit "Blog" linkine düşer (geriye dönük uyumluluk). */
  navigationItems?: NavigationItemDto[];
  ctaLabel?: string | null;
  ctaHref?: string | null;
  /** `.claude/architect-scope-theme-typography.md` — verilmezse mevcut SOLID görünüme düşer (geriye dönük uyumluluk). */
  buttonStyle?: SiteButtonStyle;
  /** §9 frontend-agent madde 4 — verilmezse dil değiştirici gösterilmez (ör. admin canlı önizleme). */
  locales?: Locale[];
  activeLocale?: Locale;
  /**
   * §customer-portal §4.4 — `false` iken sepet ikonu, favori ikonu ve hesap menüsündeki
   * "Siparişlerim" öğesi render EDİLMEZ. Verilmezse `true` kabul edilir (geriye dönük
   * uyumluluk — admin canlı önizleme/unit testler bu prop'u vermez).
   */
  productsModuleEnabled?: boolean;
}

/**
 * design-notes-theme-typography.md §3.2 — `buttonStyle` CSS custom property DEĞİL, yapısal bir
 * Tailwind sınıf varyantı. Köşe yuvarlaklığı her üçünde de ortak `rounded-[var(--site-radius)]`.
 */
const SITE_BUTTON_STYLE_CLASSES: Record<SiteButtonStyle, string> = {
  SOLID: "bg-[var(--site-button)] text-[var(--site-button-text)]",
  OUTLINE: "border-2 border-[var(--site-button)] text-[var(--site-button)] bg-transparent",
  SOFT: "bg-[var(--site-button)]/10 text-[var(--site-button)]",
};

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

export function SiteHeader({
  settings,
  pages,
  navigationItems,
  ctaLabel,
  ctaHref,
  buttonStyle = "SOLID",
  locales,
  activeLocale,
  productsModuleEnabled = true,
}: SiteHeaderProps) {
  // `useCartOptional`: bu bileşen `admin/navigation/page.tsx`'teki canlı önizlemede
  // `CartProvider` OLMADAN da render edilir (admin layout'unda sepet KASTEN yok) — o durumda
  // rozet sessizce 0 gösterir, hata fırlatmaz.
  const itemCount = useCartOptional()?.itemCount ?? 0;
  // `useAuthOptional`: `useCartOptional` ile AYNI gerekçe — bu bileşen admin canlı önizlemesinde
  // ve bazı unit testlerde `AuthProvider` OLMADAN render edilir; o durumda "giriş yapılmamış"
  // gibi davranır (hesap widget'ı "Giriş Yap" gösterir), hata FIRLATMAZ.
  const auth = useAuthOptional();
  const status = auth?.status ?? "unauthenticated";
  const user = auth?.user ?? null;
  const pathname = usePathname();
  const navTree: NavNode[] =
    navigationItems && navigationItems.length > 0
      ? buildNavTree(navigationItems)
      : [
          ...pages.map((page) => ({ id: `page-${page.id}`, href: `/${page.slug}`, label: page.title, children: [] })),
          { id: "fallback-blog", href: "/blog", label: "Blog", children: [] },
        ];

  const showCta = Boolean(ctaLabel && ctaHref);
  const defaultLocaleCode = locales?.find((l) => l.isDefault)?.code ?? activeLocale?.code ?? "tr";
  const localize = (path: string) =>
    activeLocale ? withLocalePrefix(path, activeLocale.code, defaultLocaleCode) : path;

  return (
    <header className="border-b border-border bg-surface/80 backdrop-blur">
      <nav
        className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6"
        aria-label="Site gezinme"
      >
        <Link href={localize("/")} className="flex items-center gap-2 text-lg font-semibold text-foreground">
          {settings.logoUrl ? (
            // Sabit KARE kutu modeli TERK EDİLDİ: logo artık kendi doğal en-boy oranını korur.
            // Render yüksekliği `headerLogoHeight` (varsayılan `DEFAULT_HEADER_LOGO_HEIGHT`) ile
            // belirlenir, genişlik `w-auto` ile serbest bırakılır; `headerLogoMaxWidth` doluysa
            // bir taşma tavanı olarak uygulanır. `shrink-0`: header dar bir viewport'ta sıkışırsa
            // flexbox'ın img'yi orantısızca küçültmesini engeller. Logo varken site adı metni
            // DOM'dan kaldırılır — img'nin `alt`'ı link'in tek erişilebilir adı kaynağıdır.
            <span className="flex shrink-0 items-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- logo URL'si medya kütüphanesinden gelir, next/image remotePatterns henüz tanımlı değil */}
              <img
                src={settings.logoUrl}
                alt={settings.siteName?.trim() || "Site"}
                className="block w-auto object-contain"
                style={{
                  height: `${settings.headerLogoHeight ?? DEFAULT_HEADER_LOGO_HEIGHT}px`,
                  ...(settings.headerLogoMaxWidth ? { maxWidth: `${settings.headerLogoMaxWidth}px` } : {}),
                }}
              />
            </span>
          ) : (
            <span>{settings.siteName?.trim() || "Site"}</span>
          )}
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
                    <DropdownMenuItem key={child.id} render={<Link href={localize(child.href)} />}>
                      {child.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Link key={link.id} href={localize(link.href)} className="text-foreground/70 hover:text-foreground">
                {link.label}
              </Link>
            )
          )}
          {showCta && (
            // §10.12.4 — `--site-button`/`--site-button-text` (`.site-scope` altında satır-içi
            // yazılır, bkz. globals.css `.site-scope` fallback bloğu). Admin'in `--primary`
            // token'ından KASITLI olarak bağımsız. `buttonStyle` yapısal bir sınıf varyantıdır
            // (design-notes-theme-typography.md §3.2) — CSS custom property DEĞİLDİR.
            <Link
              href={localize(ctaHref as string)}
              className={cn(
                "rounded-[var(--site-radius)] px-3.5 py-1.5 text-sm font-medium transition-all duration-300 hover:opacity-85",
                SITE_BUTTON_STYLE_CLASSES[buttonStyle]
              )}
            >
              {ctaLabel}
            </Link>
          )}
          {locales && activeLocale && <LanguageSwitcher locales={locales} activeLocale={activeLocale} />}

          {/* §10.21 §8.3 — `/hesabim` HERKESE (5 rol) açık. `/hesabim/siparislerim` bağlantısı
              `products` modülü açıkken gösterilir (SUNUM kararı, yetki kararı DEĞİL —
              `role === "CUSTOMER"` koşulu §10.21.7 gereği KALDIRILDI, bkz.
              `.claude/architect-scope-customer-portal.md` §4.4). */}
          {status === "authenticated" && user ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label={`Hesabım, ${user.name}`}
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-foreground/70 outline-none transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:text-foreground"
                  />
                }
              >
                <UserIcon className="h-4 w-4" aria-hidden="true" />
                <span className="hidden max-w-[8rem] truncate sm:inline">{user.name}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem render={<Link href={localize("/hesabim")} />}>
                  <UserIcon className="h-4 w-4" aria-hidden="true" />
                  Hesabım
                </DropdownMenuItem>
                {productsModuleEnabled && (
                  <DropdownMenuItem render={<Link href={localize("/hesabim/siparislerim")} />}>
                    <Receipt className="h-4 w-4" aria-hidden="true" />
                    Siparişlerim
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link
              href={`/login?next=${encodeURIComponent(pathname)}`}
              aria-label="Giriş yap"
              className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-foreground/70 transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              <UserIcon className="h-4.5 w-4.5" aria-hidden="true" />
              <span className="hidden sm:inline">Giriş Yap</span>
            </Link>
          )}

          {/* design-notes-customer-portal.md §6 — rozet (adet sayacı) BİLEREK yok; favori adedi
              işlem hızını etkilemez. */}
          {productsModuleEnabled && status === "authenticated" && (
            <Link
              href={localize("/hesabim/favorilerim")}
              aria-label="Favorilerim"
              className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-foreground/70 transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              <Heart className="h-5 w-5" />
            </Link>
          )}

          {productsModuleEnabled && (
            <Link
              href={localize("/cart")}
              aria-label={`Sepet, ${itemCount} ürün`}
              className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-foreground/70 transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              <ShoppingCart className="h-5 w-5" />
              {itemCount > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--site-button)] px-1 text-[10px] font-semibold text-[var(--site-button-text)]"
                >
                  {itemCount > 99 ? "99+" : itemCount}
                </span>
              )}
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
