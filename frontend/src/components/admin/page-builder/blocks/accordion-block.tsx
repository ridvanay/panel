import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { newId } from "@/lib/page-builder/registry";
import { ACCORDION_MAX_ITEMS, type AccordionBlock, type AccordionQAItem } from "@/lib/page-builder/types";

export function AccordionBlockEditor({
  block,
  onChange,
  simple = false,
}: {
  block: AccordionBlock;
  onChange: (block: AccordionBlock) => void;
  /** §2.5 tablo B — şablon modunda `allowMultipleOpen` kilitlidir. */
  simple?: boolean;
}) {
  const items = block.data.items;

  function updateItem(id: string, patch: Partial<AccordionQAItem>) {
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
    if (items.length >= ACCORDION_MAX_ITEMS) return;
    onChange({ ...block, data: { ...block.data, items: [...items, { id: newId(), question: "Soru", answer: "" }] } });
  }

  return (
    <div className="space-y-3">
      {!simple && (
        <div className="flex items-center justify-between">
          <label htmlFor={`${block.id}-multi`} className="text-sm font-medium text-foreground">
            Birden fazla panel aynı anda açık kalabilsin
          </label>
          <Switch
            id={`${block.id}-multi`}
            checked={block.data.allowMultipleOpen}
            onCheckedChange={(allowMultipleOpen) => onChange({ ...block, data: { ...block.data, allowMultipleOpen } })}
          />
        </div>
      )}

      <div className="space-y-3">
        {items.map((item, index) => (
          <div key={item.id} className="space-y-2 rounded-lg border border-border/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-foreground/50">Soru {index + 1}</span>
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
                  aria-label="Soruyu sil"
                  onClick={() => removeItem(item.id)}
                  disabled={items.length <= 1}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <Field id={`${item.id}-question`} label="Soru" required>
              {(inputProps) => (
                <Input {...inputProps} value={item.question} onChange={(e) => updateItem(item.id, { question: e.target.value })} />
              )}
            </Field>
            <Field id={`${item.id}-answer`} label="Cevap">
              {(inputProps) => (
                <Textarea {...inputProps} rows={3} value={item.answer} onChange={(e) => updateItem(item.id, { answer: e.target.value })} />
              )}
            </Field>
          </div>
        ))}
      </div>

      <Button type="button" variant="secondary" size="sm" onClick={addItem} disabled={items.length >= ACCORDION_MAX_ITEMS}>
        <Plus className="h-4 w-4" />
        Soru Ekle
      </Button>
    </div>
  );
}
