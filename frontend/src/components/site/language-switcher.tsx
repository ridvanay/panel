"use client";

import Link from "next/link";
import { Check, Globe } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocaleAlternates, contentKindBasePath } from "@/context/locale-alternates-context";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import type { Locale } from "@/lib/api/types";

interface LanguageSwitcherProps {
  /** `GET /locales` — `enabled: true`, `sortOrder` sıralı. */
  locales: Locale[];
  activeLocale: Locale;
}

/**
 * design-notes-i18n.md §1.1 — site header ziyaretçi dil değiştirici. `Globe` ikonu + tam
 * `nativeLabel`, bayrak YOK (§4). Aynı içeriğin o dildeki karşılığına gider (`localizations`'tan,
 * `context/locale-alternates-context.tsx` köprüsüyle); yoksa o dilin ana sayfasına düşer.
 */
export function LanguageSwitcher({ locales, activeLocale }: LanguageSwitcherProps) {
  const alternates = useLocaleAlternates();

  if (locales.length <= 1) return null;

  function hrefFor(locale: Locale): string {
    if (alternates) {
      const match = alternates.items.find((item) => item.locale === locale.code);
      if (match) {
        const base = contentKindBasePath(alternates.kind);
        const path = base ? `${base}/${match.slug}` : `/${match.slug}`;
        return withLocalePrefix(path, locale.code, defaultCode(locales));
      }
    }
    // Eşleşen çeviri/alternates yoksa (liste sayfaları, sepet, vb.) o dilin ana sayfasına düş.
    return withLocalePrefix("/", locale.code, defaultCode(locales));
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Dil seç"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-sm text-foreground/70 outline-none transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:text-foreground"
          />
        }
      >
        <Globe className="h-3.5 w-3.5" aria-hidden="true" />
        {activeLocale.nativeLabel}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
        {locales.map((l) => (
          <DropdownMenuItem key={l.code} render={<Link href={hrefFor(l)} />}>
            {l.nativeLabel}
            {l.code === activeLocale.code && <Check className="ml-auto h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function defaultCode(locales: Locale[]): string {
  return locales.find((l) => l.isDefault)?.code ?? locales[0]?.code ?? "tr";
}
