"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  GRANULARITY_LABELS,
  RANGE_PRESET_LABELS,
  computePresetRange,
  type RangePreset,
  type StatsFilterState,
} from "@/lib/stats-range";
import type { StatsGranularity } from "@/lib/api/types";

const PRESET_ORDER: RangePreset[] = ["7d", "30d", "90d", "ytd", "custom"];
const GRANULARITY_ORDER: StatsGranularity[] = ["day", "week", "month"];

interface DateRangeFilterProps {
  value: StatsFilterState;
  onChange: (next: StatsFilterState) => void;
}

/**
 * Preset (7/30/90/YTD/özel) + granularity seçici — üst bileşen (`admin/stats/page.tsx`) state'i
 * URL query param'a yazar, bu bileşen SADECE kontrollü bir formdur. Görsel dil: mevcut
 * `admin/stats/page.tsx`'teki `Tabs`/`Select` bileşenleri BİREBİR (yeni bir görsel karar değil).
 */
export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  function handlePresetChange(preset: RangePreset) {
    if (preset === "custom") {
      onChange({ ...value, preset, ...computePresetRange("30d") });
      return;
    }
    onChange({ preset, ...computePresetRange(preset), granularity: value.granularity });
  }

  function handleGranularityChange(granularity: StatsGranularity) {
    onChange({ ...value, granularity });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Tabs value={value.preset} onValueChange={(v) => handlePresetChange(String(v) as RangePreset)}>
        <TabsList variant="default">
          {PRESET_ORDER.map((preset) => (
            <TabsTrigger key={preset} value={preset}>
              {RANGE_PRESET_LABELS[preset]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {value.preset === "custom" && (
        <div className="flex items-center gap-2">
          <Label htmlFor="stats-range-from" className="sr-only">
            Başlangıç tarihi
          </Label>
          <Input
            id="stats-range-from"
            type="date"
            value={value.from}
            max={value.to}
            className="w-auto"
            onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
          />
          <span className="text-sm text-foreground/50" aria-hidden="true">
            –
          </span>
          <Label htmlFor="stats-range-to" className="sr-only">
            Bitiş tarihi
          </Label>
          <Input
            id="stats-range-to"
            type="date"
            value={value.to}
            min={value.from}
            max={new Date().toISOString().slice(0, 10)}
            className="w-auto"
            onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
          />
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <Label htmlFor="stats-granularity" className="sr-only">
          Zaman aralığı gruplama
        </Label>
        <Select
          id="stats-granularity"
          aria-label="Zaman aralığı gruplama"
          value={value.granularity}
          onChange={(e) => handleGranularityChange(e.target.value as StatsGranularity)}
          className="w-auto"
        >
          {GRANULARITY_ORDER.map((granularity) => (
            <option key={granularity} value={granularity}>
              {GRANULARITY_LABELS[granularity]}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
