import type { Metadata } from "next";
import { fetchPortfolioItemsServer } from "@/lib/api/server-portfolio";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { PortfolioCard } from "@/components/site/portfolio-card";

export const metadata: Metadata = { title: "Portföy" };

export default async function PortfolioIndexPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const [items, locales] = await Promise.all([fetchPortfolioItemsServer(lang), fetchLocalesServer()]);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold text-foreground">Portföy</h1>

      {items.length === 0 ? (
        <p className="mt-8 text-sm text-foreground/60">Henüz proje yayınlanmadı.</p>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <PortfolioCard
              key={item.id}
              item={item}
              activeLocaleCode={lang}
              defaultLocaleCode={defaultLocaleCode}
            />
          ))}
        </div>
      )}
    </div>
  );
}
