"use client";

import { useEffect, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { DoctorProfile } from "@/lib/api/types";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import {
  FEATURED_DOCTORS_BUTTON_LABEL_MAX,
  FEATURED_DOCTORS_MAX,
  FEATURED_DOCTORS_SUBTITLE_MAX,
  FEATURED_DOCTORS_TITLE_MAX,
  type FeaturedDoctorsBlock,
  type FeaturedDoctorsColumns,
  type FeaturedDoctorsImageShape,
  type FeaturedDoctorsLocaleContent,
} from "@/lib/page-builder/types";
import { SegmentedToggle } from "./segmented-toggle";

const CONTENT_LOCALES: { code: string; label: string }[] = [
  { code: "tr", label: "Türkçe" },
  { code: "en", label: "English" },
];

const COLUMN_OPTIONS: { value: `${FeaturedDoctorsColumns}`; label: string }[] = [
  { value: "3", label: "3" },
  { value: "4", label: "4" },
];

const SHAPE_OPTIONS: { value: FeaturedDoctorsImageShape; label: string }[] = [
  { value: "circle", label: "Daire" },
  { value: "oval", label: "Oval" },
  { value: "square", label: "Kare" },
];

const EMPTY_CONTENT: FeaturedDoctorsLocaleContent = { title: "", subtitle: "", buttonLabel: "" };

function SelectedDoctorRow({ id, doctor, index, onRemove }: { id: string; doctor: DoctorProfile | undefined; index: number; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const name = doctor ? `${doctor.title} ${doctor.fullName}` : "Bulunamayan doktor";

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn("flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5", isDragging && "opacity-50")}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Sürükle: ${name}`}
        className="flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-md text-foreground/50 hover:bg-muted active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="w-5 shrink-0 text-xs tabular-nums text-foreground/50">{index + 1}.</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{name}</span>
        {doctor?.specialty?.name && <span className="block truncate text-xs text-foreground/60">{doctor.specialty.name}</span>}
      </span>
      {(!doctor || !doctor.isActive) && (
        <Badge tone="warning" size="sm">
          {doctor ? "Pasif — sitede gizli" : "Silinmiş — sitede gizli"}
        </Badge>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Kaldır: ${name}`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground/50 hover:bg-danger/10 hover:text-danger"
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  );
}

/**
 * Öne Çıkan Doktorlar (Paket A3) — doktorları Tele-Sağlık → Doktorlar kayıtlarından seçer; kart
 * içeriği (fotoğraf, ünvan, ad, uzmanlık, bağlantı) doktor kaydından otomatik gelir. `simple`
 * (şablon modu) iken kolon sayısı ve fotoğraf şekli kilitlidir.
 */
