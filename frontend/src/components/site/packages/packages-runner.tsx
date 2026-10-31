"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import Link from "next/link";
import { ChevronRight, HeartPulse, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useActiveLocaleCode, useLocalizePath } from "@/context/locale-alternates-context";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import { usePackagesStrings } from "@/lib/i18n/use-packages-strings";
import type { PackageCardData, PackageCategory } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { PackageCard } from "./package-card";
import { PackageDetailSheet } from "./package-detail-sheet";
import { categoryLabel } from "./package-format";
import { writeRunnerDismissed } from "./runner-visibility";

/** Paket X — sayfa yüklendikten kaç ms sonra panel yarı açık "peek" olur. */
export const RUNNER_PEEK_DELAY_MS = 3000;

function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener?.("change", onChange);
      return () => mql.removeEventListener?.("change", onChange);
    },
    [query]
  );
  const getSnapshot = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : serverValue);
  return useSyncExternalStore(subscribe, getSnapshot, () => serverValue);
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

const KEYFRAMES = `
@keyframes pkg-runner-scroll{from{transform:translateY(0)}to{transform:translateY(-50%)}}
@keyframes pkg-runner-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.pkg-runner-track[data-animated]{animation:pkg-runner-scroll var(--pkg-runner-duration) linear infinite}
.pkg-runner-marquee{animation:pkg-runner-marquee var(--pkg-runner-duration) linear infinite}
[dir="rtl"] .pkg-runner-marquee{animation-direction:reverse}
.pkg-runner-viewport:hover .pkg-runner-track,.pkg-runner-viewport:focus-within .pkg-runner-track,button:hover .pkg-runner-marquee,button:focus-visible .pkg-runner-marquee{animation-play-state:paused}
@media (prefers-reduced-motion: reduce){.pkg-runner-track,.pkg-runner-marquee{animation:none!important}}
`;

interface RunnerProps {
  /** Dikey kayan liste (öne çıkanlar; yoksa tümü). */
  featured: PackageCardData[];
  /** Mobil sheet'in kart listesi (tüm aktif paketler). */
  items: PackageCardData[];
  categories: PackageCategory[];
  /** Kapatma tıklanınca (sessionStorage yazıldıktan sonra) çağrılır. */
  onDismiss: () => void;
}

/**
 * Paket X — sağlık paketleri yan paneli. Masaüstü: sağ kenarda dikey sekme; 3 sn sonra yarı açık "peek", öne çıkan
 * kartlar dikey kayar (hover/odakta durur; `prefers-reduced-motion`'da animasyon yok, liste kaydırılabilir). Mobil: alt
 * kenarda ince kategori şeridi → alt sayfa. Her ikisi de `fixed` (içeriği itmez, CLS yok). Kart → ayrıntı sheet'i.
 * Bu modül `packages-runner-lazy.tsx` üzerinden tembel yüklenir.
 */
