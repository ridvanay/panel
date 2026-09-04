"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { buildCatalogHref, type CatalogFilters } from "@/lib/catalog-search-params";

interface PriceRangeFilterProps {
  filters: CatalogFilters;
  /** `ProductCatalogFacets.price` — küme boşsa `null` (bileşen render EDİLMEZ). */
  minCents: number | null;
  maxCents: number | null;
}

function centsToUnit(cents: number): number {
  return Math.round(cents / 100);
}

function unitToCents(unit: number): number {
  return Math.round(unit * 100);
}

/**
 * `.claude/design-notes-products-catalog.md` §1.3 — iki tutamaklı slider + manuel giriş.
 * Commit zamanlaması bağlayıcı: slider `onValueCommitted` (sürükleme BIRAKILDIĞINDA), manuel
 * giriş `onBlur`/`Enter` (her tuş vuruşunda DEĞİL) — architect §5.4 madde 3'teki arama
 * debounce'ından FARKLI bir mekanizma (ara değerler geçerli bir filtre değildir).
 */
export function PriceRangeFilter({ filters, minCents, maxCents }: PriceRangeFilterProps) {
  const router = useRouter();
  const pathname = usePathname();

  const boundsMin = minCents ?? 0;
  const boundsMax = maxCents ?? 0;
  const validBounds = minCents !== null && maxCents !== null && boundsMax > boundsMin;
  const currentMin = filters.minPrice ?? boundsMin;
  const currentMax = filters.maxPrice ?? boundsMax;

  const [range, setRange] = useState<[number, number]>([currentMin, currentMax]);
  const [minText, setMinText] = useState(() => String(centsToUnit(currentMin)));
  const [maxText, setMaxText] = useState(() => String(centsToUnit(currentMax)));

  // Prop URL'den (dolayısıyla sunucudan) değişince yerel taslağı SENKRONİZE eder — ör. "Filtreleri
  // Temizle"ye basıldığında slider/inputlar da sıfırlanmalı (`catalog-toolbar.tsx` ile AYNI onaylı istisna).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRange([currentMin, currentMax]);
    setMinText(String(centsToUnit(currentMin)));
    setMaxText(String(centsToUnit(currentMax)));
  }, [currentMin, currentMax]);

  if (!validBounds) return null;

  function commit(nextMinCents: number, nextMaxCents: number) {
    const lo = Math.max(boundsMin, Math.min(nextMinCents, nextMaxCents));
    const hi = Math.min(boundsMax, Math.max(nextMinCents, nextMaxCents));
    const href = buildCatalogHref(pathname, filters, {
      minPrice: lo <= boundsMin ? null : lo,
      maxPrice: hi >= boundsMax ? null : hi,
    });
    router.replace(href, { scroll: false });
  }

  function handleSliderCommit(value: number | readonly number[]) {
    if (!Array.isArray(value) || value.length !== 2) return;
    commit(value[0], value[1]);
  }

  function handleMinBlur() {
    const parsed = Number(minText);
    if (!Number.isFinite(parsed)) {
      setMinText(String(centsToUnit(range[0])));
      return;
    }
    commit(unitToCents(parsed), range[1]);
  }

  function handleMaxBlur() {
    const parsed = Number(maxText);
    if (!Number.isFinite(parsed)) {
      setMaxText(String(centsToUnit(range[1])));
      return;
    }
    commit(range[0], unitToCents(parsed));
  }

  function commitOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") event.currentTarget.blur();
  }

  return (
    <div>
      <Slider
        min={boundsMin}
        max={boundsMax}
        value={range}
        onValueChange={(value) => Array.isArray(value) && value.length === 2 && setRange(value as [number, number])}
        onValueCommitted={handleSliderCommit}
      />
      <div className="mt-3 flex items-center gap-2">
        <Input
          type="number"
          inputMode="numeric"
          aria-label="Minimum fiyat"
          value={minText}
          onChange={(event) => setMinText(event.target.value)}
          onBlur={handleMinBlur}
          onKeyDown={commitOnEnter}
          className="w-full"
        />
        <span className="text-foreground/40" aria-hidden="true">
          —
        </span>
        <Input
          type="number"
          inputMode="numeric"
          aria-label="Maksimum fiyat"
          value={maxText}
          onChange={(event) => setMaxText(event.target.value)}
          onBlur={handleMaxBlur}
          onKeyDown={commitOnEnter}
          className="w-full"
        />
      </div>
    </div>
  );
}
