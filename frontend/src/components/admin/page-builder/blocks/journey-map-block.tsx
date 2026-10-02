import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { IconSelect, ItemToolbar, moveInList } from "@/components/admin/page-builder/about-template-form";
import { newId } from "@/lib/page-builder/registry";
import { HOME_MAX_JOURNEY_COUNTRIES, HOME_MAX_JOURNEY_STEPS, HOME_MIN_JOURNEY_STEPS } from "@/lib/home-page";
import type { HomeCountry, HomeItem } from "@/lib/home-page";
import type { JourneyMapBlock } from "@/lib/page-builder/types";

/**
 * `home-template-form.tsx::itemList`/`countryList` İLE AYNI desen (paylaşılan `IconSelect`/
 * `ItemToolbar`/`moveInList` yardımcıları yeniden kullanılır) — ama `ContentBlock`'u doğrudan
 * değiştiren genel blok-editörü sözleşmesine (`AccordionBlockEditor` İLE AYNI şekil) uyarlanmış
 * hâli. Sınırlar (`HOME_MIN_JOURNEY_STEPS` vb.) `lib/home-page.ts`'ten import edilir — burada
 * YENİDEN TANIMLANMAZ (home şablonuyla SAYISAL OLARAK BİREBİR AYNI kalmalı).
 */
export function JourneyMapBlockEditor({ block, onChange }: { block: JourneyMapBlock; onChange: (block: JourneyMapBlock) => void }) {
  const { eyebrow, title, body, steps, countries } = block.data;

  function patch(next: Partial<JourneyMapBlock["data"]>) {
    onChange({ ...block, data: { ...block.data, ...next } });
  }

  function updateStep(id: string, next: Partial<HomeItem>) {
    patch({ steps: steps.map((s) => (s.id === id ? { ...s, ...next } : s)) });
  }

  function updateCountry(id: string, next: Partial<HomeCountry>) {
    patch({ countries: countries.map((c) => (c.id === id ? { ...c, ...next } : c)) });
  }

  return (
    <div className="space-y-4">
      <Field id={`${block.id}-eyebrow`} label="Üst etiket">
        {(inputProps) => <Input {...inputProps} value={eyebrow} onChange={(e) => patch({ eyebrow: e.target.value })} />}
      </Field>
      <Field id={`${block.id}-title`} label="Başlık">
        {(inputProps) => <Input {...inputProps} value={title} onChange={(e) => patch({ title: e.target.value })} />}
      </Field>
      <Field id={`${block.id}-body`} label="Açıklama">
        {(inputProps) => <Textarea {...inputProps} rows={3} value={body} onChange={(e) => patch({ body: e.target.value })} />}
      </Field>

      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">
          Adımlar ({HOME_MIN_JOURNEY_STEPS}–{HOME_MAX_JOURNEY_STEPS} arası)
        </p>
        {steps.map((step, index) => (
          <div key={step.id} className="space-y-3 rounded-lg border border-border/60 p-3">
            <ItemToolbar
              label={`Adım ${index + 1}`}
              index={index}
              count={steps.length}
              onMove={(direction) => patch({ steps: moveInList(steps, index, direction) })}
              onRemove={() => {
                if (steps.length > HOME_MIN_JOURNEY_STEPS) patch({ steps: steps.filter((s) => s.id !== step.id) });
              }}
            />
            <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_1fr]">
              <IconSelect id={`${step.id}-icon`} value={step.icon} onChange={(icon) => updateStep(step.id, { icon })} />
              <Field id={`${step.id}-title`} label="Başlık">
                {(inputProps) => <Input {...inputProps} value={step.title} onChange={(e) => updateStep(step.id, { title: e.target.value })} />}
              </Field>
            </div>
            <Field id={`${step.id}-text`} label="Metin">
              {(inputProps) => <Textarea {...inputProps} rows={2} value={step.text} onChange={(e) => updateStep(step.id, { text: e.target.value })} />}
            </Field>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={steps.length >= HOME_MAX_JOURNEY_STEPS}
          onClick={() => patch({ steps: [...steps, { id: newId(), icon: "BadgeCheck", title: "", text: "" }] })}
        >
          <Plus className="h-3.5 w-3.5" />
          Adım ekle
        </Button>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">Ülkeler (en fazla {HOME_MAX_JOURNEY_COUNTRIES})</p>
        {countries.map((country, index) => (
          <div key={country.id} className="flex items-end gap-2">
            <div className="flex-1">
              <Field id={`${country.id}-label`} label={`Ülke ${index + 1}`}>
                {(inputProps) => (
                  <Input {...inputProps} value={country.label} placeholder="Ör. Almanya" onChange={(e) => updateCountry(country.id, { label: e.target.value })} />
                )}
              </Field>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Ülkeyi sil"
              onClick={() => patch({ countries: countries.filter((c) => c.id !== country.id) })}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={countries.length >= HOME_MAX_JOURNEY_COUNTRIES}
          onClick={() => patch({ countries: [...countries, { id: newId(), label: "" }] })}
        >
          <Plus className="h-3.5 w-3.5" />
          Ülke ekle
        </Button>
      </div>
    </div>
  );
}
