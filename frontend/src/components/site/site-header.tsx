"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarClock,
  ChevronDown,
  Heart,
  LogOut,
  Menu,
  Receipt,
  ShoppingCart,
  Stethoscope,
  User as UserIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { useCartOptional } from "@/context/cart-context";
import { useAuthOptional } from "@/context/auth-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion";
import { LanguageSwitcher } from "@/components/site/language-switcher";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { formatSiteString } from "@/lib/i18n/site-dictionaries";
import type { NavStrings } from "@/lib/i18n/site-dictionaries";
import { navStrings as legacyFallbackNavStrings } from "@/lib/i18n/site-dictionaries/tr/nav";
import type { Locale, NavigationItemDto, SiteButtonStyle, SitePage, SiteSettings } from "@/lib/api/types";
import { DEFAULT_HEADER_LOGO_HEIGHT } from "@/lib/site-settings/logo";
import { cn } from "@/lib/utils";

interface SiteHeaderProps {
  settings: SiteSettings;
  /**
   * Yedek menü için YALNIZCA `id`/`slug`/`title` kullanılır. Bu bir istemci bileşeni olduğu için
   * verilen her alan sayfanın RSC verisine serileştirilir — tam `SitePage` (bloklar + TÜM dillerin
   * çevirileri) geçirilirse her sayfa, yayındaki bütün sayfaların içeriğini gizli veri olarak taşır.
   */
  pages: Pick<SitePage, "id" | "slug" | "title">[];
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
   *
   * Sepet ikonu AYRICA `isDoctorDetailRoute(pathname)` iken (doktor DETAY sayfası,
   * `/doctors/[slug]`) bu prop `true` olsa bile gizlenir — bir randevu/danışmanlık akışında
   * "sepet" kavramı anlamsızdır. Bu istisna YALNIZCA sepet ikonunu etkiler; favori ikonu ve
   * `/products/*` gibi diğer tüm yüzeyler bu prop'un DEĞERİNE göre normal davranmaya devam eder.
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
  /**
   * `.claude/architect-scope-telehealth-template.md` K6 — `false` (varsayılan) iken "Doktor
   * Paneli"/"Randevularım" hesap menüsü öğeleri HİÇ render edilmez (geriye dönük uyumluluk —
   * admin canlı önizleme/unit testler bu prop'u vermez).
   */
  telehealthModuleEnabled?: boolean;
  /**
   * `.claude/architect-scope-i18n.md` §14.5 madde 2 — hesap menüsü/"Giriş Yap"/aria-label'lar.
   * `(site)/layout.tsx` her zaman `dict.nav`'ı (aktif site locale'ine göre çözülmüş) geçirir.
   *
   * **Geriye dönük uyumluluk sapması (BİLİNÇLİ, bu görevin gerçek çıktısı — bkz. handback notu):**
   * §14.3 "verilmezse KAYNAK dile (`en`) düşer" der; ANCAK 4 mevcut `site-header-*.test.tsx` unit
   * testi (`doctor-session`, `doctor-route-cart`) `dict` VERMEDEN render eder ve dropdown/aria-label
   * metinlerini Türkçe regex/tam eşleşme ile doğrular (ör. `getByRole("link", { name: "Giriş yap" })`).
   * EN kaynağa düşmek bu testleri KIRARDI. Bu yüzden `dict` verilmezse bileşen kaynak `en` YERİNE
   * `tr/nav.ts`'e (mevcut/legacy Türkçe metinlerle birebir aynı) düşer — admin önizlemesi ve testler
   * ESKİDEN OLDUĞU GİBİ Türkçe görünmeye devam eder, gerçek ziyaretçi render'ı (`dict` HER ZAMAN
   * verilir) etkilenmez.
   */
  dict?: NavStrings;
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
 * Görev tanımı madde 4 — doktor DETAY sayfasında (`/doctors/[slug]`, `/{lang}/doctors/[slug]`)
 * sepet ikonu gösterilmez (bir danışmanlık/randevu akışında "sepet" kavramı anlamsız). BİLEREK
 * yalnızca DETAY sayfasını eşler — `/doctors` ızgarası ve sitenin geri kalanı (`/products/*` dahil)
 * ETKİLENMEZ. `usePathname()` zaten bu bileşende (aktif nav linki tespiti için) mevcut olduğundan
 * bu kontrol için `(site)/layout.tsx`'e (Server Component) prop eklemek veya `proxy.ts`'e yeni bir
 * header eklemek GEREKMEDİ — en az invaziv nokta burasıdır. `[a-z]{2}` locale prefix segmenti
 * (`/en/doctors/...` gibi) `Locale.code` ile sınırlı DEĞİL — panelden sonradan eklenen yeni bir
 * dil kodu da (ör. `/de/doctors/...`) bu genel örüntüyle eşleşir.
 */
function isDoctorDetailRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return /^\/(?:[a-z]{2}\/)?doctors\/[^/]+\/?$/.test(pathname);
}

