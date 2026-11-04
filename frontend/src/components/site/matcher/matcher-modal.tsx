"use client";

import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, Stethoscope, X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { useFindTreatmentEnabled } from "@/components/site/site-features-context";
import { useMatcherStrings } from "@/lib/i18n/use-matcher-strings";
import { PhysicianMatcher } from "./physician-matcher";
import { cn } from "@/lib/utils";

/**
 * Paket W — sihirbazın sayfa içi modal sürümü. Tek sağlayıcı (site layout'u); header düğmesi, anasayfa
 * arama kutusu ve CTA kartları buradan açar. Açık durum ve adım URL'de `?finder=<adım>` (geri tuşu
 * çalışır); başlangıç araması YALNIZCA bellekte tutulur (URL'ye girmez — sağlık verisi olabilir).
 */
interface MatcherModalContextValue {
  enabled: boolean;
  open: (initialQuery?: string) => void;
}

const MatcherModalContext = createContext<MatcherModalContextValue | null>(null);

export function useMatcherModal(): MatcherModalContextValue | null {
  return useContext(MatcherModalContext);
}

export function MatcherModalProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [initialQuery, setInitialQuery] = useState("");
  const [session, setSession] = useState(0);
  // Modal açıkken geçmişe eklenen girdi sayısı — kapanışta geri sarılır (Back modalı yeniden açmasın).
  const depth = useRef(0);

  useEffect(() => {
    const onPop = () => {
      if (depth.current > 0) depth.current -= 1;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const open = useCallback(
    (query?: string) => {
      setInitialQuery(query ?? "");
      setSession((s) => s + 1);
      const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
      params.set("finder", "1");
      depth.current += 1;
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname]
  );

  const noteStepPush = useCallback(() => {
    depth.current += 1;
  }, []);

  const rewind = useCallback((): boolean => {
    if (depth.current <= 0) return false;
    const n = depth.current;
    depth.current = 0;
    window.history.go(-n);
    return true;
  }, []);

  const value = useMemo(() => ({ enabled, open }), [enabled, open]);
  return (
    <MatcherModalContext.Provider value={value}>
      {children}
      {enabled && (
        <Suspense fallback={null}>
          <MatcherDialogHost key={session} initialQuery={initialQuery} onStepPush={noteStepPush} rewind={rewind} />
        </Suspense>
      )}
    </MatcherModalContext.Provider>
  );
}

const subscribeNever = () => () => {};
const siteScopeElement = (): HTMLElement => (document.querySelector(".site-scope") as HTMLElement | null) ?? document.body;

function MatcherDialogHost({ initialQuery, onStepPush, rewind }: { initialQuery: string; onStepPush: () => void; rewind: () => boolean }) {
  const { m } = useMatcherStrings();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const isOpen = searchParams.has("finder");

  const close = useCallback(() => {
    if (rewind()) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("finder");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, router, pathname, rewind]);

  // Portal `.site-scope` içine kurulur: `--site-*` / `--primary` tema token'ları yalnızca orada tanımlı;
  // body'ye portal edilirse "Continue" düğmesi genel (mor) varsayılan renge düşerdi.
  const container = useSyncExternalStore(subscribeNever, siteScopeElement, () => null);
  if (!container) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(next) => !next && close()}>
      <DialogContent
        container={container}
        showCloseButton={false}
        className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-x-hidden overflow-y-auto overscroll-contain rounded-none p-4 sm:h-auto sm:max-h-[90dvh] sm:w-[calc(100vw-2rem)] sm:max-w-3xl sm:rounded-xl sm:p-6"
        data-testid="matcher-dialog"
      >
        <DialogTitle className="pe-12 font-heading text-base leading-snug font-semibold">{m.dialogTitle}</DialogTitle>
        <DialogClose
          aria-label={m.close}
          className="absolute end-3 top-3 inline-flex size-11 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--site-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none motion-reduce:transition-none"
          data-testid="matcher-close"
        >
          <X className="size-5" aria-hidden="true" />
        </DialogClose>
        <div className="mt-4 min-w-0">
          {isOpen && <PhysicianMatcher mode="modal" initialQuery={initialQuery} onClose={close} onStepPush={onStepPush} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Header ve CTA'larda kullanılan "Find your treatment" düğmesi (sağlayıcı yoksa ayrı sayfaya bağlantı).
 * Paket AB — `display`: "full" metinli; "icon" yalnızca ikon (tooltip + aria-label); "auto" ölçüm
 * yapılana kadar kırılımla (xl altında yalnızca ikon). Erişilebilir ad her durumda aynı metindir.
 */
export function MatcherLaunchButton({
  className,
  variant = "primary",
  display = "full",
}: {
  className?: string;
  variant?: "primary" | "outline";
  display?: "full" | "icon" | "auto";
}) {
  const ctx = useMatcherModal();
  const { m } = useMatcherStrings();
  const localize = useLocalizePath();
  const featureEnabled = useFindTreatmentEnabled();
  const classes = cn(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--site-radius)] text-sm font-semibold transition-colors motion-reduce:transition-none",
    display === "icon" ? "w-11 px-0" : display === "auto" ? "w-11 px-0 xl:w-auto xl:px-4" : "px-4",
    variant === "primary" ? "bg-[var(--site-primary)] text-white hover:opacity-90" : "border border-[var(--site-primary)] text-[var(--site-primary)] hover:bg-[var(--site-primary)]/5",
    className
  );
  // Paket AK — panel anahtarı kapalıysa (findTreatmentEnabled) her giriş noktası kendiliğinden gizlenir.
  if (!featureEnabled || (ctx && !ctx.enabled)) return null;
  const labelClass = display === "icon" ? "sr-only" : display === "auto" ? "sr-only xl:not-sr-only" : undefined;
  const content = (
    <>
      <Stethoscope className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className={labelClass}>{m.entryButton}</span>
    </>
  );
  const element = !ctx ? (
    <Link href={localize("/find-your-treatment")} className={classes} data-testid="matcher-launch">
      {content}
    </Link>
  ) : (
    <button type="button" onClick={() => ctx.open()} className={classes} data-testid="matcher-launch">
      {content}
    </button>
  );
  if (display !== "icon") return element;
  return (
    <Tooltip>
      <TooltipTrigger render={element} />
      <TooltipContent side="bottom">{m.entryButton}</TooltipContent>
    </Tooltip>
  );
}

/** Anasayfa hero'su — büyük arama kutusu; aranan terim modalı önceden doldurur (URL'ye girmez). */
export function MatcherHeroSearch() {
  const ctx = useMatcherModal();
  const { m } = useMatcherStrings();
  const featureEnabled = useFindTreatmentEnabled();
  const [query, setQuery] = useState("");
  if (!featureEnabled || !ctx?.enabled) return null;
  return (
    <form
      role="search"
      className="mt-8 w-full max-w-xl"
      onSubmit={(e) => {
        e.preventDefault();
        ctx.open(query.trim());
      }}
      data-testid="matcher-hero-search"
    >
      <label htmlFor="matcher-hero-input" className="mb-2 block text-base font-semibold text-foreground">
        {m.heroQuestion}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-foreground/50" aria-hidden="true" />
          <input
            id="matcher-hero-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={m.heroPlaceholder}
            className="h-12 w-full rounded-[var(--site-radius)] border border-border bg-background ps-10 pe-3 text-base shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-primary)]"
          />
        </div>
        <button type="submit" className="inline-flex h-12 items-center justify-center rounded-[var(--site-radius)] bg-[var(--site-primary)] px-5 text-sm font-semibold text-white hover:opacity-90">
          {m.heroSubmit}
        </button>
      </div>
    </form>
  );
}

/** Uzmanlık sayfaları, blog yazıları ve 404 için kısa CTA kartı. */
export function MatcherCtaCard({ className }: { className?: string }) {
  const ctx = useMatcherModal();
  const { m } = useMatcherStrings();
  const featureEnabled = useFindTreatmentEnabled();
  if (!featureEnabled || (ctx && !ctx.enabled)) return null;
  return (
    <aside className={cn("rounded-[var(--site-radius)] border border-border bg-surface p-5 sm:flex sm:items-center sm:justify-between sm:gap-6", className)} data-testid="matcher-cta">
      <div>
        <p className="font-heading text-lg font-semibold text-foreground">{m.ctaTitle}</p>
        <p className="mt-1 text-sm text-foreground/70">{m.ctaText}</p>
      </div>
      <MatcherLaunchButton className="mt-3 w-full sm:mt-0 sm:w-auto sm:shrink-0" />
    </aside>
  );
}
