import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ColorField } from "@/components/admin/appearance/color-field";
import { newId } from "@/lib/page-builder/registry";
import { SKILL_BAR_MAX_ITEMS, type SkillBarBlock, type SkillBarItem } from "@/lib/page-builder/types";

export function SkillBarBlockEditor({ block, onChange }: { block: SkillBarBlock; onChange: (block: SkillBarBlock) => void }) {
  const items = block.data.items;

  function updateItem(id: string, patch: Partial<SkillBarItem>) {
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
    if (items.length >= SKILL_BAR_MAX_ITEMS) return;
    onChange({ ...block, data: { ...block.data, items: [...items, { id: newId(), label: "Yeni yetenek", percent: 50 }] } });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-3">
        {items.map((item, index) => (
          <div key={item.id} className="space-y-2 rounded-lg border border-border/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-foreground/50">Yetenek {index + 1}</span>
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="icon-xs" aria-label="Yukarı taşı" onClick={() => moveItem(index, -1)} disabled={index === 0}>
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
                  aria-label="Yeteneği sil"
                  onClick={() => removeItem(item.id)}
                  disabled={items.length <= 1}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <Field id={`${item.id}-label`} label="Başlık" required>
              {(p) => <Input {...p} value={item.label} onChange={(e) => updateItem(item.id, { label: e.target.value })} />}
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field id={`${item.id}-percent`} label="Yüzde" required>
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min={0}
                    max={100}
                    value={item.percent}
                    onChange={(e) => {
                      const raw = Number(e.target.value);
                      const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 0;
                      updateItem(item.id, { percent: clamped });
                    }}
                  />
                )}
              </Field>
              <ColorField
                id={`${item.id}-color`}
                label="Çubuk rengi (opsiyonel)"
                value={item.color ?? "#4f46e5"}
                onChange={(color) => updateItem(item.id, { color })}
              />
            </div>
          </div>
        ))}
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={addItem} disabled={items.length >= SKILL_BAR_MAX_ITEMS}>
        <Plus className="h-4 w-4" />
        Yetenek Ekle
      </Button>
    </div>
  );
}
