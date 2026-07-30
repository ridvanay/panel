import type { ReactNode } from "react";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { fetchPublishedPagesServer } from "@/lib/api/server-pages";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";

export default async function SiteLayout({ children }: { children: ReactNode }) {
  const [settings, pages] = await Promise.all([fetchSiteSettingsServer(), fetchPublishedPagesServer()]);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader settings={settings} pages={pages} />
      <main className="flex-1">{children}</main>
      <SiteFooter siteName={settings.siteName} />
    </div>
  );
}
