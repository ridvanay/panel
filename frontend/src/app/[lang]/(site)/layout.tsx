import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import Script from "next/script";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { fetchPublishedPagesServer } from "@/lib/api/server-pages";
import { fetchNavigationConfigServer } from "@/lib/api/server-navigation";
import { fetchSiteAppearanceServer } from "@/lib/api/server-appearance";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { isModuleEnabledServer } from "@/lib/api/server-modules";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { CartProvider } from "@/context/cart-context";
import { WishlistProvider } from "@/context/wishlist-context";
import { LocaleAlternatesProvider } from "@/context/locale-alternates-context";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { DoctorPortalRouteGuard } from "@/components/site/doctor-portal-route-guard";
import { LiveChatWidget } from "@/components/site/live-chat-widget";
import { BackToTopButton } from "@/components/site/back-to-top-button";
import { CookieConsentBanner } from "@/components/site/cookie-consent-banner";
import { CartDrawer } from "@/components/site/cart-drawer";
import { SiteScope } from "@/components/site/site-scope";
import { getFooterLogoHeight } from "@/lib/site-settings/logo";
import { escapeEmbeddedClosingTags } from "@/lib/site-settings/appearance";
import { buildSiteIconsMetadata } from "@/lib/site-settings/site-icons";

/**
 * Site simgesi (favicon) / Apple touch icon — admin → Navigasyon'daki ayardan (`SiteSettings`), boşsa
 * varsayılan `/favicon.ico`. Sayfalar `icons` tanımlamadığı için bu değer tüm `(site)` sayfalarına geçer.
 */
export async function generateMetadata(): Promise<Metadata> {
  const settings = await fetchSiteSettingsServer();
  return { icons: buildSiteIconsMetadata(settings) };
}

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

  const [settings, pages, navigation, appearance, productsModuleEnabled, telehealthModuleEnabled, dict] = await Promise.all([
    fetchSiteSettingsServer(),
    fetchPublishedPagesServer(lang),
    fetchNavigationConfigServer(),
    fetchSiteAppearanceServer(),
    isModuleEnabledServer("products"),
    isModuleEnabledServer("telehealth"),
    getSiteDictionary(lang),
  ]);

  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? activeLocale.code;

  const content = (
    <>
      {/* §9 frontend-agent madde 4 — dil değiştiricinin "aynı içeriğin başka dildeki karşılığı"na
          gidebilmesi için alt sayfaların `localizations`'ı header'a bu Provider üzerinden akar
          (bkz. context/locale-alternates-context.tsx). */}
      <LocaleAlternatesProvider activeLocaleCode={activeLocale.code} defaultLocaleCode={defaultLocaleCode}>
        <SiteScope appearance={appearance}>
          {/* §9 frontend-agent — doktor hesabı guard'ı (bkz. bileşenin başlığı); `LocaleAlternatesProvider`
              İÇİNDE mount edilir ki `useLocalizePath()` çalışsın. Görsel çıktısı YOKTUR (`null` döner). */}
          <DoctorPortalRouteGuard />
          <SiteHeader
            settings={settings}
            // Yalnızca menüde kullanılan alanlar — bkz. `SiteHeaderProps.pages` yorumu (RSC verisine
            // sayfaların blok/çeviri içeriği sızmasın).
            pages={pages.map(({ id, slug, title }) => ({ id, slug, title }))}
            navigationItems={navigation.navigationItems}
            ctaLabel={navigation.headerCtaLabel}
            ctaHref={navigation.headerCtaHref}
            buttonStyle={appearance.buttonStyle}
            locales={locales}
            activeLocale={activeLocale}
            productsModuleEnabled={productsModuleEnabled}
            stickyHeaderEnabled={appearance.stickyHeaderEnabled}
            headerStickyBlurEnabled={appearance.headerStickyBlurEnabled}
            telehealthModuleEnabled={telehealthModuleEnabled}
            dict={dict.nav}
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
          {/* `.claude/design-notes-ecommerce-storefront.md` §6 — `.site-scope` İÇİNDE mount
              edilir ki `--site-primary`/`--site-radius` token'larını miras alsın. Yalnızca
              `productsModuleEnabled` iken (bu `content` her iki dalda da render edildiği için
              burada AYRICA kontrol edilir) — `CartProvider` kapalı modülde ağaca hiç eklenmez. */}
          {productsModuleEnabled && <CartDrawer />}
          {/* Görev (2026-09-15) — sağ alt canlı destek widget'ı. TEK global mount noktası: bu
              layout `/patient/**`i (hasta portalı) de kapsar (`(site)/patient/layout.tsx` ayrı bir
              header/shell EKLEMİYOR), `/doctor/**` AYRI bir route grubudur ((doctor)/layout.tsx,
              kapsam DIŞI, görev talimatı). Widget kendi `usePathname()` kontrolüyle
              `/consultation/**`de kendini HİÇ render etmez ve `liveChatEnabled` kapalıyken de
              HİÇBİR ŞEY render etmez — bu yüzden burada AYRICA bir koşul YAZILMAZ. */}
          <LiveChatWidget settings={settings} />
        </SiteScope>
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
    </>
  );

  // §customer-portal §4.4 — `products` kapalıyken `CartProvider` ağaca HİÇ eklenmez (kapalı
  // modülde `/cart` uçları 404 döner, gereksiz hata gürültüsü önlenir). Sepet SADECE public
  // site'ta yönetilir — admin layout'a KASTEN eklenmedi. `WishlistProvider` AYNI gerekçeyle
  // `products` kapalıyken eklenmez (`/users/me/wishlist*` da modül kapalıyken 404 döner, bkz.
  // `lib/api/users.ts`), `CartProvider`'ın İÇİNDE mount edilir (ikisi de sadece kimlik
  // doğrulanmış kullanıcı için anlamlı, sıralama önemli değildir).
  return productsModuleEnabled ? (
    <CartProvider>
      <WishlistProvider>{content}</WishlistProvider>
    </CartProvider>
  ) : (
    content
  );
}
