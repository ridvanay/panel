import { describe, expect, it } from "vitest";
import {
  computePresetRange,
  dateKeyToUtcIso,
  statsFilterStateFromSearchParams,
  statsFilterStateToSearchParams,
  toStatsRangeQuery,
  type StatsFilterState,
} from "@/lib/stats-range";

describe("computePresetRange", () => {
  const today = new Date("2026-08-06T12:00:00Z");

  it("7d preset — bugün dahil son 7 günü kapsar", () => {
    expect(computePresetRange("7d", today)).toEqual({ from: "2026-07-31", to: "2026-08-06" });
  });

  it("30d preset — bugün dahil son 30 günü kapsar", () => {
    expect(computePresetRange("30d", today)).toEqual({ from: "2026-07-08", to: "2026-08-06" });
  });

  it("ytd preset — yıl başından bugüne kapsar", () => {
    expect(computePresetRange("ytd", today)).toEqual({ from: "2026-01-01", to: "2026-08-06" });
  });
});

describe("statsFilterStateFromSearchParams / statsFilterStateToSearchParams", () => {
  it("preset yoksa varsayılan (30d/day) state'i döner", () => {
    const state = statsFilterStateFromSearchParams(new URLSearchParams(""));
    expect(state.preset).toBe("30d");
    expect(state.granularity).toBe("day");
  });

  it("bilinmeyen bir preset değeri varsayılana düşer (kullanıcı URL'i elle bozmuş olabilir)", () => {
    const state = statsFilterStateFromSearchParams(new URLSearchParams("preset=not-a-real-preset"));
    expect(state.preset).toBe("30d");
  });

  it("custom preset — from/to geçerliyse AYNEN korunur", () => {
    const state = statsFilterStateFromSearchParams(
      new URLSearchParams("preset=custom&from=2026-01-01&to=2026-01-31&granularity=week")
    );
    expect(state).toEqual({ preset: "custom", from: "2026-01-01", to: "2026-01-31", granularity: "week" });
  });

  it("custom preset — from > to gibi geçersiz bir aralıkta varsayılana düşer", () => {
    const state = statsFilterStateFromSearchParams(new URLSearchParams("preset=custom&from=2026-02-01&to=2026-01-01"));
    expect(state.preset).toBe("30d");
  });

  it("custom preset — from/to eksikse varsayılana düşer", () => {
    const state = statsFilterStateFromSearchParams(new URLSearchParams("preset=custom"));
    expect(state.preset).toBe("30d");
  });

  it("round-trip — state'i search params'a yazıp geri okumak AYNI state'i üretir", () => {
    const original: StatsFilterState = { preset: "custom", from: "2026-03-01", to: "2026-03-15", granularity: "month" };
    const params = statsFilterStateToSearchParams(original);
    const parsed = statsFilterStateFromSearchParams(params);
    expect(parsed).toEqual(original);
  });

  it("preset custom DEĞİLSE search params'a from/to YAZILMAZ (preset zaten türetir)", () => {
    const params = statsFilterStateToSearchParams({ preset: "7d", from: "irrelevant", to: "irrelevant", granularity: "day" });
    expect(params.has("from")).toBe(false);
    expect(params.has("to")).toBe(false);
  });
});

describe("dateKeyToUtcIso", () => {
  // Regresyon: `date-fns`'in `startOfDay`/`endOfDay`'i yerel saat dilimini kullanıyordu — bu
  // makinenin yerel saat dilimi UTC değilse (ör. TR, +03:00) günü bir öncekine kaydırırdı.
  // `Date.UTC(...)` tabanlı bu fonksiyon test ortamının yerel saat diliminden BAĞIMSIZ olmalı.
  it("gün başını her zaman gerçek UTC 00:00:00.000 olarak üretir", () => {
    expect(dateKeyToUtcIso("2026-01-01", "start")).toBe("2026-01-01T00:00:00.000Z");
  });

  it("gün sonunu her zaman gerçek UTC 23:59:59.999 olarak üretir", () => {
    expect(dateKeyToUtcIso("2026-01-01", "end")).toBe("2026-01-01T23:59:59.999Z");
  });
});

describe("toStatsRangeQuery", () => {
  it("from/to'yu UTC gün başı/sonu ISO datetime'a normalize eder", () => {
    const query = toStatsRangeQuery({ preset: "custom", from: "2026-01-01", to: "2026-01-01", granularity: "day" });
    expect(query.from).toBe("2026-01-01T00:00:00.000Z");
    expect(query.to).toBe("2026-01-01T23:59:59.999Z");
    expect(query.granularity).toBe("day");
  });

  it("`extra.compare` verilirse sorguya eklenir", () => {
    const query = toStatsRangeQuery(
      { preset: "custom", from: "2026-01-01", to: "2026-01-02", granularity: "day" },
      { compare: true }
    );
    expect(query.compare).toBe(true);
  });
});
