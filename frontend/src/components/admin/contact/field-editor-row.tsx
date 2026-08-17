"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Lock, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { slugifyVariableKey } from "@/lib/email-blocks/variable-key";
import type { ContactFieldType, ContactFormField } from "@/lib/api/types";

const TYPE_LABEL: Record<ContactFieldType, string> = {
  TEXT: "Metin",
  EMAIL: "E-posta",
  PHONE: "Telefon",
  TEXTAREA: "Uzun Metin",
  SELECT: "Seçim Listesi",
  CHECKBOX: "Onay Kutusu",
};

interface FieldEditorRowProps {
  field: ContactFormField;
  onChange: (next: ContactFormField) => void;
  onRemove: () => void;
}

/** İletişim formu alan düzenleyici satırı — dnd-kit sıralanabilir, sistem alanları (name/email/message) key/type kilitli. */
export function FieldEditorRow({ field, onChange, onRemove }: FieldEditorRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  function handleLabelChange(label: string) {
    if (field.isSystem) {
      onChange({ ...field, label });
      return;
    }
    onChange({ ...field, label });
  }

  function updateOption(index: number, patch: Partial<{ value: string; label: string }>) {
    const options = field.options.map((opt, i) => (i === index ? { ...opt, ...patch } : opt));
    onChange({ ...field, options });
  }

  function addOption() {
    onChange({ ...field, options: [...field.options, { value: "", label: "" }] });
  }

  function removeOption(index: number) {
    onChange({ ...field, options: field.options.filter((_, i) => i !== index) });
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm", isDragging && "opacity-50")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Sürükle: ${field.label || "Adsız alan"}`}
          className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-md text-foreground/40 hover:bg-surface-muted hover:text-foreground/70 active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <div className="min-w-32 flex-1 space-y-1">
          <label className="block text-xs font-medium text-foreground/60">Etiket</label>
          <Input value={field.label} onChange={(e) => handleLabelChange(e.target.value)} />
        </div>

        <div className="min-w-40 space-y-1">
          <label className="block text-xs font-medium text-foreground/60">Anahtar</label>
          {field.isSystem ? (
            <div className="flex h-8 items-center gap-1.5 font-mono text-xs text-foreground/60">
              <Lock className="h-3 w-3" />
              {field.key}
            </div>
          ) : (
            <Input
              className="font-mono text-xs"
              value={field.key}
              onChange={(e) => onChange({ ...field, key: slugifyVariableKey(e.target.value) })}
            />
          )}
        </div>

        <div className="min-w-32 space-y-1">
          <label className="block text-xs font-medium text-foreground/60">Tip</label>
          {field.isSystem ? (
            <Badge tone="neutral" size="sm">
              {TYPE_LABEL[field.type]}
            </Badge>
          ) : (
            <Select value={field.type} onChange={(e) => onChange({ ...field, type: e.target.value as ContactFieldType })}>
              {(Object.keys(TYPE_LABEL) as ContactFieldType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Switch checked={field.required} onCheckedChange={(required) => onChange({ ...field, required })} aria-label="Zorunlu" />
          <span className="text-xs text-foreground/60">Zorunlu</span>
        </div>

        <Button type="button" variant="ghost" size="icon-sm" aria-label="Alanı sil" disabled={field.isSystem} onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-foreground/60">Yer tutucu (placeholder)</label>
          <Input value={field.placeholder ?? ""} onChange={(e) => onChange({ ...field, placeholder: e.target.value || null })} />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-foreground/60">Yardım metni</label>
          <Input value={field.helpText ?? ""} onChange={(e) => onChange({ ...field, helpText: e.target.value || null })} />
        </div>
      </div>

      {field.type === "SELECT" && (
        <div className="space-y-2 rounded-lg border border-border/60 bg-surface-muted/50 p-3">
          <p className="text-xs font-medium text-foreground/70">Seçenekler</p>
          {field.options.map((opt, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                className="h-8"
                placeholder="Değer"
                value={opt.value}
                onChange={(e) => updateOption(index, { value: e.target.value })}
              />
              <Input
                className="h-8"
                placeholder="Etiket"
                value={opt.label}
                onChange={(e) => updateOption(index, { label: e.target.value })}
              />
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Seçeneği sil" onClick={() => removeOption(index)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addOption}>
            <Plus className="h-3.5 w-3.5" />
            Seçenek Ekle
          </Button>
        </div>
      )}
    </div>
  );
}
