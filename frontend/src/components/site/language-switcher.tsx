"use client";

import Link from "next/link";
import { Check, Globe } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useLocaleAlternates, contentKindBasePath } from "@/context/locale-alternates-context";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import type { Locale } from "@/lib/api/types";

interface LanguageSwitcherProps {
  /** `GET /locales` — `enabled: true`, `sortOrder` sıralı. */
  locales: Locale[];
  activeLocale: Locale;
  /**
   * `dropdown` (varsayılan) — header'daki açılır menü. `list` — mobil menü panelinin içinde düz
   * link listesi (modal panel içinde iç içe bir açılır menü açmak yerine; dokunma alanı ≥44px).
   * Her iki görünüm de AYNI `hrefFor` mantığını kullanır.
   */
  variant?: "dropdown" | "list";
  /** Yalnızca `list` — başlık metni (ör. "Language"). */
  heading?: string;
  /** Yalnızca `list` — bir dil linkine tıklanınca (ör. paneli kapatmak için). */
  onNavigate?: () => void;
}

/**
 * design-notes-i18n.md §1.1 — site header ziyaretçi dil değiştirici. `Globe` ikonu + tam
 * `nativeLabel`, bayrak YOK (§4). Aynı içeriğin o dildeki karşılığına gider (`localizations`'tan,
 * `context/locale-alternates-context.tsx` köprüsüyle); yoksa o dilin ana sayfasına düşer.
 */
export function LanguageSwitcher({ locales, activeLocale, variant = "dropdown", heading, onNavigate }: LanguageSwitcherProps) {
  const alternates = useLocaleAlternates();

  if (locales.length <= 1) return null;

  function hrefFor(locale: Locale): string {
    if (alternates) {
      // qa-agent bulgusu (2026-09-16) — ana sayfa (`kind: "home"`) kaydının kendi `slug`'ı
      // (`"anasayfa"`) ASLA URL'e girmez, PREFİX'SİZ kanonik URL'i HER ZAMAN kök path'tir
      // (`lib/seo.ts::isHomepage` İLE AYNI gerekçe).
      if (alternates.kind === "home") {
        return withLocalePrefix("/", locale.code, defaultCode(locales));
      }
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

  if (variant === "list") {
    return (
      <div>
        {heading && <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-foreground/50">{heading}</p>}
        <ul>
          {locales.map((l) => {
            const active = l.code === activeLocale.code;
            return (
              <li key={l.code}>
                <Link
                  href={hrefFor(l)}
                  lang={l.code}
                  hrefLang={l.hreflang ?? l.code}
                  aria-current={active ? "true" : undefined}
                  onClick={onNavigate}
                  className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-foreground hover:bg-surface-muted"
                >
                  <Globe className="h-4 w-4 text-foreground/50" aria-hidden="true" />
                  {l.nativeLabel}
                  {active && <Check className="ml-auto h-4 w-4" aria-hidden="true" />}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="sm" aria-label="Dil seç" />}>
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