export function FeaturedDoctorsBlockEditor({
  block,
  onChange,
  simple = false,
}: {
  block: FeaturedDoctorsBlock;
  onChange: (block: FeaturedDoctorsBlock) => void;
  simple?: boolean;
}) {
  const [activeLocale, setActiveLocale] = useState(CONTENT_LOCALES[0]!.code);
  const [doctors, setDoctors] = useState<DoctorProfile[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const content = block.data.content[activeLocale] ?? EMPTY_CONTENT;
  const doctorIds = block.data.doctorIds ?? [];
  const atLimit = doctorIds.length >= FEATURED_DOCTORS_MAX;

  useEffect(() => {
    let cancelled = false;
    telehealthApi
      .listAdminDoctors({ limit: 100 })
      .then((page) => {
        if (!cancelled) setDoctors(page.items);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(friendlyErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function patchData(patch: Partial<FeaturedDoctorsBlock["data"]>) {
    onChange({ ...block, data: { ...block.data, ...patch } });
  }

  function patchContent(patch: Partial<FeaturedDoctorsLocaleContent>) {
    patchData({ content: { ...block.data.content, [activeLocale]: { ...EMPTY_CONTENT, ...content, ...patch } } });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = doctorIds.indexOf(String(active.id));
    const newIndex = doctorIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    patchData({ doctorIds: arrayMove(doctorIds, oldIndex, newIndex) });
  }

  function addDoctor(id: string) {
    if (!id || doctorIds.includes(id) || atLimit) return;
    patchData({ doctorIds: [...doctorIds, id] });
  }

  const doctorById = new Map((doctors ?? []).map((doctor) => [doctor.id, doctor]));
  const selectable = (doctors ?? []).filter((doctor) => !doctorIds.includes(doctor.id));

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-foreground/60">
        Kartlar Tele-Sağlık → Doktorlar kayıtlarından oluşur; fotoğraf, ünvan, ad ve uzmanlık oradan otomatik gelir. Pasif
        doktorlar sitede otomatik gizlenir.
      </p>

      <div className="space-y-3 rounded-lg border border-border p-3">
        <SegmentedToggle value={activeLocale} options={CONTENT_LOCALES.map((l) => ({ value: l.code, label: l.label }))} onChange={setActiveLocale} />
        <Field id={`${block.id}-${activeLocale}-title`} label="Başlık" hint="Boş bırakılırsa başlık gösterilmez.">
          {(inputProps) => (
            <Input {...inputProps} maxLength={FEATURED_DOCTORS_TITLE_MAX} value={content.title} onChange={(e) => patchContent({ title: e.target.value })} />
          )}
        </Field>
        <Field id={`${block.id}-${activeLocale}-subtitle`} label="Alt başlık" hint="Opsiyonel.">
          {(inputProps) => (
            <Textarea
              {...inputProps}
              rows={2}
              maxLength={FEATURED_DOCTORS_SUBTITLE_MAX}
              value={content.subtitle}
              onChange={(e) => patchContent({ subtitle: e.target.value })}
            />
          )}
        </Field>
        {block.data.showAllButton && (
          <Field id={`${block.id}-${activeLocale}-button`} label="“Tüm doktorlar” buton metni" hint="Boşsa varsayılan metin kullanılır.">
            {(inputProps) => (
              <Input
                {...inputProps}
                maxLength={FEATURED_DOCTORS_BUTTON_LABEL_MAX}
                value={content.buttonLabel ?? ""}
                onChange={(e) => patchContent({ buttonLabel: e.target.value })}
              />
            )}
          </Field>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-medium text-foreground">Doktorlar</p>
          <span className="text-xs tabular-nums text-foreground/60">
            {doctorIds.length}/{FEATURED_DOCTORS_MAX}
          </span>
        </div>
        {loadError && <Alert variant="error">{loadError}</Alert>}
        {doctorIds.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-foreground/60">
            Henüz doktor seçilmedi — seçilmeyen blok sitede görünmez.
          </p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={doctorIds} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1.5" aria-label="Seçili doktorlar (sürükleyerek sıralayın)">
                {doctorIds.map((id, index) => (
                  <SelectedDoctorRow
                    key={id}
                    id={id}
                    index={index}
                    doctor={doctors ? doctorById.get(id) : undefined}
                    onRemove={() => patchData({ doctorIds: doctorIds.filter((x) => x !== id) })}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
        <Field
          id={`${block.id}-add-doctor`}
          label="Doktor ekle"
          hint={atLimit ? `En fazla ${FEATURED_DOCTORS_MAX} doktor seçilebilir.` : "Sırayı sürükleyerek değiştirebilirsiniz."}
        >
          {(inputProps) => (
            <Select {...inputProps} value="" disabled={atLimit || doctors === null} onChange={(e) => addDoctor(e.target.value)}>
              <option value="">{doctors === null && !loadError ? "Yükleniyor…" : "Doktor seçin…"}</option>
              {selectable.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.title} {doctor.fullName}
                  {doctor.isActive ? "" : " (pasif)"}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {!simple && (
        <>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">Masaüstü sütun sayısı</p>
            <SegmentedToggle
              value={`${block.data.columns}` as `${FeaturedDoctorsColumns}`}
              options={COLUMN_OPTIONS}
              onChange={(value) => patchData({ columns: Number(value) as FeaturedDoctorsColumns })}
            />
            <p className="text-xs text-foreground/60">Mobilde 1, tablette 2 sütun sabittir.</p>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-foreground">Fotoğraf şekli</p>
            <SegmentedToggle value={block.data.imageShape} options={SHAPE_OPTIONS} onChange={(value) => patchData({ imageShape: value })} />
          </div>
        </>
      )}

      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
        <label htmlFor={`${block.id}-show-all`} className="text-sm font-medium text-foreground">
          “Tüm doktorlar” butonu
        </label>
        <Switch id={`${block.id}-show-all`} checked={block.data.showAllButton} onCheckedChange={(checked) => patchData({ showAllButton: checked })} />
      </div>
    </div>
  );
}
