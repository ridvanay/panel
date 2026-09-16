/**
 * `.claude/architect-scope-i18n.md` §14.2/§14.4/§14.5 madde 2 — `site-header.tsx` chrome'u
 * (hesap menüsü, "Giriş Yap", aria-label'lar). DB'den gelen ana menü etiketleri
 * (`NavigationItem.label`) BİLİNÇLİ OLARAK BURADA DEĞİL (§14.6 — ayrı bir iş kalemi).
 */
export const navStrings = {
  /** `<nav aria-label>` — ana site gezinme şeridi. */
  siteNavigationAriaLabel: "Site navigation",
  /** Hesap dropdown tetikleyicisinin `aria-label`'ı — `{name}` yer tutucusu `formatSiteString`'e gider. */
  accountMenuAriaLabel: "My account, {name}",
  doctorPortal: "Doctor Portal",
  myAppointments: "My Appointments",
  myAccount: "My Account",
  myOrders: "My Orders",
  logout: "Log Out",
  /** Görünür "Giriş Yap" linki metni. */
  login: "Sign In",
  /** Aynı linkin `aria-label`'ı — mevcut davranışla aynı şekilde görünür metinden AYRI tutulur. */
  loginAriaLabel: "Sign in",
  wishlistAriaLabel: "Wishlist",
  /** `{count}` yer tutucusu `formatSiteString`'e gider. */
  cartAriaLabel: "Cart, {count} items",
} as const;

export type NavStrings = Record<keyof typeof navStrings, string>;
