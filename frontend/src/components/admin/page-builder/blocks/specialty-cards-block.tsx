"use client";

import { useState } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  SPECIALTY_CARDS_SUBTITLE_MAX,
  SPECIALTY_CARDS_TITLE_MAX,
  type SpecialtyCardsBlock,
  type SpecialtyCardsColumns,
  type SpecialtyCardsImageShape,
} from "@/lib/page-builder/types";
import { SegmentedToggle } from "./segmented-toggle";

/** Başlık/alt başlığı düzenlenebilen diller — site sözlüğü olan diller (EN/TR). */
const CONTENT_LOCALES: { code: string; label: string }[] = [
  { code: "tr", label: "Türkçe" },
  { code: "en", label: "English" },
];

const COLUMN_OPTIONS: { value: `${SpecialtyCardsColumns}`; label: string }[] = [
  { value: "3", label: "3" },
  { value: "4", label: "4" },
  { value: "6", label: "6" },
];

const SHAPE_OPTIONS: { value: SpecialtyCardsImageShape; label: string }[] = [
  { value: "circle", label: "Daire" },
  { value: "square", label: "Kare" },
  { value: "rounded", label: "Köşeli" },
];

/**
 * Uzmanlık Kartları bloğu — kartların İÇERİĞİ (ad, görsel, açıklama, bağlantı) Uzmanlıklar
 * modülünden otomatik gelir (Tele-Sağlık → Uzmanlıklar). Burada yalnızca başlıklar ve görünüm
 * ayarları düzenlenir. `simple` (şablon modu) iken kolon sayısı ve görsel şekli kilitlidir.
 */
export function SpecialtyCardsBlockEditor({
  block,
  onChange,
  simple = false,
}: {
  block: SpecialtyCardsBlock;
  onChange: (block: SpecialtyCardsBlock) => void;
  simple?: boolean;
}) {
  const [activeLocale, setActiveLocale] = useState(CONTENT_LOCALES[0]!.code);
  const content = block.data.content[activeLocale] ?? { title: "", subtitle: "" };

  function patchData(patch: Partial<SpecialtyCardsBlock["data"]>) {
    onChange({ ...block, data: { ...block.data, ...patch } });
  }

  function patchContent(patch: Partial<typeof content>) {
    patchData({ content: { ...block.data.content, [activeLocale]: { ...content, ...patch } } });
  }

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-foreground/60">
        Kartlar Tele-Sağlık → Uzmanlıklar sayfasındaki <strong>aktif</strong> uzmanlıklardan, oradaki sırayla otomatik
        oluşturulur. Görsel ve açıklama o sayfadan düzenlenir.
      </p>

      <div className="space-y-3 rounded-lg border border-border p-3">
        <SegmentedToggle
          value={activeLocale}
          options={CONTENT_LOCALES.map((l) => ({ value: l.code, label: l.label }))}
          onChange={setActiveLocale}
        />
        <Field id={`${block.id}-${activeLocale}-title`} label="Başlık" hint="Boş bırakılırsa başlık gösterilmez.">
          {(inputProps) => (
            <Input
              {...inputProps}
              maxLength={SPECIALTY_CARDS_TITLE_MAX}
              value={content.title}
              onChange={(e) => patchContent({ title: e.target.value })}
            />
          )}
        </Field>
        <Field id={`${block.id}-${activeLocale}-subtitle`} label="Alt başlık" hint="Opsiyonel.">
          {(inputProps) => (
            <Textarea
              {...inputProps}
              rows={2}
              maxLength={SPECIALTY_CARDS_SUBTITLE_MAX}
              value={content.subtitle}
              onChange={(e) => patchContent({ subtitle: e.target.value })}
            />
          )}
        </Field>
      </div>

      {!simple && (
        <>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">Masaüstü kolon sayısı</p>
            <SegmentedToggle
              value={`${block.data.columns}` as `${SpecialtyCardsColumns}`}
              options={COLUMN_OPTIONS}
              onChange={(value) => patchData({ columns: Number(value) as SpecialtyCardsColumns })}
            />
            <p className="text-xs text-foreground/60">Mobilde 2, tablette 3 kolon sabittir.</p>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">Görsel şekli</p>
            <SegmentedToggle value={block.data.imageShape} options={SHAPE_OPTIONS} onChange={(value) => patchData({ imageShape: value })} />
          </div>
        </>
      )}

      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
        <label htmlFor={`${block.id}-show-description`} className="text-sm font-medium text-foreground">
          Açıklamayı göster
        </label>
        <Switch
          id={`${block.id}-show-description`}
          checked={block.data.showDescription}
          onCheckedChange={(checked) => patchData({ showDescription: checked })}
        />
      </div>
    </div>
  );
}
