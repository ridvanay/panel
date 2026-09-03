"use client";

import { Plus, Trash2 } from "lucide-react";
import type { ProductVariantOption, ProductVariantOptionValue } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card } from "@/components/ui/card";

/** `.claude/architect-scope-ecommerce-pro-template.md` §1.1 — Zod tavanları, istemcide de tekrarlanır (erken geri bildirim). */
const MAX_AXES = 2;
const MAX_VALUES_PER_AXIS = 12;

interface VariantAxesEditorProps {
  value: ProductVariantOption[];
  onChange: (next: ProductVariantOption[]) => void;
}

/**
 * Varyasyon EKSENİ tanımlama paneli (Renk/Beden ekle, değer ekle, swatch hex seçici) —
 * `Product.variantOptions` taslağını yönetir; asıl YAZMA sayfanın ana "Kaydet" akışıyla olur
 * (`UpdateProductRequest.variantOptions`, tam-replace). Kombinasyon SATIRLARI BURADA
 * YÖNETİLMEZ — bkz. `product-variants-panel.tsx`.
 */
export function VariantAxesEditor({ value, onChange }: VariantAxesEditorProps) {
  function addAxis() {
    if (value.length >= MAX_AXES) return;
    onChange([...value, { name: "", type: "TEXT", values: [] }]);
  }

  function updateAxis(index: number, patch: Partial<ProductVariantOption>) {
    onChange(value.map((axis, i) => (i === index ? { ...axis, ...patch } : axis)));
  }

  function removeAxis(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function changeType(index: number, type: "SWATCH" | "TEXT") {
    const axis = value[index];
    updateAxis(index, {
      type,
      values: axis.values.map((v) => ({ value: v.value, swatchHex: type === "SWATCH" ? (v.swatchHex ?? "#000000") : null })),
    });
  }

  function addValue(axisIndex: number) {
    const axis = value[axisIndex];
    if (axis.values.length >= MAX_VALUES_PER_AXIS) return;
    const nextValue: ProductVariantOptionValue = { value: "", swatchHex: axis.type === "SWATCH" ? "#000000" : null };
    updateAxis(axisIndex, { values: [...axis.values, nextValue] });
  }

  function updateValue(axisIndex: number, valueIndex: number, patch: Partial<ProductVariantOptionValue>) {
    const axis = value[axisIndex];
    updateAxis(axisIndex, {
      values: axis.values.map((v, i) => (i === valueIndex ? { ...v, ...patch } : v)),
    });
  }

  function removeValue(axisIndex: number, valueIndex: number) {
    const axis = value[axisIndex];
    updateAxis(axisIndex, { values: axis.values.filter((_, i) => i !== valueIndex) });
  }

  return (
    <div className="space-y-4">
      {value.map((axis, axisIndex) => (
        <Card key={axisIndex} className="space-y-3">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <label className="block text-sm font-medium text-foreground" htmlFor={`axis-name-${axisIndex}`}>
                Eksen adı
              </label>
              <Input
                id={`axis-name-${axisIndex}`}
                value={axis.name}
                placeholder="ör. Renk"
                onChange={(e) => updateAxis(axisIndex, { name: e.target.value })}
              />
            </div>
            <div className="w-44 space-y-1.5">
              <label className="block text-sm font-medium text-foreground" htmlFor={`axis-type-${axisIndex}`}>
                Tür
              </label>
              <Select
                id={`axis-type-${axisIndex}`}
                value={axis.type}
                onChange={(e) => changeType(axisIndex, e.target.value as "SWATCH" | "TEXT")}
              >
                <option value="SWATCH">Renk (swatch)</option>
                <option value="TEXT">Metin (buton)</option>
              </Select>
            </div>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Ekseni sil" onClick={() => removeAxis(axisIndex)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-2">
            {axis.values.map((axisValue, valueIndex) => (
              <div key={valueIndex} className="flex items-center gap-2">
                {axis.type === "SWATCH" && (
                  <input
                    type="color"
                    aria-label={`${axis.name || "Eksen"} değeri ${valueIndex + 1} — renk`}
                    value={axisValue.swatchHex ?? "#000000"}
                    onChange={(e) => updateValue(axisIndex, valueIndex, { swatchHex: e.target.value })}
                    className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
                  />
                )}
                <Input
                  value={axisValue.value}
                  placeholder="ör. Antrasit"
                  aria-label={`${axis.name || "Eksen"} değeri ${valueIndex + 1}`}
                  onChange={(e) => updateValue(axisIndex, valueIndex, { value: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Değeri sil"
                  onClick={() => removeValue(axisIndex, valueIndex)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={axis.values.length >= MAX_VALUES_PER_AXIS}
              onClick={() => addValue(axisIndex)}
            >
              <Plus className="h-3.5 w-3.5" />
              Değer ekle
            </Button>
          </div>
        </Card>
      ))}

      <Button type="button" variant="secondary" disabled={value.length >= MAX_AXES} onClick={addAxis}>
        <Plus className="h-4 w-4" />
        Eksen ekle
      </Button>
      {value.length === 0 && (
        <p className="text-xs text-foreground/60">
          Varyasyon eksenleri (ör. Renk, Beden) eklemezseniz ürün varyasyonsuz kalır ve stok/fiyat yukarıdaki alanlardan
          okunur.
        </p>
      )}
    </div>
  );
}
