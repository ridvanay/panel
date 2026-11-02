import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isModuleEnabledServer } from "@/lib/api/server-modules";
import { matcherStringsFor } from "@/lib/i18n/matcher-dictionaries";
import { aboutContainerClass } from "@/components/site/about/about-buttons";
import { PhysicianMatcher } from "@/components/site/matcher/physician-matcher";
import { cn } from "@/lib/utils";

type PageProps = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang } = await params;
  const m = matcherStringsFor(lang);
  return { title: m.metaTitle, description: m.metaDescription };
}

/**
 * Paket W — `/[lang]/find-a-physician`: "Find my physician" sihirbazının ayrı sayfası (aynı bileşen
 * sayfa içi modalda da çalışır). Adım `?step=` ile URL'de; kişisel veri URL'ye girmez.
 */
export default async function FindAPhysicianPage({ params }: PageProps) {
  const { lang } = await params;
  if (!(await isModuleEnabledServer("telehealth"))) notFound();
  const m = matcherStringsFor(lang);
  return (
    <div className={cn(aboutContainerClass, "py-10 sm:py-14")}>
      <div className="mx-auto max-w-3xl">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{m.pageTitle}</h1>
        <p className="mt-2 text-base text-foreground/70">{m.pageIntro}</p>
        <div className="mt-8 rounded-[var(--site-radius)] border border-border bg-background p-4 shadow-sm sm:p-6">
          <Suspense fallback={null}>
            <PhysicianMatcher mode="page" />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
