"use client";

import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useLocaleAlternates, contentKindBasePath } from "@/context/locale-alternates-context";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { localeDirection } from "@/lib/i18n/locale-direction";
import { LocaleFlag } from "@/components/site/locale-flag";
import { cn } from "@/lib/utils";
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
  /** Tetik düğmesinin erişilebilir adı (ör. sözlükten "Language"); aktif dil adı sonuna eklenir. */
  label?: string;
  /**
   * Paket O — dar masaüstü genişliğinde (lg, xl altı) tetikte yalnızca bayrak: dil adı `xl` ve üstünde
   * görünür; dar ekranda ad `title` (tooltip) ve `aria-label` olarak kalır.
   */
  compactBelowXl?: boolean;
  /**
   * Ölçüme dayalı kesin karar (başlık `useHeaderFit`): `true` → yalnızca bayrak, `false` → bayrak + ad.
   * Verilmezse (`undefined`, ör. ilk sunucu render'ı) `compactBelowXl` kırılım davranışı geçerlidir.
   */
  compact?: boolean;
}

/**
 * Paket M — dil satırı: solda 4:3 bayrak, yanında dilin kendi adı (`nativeLabel`), seçiliyse sağda ✓.
 * Satır kendi dilinde ve yönünde işaretlenir (`lang`/`dir`; ör. العربية sağdan sola). Seçili satır kalın
 * ve koyu marka renginde (`--site-accent`, yoksa #2951A0 — açık birincil renk beyaz zeminde AA geçmez).
 */
function LocaleRowContent({ locale, active }: { locale: Locale; active: boolean }) {
  return (
    <>
      <LocaleFlag code={locale.code} />
      <span lang={locale.code} dir={localeDirection(locale.code)} className="min-w-0 flex-1 truncate text-start">
        {locale.nativeLabel}
      </span>
      {active && <Check className="h-4 w-4 shrink-0 text-[var(--site-accent,#2951A0)]" aria-hidden="true" />}
    </>
  );
}

const ROW_CLASS = "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground transition-colors";
const ACTIVE_ROW_CLASS = "font-semibold text-[var(--site-accent,#2951A0)]";

/**
 * design-notes-i18n.md §1.1 — site header ziyaretçi dil değiştirici. Paket M (2026-10-23): bayraklı
 * görünüm (tetikte aktif dilin bayrağı + adı + açılınca dönen ok; listede bayrak + ad + seçili ✓).
 * Davranış DEĞİŞMEDİ: aynı içeriğin o dildeki karşılığına gider (`localizations`'tan,
 * `context/locale-alternates-context.tsx` köprüsüyle); yoksa o dilin ana sayfasına düşer.
 * Klavye: tetik Enter/Space ile açılır, ok tuşlarıyla gezinilir, Enter seçer, Esc kapatır
 * (base-ui `Menu` — `menu`/`menuitem` rolleri, `aria-expanded` tetikte).
 */
export function LanguageSwitcher({
  locales: allLocales,
  activeLocale,
  variant = "dropdown",
  heading,
  onNavigate,
  label = "Dil seç",
  compactBelowXl = false,
  compact,
}: LanguageSwitcherProps) {
  const alternates = useLocaleAlternates();
  // Paket L — kapalı (`enabled: false`) diller hiçbir koşulda listelenmez (public `/locales` zaten
  // yalnızca açık dilleri döner; bu, önbellekte kalmış eski bir listeye karşı savunmadır).
  const locales = allLocales.filter((l) => l.enabled);

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
        <ul className="space-y-0.5">
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
                  className={cn(ROW_CLASS, "hover:bg-surface-muted", active && ACTIVE_ROW_CLASS)}
                >
                  <LocaleRowContent locale={l} active={active} />
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
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "group gap-2",
              compact === undefined ? compactBelowXl && "gap-1 px-2 xl:gap-2" : compact && "gap-1 px-2"
            )}
            aria-label={`${label}: ${activeLocale.nativeLabel}`}
            title={compactBelowXl || compact ? activeLocale.nativeLabel : undefined}
          />
        }
      >
        <LocaleFlag code={activeLocale.code} />
        <span lang={activeLocale.code} dir={localeDirection(activeLocale.code)} className={compact === undefined ? (compactBelowXl ? "hidden xl:inline" : undefined) : compact ? "hidden" : undefined}>
          {activeLocale.nativeLabel}
        </span>
        <ChevronDown
          className="h-3.5 w-3.5 transition-transform duration-150 group-data-[popup-open]:rotate-180 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 min-w-56 overflow-y-auto rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-black/5 dark:bg-popover">
        {locales.map((l) => {
          const active = l.code === activeLocale.code;
          return (
            <DropdownMenuItem
              key={l.code}
              className={cn(ROW_CLASS, "focus:bg-surface-muted data-highlighted:bg-surface-muted", active && ACTIVE_ROW_CLASS)}
              render={<Link href={hrefFor(l)} lang={l.code} hrefLang={l.hreflang ?? l.code} aria-current={active ? "true" : undefined} />}
            >
              <LocaleRowContent locale={l} active={active} />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function defaultCode(locales: Locale[]): string {
  return locales.find((l) => l.isDefault)?.code ?? locales[0]?.code ?? "tr";
}
