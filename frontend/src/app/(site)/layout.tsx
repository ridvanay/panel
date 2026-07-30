import type { ReactNode } from "react";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { fetchPublishedPagesServer } from "@/lib/api/server-pages";
import { fetchNavigationConfigServer } from "@/lib/api/server-navigation";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const [settings, pages, navigation] = await Promise.all([
    fetchSiteSettingsServer(),
    fetchPublishedPagesServer(),
    fetchNavigationConfigServer(),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader
        settings={settings}
        pages={pages}
        navigationItems={navigation.navigationItems}
        ctaLabel={navigation.headerCtaLabel}
        ctaHref={navigation.headerCtaHref}
      />
      <main className="flex-1">{children}</main>
      <SiteFooter
        siteName={settings.siteName}
        socialLinks={navigation.socialLinks}
        footerColumns={navigation.footerColumns}
        copyrightText={navigation.footerCopyrightText}
      />
    </div>
  );
}
