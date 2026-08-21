import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import { newId } from "@/lib/page-builder/registry";
import { TESTIMONIAL_MAX_ITEMS, type TestimonialBlock, type TestimonialItem } from "@/lib/page-builder/types";

export function TestimonialBlockEditor({
  block,
  onChange,
}: {
  block: TestimonialBlock;
  onChange: (block: TestimonialBlock) => void;
}) {
  const items = block.data.items;

  function updateItem(id: string, patch: Partial<TestimonialItem>) {
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
    if (items.length >= TESTIMONIAL_MAX_ITEMS) return;
    onChange({ ...block, data: { ...block.data, items: [...items, { id: newId(), quote: "", authorName: "" }] } });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-3">
        {items.map((item, index) => (
          <div key={item.id} className="space-y-2 rounded-lg border border-border/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-foreground/50">Yorum {index + 1}</span>
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
                  aria-label="Yorumu sil"
                  onClick={() => removeItem(item.id)}
                  disabled={items.length <= 1}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <Field id={`${item.id}-quote`} label="Yorum metni" required>
              {(inputProps) => (
                <Textarea {...inputProps} rows={3} value={item.quote} onChange={(e) => updateItem(item.id, { quote: e.target.value })} />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field id={`${item.id}-author`} label="Ad Soyad" required>
                {(inputProps) => (
                  <Input {...inputProps} value={item.authorName} onChange={(e) => updateItem(item.id, { authorName: e.target.value })} />
                )}
              </Field>
              <Field id={`${item.id}-role`} label="Unvan (opsiyonel)">
                {(inputProps) => (
                  <Input
                    {...inputProps}
                    value={item.authorRole ?? ""}
                    onChange={(e) => updateItem(item.id, { authorRole: e.target.value || undefined })}
                  />
                )}
              </Field>
            </div>
            <ImageUploadField
              id={`${item.id}-avatar`}
              label="Fotoğraf (opsiyonel)"
              value={item.avatarUrl ?? ""}
              onChange={(avatarUrl) => updateItem(item.id, { avatarUrl: avatarUrl || undefined })}
              previewShape="circle"
            />
            <Field id={`${item.id}-rating`} label="Puan (opsiyonel)">
              {(inputProps) => (
                <Select
                  {...inputProps}
                  value={item.rating ?? 0}
                  onChange={(e) => {
                    const rating = Number(e.target.value);
                    updateItem(item.id, { rating: rating === 0 ? undefined : (rating as TestimonialItem["rating"]) });
                  }}
                >
                  <option value={0}>Yok</option>
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <option key={rating} value={rating}>
                      {rating} yıldız
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        ))}
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={addItem} disabled={items.length >= TESTIMONIAL_MAX_ITEMS}>
        <Plus className="h-4 w-4" />
        Yorum Ekle
      </Button>
    </div>
  );
}
