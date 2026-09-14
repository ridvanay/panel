import type { CSSProperties, ReactNode } from "react";
import type { PublicSiteAppearance } from "@/lib/api/types";
import { SITE_FONT_FAMILY, SITE_FONT_VARIABLES } from "@/lib/site-settings/site-fonts";
import { SITE_BORDER_RADIUS_PX } from "@/lib/site-settings/site-radius";
import { cn } from "@/lib/utils";

/**
 * `.claude/architect-scope-doctor-subdomain.md` §5.3/§7.3 madde 3 — `(site)/layout.tsx`'in
 * (eski satır 51-76+86) `.site-scope` token bloğu + sarmalayıcı `<div>`'i buraya çıkarıldı; hem
 * `(site)` hem `(doctor)` route grubu layout'u AYNI bileşeni kullanır (drift yasağı — token
 * sözleşmesinin TEK tanımı). §10.12.4 render sözleşmesi DEĞİŞMEDİ: bu değişkenler `:root`'a DEĞİL,
 * yalnızca bu sarmalayıcıya satır-içi `style` ile yazılır; admin panelinin `--primary`/`--ring`
 * gibi token'ları (`.admin-shell` altında) buradan ASLA etkilenmez.
 */
export function buildSiteScopeStyle(appearance: PublicSiteAppearance): CSSProperties {
  return {
    "--site-primary": appearance.primaryColor,
    "--site-secondary": appearance.secondaryColor,
    "--site-button": appearance.buttonColor,
    "--site-button-text": appearance.buttonTextColor,
    "--site-link": appearance.linkColor,
    "--site-accent": appearance.accentColor,
    "--site-background": appearance.backgroundColor,
    "--site-surface": appearance.surfaceColor,
    "--site-text": appearance.textColor,
    "--site-muted-text": appearance.mutedTextColor,
    "--site-header-bg": appearance.headerBgColor,
    "--site-header-bg-sticky": appearance.headerStickyBgColor,
    "--site-header-link": appearance.headerLinkColor,
    "--site-header-link-hover": appearance.headerLinkHoverColor,
    "--site-header-link-active": appearance.headerLinkActiveColor,
    "--site-radius": SITE_BORDER_RADIUS_PX[appearance.borderRadius],
    "--site-heading-font": SITE_FONT_FAMILY[appearance.headingFont],
    "--site-body-font": SITE_FONT_FAMILY[appearance.bodyFont],
    "--site-base-font-size": `${appearance.baseFontSize}px`,
    // `CSSProperties` (csstype) tanınan CSS özellikleri için index imzası TAŞIMAZ — `--site-*`
    // özel özellikleri (custom properties) için `unknown` üzerinden güvenli bir tip dönüşümü.
  } as unknown as CSSProperties;
}

export function SiteScope({
  appearance,
  className,
  children,
}: {
  appearance: PublicSiteAppearance;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("site-scope flex min-h-screen flex-col", SITE_FONT_VARIABLES, className)} style={buildSiteScopeStyle(appearance)}>
      {children}
    </div>
  );
}