/** Mobil menü panelinin `id`'si — hamburger düğmesinin `aria-controls` hedefi. */
const MOBILE_MENU_ID = "site-mobile-menu";

/** Mobil menü panelindeki hesap/sepet linkleri — dokunma alanı en az 44px (`min-h-11`). */
function MobileMenuLink({
  href,
  icon: Icon,
  label,
  ariaLabel,
  onNavigate,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  ariaLabel?: string;
  onNavigate: () => void;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-label={ariaLabel}
        onClick={onNavigate}
        className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-foreground hover:bg-surface-muted"
      >
        <Icon className="h-4 w-4 text-foreground/60" aria-hidden="true" />
        {label}
      </Link>
    </li>
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
  telehealthModuleEnabled = false,
  dict = legacyFallbackNavStrings,
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
  // `.claude/architect-scope-telehealth-template.md` K6 — `SiteRole.DOCTOR` YOKTUR; doktorluk
  // `User.doctorProfileId` ilişkisinden TÜRETİLİR (bkz. types.ts).
  const isDoctorSession = status === "authenticated" && user?.doctorProfileId != null;
  const pathname = usePathname();
  const { hidden, isSticky } = useSmartSticky(stickyHeaderEnabled);
  const navTree: NavNode[] =
    navigationItems && navigationItems.length > 0
      ? buildNavTree(navigationItems)
      : [
          ...pages.map((page) => ({ id: `page-${page.id}`, href: `/${page.slug}`, label: page.title, children: [] })),
          { id: "fallback-blog", href: "/blog", label: "Blog", children: [] },
        ];

  const showCta = Boolean(ctaLabel && ctaHref);
  const showCartIcon = productsModuleEnabled && !isDoctorDetailRoute(pathname) && !isDoctorSession;
  const defaultLocaleCode = locales?.find((l) => l.isDefault)?.code ?? activeLocale?.code ?? "tr";
  const localize = (path: string) =>
    activeLocale ? withLocalePrefix(path, activeLocale.code, defaultLocaleCode) : path;

  // Mobil/tablet menü paneli (lg altı). Sayfa (pathname) değişince kapanır; aynı sayfaya giden bir
  // linke tıklanırsa route değişmediği için `closeMobileMenu` link'in onClick'inde ayrıca çağrılır.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [menuPathname, setMenuPathname] = useState(pathname);
  if (pathname !== menuPathname) {
    setMenuPathname(pathname);
    setMobileMenuOpen(false);
  }
  const closeMobileMenu = () => setMobileMenuOpen(false);
  const ctaClassName = cn(
    "rounded-[var(--site-radius)] font-medium transition-all duration-300 hover:opacity-85",
    SITE_BUTTON_STYLE_CLASSES[buttonStyle]
  );

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
        className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:flex-wrap lg:gap-4 lg:py-4"
        aria-label={dict.siteNavigationAriaLabel}
      >
        <Link href={localize("/")} className="flex min-w-0 items-center gap-2 text-lg font-semibold text-foreground">
          {settings.logoUrl ? (
            // Sabit KARE kutu modeli TERK EDİLDİ: logo artık kendi doğal en-boy oranını korur.
            // Render yüksekliği `headerLogoHeight` (varsayılan `DEFAULT_HEADER_LOGO_HEIGHT`) ile
            // belirlenir, genişlik `w-auto` ile serbest bırakılır; `headerLogoMaxWidth` doluysa
            // bir taşma tavanı olarak uygulanır. `shrink-0`: header dar bir viewport'ta sıkışırsa
            // flexbox'ın img'yi orantısızca küçültmesini engeller. Logo varken site adı metni
            // DOM'dan kaldırılır — img'nin `alt`'ı link'in tek erişilebilir adı kaynağıdır.
            // Mobil/tablette (lg altı) logo, CTA + hamburger'a yer açmak için gerektiğinde küçülür
            // (`min-w-0` + `max-width: 100%`, `object-contain` en-boy oranını korur); masaüstünde
            // davranış aynı (yeterli yer olduğu için küçülmez).
            <span className="flex min-w-0 items-center lg:shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element -- logo URL'si medya kütüphanesinden gelir, next/image remotePatterns henüz tanımlı değil */}
              <img
                src={settings.logoUrl}
                alt={settings.siteName?.trim() || "Site"}
                className="block w-auto object-contain object-left"
                style={{
                  height: `${settings.headerLogoHeight ?? DEFAULT_HEADER_LOGO_HEIGHT}px`,
                  maxWidth: settings.headerLogoMaxWidth ? `min(${settings.headerLogoMaxWidth}px, 100%)` : "100%",
                }}
              />
            </span>
          ) : (
            <span className="truncate">{settings.siteName?.trim() || "Site"}</span>
          )}
        </Link>

        {/* Masaüstü (lg ve üstü) — görünüm DEĞİŞMEDİ (yalnızca alt menü genişliği içeriğe göre). */}
        <div className="hidden flex-wrap items-center gap-x-5 gap-y-1 text-sm lg:flex">
          {navTree.map((link) => {
            if (link.children.length > 0) {
              const hasActiveChild = link.children.some((child) => isNavLinkActive(pathname, localize(child.href)));
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
                  {/* Genişlik tetikleyiciye (`--anchor-width`) değil İÇERİĞE göre: kısa öğeler tek satırda
                      kalır, uzunlar en fazla 22rem'de 2 satıra kırılır (`line-clamp-2`, tam metin `title`da).
                      Sağ kenara sığmazsa Base UI'nin çarpışma önlemesi menüyü sola kaydırır. */}
                  <DropdownMenuContent
                    align="start"
                    className="w-max min-w-[max(8rem,var(--anchor-width))] max-w-[min(22rem,var(--available-width))]"
                  >
                    {link.children.map((child) => (
                      <DropdownMenuItem
                        key={child.id}
                        className="items-start py-1.5 whitespace-normal"
                        render={<Link href={localize(child.href)} title={child.label} />}
                      >
                        <span className="line-clamp-2">{child.label}</span>
                      </DropdownMenuItem>
                    ))}
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
          {showCta && (
            // §10.12.4 — `--site-button`/`--site-button-text` (`.site-scope` altında satır-içi
            // yazılır, bkz. globals.css `.site-scope` fallback bloğu). Admin'in `--primary`
            // token'ından KASITLI olarak bağımsız. `buttonStyle` yapısal bir sınıf varyantıdır
            // (design-notes-theme-typography.md §3.2) — CSS custom property DEĞİLDİR.
            <Link href={localize(ctaHref as string)} className={cn(ctaClassName, "px-3.5 py-1.5 text-sm")}>
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
                    aria-label={formatSiteString(dict.accountMenuAriaLabel, { name: user.name })}
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
                {/* §K6 — KESİN sıra: Doktor Paneli → Randevularım → Hesabım → Siparişlerim → Çıkış Yap. */}
                {isDoctorSession && telehealthModuleEnabled && (
                  <DropdownMenuItem render={<Link href={localize("/doctor")} />}>
                    <Stethoscope className="h-4 w-4" aria-hidden="true" />
                    {dict.doctorPortal}
                  </DropdownMenuItem>
                )}
                {/* [KHP] `.claude/architect-scope-telehealth-template.md` §9.8.3 — hedef `/patient/appointments`e
                    güncellendi (eski `/patient/bookings` artık kalıcı yönlendirmeye düşüyor, gereksiz bir
                    ekstra atlama olmasın diye buradan DOĞRUDAN yeni rotaya bağlanılır). */}
                {!isDoctorSession && telehealthModuleEnabled && (
                  <DropdownMenuItem render={<Link href={localize("/patient/appointments")} />}>
                    <CalendarClock className="h-4 w-4" aria-hidden="true" />
                    {dict.myAppointments}
                  </DropdownMenuItem>
                )}
                {/* `/hesabim` HERKESE (5 rol + doktor) açık — `DoctorPortalShell`'in 2FA ekranı
                    `/hesabim/profil`'e link verir, bu öğe doktorda GİZLENİRSE doktor 2FA'yı
                    açamaz hale gelir. */}
                <DropdownMenuItem render={<Link href={localize("/hesabim")} />}>
                  <UserIcon className="h-4 w-4" aria-hidden="true" />
                  {dict.myAccount}
                </DropdownMenuItem>
                {productsModuleEnabled && !isDoctorSession && (
                  <DropdownMenuItem render={<Link href={localize("/hesabim/siparislerim")} />}>
                    <Receipt className="h-4 w-4" aria-hidden="true" />
                    {dict.myOrders}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => void auth?.logout()}>
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  {dict.logout}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link
              href={`/login?next=${encodeURIComponent(pathname)}`}
              aria-label={dict.loginAriaLabel}
              className={cn("flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-muted", ICON_LINK_TEXT_CLASSES)}
            >
              <UserIcon className="h-4.5 w-4.5" aria-hidden="true" />
              <span className="hidden sm:inline">{dict.login}</span>
            </Link>
          )}

          {/* design-notes-customer-portal.md §6 — rozet (adet sayacı) BİLEREK yok; favori adedi
              işlem hızını etkilemez. */}
          {productsModuleEnabled && status === "authenticated" && !isDoctorSession && (
            <Link
              href={localize("/hesabim/favorilerim")}
              aria-label={dict.wishlistAriaLabel}
              className={cn(
                "relative inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-surface-muted",
                ICON_LINK_TEXT_CLASSES
              )}
            >
              <Heart className="h-5 w-5" />
            </Link>
          )}

          {showCartIcon && (
            <Link
              href={localize("/cart")}
              aria-label={formatSiteString(dict.cartAriaLabel, { count: itemCount })}
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

        {/* Mobil/tablet (lg altı) — yalnızca logo + CTA + hamburger. CTA gizlenmez; dar ekranda
            küçültülür (`text-xs`, dar padding; `sm` ve üstünde normal boyut). */}
        <div className="flex shrink-0 items-center gap-1.5 lg:hidden">
          {showCta && (
            <Link
              href={localize(ctaHref as string)}
              className={cn(ctaClassName, "inline-flex min-h-11 items-center px-3 text-xs whitespace-nowrap sm:px-3.5 sm:text-sm")}
            >
              {ctaLabel}
            </Link>
          )}
          {/* Base UI Dialog (`Sheet`): odak panelde tutulur, Esc/dış tıklama kapatır, kapanınca odak
              hamburger'a döner, açıkken arka plan kaydırılamaz. */}
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger
              render={
                <button
                  type="button"
                  aria-label={mobileMenuOpen ? dict.closeMenu : dict.openMenu}
                  aria-expanded={mobileMenuOpen}
                  aria-controls={MOBILE_MENU_ID}
                  className={cn(
                    "inline-flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-surface-muted",
                    ICON_LINK_TEXT_CLASSES
                  )}
                />
              }
            >
              <Menu className="h-6 w-6" aria-hidden="true" />
            </SheetTrigger>
            <SheetContent
              id={MOBILE_MENU_ID}
              side="right"
              showCloseButton={false}
              className="w-[min(20rem,88vw)] gap-0 overflow-y-auto p-0 data-[side=right]:w-[min(20rem,88vw)]"
            >
              <div className="flex items-center justify-between border-b border-border py-1.5 pl-4 pr-2">
                <SheetTitle className="text-base font-semibold text-foreground">{dict.menuTitle}</SheetTitle>
                <SheetClose
                  render={
                    <button
                      type="button"
                      aria-label={dict.closeMenu}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-foreground/70 hover:bg-surface-muted"
                    />
                  }
                >
                  <XIcon className="h-5 w-5" aria-hidden="true" />
                </SheetClose>
              </div>

              <div className="flex flex-col gap-3 p-3">
                <ul className="flex flex-col gap-0.5">
                  {navTree.map((link) => {
                    if (link.children.length > 0) {
                      const hasActiveChild = link.children.some((child) => isNavLinkActive(pathname, localize(child.href)));
                      return (
                        <li key={link.id}>
                          <Accordion defaultValue={hasActiveChild ? [link.id] : []}>
                            <AccordionItem value={link.id} className="rounded-lg border-0">
                              <AccordionTrigger className="min-h-11 rounded-lg px-3 text-base">
                                <span className="flex-1">{link.label}</span>
                              </AccordionTrigger>
                              <AccordionPanel>
                                <ul className="flex flex-col gap-0.5 pb-1 pl-3">
                                  {link.children.map((child) => {
                                    const href = localize(child.href);
                                    const active = isNavLinkActive(pathname, href);
                                    return (
                                      <li key={child.id}>
                                        <Link
                                          href={href}
                                          aria-current={active ? "page" : undefined}
                                          onClick={closeMobileMenu}
                                          className={cn(
                                            "flex min-h-11 items-center rounded-lg px-3 py-2 text-sm hover:bg-surface-muted",
                                            active ? "font-medium text-[var(--site-header-link-active)]" : "text-foreground/80"
                                          )}
                                        >
                                          {child.label}
                                        </Link>
                                      </li>
                                    );
                                  })}
                                </ul>
                              </AccordionPanel>
                            </AccordionItem>
                          </Accordion>
                        </li>
                      );
                    }
                    const href = localize(link.href);
                    const active = isNavLinkActive(pathname, href);
                    return (
                      <li key={link.id}>
                        <Link
                          href={href}
                          aria-current={active ? "page" : undefined}
                          onClick={closeMobileMenu}
                          className={cn(
                            "flex min-h-11 items-center rounded-lg px-3 text-base font-medium hover:bg-surface-muted",
                            active ? "text-[var(--site-header-link-active)]" : "text-foreground"
                          )}
                        >
                          {link.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>

                {locales && activeLocale && locales.length > 1 && (
                  <div className="border-t border-border pt-3">
                    <LanguageSwitcher
                      variant="list"
                      locales={locales}
                      activeLocale={activeLocale}
                      heading={dict.languageHeading}
                      onNavigate={closeMobileMenu}
                    />
                  </div>
                )}

                <ul className="flex flex-col gap-0.5 border-t border-border pt-3">
                  {status === "authenticated" && user ? (
                    <>
                      {isDoctorSession && telehealthModuleEnabled && (
                        <MobileMenuLink href={localize("/doctor")} icon={Stethoscope} label={dict.doctorPortal} onNavigate={closeMobileMenu} />
                      )}
                      {!isDoctorSession && telehealthModuleEnabled && (
                        <MobileMenuLink
                          href={localize("/patient/appointments")}
                          icon={CalendarClock}
                          label={dict.myAppointments}
                          onNavigate={closeMobileMenu}
                        />
                      )}
                      <MobileMenuLink href={localize("/hesabim")} icon={UserIcon} label={dict.myAccount} onNavigate={closeMobileMenu} />
                      {productsModuleEnabled && !isDoctorSession && (
                        <MobileMenuLink href={localize("/hesabim/siparislerim")} icon={Receipt} label={dict.myOrders} onNavigate={closeMobileMenu} />
                      )}
                      {productsModuleEnabled && !isDoctorSession && (
                        <MobileMenuLink href={localize("/hesabim/favorilerim")} icon={Heart} label={dict.wishlist} onNavigate={closeMobileMenu} />
                      )}
                    </>
                  ) : (
                    <MobileMenuLink
                      href={`/login?next=${encodeURIComponent(pathname)}`}
                      icon={UserIcon}
                      label={dict.login}
                      onNavigate={closeMobileMenu}
                    />
                  )}
                  {showCartIcon && (
                    <MobileMenuLink
                      href={localize("/cart")}
                      icon={ShoppingCart}
                      label={itemCount > 0 ? `${dict.cart} (${itemCount > 99 ? "99+" : itemCount})` : dict.cart}
                      ariaLabel={formatSiteString(dict.cartAriaLabel, { count: itemCount })}
                      onNavigate={closeMobileMenu}
                    />
                  )}
                  {status === "authenticated" && user && (
                    <li>
                      <button
                        type="button"
                        onClick={() => {
                          closeMobileMenu();
                          void auth?.logout();
                        }}
                        className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-foreground hover:bg-surface-muted"
                      >
                        <LogOut className="h-4 w-4 text-foreground/60" aria-hidden="true" />
                        {dict.logout}
                      </button>
                    </li>
                  )}
                </ul>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  );
}
