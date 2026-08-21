import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { newId } from "@/lib/page-builder/registry";
import { COUNTER_MAX_ITEMS, type CounterBlock, type CounterItem } from "@/lib/page-builder/types";

export function CounterBlockEditor({ block, onChange }: { block: CounterBlock; onChange: (block: CounterBlock) => void }) {
  const items = block.data.items;

  function updateItem(id: string, patch: Partial<CounterItem>) {
    onChange({ ...block, data: { ...block.data, items: items.map((item) => (item.id === id ? { ...item, ...patch } : item)) } });
  }

  function removeItem(id: string) {
    onChange({ ...block, data: { ...block.data, items: items.filter((item) => item.id !== id) } });
  }

  function moveItem(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange({ ...block, data: { ...block.data, items: next } });
  }

  function addItem() {
    if (items.length >= COUNTER_MAX_ITEMS) return;
    onChange({ ...block, data: { ...block.data, items: [...items, { id: newId(), value: 100, label: "Etiket" }] } });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-3">
        {items.map((item, index) => (
          <div key={item.id} className="space-y-2 rounded-lg border border-border/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-foreground/50">İstatistik {index + 1}</span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Yukarı taşı"
                  onClick={() => moveItem(index, -1)}
                  disabled={index === 0}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Aşağı taşı"
                  onClick={() => moveItem(index, 1)}
                  disabled={index === items.length - 1}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="İstatistiği sil"
                  onClick={() => removeItem(item.id)}
                  disabled={items.length <= 1}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Field id={`${item.id}-prefix`} label="Önek">
                {(inputProps) => (
                  <Input
                    {...inputProps}
                    value={item.prefix ?? ""}
                    onChange={(e) => updateItem(item.id, { prefix: e.target.value || undefined })}
                  />
                )}
              </Field>
              <Field id={`${item.id}-value`} label="Değer" required>
                {(inputProps) => (
                  <Input
                    {...inputProps}
                    type="number"
                    value={item.value}
                    onChange={(e) => updateItem(item.id, { value: Number(e.target.value) || 0 })}
                  />
                )}
              </Field>
              <Field id={`${item.id}-suffix`} label="Sonek">
                {(inputProps) => (
                  <Input
                    {...inputProps}
                    value={item.suffix ?? ""}
                    onChange={(e) => updateItem(item.id, { suffix: e.target.value || undefined })}
                  />
                )}
              </Field>
            </div>
            <Field id={`${item.id}-label`} label="Etiket" required>
              {(inputProps) => (
                <Input {...inputProps} value={item.label} onChange={(e) => updateItem(item.id, { label: e.target.value })} />
              )}
            </Field>
          </div>
        ))}
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={addItem} disabled={items.length >= COUNTER_MAX_ITEMS}>
        <Plus className="h-4 w-4" />
        İstatistik Ekle
      </Button>
    </div>
  );
}
