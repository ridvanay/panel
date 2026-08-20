import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { newId } from "@/lib/page-builder/registry";
import { TABS_MAX_ITEMS, type TabItem, type TabsBlock } from "@/lib/page-builder/types";
import { SegmentedToggle } from "./segmented-toggle";

const ORIENTATION_OPTIONS: { value: TabsBlock["data"]["orientation"]; label: string }[] = [
  { value: "horizontal", label: "Yatay" },
  { value: "vertical", label: "Dikey" },
];

export function TabsBlockEditor({ block, onChange }: { block: TabsBlock; onChange: (block: TabsBlock) => void }) {
  const items = block.data.items;

  function updateItem(id: string, patch: Partial<TabItem>) {
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
    if (items.length >= TABS_MAX_ITEMS) return;
    onChange({
      ...block,
      data: { ...block.data, items: [...items, { id: newId(), label: `Sekme ${items.length + 1}`, content: "" }] },
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Yön</p>
        <SegmentedToggle
          value={block.data.orientation}
          options={ORIENTATION_OPTIONS}
          onChange={(orientation) => onChange({ ...block, data: { ...block.data, orientation } })}
        />
      </div>

      <div className="space-y-3">
        {items.map((item, index) => (
          <div key={item.id} className="space-y-2 rounded-lg border border-border/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-foreground/50">Sekme {index + 1}</span>
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
                  aria-label="Sekmeyi sil"
                  onClick={() => removeItem(item.id)}
                  disabled={items.length <= 1}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <Field id={`${item.id}-label`} label="Sekme adı" required>
              {(inputProps) => <Input {...inputProps} value={item.label} onChange={(e) => updateItem(item.id, { label: e.target.value })} />}
            </Field>
            <Field id={`${item.id}-content`} label="İçerik">
              {(inputProps) => (
                <Textarea {...inputProps} rows={4} value={item.content} onChange={(e) => updateItem(item.id, { content: e.target.value })} />
              )}
            </Field>
          </div>
        ))}
      </div>

      <Button type="button" variant="secondary" size="sm" onClick={addItem} disabled={items.length >= TABS_MAX_ITEMS}>
        <Plus className="h-4 w-4" />
        Sekme Ekle
      </Button>
    </div>
  );
}
