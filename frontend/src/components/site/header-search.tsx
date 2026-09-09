"use client";

/**
 * Header canlı ürün arama (instant search) popover'ı.
 *
 * Kontrat: `.claude/architect-scope-search-and-order-emails.md` §1 (BAĞLAYICI).
 * Görsel spesifikasyon: `.claude/design-notes-instant-search.md` (BİREBİR uygulanır, burada
 * yeniden görsel karar VERİLMEZ) — §1(b)/(c)/(d) tek-pattern (mobil+masaüstü ORTAK tetikleyici/panel)
 * davranışını yansıtacak şekilde güncellenmiştir, §0/§2-§7 DEĞİŞMEMİŞTİR.
 *
 * Tek bir arama state'i (`useHeaderSearch`) iki AYRI prezentasyonel bileşene dağıtılır:
 * - `HeaderSearchTrigger`: `site-header.tsx`'teki sağ eylem ikonları grubunun İÇİNDE render edilen
 *   ikon-buton (nav'ın flex-child'ı).
 * - `HeaderSearchPanel`: `<header>` içinde `<nav>`in DOĞRUDAN sonrasına gelen bağımsız bir sibling
 *   `<div>` olarak render edilen, açılınca beliren tam-genişlik arama satırı.
 * Bu ayrım, tetikleyicinin nav'ın sağ ikon kümesinde kalmasına İZİN VERİRKEN panelin nav'ın
 * `flex-wrap`/`flex-nowrap` davranışına hiç bağımlı olmamasını sağlar (bkz. `site-header.tsx`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronRight, CircleAlert, FolderOpen, ImageOff, Search, SearchX } from "lucide-react";
import { searchProducts } from "@/lib/api/products";
import type { ProductSearchResult } from "@/lib/api/types";
import { formatPriceFromCents } from "@/lib/format-price";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** §1.2 architect kararı — 2 karakterin altında istek ATILMAZ. */
const MIN_CHARS = 2;
/** §1.6 architect kararı — ≥ 250ms debounce. */
const DEBOUNCE_MS = 250;

type SearchStatus = "idle" | "loading" | "success" | "error";

interface FlatResultItem {
  href: string;
}

export interface HeaderSearchProps {
  /** `site-header.tsx`in AYNI `localize` fonksiyonu — dil öneki tutarlılığı için. */
  localize: (path: string) => string;
}

/** Ortak input sınıfları — §1(c)/(d) BİREBİR aynı odak halkası/köşe/kenarlık. */
const INPUT_BASE_CLASSES =
  "rounded-[var(--site-radius)] border border-border bg-[var(--site-surface,transparent)] pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** Tetikleyici ikon-buton sınıfları — sepet/favori ikonlarıyla AYNI görsel aile (`ICON_LINK_TEXT_CLASSES`). */
const TRIGGER_BUTTON_CLASSES =
  "inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--site-header-link)] transition-colors hover:bg-surface-muted hover:text-[var(--site-header-link-hover)]";

const ROW_CLASSES = "flex items-center gap-3 px-3 py-2 outline-none hover:bg-muted focus-visible:bg-muted";

/**
 * Tüm arama mantığını (debounce/cache/abort, klavye navigasyonu, açık/kapalı state'i) tek bir yerde
 * tutan hook — `site-header.tsx` bunu bir kez çağırır, dönen değerleri `HeaderSearchTrigger` ve
 * `HeaderSearchPanel`e prop olarak dağıtır (bkz. dosya başı notu).
 */