export default function PackagesRunner({ featured, items, categories, onDismiss }: RunnerProps) {
  const t = usePackagesStrings();
  const lang = useActiveLocaleCode();
  const intlLocale = contentLocaleToIntl(lang);
  const localize = useLocalizePath();
  const reduced = usePrefersReducedMotion();
  const isDesktop = useMediaQuery("(min-width: 768px)", true);
  const [mode, setMode] = useState<"tab" | "peek">("tab");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState<PackageCardData | null>(null);
  const touched = useRef(false);
  const tabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isDesktop) return;
    const timer = window.setTimeout(() => {
      if (!touched.current) setMode("peek");
    }, RUNNER_PEEK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isDesktop]);

  const dismiss = useCallback(() => {
    writeRunnerDismissed();
    onDismiss();
  }, [onDismiss]);

  const collapse = useCallback(() => {
    touched.current = true;
    setMode("tab");
    tabRef.current?.focus();
  }, []);

  const select = useCallback((pkg: PackageCardData) => {
    setSheetOpen(false);
    setSelected(pkg);
  }, []);

  const animated = !reduced && featured.length > 1;
  const listHref = localize("/packages");

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />
      {isDesktop ? (
        <aside
          aria-label={t.sectionTitle}
          data-testid="packages-runner"
          className="fixed end-0 top-1/2 z-40 flex -translate-y-1/2 items-stretch"
          onKeyDown={(e) => {
            if (e.key === "Escape" && mode === "peek") {
              e.stopPropagation();
              collapse();
            }
          }}
        >
          {mode === "peek" && (
            <div id="packages-runner-peek" className="w-64 rounded-s-xl border border-e-0 border-border bg-background shadow-xl" data-testid="packages-runner-peek">
              <div className="flex items-center justify-between gap-1 border-b border-border px-3 py-2">
                <p className="font-heading text-sm font-semibold text-foreground">{t.featuredLabel}</p>
                <div className="flex items-center">
                  <button type="button" onClick={collapse} aria-label={t.closePanel} className="flex h-8 w-8 items-center justify-center rounded-md text-foreground/70 hover:bg-surface focus-visible:outline-2 focus-visible:outline-[var(--site-primary)]" data-testid="packages-runner-collapse">
                    <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={dismiss} aria-label={t.hidePanel} className="flex h-8 w-8 items-center justify-center rounded-md text-foreground/70 hover:bg-surface focus-visible:outline-2 focus-visible:outline-[var(--site-primary)]" data-testid="packages-runner-dismiss">
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className={cn("pkg-runner-viewport h-72 p-2", animated ? "overflow-hidden" : "overflow-y-auto")} data-testid="packages-runner-viewport" data-animated={animated ? "true" : "false"}>
                <div
                  className="pkg-runner-track"
                  data-animated={animated ? "" : undefined}
                  // Süre değişkenle verilir: satır içi `animation` kısaltması hover duraklatmasını ezerdi.
                  style={animated ? ({ "--pkg-runner-duration": `${Math.max(featured.length * 8, 16)}s` } as CSSProperties) : undefined}
                >
                  <ul className="space-y-2" data-testid="packages-runner-list">
                    {featured.map((pkg) => (
                      <li key={pkg.id}>
                        <PackageCard pkg={pkg} t={t} intlLocale={intlLocale} variant="compact" action={{ kind: "button", onSelect: select }} />
                      </li>
                    ))}
                  </ul>
                  {animated && (
                    // Döngü için ikinci kopya: yardımcı teknolojilere ve klavyeye kapalı.
                    <ul className="mt-2 space-y-2" aria-hidden="true" inert data-testid="packages-runner-loop-copy">
                      {featured.map((pkg) => (
                        <li key={pkg.id}>
                          <PackageCard pkg={pkg} t={t} intlLocale={intlLocale} variant="compact" action={{ kind: "button", onSelect: select }} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="border-t border-border px-3 py-2">
                <Link href={listHref} className="inline-flex min-h-9 items-center text-sm font-medium text-[var(--site-link,var(--site-primary))] underline">
                  {t.viewAll}
                </Link>
              </div>
            </div>
          )}
          <button
            ref={tabRef}
            type="button"
            aria-expanded={mode === "peek"}
            aria-controls="packages-runner-peek"
            aria-label={mode === "peek" ? t.closePanel : t.openPanel}
            onClick={() => {
              touched.current = true;
              setMode((m) => (m === "peek" ? "tab" : "peek"));
            }}
            className="flex w-10 flex-col items-center justify-center gap-2 rounded-s-lg bg-[var(--site-primary)] px-1 py-4 text-white shadow-lg hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]"
            data-testid="packages-runner-tab"
          >
            <HeartPulse className="h-4 w-4" aria-hidden="true" />
            <span className="text-xs font-semibold tracking-wide [writing-mode:vertical-rl]">{t.sectionTitle}</span>
          </button>
        </aside>
      ) : (
        <MobileStrip categories={categories} reduced={reduced} onOpen={() => setSheetOpen(true)} onDismiss={dismiss} />
      )}

      {!isDesktop && (
        <MobileSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          items={items}
          categories={categories}
          onSelect={select}
          onDismiss={dismiss}
          listHref={listHref}
          intlLocale={intlLocale}
        />
      )}

      <PackageDetailSheet card={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function MobileStrip({ categories, reduced, onOpen, onDismiss }: { categories: PackageCategory[]; reduced: boolean; onOpen: () => void; onDismiss: () => void }) {
  const t = usePackagesStrings();
  const label = categories.map((c) => categoryLabel(t, c)).join(" · ");
  return (
    <div data-bottom-bar data-testid="packages-runner-strip" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_8px_rgba(0,0,0,0.08)]">
      <div className="flex items-center">
      <button type="button" onClick={onOpen} aria-label={`${t.sectionTitle}. ${t.stripAria}`} className="flex h-9 min-w-0 flex-1 items-center gap-2 overflow-hidden px-3 text-xs font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--site-primary)]">
        <HeartPulse className="h-4 w-4 shrink-0 text-[var(--site-primary)]" aria-hidden="true" />
        <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap" aria-hidden="true">
          {reduced ? (
            <span className="block truncate" data-testid="packages-runner-strip-static">
              {label}
            </span>
          ) : (
            <span className="pkg-runner-marquee inline-flex" style={{ "--pkg-runner-duration": `${Math.max(categories.length * 4, 12)}s` } as CSSProperties} data-testid="packages-runner-strip-marquee">
              <span className="pe-6">{label}</span>
              <span className="pe-6">{label}</span>
            </span>
          )}
        </span>
      </button>
      <button type="button" onClick={onDismiss} aria-label={t.hidePanel} className="flex h-9 w-11 shrink-0 items-center justify-center text-foreground/70 focus-visible:outline-2 focus-visible:outline-[var(--site-primary)]" data-testid="packages-runner-dismiss">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
      </div>
    </div>
  );
}

function MobileSheet({
  open,
  onOpenChange,
  items,
  categories,
  onSelect,
  onDismiss,
  listHref,
  intlLocale,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: PackageCardData[];
  categories: PackageCategory[];
  onSelect: (pkg: PackageCardData) => void;
  onDismiss: () => void;
  listHref: string;
  intlLocale: string;
}) {
  const t = usePackagesStrings();
  const [active, setActive] = useState<PackageCategory | "all">("all");
  const visible = useMemo(() => (active === "all" ? items : items.filter((p) => p.category === active)), [items, active]);
  const tabs: (PackageCategory | "all")[] = ["all", ...categories];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85dvh] gap-0 overflow-hidden rounded-t-2xl p-0" data-testid="packages-runner-sheet">
        <div className="px-4 pb-2 pt-4">
          <SheetTitle className="font-heading text-lg font-semibold">{t.sectionTitle}</SheetTitle>
          <SheetDescription className="sr-only">{t.filterAria}</SheetDescription>
        </div>
        <div role="tablist" aria-label={t.filterAria} className="flex gap-2 overflow-x-auto px-4 pb-3">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={active === tab}
              onClick={() => setActive(tab)}
              className={cn(
                "min-h-9 shrink-0 rounded-full border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]",
                active === tab ? "border-[var(--site-primary)] bg-[var(--site-primary)] text-white" : "border-border bg-background text-foreground"
              )}
            >
              {tab === "all" ? t.allCategories : categoryLabel(t, tab)}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="flex-1 overflow-y-auto px-4 pb-4">
          {visible.length === 0 ? (
            <p className="py-6 text-center text-sm text-foreground/70" data-testid="packages-runner-empty">
              {t.emptyCategory}
            </p>
          ) : (
            <ul className="space-y-2">
              {visible.map((pkg) => (
                <li key={pkg.id}>
                  <PackageCard pkg={pkg} t={t} intlLocale={intlLocale} variant="compact" action={{ kind: "button", onSelect }} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2">
          <Link href={listHref} className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--site-link,var(--site-primary))] underline">
            {t.viewAll}
          </Link>
          <button type="button" onClick={onDismiss} className="min-h-11 text-sm text-foreground/70 underline" data-testid="packages-runner-dismiss">
            {t.hidePanel}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
