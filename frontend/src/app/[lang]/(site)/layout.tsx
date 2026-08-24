import type { CSSProperties, ReactNode } from "react";
import { notFound } from "next/navigation";
import Script from "next/script";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { fetchPublishedPagesServer } from "@/lib/api/server-pages";
import { fetchNavigationConfigServer } from "@/lib/api/server-navigation";
import { fetchSiteAppearanceServer } from "@/lib/api/server-appearance";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { CartProvider } from "@/context/cart-context";
import { LocaleAlternatesProvider } from "@/context/locale-alternates-context";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { BackToTopButton } from "@/components/site/back-to-top-button";
import { CookieConsentBanner } from "@/components/site/cookie-consent-banner";
import { getFooterLogoHeight } from "@/lib/site-settings/logo";
import { escapeEmbeddedClosingTags } from "@/lib/site-settings/appearance";
import { SITE_FONT_FAMILY, SITE_FONT_VARIABLES } from "@/lib/site-settings/site-fonts";
import { SITE_BORDER_RADIUS_PX } from "@/lib/site-settings/site-radius";

export default async function SiteLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;

  // Bakım modu (§10.12.5) proxy.ts'te ele alınır (bkz. o dosyadaki gerekçe — Server
  // Component'ten 503 döndürmenin bir yolu yok); bu layout maintenanceModeEnabled'ı TEKRAR
  // KONTROL ETMEZ, proxy'den geçen her istek zaten bakım modunda DEĞİLDİR.
  const locales = await fetchLocalesServer();
  // Bilinmeyen/devre dışı `[lang]` → 404 (rota katmanı kararı — bkz. LocaleQuery sözleşmesi,
  // `.claude/architect-scope-i18n.md` §4.3: veri katmanı hata DÖNMEZ, rota katmanı döner).
  const activeLocale = locales.find((l) => l.code === lang);
  if (!activeLocale) notFound();

  const [settings, pages, navigation, appearance] = await Promise.all([
    fetchSiteSettingsServer(),
    fetchPublishedPagesServer(lang),
    fetchNavigationConfigServer(),
    fetchSiteAppearanceServer(),
  ]);

  // §10.12.4 render sözleşmesi — BU değişkenler `:root`'a DEĞİL, yalnızca bu `.site-scope`
  // sarmalayıcısına satır-içi `style` ile yazılır; admin panelinin `--primary`/`--ring` gibi
  // token'ları (`.admin-shell` altında) buradan ASLA etkilenmez.
  const siteScopeStyle = {
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
    "--site-radius": SITE_BORDER_RADIUS_PX[appearance.borderRadius],
    "--site-heading-font": SITE_FONT_FAMILY[appearance.headingFont],
    "--site-body-font": SITE_FONT_FAMILY[appearance.bodyFont],
    "--site-base-font-size": `${appearance.baseFontSize}px`,
    // `CSSProperties` (csstype) tanınan CSS özellikleri için index imzası TAŞIMAZ — `--site-*`
    // özel özellikleri (custom properties) için `unknown` üzerinden güvenli bir tip dönüşümü.
  } as unknown as CSSProperties;

  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? activeLocale.code;

  return (
    // Sepet SADECE public site'ta yönetilir — admin layout'a KASTEN eklenmedi.
    <CartProvider>
      {/* §9 frontend-agent madde 4 — dil değiştiricinin "aynı içeriğin başka dildeki karşılığı"na
          gidebilmesi için alt sayfaların `localizations`'ı header'a bu Provider üzerinden akar
          (bkz. context/locale-alternates-context.tsx). */}
      <LocaleAlternatesProvider activeLocaleCode={activeLocale.code} defaultLocaleCode={defaultLocaleCode}>
        <div className={`site-scope flex min-h-screen flex-col ${SITE_FONT_VARIABLES}`} style={siteScopeStyle}>
          <SiteHeader
            settings={settings}
            pages={pages}
            navigationItems={navigation.navigationItems}
            ctaLabel={navigation.headerCtaLabel}
            ctaHref={navigation.headerCtaHref}
            buttonStyle={appearance.buttonStyle}
            locales={locales}
            activeLocale={activeLocale}
          />
          <main className="flex-1">{children}</main>
          <SiteFooter
            siteName={settings.siteName}
            logoUrl={settings.logoUrl}
            logoHeight={getFooterLogoHeight(settings.headerLogoHeight)}
            tagline={settings.tagline}
            socialLinks={navigation.socialLinks}
            footerColumns={navigation.footerColumns}
            copyrightText={navigation.footerCopyrightText}
            activeLocaleCode={activeLocale.code}
            defaultLocaleCode={defaultLocaleCode}
          />
          {appearance.backToTopEnabled && <BackToTopButton />}
          {appearance.cookieBannerEnabled && (
            <CookieConsentBanner
              text={appearance.cookieBannerText ?? ""}
              policyHref={appearance.cookieBannerPolicyHref}
            />
          )}
        </div>
      </LocaleAlternatesProvider>

      {/*
       * §10.12.6 render sözleşmesi (BAĞLAYICI) — enjeksiyon YALNIZCA burada, `(site)` route
       * grubunun layout'unda yapılır; kök `app/layout.tsx` admin panelini de sarmaladığı için
       * ORAYA KESİNLİKLE konmaz. Kapanış etiketi kaçışı (`</style`/`</script` nötrleştirme)
       * ZORUNLUDUR — aksi hâlde kaydedilen metin kendi etiketinden erken çıkıp belgeye keyfi
       * işaretleme enjekte edebilir (bkz. escapeEmbeddedClosingTags).
       */}
      {appearance.customCss && (
        <style id="site-custom-css" dangerouslySetInnerHTML={{ __html: escapeEmbeddedClosingTags(appearance.customCss) }} />
      )}
      {/* `customJs`: `CUSTOM_CODE_ENABLED=false` iken backend HER ZAMAN `null` döner (kill switch,
          §10.12.6) — burada EKSTRA bir kill-switch mantığı YAZILMAZ, sadece null-check yeterlidir. */}
      {appearance.customJs && (
        <Script id="site-custom-js" strategy="afterInteractive">
          {escapeEmbeddedClosingTags(appearance.customJs)}
        </Script>
      )}
    </CartProvider>
  );
}
