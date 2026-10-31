"use client";

import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

export interface OrderedOption {
  id: string;
  label: string;
}

/** Sıralı çoklu seçim: açılır listeden ekle, oklarla sırala, çarpıyla kaldır. */
export function OrderedMultiSelect({
  id,
  label,
  hint,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  options: OrderedOption[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const labelOf = (v: string) => options.find((o) => o.id === v)?.label ?? v;
  const available = options.filter((o) => !value.includes(o.id));

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      <Select
        id={id}
        value=""
        onChange={(e) => {
          if (e.target.value) onChange([...value, e.target.value]);
        }}
        disabled={available.length === 0}
      >
        <option value="">{available.length === 0 ? "Eklenecek kayıt kalmadı" : "Ekle…"}</option>
        {available.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
      {value.length > 0 && (
        <ol className="space-y-1" aria-label={`${label} sırası`}>
          {value.map((v, i) => (
            <li key={v} className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1 text-sm">
              <span>
                <span className="mr-2 text-xs text-foreground/50">{i + 1}.</span>
                {labelOf(v)}
              </span>
              <span className="flex gap-0.5">
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`${labelOf(v)} yukarı taşı`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`${labelOf(v)} aşağı taşı`} disabled={i === value.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`${labelOf(v)} kaldır`} onClick={() => onChange(value.filter((x) => x !== v))}>
                  <X className="h-4 w-4" />
                </Button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {hint && <p className="text-xs text-foreground/60">{hint}</p>}
    </div>
  );
}
