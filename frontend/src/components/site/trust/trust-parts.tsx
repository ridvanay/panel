import type { ReactNode } from "react";
import { createElement } from "react";
import Link from "next/link";
import { Info, type LucideIcon } from "lucide-react";
import { BlogBreadcrumb, type BlogCrumb } from "@/components/site/blog/blog-breadcrumb";
import { cn } from "@/lib/utils";

/** Sitenin blog / diger sayfalariyla ayni kap genisligi. */
export const TRUST_CONTAINER = "mx-auto max-w-7xl px-4 sm:px-6";

/**
 * Paket Z1-ek - guven sayfalari ortak ust bandi: marka tonunda hafif zemin (yalnizca tema tokenlari), kirinti yolu,
 * H1, tek paragraflik giris ve "Last updated" tarihi (sunucuda bicimlenmis metin; hidrasyon guvenli).
 */
export function TrustHero({
  crumbs,
  crumbsAria,
  title,
  intro,
  updatedLabel,
  updatedDate,
  updatedIso,
}: {
  crumbs: BlogCrumb[];
  crumbsAria: string;
  title: string;
  intro: string;
  updatedLabel: string;
  updatedDate: string;
  updatedIso: string;
}) {
  return (
    <header className="border-b border-border bg-[var(--site-primary)]/5" data-testid="trust-hero">
      <div className={cn(TRUST_CONTAINER, "py-8 sm:py-12")}>
        <BlogBreadcrumb ariaLabel={crumbsAria} items={crumbs} />
        <h1 className="mt-5 max-w-3xl font-heading text-3xl font-semibold leading-tight text-foreground sm:text-4xl">{title}</h1>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-foreground/80 sm:text-lg">{intro}</p>
        <p className="mt-4 text-sm text-foreground/70" data-testid="trust-updated">
          {updatedLabel}: <time dateTime={updatedIso}>{updatedDate}</time>
        </p>
      </div>
    </header>
  );
}

/** Ikonlu ilke karti. */
export function TrustCard({ icon, title, children, className }: { icon: LucideIcon; title: string; children: ReactNode; className?: string }) {
  return (
    <article className={cn("flex flex-col rounded-[var(--site-radius)] border border-border bg-background p-5 sm:p-6", className)} data-testid="trust-card">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--site-primary)]/10 text-[var(--site-primary)]">
        {createElement(icon, { className: "h-5 w-5", "aria-hidden": true })}
      </span>
      <h3 className="mt-4 font-heading text-lg font-semibold text-foreground">{title}</h3>
      <div className="mt-2 text-base leading-relaxed text-foreground/80">{children}</div>
    </article>
  );
}

/** Bolum basligi (H2) - ayni olcek her iki sayfada. */
export function TrustSectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="font-heading text-2xl font-semibold text-foreground sm:text-3xl">
      {children}
    </h2>
  );
}

/** Vurgulu uyari kutusu (acil durum notu). `role="note"`: ekran okuyucuya ek bilgi olarak duyurulur. */
export function TrustAlert({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside role="note" className="flex gap-3 rounded-[var(--site-radius)] border border-[var(--site-accent)]/60 bg-[var(--site-accent)]/10 p-5 sm:p-6" data-testid="trust-alert">
      <Info className="mt-0.5 h-6 w-6 shrink-0 text-[var(--site-accent)]" aria-hidden="true" />
      <div>
        <p className="font-heading text-lg font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-base leading-relaxed text-foreground/85">{children}</p>
      </div>
    </aside>
  );
}

/** 44 px dokunma alanli ikincil baglanti dugmesi. */
export function TrustLinkButton({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: "primary" | "outline" }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--site-radius)] px-5 text-sm font-semibold transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)] motion-reduce:transition-none",
        variant === "primary" ? "bg-[var(--site-primary)] text-white hover:opacity-90" : "border border-[var(--site-primary)] text-[var(--site-primary)] hover:bg-[var(--site-primary)]/5"
      )}
    >
      {children}
    </Link>
  );
}
