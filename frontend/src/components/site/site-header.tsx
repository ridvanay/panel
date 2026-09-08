"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Heart, Menu, Receipt, ShoppingCart, User as UserIcon } from "lucide-react";
import { useCartOptional } from "@/context/cart-context";
import { useAuthOptional } from "@/context/auth-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion";
import { LanguageSwitcher } from "@/components/site/language-switcher";
import { HeaderSearch } from "@/components/site/header-search";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { NAVIGATION_MAX_DEPTH } from "@/lib/navigation-constants";
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
  /**
   * design-notes-header-colors.md §3 / görev tanımı GÖREV A — `SiteAppearance.stickyHeaderEnabled`.
   * `false` (varsayılan) iken header eskisi gibi STATİK kalır (position sticky YOK, scroll mantığı
   * hiç çalışmaz) — geriye dönük uyumluluk. Verilmezse `false` kabul edilir (admin canlı
   * önizlemeleri — `admin/appearance` ve `admin/navigation` — bu prop'u KASITLI olarak vermez,
   * önizleme kutuları sabit yükseklikte statik, gerçek sayfa scroll'u yok — bilinen sınırlama).
   */
  stickyHeaderEnabled?: boolean;
  /**
   * design-notes-header-colors.md §3 — yapışkan (sticky) durumdayken backdrop-blur uygulanır mı.
   * Varsayılan `true` (`buttonStyle = "SOLID"` paterniyle AYNI geriye-dönük-uyumlu varsayılan).
   * İdle (kaydırılmamış) durumda blur KOŞULSUZ kalır, bu prop'tan ETKİLENMEZ.
   */
  headerStickyBlurEnabled?: boolean;
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

/** §architect-scope-navigation-deep-nesting.md §4 — özyinelemeli (4 seviyeye kadar) ağaç düğümü. */
interface NavNode {
  id: string;
  href: string;
  label: string;
  children: NavNode[];
}

/**
 * §10.10.1/§10.10.3: `navigationItems` düz bir dizidir, ağaç `parentId` ile kurulur. Derinlik
 * `NAVIGATION_MAX_DEPTH` (0-tabanlı, kök = 0) ile sınırlıdır — backend bunu yazma anında
 * doğrular, ancak elle-müdahale edilmiş/kısmi restore edilmiş DB verisi (döngü, aşırı derinlik)
 * teoride sızabilir; bu yüzden burada da savunma amaçlı bir derinlik kesme uygulanır.
 *
 * İki geçişli `parentId -> children[]` haritası O(n)'dir. Ebeveyni (parentId'si) dizide
 * BULUNAMAYAN bir öğe (orphan) sessizce ATLANIR — bu yalnızca o öğeyi düşürür, tüm ağacı değil.
 */
function buildNavTree(items: NavigationItemDto[]): NavNode[] {
  const itemById = new Map<string, NavigationItemDto>();
  for (const item of items) {
    itemById.set(item.id, item);
  }

  const childrenByParentId = new Map<string, NavigationItemDto[]>();
  for (const item of items) {
    if (item.parentId === null) continue;
    if (!itemById.has(item.parentId)) continue; // orphan: ebeveyn dizide yok, öğe atlanır
    const siblings = childrenByParentId.get(item.parentId);
    if (siblings) {
      siblings.push(item);
    } else {
      childrenByParentId.set(item.parentId, [item]);
    }
  }

  // `depth` kesme: hem bozuk/döngüsel `parentId` verisine karşı savunma hem de ürün politikası
  // olan `NAVIGATION_MAX_DEPTH`'in ağaç kurma aşamasında da uygulanması içindir (render katmanı
  // AYRICA kendi kesmesini uygular — çift savunma kasıtlıdır, bkz. `NavMenuItems`).
  function toNode(item: NavigationItemDto, depth: number): NavNode {
    const rawChildren = depth >= NAVIGATION_MAX_DEPTH ? [] : (childrenByParentId.get(item.id) ?? []);
    const children = rawChildren
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((child) => toNode(child, depth + 1));
    return { id: item.id, href: item.href, label: item.label, children };
  }

  return items
    .filter((item) => item.parentId === null)
    .sort((a, b) => a.order - b.order)
    .map((root) => toNode(root, 0));
}

/** Sondaki `/`'i kaldırır (kök `/` hariç) — `withLocalePrefix`'in prefixli kök yol için ürettiği
 * `/en/` gibi bir değer ile `usePathname()`'in döndürdüğü `/en` arasındaki farkı normalize eder. */
function normalizeNavPath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

