import Link from "next/link";
import { Globe } from "lucide-react";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { formatSiteString } from "@/lib/i18n/site-dictionaries";
import type { IntermediaryStrings } from "@/lib/i18n/site-dictionaries/types";
import { legacyFooterTitleKey, looksTurkish } from "@/lib/legacy-turkish-text";
import { isPhysiciansListHref } from "@/lib/i18n/physicians-path";
import { SOCIAL_PLATFORM_ICONS, SOCIAL_PLATFORM_LABELS } from "@/lib/social-platform-icons";
import type { FooterColumnDto, PublicAccreditation, SocialLinkDto } from "@/lib/api/types";
import { AccreditationLogo } from "@/components/site/accreditations/accreditation-logo";
import { CookiePreferencesButton } from "@/components/site/cookie-preferences-button";

interface SiteFooterProps {
  siteName: string;
  logoUrl?: string | null;
  /** Çağıran taraf (header yüksekliğinden `getFooterLogoHeight` ile) orantılamış değeri geçirir — footer, header'dan habersiz "dumb component" olarak kalır. */
  logoHeight?: number | null;
  tagline?: string | null;
  socialLinks?: SocialLinkDto[];
  footerColumns?: FooterColumnDto[];
  copyrightText?: string | null;
  /** Verilmezse öneklemeye GİRİLMEZ (geriye dönük uyumluluk — admin canlı önizleme). */
  activeLocaleCode?: string;
  defaultLocaleCode?: string;
  /** Paket N — verilirse alt satırda "Çerez tercihleri" bağlantısı (onay bandı açıkken). */
  cookiePreferencesLabel?: string | null;
  /** Paket V — hekim listesine giden bağlantının etiketi (`nav.consultPhysicians`). Verilmezse kayıttaki etiket. */
  physiciansNavLabel?: string;
  /** Paket V — "kendi dilinizde destek" kısa satırı; yalnızca destek dili seçiliyse dolu. */
  supportLine?: string | null;
  /** Paket V — sitede görünen yetki belgelerinin küçük logoları (Hakkımızda listesine bağlanır). */
  accreditations?: PublicAccreditation[];
  accreditationsHref?: string;
  accreditationsLabel?: string;
  /** Paket AH — kurumsal kimlik ibaresi (logo altı): kısa ibare + açıklama (+ yetki belgesi satırı, numara doluysa). */
  intermediary?: IntermediaryStrings;
  certificateNo?: string | null;
  /** Paket AH — sabit footer metinleri (`dict.nav.footer*`); eski Türkçe DB başlıkları/telif satırı bunlarla değiştirilir. */
  labels?: { allRightsReserved: string; servicesHeading: string; legalHeading: string; navAria: string };
}

function columnTitle(title: string, labels: SiteFooterProps["labels"]): string {
  const key = legacyFooterTitleKey(title);
  if (key && labels) return labels[key];
  return title;
}

