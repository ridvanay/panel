"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { CrmLead, CrmLeadStatus } from "@/lib/api/crm";
import { leadStatusLabel } from "@/lib/api/crm";

/**
 * Paket N — CRM ekranlarının ortak parçaları. Ziyaretçiden gelen HER metin (yol, başlık, öğe metni,
 * kaynak adı, talep notu) burada ve ekranlarda React ile METİN olarak basılır; `dangerouslySetInnerHTML`
 * YASAK (sahte olayla panele HTML/JS sokma girişimi kaçışlanmış metin olarak görünür).
 * `dir="auto"`: Arapça/Rusça içerik (sayfa başlığı, isim) kendi yönünde gösterilir.
 */

export type RangePreset = "today" | "7" | "30" | "90" | "custom";

const ISTANBUL_OFFSET_MS = 3 * 3_600_000;

export function istanbulToday(): string {
  return new Date(Date.now() + ISTANBUL_OFFSET_MS).toISOString().slice(0, 10);
}

export function shiftDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function presetRange(preset: Exclude<RangePreset, "custom">): { from: string; to: string } {
  const to = istanbulToday();
  if (preset === "today") return { from: to, to };
  return { from: shiftDay(to, -(Number(preset) - 1)), to };
}

export interface DateRangeValue {
  preset: RangePreset;
  from: string;
  to: string;
}

export function defaultRange(preset: Exclude<RangePreset, "custom"> = "30"): DateRangeValue {
  return { preset, ...presetRange(preset) };
}

export function CrmDateRange({ value, onChange }: { value: DateRangeValue; onChange: (v: DateRangeValue) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Tarih aralığı" className="inline-flex rounded-lg border border-border p-0.5">
        {(["today", "7", "30", "90"] as const).map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={value.preset === p}
            onClick={() => onChange({ preset: p, ...presetRange(p) })}
            className={`rounded-md px-3 py-1.5 text-sm ${value.preset === p ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-muted"}`}
          >
            {p === "today" ? "Bugün" : `${p} gün`}
          </button>
        ))}
      </div>
      <Input
        type="date"
        aria-label="Başlangıç"
        className="w-auto"
        value={value.from}
        max={value.to}
        onChange={(e) => e.target.value && onChange({ preset: "custom", from: e.target.value, to: value.to })}
      />
      <span aria-hidden="true">–</span>
      <Input
        type="date"
        aria-label="Bitiş"
        className="w-auto"
        value={value.to}
        min={value.from}
        onChange={(e) => e.target.value && onChange({ preset: "custom", from: value.from, to: e.target.value })}
      />
    </div>
  );
}

const STATUS_TONE: Record<CrmLeadStatus, "neutral" | "primary" | "success" | "danger" | "warning"> = {
  NEW: "primary",
  CALLED: "neutral",
  UNREACHABLE: "warning",
  APPOINTMENT_GIVEN: "primary",
  CONSULTED: "success",
  TREATMENT_PLANNED: "success",
  TREATED: "success",
  NEGATIVE: "danger",
  SPAM: "neutral",
};

export function LeadStatusBadge({ status }: { status: CrmLeadStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{leadStatusLabel(status)}</Badge>;
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} sa ${minutes % 60} dk`;
  return `${Math.floor(hours / 24)} gün`;
}

export function SlaBadge({ sla }: { sla: CrmLead["sla"] }) {
  switch (sla.state) {
    case "met":
      return <Badge tone="success">Yanıtlandı · {formatMinutes(sla.minutes)}</Badge>;
    case "late":
      return <Badge tone="warning">Geç yanıt · {formatMinutes(sla.minutes)}</Badge>;
    case "pending":
      return <Badge tone="primary">{formatMinutes(sla.minutes)} kaldı</Badge>;
    case "breached":
      return <Badge tone="danger">{formatMinutes(sla.minutes)} gecikti</Badge>;
  }
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(0)} ${currency}`;
  }
}

export function formatRevenue(revenue: Record<string, number>): string {
  const parts = Object.entries(revenue).map(([currency, cents]) => formatMoney(cents, currency));
  return parts.length > 0 ? parts.join(" + ") : "—";
}

export function formatPercent(value: number): string {
  return `%${value.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}`;
}

export function KpiCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium text-foreground/60">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-foreground/50">{hint}</p>}
    </div>
  );
}

/** Basit, kütüphanesiz yatay çubuk — oran 0..1. */
export function MiniBar({ ratio, label }: { ratio: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, ratio * 100));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role={label ? "img" : undefined} aria-label={label}>
      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function SimpleSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)} className={className ?? "w-auto"}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

/** Tablo: kaydırılabilir, başlıklı; boşsa açıklama. */
export function DataTable({
  caption,
  columns,
  rows,
  empty = "Bu aralıkta veri yok.",
}: {
  caption: string;
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: { id: string; cells: Record<string, ReactNode> }[];
  empty?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-xs text-foreground/60">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`px-2 py-2 font-medium ${c.numeric ? "text-end" : "text-start"}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-2 py-6 text-center text-foreground/50">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="border-b border-border/60 last:border-0">
                {columns.map((c) => (
                  <td key={c.key} dir={c.numeric ? undefined : "auto"} className={`px-2 py-2 align-top ${c.numeric ? "text-end tabular-nums" : "text-start break-words"}`}>
                    {row.cells[c.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