/**
 * design-notes-header-colors.md §3 "Aktif sayfa durumu" — kök `/` için TAM eşleşme, alt sayfalar
 * için `startsWith` (bir sonraki path segmentinin sınırında, `/products` linkinin `/products-eski`
 * gibi alakasız bir yolu yanlışlıkla "aktif" işaretlememesi için `/`'lı sınır kontrolü yapılır).
 */
function isNavLinkActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  const normalizedPathname = normalizeNavPath(pathname);
  const normalizedHref = normalizeNavPath(href);
  if (normalizedHref === "" || normalizedHref === "/") {
    return normalizedPathname === "/" || normalizedPathname === "";
  }
  return normalizedPathname === normalizedHref || normalizedPathname.startsWith(`${normalizedHref}/`);
}

/**
 * Herhangi bir derinlikteki torun (child, torun, torun-torun...) route eşleşirse `true` döner —
 * eski `hasActiveChild`'ın (yalnızca doğrudan çocuklara bakan) özyinelemeli hâli.
 */
function hasActiveDescendant(node: NavNode, isActive: (href: string) => boolean): boolean {
  return node.children.some((child) => isActive(child.href) || hasActiveDescendant(child, isActive));
}

interface NavMenuItemsProps {
  nodes: NavNode[];
  localize: (path: string) => string;
  pathname: string | null;
  /** 0-tabanlı, kökten (`DropdownMenuContent` içeriği) itibaren bu düğümlerin derinliği. */
  depth: number;
}

/**
 * §architect-scope-navigation-deep-nesting.md §4 — masaüstü flyout'un özyinelemeli gövdesi.
 * Çocuğu OLMAYAN düğüm düz `DropdownMenuItem`; çocuğu OLAN düğüm `DropdownMenuSub` +
 * `DropdownMenuSubTrigger` + `DropdownMenuSubContent` içinde KENDİNİ çağırır.
 *
 * `ui-designer-navigation-flyout-spec.md` (b): `DropdownMenuSubContent`'in `side="right"`/
 * `alignOffset={-3}` varsayılanları DEĞİŞTİRİLMEZ; sadece `collisionPadding={8}` eklenir.
 * Hover-intent: `DropdownMenuSubTrigger`'ın (Base UI `MenuSubmenuTrigger`) kendi `openOnHover`/
 * `delay`/`closeDelay` prop'ları kullanılır — ayrı bir `setTimeout` fallback'ine gerek yok.
 *
 * Savunma: `depth`, `NAVIGATION_MAX_DEPTH`'i aşarsa düğün sessizce ATLANIR (throw edilmez) —
 * `buildNavTree` zaten bunu büyük ölçüde engeller, bu render-katmanı kesmesi ikinci bir savunma.
 */
