"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DoctorAvailabilityRuleInput } from "@/lib/api/types";

/**
 * `.claude/architect-scope-telehealth-template.md` §3.4/§5.1 — haftalık TEKRARLAYAN müsaitlik
 * ızgara editörü. `dayOfWeek` ISO-8601 (1 = Pazartesi … 7 = Pazar, JS'in 0-6/Pazar=0 konvansiyonu
 * KULLANILMAZ, bkz. backend `lib/availability.ts` yorumu) — bu editör de AYNI kuralı izler.
 * `startMinute`/`endMinute` doktorun KENDİ `timeZone`'undaki DUVAR SAATİDİR (§4.2) — editör
 * saat/dakika seçicisi bunu doğrudan dakikaya çevirir, herhangi bir dönüşüm/UTC hesaplaması
 * YAPMAZ (o backend'in `lib/timezone.ts`'te yaptığı iş).
 */

const DAY_LABELS: { value: number; label: string }[] = [
  { value: 1, label: "Pazartesi" },
  { value: 2, label: "Salı" },
  { value: 3, label: "Çarşamba" },
  { value: 4, label: "Perşembe" },
  { value: 5, label: "Cuma" },
  { value: 6, label: "Cumartesi" },
  { value: 7, label: "Pazar" },
];

function minutesToTimeInput(minutes: number): string {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function timeInputToMinutes(value: string): number {
  const [h, m] = value.split(":").map((v) => Number(v));
  return (h || 0) * 60 + (m || 0);
}

export function WeeklyAvailabilityEditor({
  rules,
  onChange,
}: {
  rules: DoctorAvailabilityRuleInput[];
  onChange: (rules: DoctorAvailabilityRuleInput[]) => void;
}) {
  function addWindow(dayOfWeek: number) {
    if (rules.length >= 21) return;
    onChange([...rules, { dayOfWeek, startMinute: 540, endMinute: 1020, isActive: true }]);
  }

  function removeWindow(index: number) {
    onChange(rules.filter((_, i) => i !== index));
  }

  function updateWindow(index: number, patch: Partial<DoctorAvailabilityRuleInput>) {
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  }

  return (
    <div className="space-y-4">
      {DAY_LABELS.map((day) => {
        const dayWindows = rules
          .map((rule, index) => ({ rule, index }))
          .filter(({ rule }) => rule.dayOfWeek === day.value);

        return (
          <div key={day.value} className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{day.label}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={rules.length >= 21}
                onClick={() => addWindow(day.value)}
                aria-label={`${day.label} için müsaitlik penceresi ekle`}
              >
                <Plus className="h-3.5 w-3.5" />
                Pencere Ekle
              </Button>
            </div>

            {dayWindows.length === 0 ? (
              <p className="mt-2 text-xs text-foreground/40">Bu gün için müsaitlik tanımlanmadı.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {dayWindows.map(({ rule, index }) => (
                  <div key={index} className="flex flex-wrap items-center gap-2">
                    <Input
                      type="time"
                      aria-label={`${day.label} başlangıç saati`}
                      className="w-auto"
                      value={minutesToTimeInput(rule.startMinute)}
                      onChange={(e) => updateWindow(index, { startMinute: timeInputToMinutes(e.target.value) })}
                    />
                    <span className="text-xs text-foreground/50">—</span>
                    <Input
                      type="time"
                      aria-label={`${day.label} bitiş saati`}
                      className="w-auto"
                      value={minutesToTimeInput(rule.endMinute)}
                      onChange={(e) => updateWindow(index, { endMinute: timeInputToMinutes(e.target.value) })}
                    />
                    {rule.startMinute >= rule.endMinute && (
                      <span className="text-xs text-danger">Bitiş, başlangıçtan sonra olmalı.</span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Pencereyi kaldır"
                      onClick={() => removeWindow(index)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <p className="text-xs text-foreground/50">
        En fazla 21 pencere (haftalık 3 pencere × 7 gün) tanımlanabilir. Saatler doktorun kendi zaman diliminin duvar
        saatidir.
      </p>
    </div>
  );
}
