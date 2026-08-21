import Link from "next/link";
import { Globe } from "lucide-react";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { SOCIAL_PLATFORM_ICONS, SOCIAL_PLATFORM_LABELS } from "@/lib/social-platform-icons";
import type { FooterColumnDto, SocialLinkDto } from "@/lib/api/types";

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
}: SiteFooterProps) {
  const localize = (path: string) =>
    activeLocaleCode ? withLocalePrefix(path, activeLocaleCode, defaultLocaleCode ?? activeLocaleCode) : path;
  const hasSocial = Boolean(socialLinks && socialLinks.length > 0);
  const hasColumns = Boolean(footerColumns && footerColumns.length > 0);
  const year = new Date().getFullYear();
  const displayName = siteName?.trim() || "Site";
  const copyrightLine =
    copyrightText && copyrightText.trim().length > 0 ? copyrightText : `© ${year} ${displayName}`;

  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-col gap-8 sm:flex-row sm:flex-wrap sm:justify-between">
          <div className="max-w-xs space-y-3">
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
            {tagline && tagline.trim().length > 0 && <p className="text-xs text-foreground/50">{tagline}</p>}
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
                  <p className="text-sm font-medium text-foreground">{column.title}</p>
                  <ul className="space-y-1.5">
                    {column.links.map((link) => (
                      <li key={link.id}>
                        <Link href={localize(link.href)} className="text-sm text-foreground/60 hover:text-[var(--site-link)]">
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-8 border-t border-border pt-6 text-sm text-foreground/50">{copyrightLine}</div>
      </div>
    </footer>
  );
}