export function useHeaderSearch({ localize }: HeaderSearchProps) {
  const router = useRouter();

  const [inputValue, setInputValue] = useState("");
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [result, setResult] = useState<ProductSearchResult | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  /** Kullanıcının sonuç popover'ını görmek isteyip istemediği (input odaklandığında `true` olur). */
  const [wantsOpen, setWantsOpen] = useState(false);
  /** Arama satırının (tetikleyici ikon-butonla açılıp kapanan) kendisi açık mı. */
  const [panelOpen, setPanelOpen] = useState(false);

  // Terim → sonuç eşlemesi bileşen ömrü boyunca bellekte (§1.6 madde d).
  const cacheRef = useRef<Map<string, ProductSearchResult>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const trimmed = inputValue.trim();
  const resultsOpen = wantsOpen && trimmed.length >= MIN_CHARS;

  const runSearch = useCallback(async (term: string) => {
    const cached = cacheRef.current.get(term);
    if (cached) {
      setResult(cached);
      setStatus("success");
      setHighlightedIndex(null);
      return;
    }
    // (c) yeni istek atılırken önceki AbortController iptal edilir.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    try {
      const data = await searchProducts(term, controller.signal);
      cacheRef.current.set(term, data);
      setResult(data);
      setStatus("success");
      setHighlightedIndex(null);
    } catch (err) {
      // İptal edilen istek bir hata DEĞİLDİR — sessizce yut (bkz. `client.ts` AbortError geçişi).
      if (err instanceof DOMException && err.name === "AbortError") return;
      setStatus("error");
    }
  }, []);

  // Not: `trimmed.length < MIN_CHARS` dalı BİLEREK burada değil, `handleInputChange` içinde ele
  // alınır (react-hooks/set-state-in-effect: effect gövdesinde SENKRON setState çağrısı YAPILMAZ,
  // yalnızca dış sistemle senkronizasyon — burada debounce zamanlayıcısı — kurulur).
  useEffect(() => {
    if (trimmed.length < MIN_CHARS) return;
    const timer = window.setTimeout(() => {
      void runSearch(trimmed);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [trimmed, runSearch]);

  function handleInputChange(value: string) {
    setInputValue(value);
    if (value.trim().length < MIN_CHARS) {
      abortRef.current?.abort();
      setStatus("idle");
      setResult(null);
      setHighlightedIndex(null);
    }
  }

  // §3 — grup sırası bağlayıcı: Ürünler ÖNCE, Kategoriler SONRA.
  const flatItems = useMemo<FlatResultItem[]>(() => {
    if (!result) return [];
    return [
      ...result.products.map((p) => ({ href: localize(`/products/${p.slug}`) })),
      ...result.categories.map((c) => ({ href: localize(`/products?category=${c.slug}`) })),
    ];
  }, [result, localize]);

  const catalogHref = useMemo(
    () => localize(`/products?search=${encodeURIComponent(trimmed)}`),
    [localize, trimmed]
  );

  const liveMessage =
    status === "success" && result
      ? result.products.length === 0 && result.categories.length === 0
        ? `"${trimmed}" için sonuç bulunamadı`
        : `${result.products.length} ürün, ${result.categories.length} kategori bulundu`
      : status === "error"
        ? "Arama şu anda kullanılamıyor"
        : "";

  function closeResults() {
    setWantsOpen(false);
    setHighlightedIndex(null);
  }

  function handleFocus() {
    setWantsOpen(true);
  }

  function handleOpenChange(open: boolean) {
    if (!open) setWantsOpen(false);
  }

  /** Paneli tamamen kapatır: sonuç popover'ı + arama satırının kendisi + input değeri sıfırlanır. */
  function closePanel() {
    closeResults();
    setPanelOpen(false);
    setInputValue("");
  }

  function togglePanel() {
    setPanelOpen((prev) => {
      const next = !prev;
      if (!next) {
        setInputValue("");
        closeResults();
      }
      return next;
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      if (flatItems.length === 0) return;
      event.preventDefault();
      setHighlightedIndex((prev) => (prev === null ? 0 : (prev + 1) % flatItems.length));
    } else if (event.key === "ArrowUp") {
      if (flatItems.length === 0) return;
      event.preventDefault();
      setHighlightedIndex((prev) => (prev === null ? flatItems.length - 1 : (prev - 1 + flatItems.length) % flatItems.length));
    } else if (event.key === "Enter") {
      if (trimmed.length < MIN_CHARS) return;
      event.preventDefault();
      const target = highlightedIndex !== null ? flatItems[highlightedIndex]?.href : catalogHref;
      if (target) {
        closeResults();
        router.push(target);
      }
    } else if (event.key === "Escape") {
      // §6 — Esc HEM sonuç popover'ını HEM arama satırının kendisini kapatır, odak tetikleyici
      // ikona geri döner.
      closePanel();
      triggerRef.current?.focus();
    }
  }

  function handleSelect() {
    closeResults();
  }

  useEffect(() => {
    if (panelOpen) {
      inputRef.current?.focus();
    }
  }, [panelOpen]);

  function renderBody() {
    const footer = (
      <Link
        href={catalogHref}
        onClick={handleSelect}
        className="flex items-center justify-center gap-1.5 border-t border-border/60 px-3 py-2.5 text-sm font-medium text-primary hover:underline"
      >
        Tüm sonuçları gör
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    );

    if (status === "loading") {
      return (
        <>
          <div className="max-h-96 overflow-y-auto">
            <div className="px-3 pt-2.5 pb-1">
              <Skeleton className="h-3 w-16" />
            </div>
            {[0, 1, 2].map((i) => (
              <div key={`skeleton-product-${i}`} className="flex items-center gap-3 px-3 py-2">
                <Skeleton className="h-10 w-10 shrink-0 rounded-md" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
            <div className="px-3 pt-2.5 pb-1">
              <Skeleton className="h-3 w-20" />
            </div>
            {[0, 1].map((i) => (
              <div key={`skeleton-category-${i}`} className="flex items-center gap-3 px-3 py-2">
                <Skeleton className="h-10 w-10 shrink-0 rounded-md" />
                <Skeleton className="h-3.5 w-1/2" />
              </div>
            ))}
          </div>
          {footer}
        </>
      );
    }

    if (status === "error") {
      return (
        <>
          <div className="max-h-96 overflow-y-auto">
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <CircleAlert className="h-8 w-8 text-foreground/20" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">Arama şu anda kullanılamıyor</p>
              <p className="text-xs text-muted-foreground">Lütfen daha sonra tekrar deneyin.</p>
            </div>
          </div>
          {footer}
        </>
      );
    }

    const products = result?.products ?? [];
    const categories = result?.categories ?? [];

    if (products.length === 0 && categories.length === 0) {
      return (
        <>
          <div className="max-h-96 overflow-y-auto">
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <SearchX className="h-8 w-8 text-foreground/20" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">&ldquo;{trimmed}&rdquo; için sonuç bulunamadı</p>
              <p className="text-xs text-muted-foreground">Farklı bir anahtar kelime deneyin.</p>
            </div>
          </div>
          {footer}
        </>
      );
    }

    return (
      <>
        <div id="header-search-listbox" role="listbox" aria-label="Arama sonuçları" className="max-h-96 overflow-y-auto">
          {products.length > 0 && (
            <>
              <p className="px-3 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Ürünler</p>
              {products.map((product, i) => (
                <Link
                  key={product.id}
                  id={`header-search-option-${i}`}
                  role="option"
                  aria-selected={highlightedIndex === i}
                  href={flatItems[i]?.href ?? localize(`/products/${product.slug}`)}
                  onClick={handleSelect}
                  className={cn(ROW_CLASSES, highlightedIndex === i && "bg-muted")}
                >
                  <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted">
                    {product.coverMedia ? (
                      // `SafeImage`/`next/image` BİLEREK kullanılmaz — bu veri (product-card.tsx'in
                      // aksine) İSTEMCİ TARAFINDA `apiFetch` ile çekilir; `coverMedia.url` tarayıcıya
                      // açık genel adresi taşır (`NEXT_PUBLIC_API_URL`), Next sunucusunun KENDİSİ
                      // (ör. Docker'da `backend:4000` DEĞİL `localhost:4000`) bu adresi optimize etmek
                      // için ERİŞEMEYEBİLİR — `cart-drawer.tsx`/`wishlist-client.tsx` ile AYNI, mevcut
                      // deseni izler.
                      // eslint-disable-next-line @next/next/no-img-element -- ürün görseli istemci tarafı fetch ile gelir, next/image remotePatterns'ın sunucu erişemeyebileceği bir host olabilir
                      <img
                        src={product.coverMedia.url}
                        alt={product.coverMedia.altText ?? ""}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <ImageOff className="h-4 w-4 text-foreground/30" aria-hidden="true" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{product.title}</p>
                    <p className="mt-0.5 text-xs">
                      {product.discountPriceCents !== null ? (
                        <>
                          <span className="mr-1.5 text-[11px] font-normal text-foreground/40 line-through">
                            {formatPriceFromCents(product.priceCents, product.currency)}
                          </span>
                          <span className="font-semibold text-foreground">
                            {formatPriceFromCents(product.discountPriceCents, product.currency)}
                          </span>
                        </>
                      ) : (
                        <span className="font-semibold text-foreground">{formatPriceFromCents(product.priceCents, product.currency)}</span>
                      )}
                    </p>
                  </div>
                </Link>
              ))}
            </>
          )}
          {categories.length > 0 && (
            <>
              <p className="px-3 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Kategoriler</p>
              {categories.map((category, i) => {
                const idx = products.length + i;
                return (
                  <Link
                    key={category.id}
                    id={`header-search-option-${idx}`}
                    role="option"
                    aria-selected={highlightedIndex === idx}
                    href={flatItems[idx]?.href ?? localize(`/products?category=${category.slug}`)}
                    onClick={handleSelect}
                    className={cn(ROW_CLASSES, highlightedIndex === idx && "bg-muted")}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
                      <FolderOpen className="h-4 w-4 text-foreground/40" aria-hidden="true" />
                    </div>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{category.name}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-foreground/30" aria-hidden="true" />
                  </Link>
                );
              })}
            </>
          )}
        </div>
        {footer}
      </>
    );
  }

  const activeDescendantId = highlightedIndex !== null ? `header-search-option-${highlightedIndex}` : undefined;

  return {
    panelOpen,
    togglePanel,
    inputRef,
    triggerRef,
    inputValue,
    handleInputChange,
    handleFocus,
    handleKeyDown,
    handleOpenChange,
    resultsOpen,
    activeDescendantId,
    renderBody,
    liveMessage,
  };
}

export type UseHeaderSearchReturn = ReturnType<typeof useHeaderSearch>;

/**
 * `site-header.tsx`'teki sağ eylem ikonları grubunun İÇİNDE, en solda render edilen tek tetikleyici
 * (`aria-label`/`aria-expanded` panel açık/kapalı durumunu yansıtır).
 */
export function HeaderSearchTrigger({
  panelOpen,
  togglePanel,
  triggerRef,
}: Pick<UseHeaderSearchReturn, "panelOpen" | "togglePanel" | "triggerRef">) {
  return (
    <button
      ref={triggerRef}
      type="button"
      aria-label={panelOpen ? "Aramayı kapat" : "Ara"}
      aria-expanded={panelOpen}
      onClick={togglePanel}
      className={TRIGGER_BUTTON_CLASSES}
    >
      <Search className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}

/**
 * `<header>` içinde `<nav>`in DOĞRUDAN sonrasına gelen bağımsız sibling — edge-to-edge tam genişlik,
 * açılış animasyonu `animate-in fade-in-0 slide-in-from-top-2 duration-150` (proje genelinde zaten
 * kullanılan `tw-animate-css` sınıfları, bkz. `admin/appearance/page.tsx`/`popover.tsx`).
 */
export function HeaderSearchPanel({
  panelOpen,
  inputRef,
  inputValue,
  handleInputChange,
  handleFocus,
  handleKeyDown,
  handleOpenChange,
  resultsOpen,
  activeDescendantId,
  renderBody,
  liveMessage,
}: Omit<UseHeaderSearchReturn, "panelOpen" | "togglePanel" | "triggerRef"> & { panelOpen: boolean }) {
  if (!panelOpen) return null;

  return (
    <div className="animate-in fade-in-0 slide-in-from-top-2 border-t border-border/60 px-4 py-2.5 duration-150 sm:px-6">
      <span aria-live="polite" className="sr-only">
        {liveMessage}
      </span>
      <Popover open={resultsOpen} onOpenChange={handleOpenChange}>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--site-header-link)]"
            aria-hidden="true"
          />
          <PopoverTrigger
            nativeButton={false}
            render={
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded={resultsOpen}
                aria-controls="header-search-listbox"
                aria-activedescendant={resultsOpen ? activeDescendantId : undefined}
                aria-label="Ürün ara"
                autoComplete="off"
                placeholder="Ürün, kategori ara..."
                value={inputValue}
                onChange={(e) => handleInputChange(e.target.value)}
                onFocus={handleFocus}
                onKeyDown={handleKeyDown}
                className={cn("h-10 w-full", INPUT_BASE_CLASSES)}
              />
            }
          />
        </div>
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="w-(--anchor-width) flex-col gap-0 p-0"
        >
          {renderBody()}
        </PopoverContent>
      </Popover>
    </div>
  );
}
