"use client";

import { useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, GalleryHorizontal, GripVertical, Images, LayoutDashboard, LayoutGrid, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { MediaPicker } from "@/components/admin/media/media-picker";
import { cn } from "@/lib/utils";
import { GALLERY_MAX_IMAGES, type GalleryBlock, type GalleryLayout } from "@/lib/page-builder/types";
import { newId } from "@/lib/page-builder/registry";
import type { Media } from "@/lib/api/types";

type GalleryImage = { url: string; alt: string };

/**
 * design-notes-page-builder-gallery.md madde A.2 — icon-toggle-group, `style-controls.tsx`'teki
 * `AlignControl` vb. ile BİREBİR aynı görsel dil (ikon + kısa metin, `size="sm"`).
 */
const GALLERY_LAYOUT_OPTIONS: { value: GalleryLayout; label: string; icon: LucideIcon; hint: string }[] = [
  { value: "grid", label: "Izgara", icon: LayoutGrid, hint: "Eşit boyutlu sütun ızgarası" },
  { value: "carousel", label: "Kaydırmalı", icon: GalleryHorizontal, hint: "Yatay kayan slayt görünümü" },
  { value: "masonry", label: "Masonry", icon: LayoutDashboard, hint: "Pinterest tarzı, farklı yükseklikte serbest düzen" },
];

function GalleryLayoutControl({ value, onChange }: { value: GalleryLayout; onChange: (value: GalleryLayout) => void }) {
  return (
    <div className="inline-flex flex-wrap items-center gap-0.5 rounded-md border border-border/60 bg-surface-muted p-0.5">
      {GALLERY_LAYOUT_OPTIONS.map(({ value: optionValue, label, icon: Icon, hint }) => (
        <Button
          key={optionValue}
          type="button"
          size="sm"
          variant={value === optionValue ? "secondary" : "ghost"}
          aria-pressed={value === optionValue}
          title={hint}
          onClick={() => onChange(optionValue)}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </Button>
      ))}
    </div>
  );
}

/**
 * madde A.4 — sürükleme kapsamı DIŞ konteynerde (görsel + alt input birlikte tek birim olarak
 * taşınır), `{...attributes} {...listeners}` SADECE tutamaç butonunda. Opak rozetler
 * (glassmorphism/blur YOK — görsel yön kararı Flat), a11y: butonlar DOM'dan kaldırılmaz.
 */
function GalleryImageCard({
  id,
  image,
  index,
  onAltChange,
  onRemove,
}: {
  id: string;
  image: GalleryImage;
  index: number;
  onAltChange: (alt: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className={cn("group space-y-1", isDragging && "opacity-50")}>
      <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element -- yüklenen/harici görsel URL'si, next/image remotePatterns henüz tanımlı değil */}
        <img src={image.url} alt="" loading="lazy" className="h-full w-full object-cover" />

        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Sürükle: Görsel ${index + 1}`}
          className={cn(
            "absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-md border border-border/60",
            "bg-background text-foreground/60 shadow-sm cursor-grab active:cursor-grabbing",
            "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
          )}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          aria-label={`Görseli kaldır: Görsel ${index + 1}`}
          onClick={onRemove}
          className={cn(
            "absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-border/60",
            "bg-background text-foreground/60 shadow-sm transition-opacity",
            "hover:border-danger/40 hover:bg-danger/10 hover:text-danger",
            "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 max-sm:opacity-100"
          )}
        >
          <X className="h-3.5 w-3.5" />
        </button>

        {!image.alt.trim() && (
          <span
            className="absolute bottom-1 left-1 flex h-5 w-5 items-center justify-center rounded-full bg-warning text-warning-foreground shadow-sm"
            title="Alt metin eksik"
          >
            <AlertTriangle className="h-3 w-3" />
          </span>
        )}
      </div>

      <Input
        aria-label={`Görsel ${index + 1} alt metni`}
        className="h-7 text-xs"
        placeholder="Alt metin…"
        value={image.alt}
        onChange={(e) => onAltChange(e.target.value)}
      />
    </div>
  );
}

/**
 * WordPress-tarzı çoklu görsel galeri editörü — design-notes-page-builder-gallery.md madde A.
 * dnd-kit sıralama id'si: `images[]`'in kendisinde `id` yok, bu yüzden SADECE editör state'i için
 * `localIds` (index'e paralel, `crypto.randomUUID()`) tutulur; persisted şekle (`{url,alt}[]`)
 * asla sızmaz.
 */
export function GalleryBlockEditor({
  block,
  onChange,
  simple = false,
}: {
  block: GalleryBlock;
  onChange: (block: GalleryBlock) => void;
  /** §2.5 tablo B — şablon modunda düzen (`layout`) kontrolü kilitlidir. */
  simple?: boolean;
}) {
  const [localIds, setLocalIds] = useState<string[]>(() => block.data.images.map(() => newId()));
  const [pickerOpen, setPickerOpen] = useState(false);

  const images = block.data.images;
  const layout = block.data.layout ?? "grid";
  const atLimit = images.length >= GALLERY_MAX_IMAGES;
  const nearLimit = images.length >= GALLERY_MAX_IMAGES - 5;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function emit(nextImages: GalleryImage[], nextLayout: GalleryLayout = layout) {
    onChange({ ...block, data: { images: nextImages, layout: nextLayout } });
  }

  function updateAlt(index: number, alt: string) {
    emit(images.map((img, i) => (i === index ? { ...img, alt } : img)));
  }

  function removeImage(index: number) {
    emit(images.filter((_, i) => i !== index));
    setLocalIds((prev) => prev.filter((_, i) => i !== index));
  }

  function handleLayoutChange(nextLayout: GalleryLayout) {
    emit(images, nextLayout);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localIds.indexOf(String(active.id));
    const newIndex = localIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    setLocalIds((prev) => arrayMove(prev, oldIndex, newIndex));
    emit(arrayMove(images, oldIndex, newIndex));
  }

  function handleMediaSelect(selected: Media[]) {
    if (selected.length === 0) return;
    emit([...images, ...selected.map((media) => ({ url: media.url, alt: media.altText ?? "" }))]);
    setLocalIds((prev) => [...prev, ...selected.map(() => newId())]);
  }

  function openPicker() {
    setPickerOpen(true);
  }

  return (
    <div className="space-y-3">
      {images.length === 0 ? (
        <EmptyState
          icon={Images}
          title="Henüz görsel eklenmedi"
          description="Galeriye eklemek için kütüphaneden görsel seçin veya yeni bir görsel yükleyin."
          action={
            <Button type="button" onClick={openPicker}>
              <Images className="h-4 w-4" />
              Görsel Ekle
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {!simple && <GalleryLayoutControl value={layout} onChange={handleLayoutChange} />}
            <div className="flex items-center gap-2">
              <span className={cn("text-xs tabular-nums", nearLimit ? "text-warning" : "text-foreground/60")}>
                {images.length} / {GALLERY_MAX_IMAGES}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={atLimit}
                title={atLimit ? "En fazla 30 görsel eklenebilir." : undefined}
                onClick={openPicker}
              >
                <Images className="h-3.5 w-3.5" />
                Görsel Ekle
              </Button>
            </div>
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={localIds} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-3">
                {images.map((image, index) => (
                  <GalleryImageCard
                    key={localIds[index]}
                    id={localIds[index]}
                    image={image}
                    index={index}
                    onAltChange={(alt) => updateAlt(index, alt)}
                    onRemove={() => removeImage(index)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </>
      )}

      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        multiple
        maxSelection={Math.max(1, GALLERY_MAX_IMAGES - images.length)}
        onSelect={handleMediaSelect}
      />
    </div>
  );
}