export function SiteFooter({
  siteName,
  logoUrl,
  logoHeight,
  tagline,
  socialLinks,
  footerColumns,
  copyrightText,
  activeLocaleCode,
  defaultLocaleCode,
  cookiePreferencesLabel,
  physiciansNavLabel,
  supportLine,
  accreditations = [],
  accreditationsHref,
  accreditationsLabel,
  intermediary,
  certificateNo,
  labels,
}: SiteFooterProps) {
  const localize = (path: string) =>
    activeLocaleCode ? withLocalePrefix(path, activeLocaleCode, defaultLocaleCode ?? activeLocaleCode) : path;
  const hasSocial = Boolean(socialLinks && socialLinks.length > 0);
  const hasColumns = Boolean(footerColumns && footerColumns.length > 0);
  const year = new Date().getFullYear();
  const displayName = siteName?.trim() || "Site";
  const defaultCopyright = labels ? `© ${year} ${displayName}. ${labels.allRightsReserved}` : `© ${year} ${displayName}`;
  // Paket AH — DB'deki eski Türkçe telif satırı ("Tüm hakları saklıdır") ziyaretçiye gösterilmez.
  const copyrightLine =
    copyrightText && copyrightText.trim().length > 0 && !looksTurkish(copyrightText) ? copyrightText : defaultCopyright;
  const certificate = certificateNo?.trim();
  const visibleTagline = tagline && tagline.trim().length > 0 && !looksTurkish(tagline) ? tagline : null;

  return (
    <footer className="border-t border-border" aria-label={labels?.navAria}>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-col gap-8 sm:flex-row sm:flex-wrap sm:justify-between">
          <div className="max-w-sm space-y-3">
            {logoUrl ? (
              // 28 = eski varsayılan `h-7`; çağıran taraf (`getFooterLogoHeight`) zaten header
              // yüksekliğinden orantılayıp `logoHeight` prop'unu geçirdiği için burada sadece
              // son bir güvenlik fallback'idir.
              <span className="flex shrink-0 items-center">
                {/* eslint-disable-next-line @next/next/no-img-element -- bkz. site-header.tsx aynı gerekçe */}
                <img
                  src={logoUrl}
                  alt={displayName}
                  className="block w-auto object-contain"
                  style={{ height: `${logoHeight ?? 28}px` }}
                />
              </span>
            ) : (
              <p className="text-sm font-semibold text-foreground">{displayName}</p>
            )}
            {visibleTagline && <p className="text-xs text-foreground/50">{visibleTagline}</p>}
            {intermediary && (
              <div className="space-y-1.5 text-xs text-foreground/60" data-testid="footer-intermediary">
                <p className="text-sm font-semibold text-foreground">{intermediary.shortLabel}</p>
                <p className="leading-relaxed">{intermediary.description}</p>
                {certificate && (
                  <p className="font-medium text-foreground/80" data-testid="footer-certificate">
                    {formatSiteString(intermediary.certificateLine, { no: certificate })}
                  </p>
                )}
              </div>
            )}
            {hasSocial && (
              <div className="flex flex-wrap items-center gap-2">
                {socialLinks!.map((link) => {
                  const Icon = SOCIAL_PLATFORM_ICONS[link.platform] ?? Globe;
                  return (
                    <a
                      key={link.id}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={SOCIAL_PLATFORM_LABELS[link.platform] ?? link.platform}
                      // §10.12.4 — `--site-link` (`.site-scope` altında satır-içi yazılır).
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-foreground/60 transition-colors hover:border-[var(--site-link)] hover:text-[var(--site-link)]"
                    >
                      <Icon className="h-4 w-4" />
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          {hasColumns && (
            <div className="flex flex-1 flex-wrap gap-8 sm:justify-end">
              {footerColumns!.map((column) => (
                <div key={column.id} className="min-w-[140px] space-y-2">
                  <p className="text-sm font-medium text-foreground">{columnTitle(column.title, labels)}</p>
                  <ul className="space-y-1.5">
                    {column.links.map((link) => (
                      <li key={link.id}>
                        <Link href={localize(link.href)} className="text-sm text-foreground/60 hover:text-[var(--site-link)]">
                          {physiciansNavLabel && isPhysiciansListHref(link.href) ? physiciansNavLabel : link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        {(supportLine || accreditations.length > 0) && (
          <div className="mt-8 flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
            {supportLine ? (
              <p data-testid="footer-support-line" className="flex items-center gap-2 text-sm text-foreground/70">
                <Globe className="h-4 w-4 shrink-0 text-[var(--site-primary)]" aria-hidden="true" />
                {supportLine}
              </p>
            ) : (
              <span />
            )}
            {accreditations.length > 0 && (
              <ul data-testid="footer-accreditations" aria-label={accreditationsLabel} className="flex flex-wrap items-center gap-4">
                {accreditations.map((badge) => (
                  <li key={badge.id}>
                    <Link href={accreditationsHref ?? "#"} title={badge.name} className="block opacity-80 transition-opacity hover:opacity-100">
                      <AccreditationLogo badge={badge} className="h-7 max-w-[6rem]" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6 text-sm text-foreground/50">
          <span>{copyrightLine}</span>
          {cookiePreferencesLabel && <CookiePreferencesButton label={cookiePreferencesLabel} />}
        </div>
      </div>
    </footer>
  );
}