function NavMenuItems({ nodes, localize, pathname, depth }: NavMenuItemsProps) {
  if (depth > NAVIGATION_MAX_DEPTH) return null;

  return (
    <>
      {nodes.map((node) => {
        if (node.children.length > 0) {
          const hasActiveChild = hasActiveDescendant(node, (href) => isNavLinkActive(pathname, localize(href)));
          return (
            <DropdownMenuSub key={node.id}>
              <DropdownMenuSubTrigger
                openOnHover
                delay={150}
                closeDelay={300}
                className={cn(hasActiveChild && NAV_LINK_ACTIVE_TEXT_CLASS)}
              >
                {node.label}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent collisionPadding={8}>
                <NavMenuItems nodes={node.children} localize={localize} pathname={pathname} depth={depth + 1} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        }

        const href = localize(node.href);
        const active = isNavLinkActive(pathname, href);
        return (
          <DropdownMenuItem
            key={node.id}
            render={<Link href={href} aria-current={active ? "page" : undefined} />}
            className={cn(active && NAV_LINK_ACTIVE_TEXT_CLASS)}
          >
            {node.label}
          </DropdownMenuItem>
        );
      })}
    </>
  );
}

interface MobileNavAccordionProps {
  nodes: NavNode[];
  localize: (path: string) => string;
  pathname: string | null;
  depth: number;
  onNavigate: () => void;
}

/**
 * `ui-designer-navigation-flyout-spec.md` (c) — BAĞLAYICI: `Sheet` içinde özyinelemeli
 * `Accordion` (Base UI'ın `type="multiple"` karşılığı `multiple` boole prop'udur — bu
 * primitif Radix DEĞİL, `components/ui/accordion.tsx`'in gerçek API'si doğrulanarak
 * kullanılmıştır). Çocuğu OLAN düğüm `AccordionItem` + `AccordionTrigger` +
 * `AccordionPanel` (kendini çağırır); yaprak düz `Link`. Girinti `style={{ paddingLeft }}`
 * ile (`depth * 16 + 16`), dokunmatik hedef `min-h-11`. `onNavigate`: bir linke tıklanınca
 * `Sheet`'i kapatmak için (mevcut `SheetClose` her yaprakta ayrı sarmalamak yerine tek bir
 * `onClick` callback'i — Base UI `Dialog` kontrollü `open` state'i üzerinden kapatılır).
 */
function MobileNavAccordion({ nodes, localize, pathname, depth, onNavigate }: MobileNavAccordionProps) {
  if (depth > NAVIGATION_MAX_DEPTH) return null;

  return (
    <Accordion multiple className={depth === 0 ? "gap-1 px-2" : "gap-0"}>
      {nodes.map((node) => {
        const paddingLeft = depth * 16 + 16;

        if (node.children.length > 0) {
          const hasActiveChild = hasActiveDescendant(node, (href) => isNavLinkActive(pathname, localize(href)));
          return (
            <AccordionItem key={node.id} value={node.id} className={depth > 0 ? "border-none" : undefined}>
              <AccordionTrigger
                style={{ paddingLeft }}
                className={cn("min-h-11", hasActiveChild && NAV_LINK_ACTIVE_TEXT_CLASS)}
              >
                {node.label}
              </AccordionTrigger>
              <AccordionPanel className="pl-4">
                <MobileNavAccordion
                  nodes={node.children}
                  localize={localize}
                  pathname={pathname}
                  depth={depth + 1}
                  onNavigate={onNavigate}
                />
              </AccordionPanel>
            </AccordionItem>
          );
        }

        const href = localize(node.href);
        const active = isNavLinkActive(pathname, href);
        return (
          <Link
            key={node.id}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            style={{ paddingLeft }}
            className={cn(
              "flex min-h-11 items-center px-3 py-2.5 text-sm",
              active ? NAV_LINK_ACTIVE_TEXT_CLASS : "text-foreground"
            )}
          >
            {node.label}
          </Link>
        );
      })}
    </Accordion>
  );
}

/** İdle/hover/aktif durumları arasında geçiş yapan nav link/tetikleyici metin rengi sınıfları. */
const NAV_LINK_TEXT_CLASSES =
  "text-[var(--site-header-link)] hover:text-[var(--site-header-link-hover)] focus-visible:text-[var(--site-header-link-hover)]";
const NAV_LINK_ACTIVE_TEXT_CLASS = "text-[var(--site-header-link-active)]";

/** Hesap/favori/sepet ikonlarının paylaştığı metin/ikon rengi sınıfları — `headerLinkActiveColor` BURAYA UYGULANMAZ. */
const ICON_LINK_TEXT_CLASSES = "text-[var(--site-header-link)] hover:text-[var(--site-header-link-hover)]";

/**
 * GÖREV A — akıllı yapışkan (smart sticky) menü davranışı. `back-to-top-button.tsx`'teki
 * `useEffect` + `window.addEventListener("scroll", ..., { passive: true })` paternini örnek alır.
 * `stickyHeaderEnabled=false` iken bu hook HİÇBİR listener eklemez (early return) — statik header,
 * sıfır davranış değişikliği.
 */
function useSmartSticky(enabled: boolean) {
  const [hidden, setHidden] = useState(false);
  const [isSticky, setIsSticky] = useState(false);
  const lastScrollY = useRef(0);

  useEffect(() => {
    // `enabled=false`: listener HİÇ eklenmez — `hidden`/`isSticky` iç state'i ne olursa olsun
    // hook'un döndürdüğü değerler zaten `enabled &&` ile kapılı (aşağıdaki `return` ifadesi),
    // burada AYRICA senkron bir `setState` ile sıfırlamaya gerek yok.
    if (!enabled) return;

    lastScrollY.current = window.scrollY;

    function handleScroll() {
      const currentY = window.scrollY;
      const scrollingUp = currentY < lastScrollY.current;
      const scrollingDown = currentY > lastScrollY.current;

      // Yukarı kaydırma: MEVCUT scrollY ne olursa olsun (sadece "aşağı" bug'ının aksine) hemen
      // görün. Aşağı kaydırma: sadece sayfanın belirli bir mesafesinden sonra (`> 120`) gizlen —
      // sayfanın hemen başındaki küçük bir aşağı kaydırmada header'ın anında kaybolması istenmez.
      if (scrollingUp) {
        setHidden(false);
      } else if (scrollingDown && currentY > 120) {
        setHidden(true);
      }

      setIsSticky(currentY > 20);
      lastScrollY.current = currentY;
    }

    // `back-to-top-button.tsx`'teki paternin AYNISI — geri/ileri navigasyonla sayfa zaten
    // kaydırılmış halde açılırsa (`scrollY > 20`) ilk render'da isSticky'nin doğru yansıması için.
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [enabled]);

  return { hidden: enabled && hidden, isSticky: enabled && isSticky };
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
  stickyHeaderEnabled = false,
  headerStickyBlurEnabled = true,
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
  const { hidden, isSticky } = useSmartSticky(stickyHeaderEnabled);
  // `ui-designer-navigation-flyout-spec.md` (c) — mobil `Sheet` açık/kapalı durumu; bir yaprak
  // linke tıklanınca (`MobileNavAccordion`'ın `onNavigate`'i) programatik olarak kapatılır.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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
    <header
      className={cn(
        "border-b border-border transition-colors duration-300",
        isSticky
          ? cn("bg-[var(--site-header-bg-sticky)]", headerStickyBlurEnabled && "backdrop-blur")
          : "bg-[var(--site-header-bg)] backdrop-blur",
        stickyHeaderEnabled && "sticky top-0 z-30 transition-transform duration-300",
        stickyHeaderEnabled && (hidden ? "-translate-y-full" : "translate-y-0"),
        isSticky && !hidden && "shadow-sm"
      )}
    >
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

        {/* `ui-designer-navigation-flyout-spec.md` (c) — `md:hidden` altında hamburger tetikleyici;
            masaüstü nav-link listesi `md:flex` ile mobilde gizlenir (CTA/dil/hesap/favori/sepet
            ikonları BİLEREK bu sarmalayıcının DIŞINDA, her iki genişlikte de görünür kalır). */}
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetTrigger
            render={
              <button
                type="button"
                aria-label="Menüyü aç"
                className={cn(
                  "inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-surface-muted md:hidden",
                  ICON_LINK_TEXT_CLASSES
                )}
              />
            }
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </SheetTrigger>
          <SheetContent side="left" className="w-3/4 sm:max-w-sm">
            <SheetHeader>
              <SheetTitle>Menü</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto pb-4">
              <MobileNavAccordion
                nodes={navTree}
                localize={localize}
                pathname={pathname}
                depth={0}
                onNavigate={() => setMobileNavOpen(false)}
              />
            </div>
          </SheetContent>
        </Sheet>

        <div className="hidden items-center gap-x-5 gap-y-1 text-sm md:flex">
          {navTree.map((link) => {
            if (link.children.length > 0) {
              const hasActiveChild = hasActiveDescendant(link, (href) => isNavLinkActive(pathname, localize(href)));
              return (
                <DropdownMenu key={link.id}>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        aria-current={hasActiveChild ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-1 outline-none",
                          hasActiveChild ? NAV_LINK_ACTIVE_TEXT_CLASS : NAV_LINK_TEXT_CLASSES
                        )}
                      />
                    }
                  >
                    {link.label}
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <NavMenuItems nodes={link.children} localize={localize} pathname={pathname} depth={1} />
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            }

            const href = localize(link.href);
            const active = isNavLinkActive(pathname, href);
            return (
              <Link
                key={link.id}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(active ? NAV_LINK_ACTIVE_TEXT_CLASS : NAV_LINK_TEXT_CLASSES)}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        {/* design-notes-instant-search.md §1(a) — nav-link kümesinin kapanışından HEMEN SONRA,
            hesap eylemleri kümesinin İÇİNDE DEĞİL; `productsModuleEnabled` sepet/favori ile AYNI koşul. */}
        {productsModuleEnabled && <HeaderSearch localize={localize} />}

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
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
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-2 py-1.5 outline-none transition-colors hover:bg-surface-muted",
                      ICON_LINK_TEXT_CLASSES,
                      "focus-visible:text-[var(--site-header-link-hover)]"
                    )}
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
              className={cn("flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-muted", ICON_LINK_TEXT_CLASSES)}
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
              className={cn(
                "relative inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-surface-muted",
                ICON_LINK_TEXT_CLASSES
              )}
            >
              <Heart className="h-5 w-5" />
            </Link>
          )}

          {productsModuleEnabled && (
            <Link
              href={localize("/cart")}
              aria-label={`Sepet, ${itemCount} ürün`}
              className={cn(
                "relative inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-surface-muted",
                ICON_LINK_TEXT_CLASSES
              )}
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
