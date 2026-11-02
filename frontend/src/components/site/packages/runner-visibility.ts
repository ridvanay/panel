import { LEADING_LOCALE_SEGMENT } from "@/lib/i18n/locale-code";

/**
 * Paket X — yan paneli ("runner") GÖSTERMEYECEK yollar. Dil önekli (`/tr/cart`, `/sr-latn/cart`) ve öneksiz (`/cart`)
 * yollar aynı kurala girer: önce `lib/i18n/locale-code.ts::LEADING_LOCALE_SEGMENT` ile dil öneki atılır.
 *
 * Kapsam: ödeme/sepet, görüşme odası, hasta portalı ve hesap sayfaları, tercüman paneli, hekim eşleştirme sihirbazı,
 * yorum formu, admin/doktor paneli ve giriş/kayıt ekranları; ayrıca `/physicians/<slug>` (hekim profili — randevu
 * sihirbazı `#randevu` alanında; bkz. rapor: kısmi gizleme yerine sayfada hiç gösterilmez) ve `/packages**` (sayfanın
 * kendisi zaten paketleri gösterir).
 */
const HIDDEN_AFTER_LOCALE: RegExp[] = [
  /^\/(?:cart|checkout)(?:\/|$)/,
  /^\/consultation(?:\/|$)/,
  /^\/(?:patient|hesabim|siparislerim)(?:\/|$)/,
  /^\/interpreter(?:\/|$)/,
  /^\/find-(?:your-treatment|a-physician)(?:\/|$)/,
  /^\/review(?:\/|$)/,
  /^\/(?:admin|dashboard|doctor)(?:\/|$)/,
  /^\/(?:login|register|forgot-password|reset-password|verify-email|activate-account|invitations)(?:\/|$)/,
  /^\/(?:physicians|doctors)\/[^/]+/,
  /^\/packages(?:\/|$)/,
];

/** `/tr/cart?x=1#y` → `/cart` (sorgu ve parça atılır; dil öneki atılır). */
export function stripLocaleAndQuery(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0] ?? "";
  return path.replace(LEADING_LOCALE_SEGMENT, "") || "/";
}

export function isPackagesRunnerHiddenPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const path = stripLocaleAndQuery(pathname);
  return HIDDEN_AFTER_LOCALE.some((pattern) => pattern.test(path));
}

/** Oturum boyunca "kapattım" bilgisi — sessionStorage erişimi hata verirse (gizli mod, kapalı depolama) sessizce yutulur. */
export const RUNNER_DISMISS_KEY = "wm-packages-runner-dismissed";

export function readRunnerDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(RUNNER_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeRunnerDismissed(): void {
  try {
    window.sessionStorage.setItem(RUNNER_DISMISS_KEY, "1");
  } catch {
    // Depolama yok: kapatma yalnızca bu sayfa ömrü için geçerli olur.
  }
}
