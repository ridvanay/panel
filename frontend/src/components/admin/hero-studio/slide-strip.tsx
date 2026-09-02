"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis, restrictToWindowEdges } from "@dnd-kit/modifiers";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { Slide } from "@/lib/sliders/types";
import { MAX_SLIDES_PER_SLIDER } from "@/lib/sliders/types";

function SlideThumb({ slide }: { slide: Slide }) {
  if (slide.bgType === "image" && slide.bgMedia) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- küçük şerit önizlemesi
      <img src={slide.bgMedia.url} alt="" className="h-full w-full object-cover" />
    );
  }
  const from = slide.bgGradientFrom ?? "#111827";
  const to = slide.bgGradientTo ?? "#111827";
  return <div className="h-full w-full" style={{ background: `linear-gradient(${slide.bgGradientAngle}deg, ${from}, ${to})` }} />;
}

function SlideCard({
  slide,
  index,
  total,
  selected,
  busy,
  onSelect,
  onDuplicate,
  onDelete,
  onToggleActive,
  onMoveUp,
  onMoveDown,
}: {
  slide: Slide;
  index: number;
  total: number;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleActive: (next: boolean) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group space-y-1.5 rounded-lg border border-border bg-surface p-2",
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        !slide.isActive && "opacity-50",
        isDragging && "opacity-60"
      )}
    >
      <button type="button" onClick={onSelect} className="block aspect-video w-full overflow-hidden rounded-md border border-border/60 text-left">
        <SlideThumb slide={slide} />
      </button>
      <div className="flex items-center gap-1">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Sürükle: Slayt ${index + 1}`}
          className="flex h-6 w-6 shrink-0 cursor-grab items-center justify-center rounded-md text-foreground/50 hover:bg-surface-muted active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 truncate text-left text-xs font-medium text-foreground">
          {slide.label || `Slayt ${index + 1}`}
        </button>
        {!slide.isActive && (
          <Badge tone="neutral" size="sm">
            Pasif
          </Badge>
        )}
      </div>
      <div className="flex items-center justify-between gap-1 px-0.5">
        <label className="flex items-center gap-1.5 text-[11px] text-foreground/60">
          <Switch size="sm" checked={slide.isActive} onCheckedChange={onToggleActive} disabled={busy} aria-label="Slayt aktif mi" />
          Aktif
        </label>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Yukarı taşı: ${slide.label || `Slayt ${index + 1}`}`}
            onClick={onMoveUp}
            disabled={busy || index === 0}
          >
            <ArrowUp className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Aşağı taşı: ${slide.label || `Slayt ${index + 1}`}`}
            onClick={onMoveDown}
            disabled={busy || index === total - 1}
          >
            <ArrowDown className="h-3 w-3" />
          </Button>
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Slaytı kopyala" onClick={onDuplicate} disabled={busy}>
            <Copy className="h-3 w-3" />
          </Button>
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Slaytı sil" onClick={onDelete} disabled={busy}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** `DragOverlay` içeriği — sürüklenen slaytın küçük görsel kopyası (bkz. nav-tree-row.tsx::NavTreeRowOverlay paterni). */
function SlideCardOverlay({ slide, index }: { slide: Slide; index: number }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2 shadow-lg ring-2 ring-primary/40">
      <div className="h-8 w-12 shrink-0 overflow-hidden rounded-md border border-border/60">
        <SlideThumb slide={slide} />
      </div>
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
        {slide.label || `Slayt ${index + 1}`}
      </span>
    </div>
  );
}

export function SlideStrip({
  slides,
  selectedSlideId,
  busySlideId,
  onSelect,
  onReorder,
  onAdd,
  onDuplicate,
  onDelete,
  onToggleActive,
  adding,
}: {
  slides: Slide[];
  selectedSlideId: string | null;
  busySlideId: string | null;
  onSelect: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onAdd: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleActive: (id: string, next: boolean) => void;
  adding: boolean;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;
    const ids = slides.map((s) => s.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(ids, oldIndex, newIndex));
  }
  function handleDragCancel() {
    setActiveId(null);
  }

  /** Sürükle-bırağın fail-safe alternatifi — komşu slaytla yer değiştirir. */
  function handleMoveUp(index: number) {
    if (index <= 0) return;
    const ids = slides.map((s) => s.id);
    onReorder(arrayMove(ids, index, index - 1));
  }
  function handleMoveDown(index: number) {
    if (index >= slides.length - 1) return;
    const ids = slides.map((s) => s.id);
    onReorder(arrayMove(ids, index, index + 1));
  }

  const activeSlide = activeId ? slides.find((s) => s.id === activeId) ?? null : null;
  const activeSlideIndex = activeSlide ? slides.indexOf(activeSlide) : -1;

  const atLimit = slides.length >= MAX_SLIDES_PER_SLIDER;

  return (
    <aside className="w-64 shrink-0 overflow-y-auto border-r border-border bg-surface-muted/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-foreground/50">
          Slaytlar ({slides.length}/{MAX_SLIDES_PER_SLIDER})
        </span>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToWindowEdges]}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={slides.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {slides.map((slide, index) => (
              <SlideCard
                key={slide.id}
                slide={slide}
                index={index}
                total={slides.length}
                selected={slide.id === selectedSlideId}
                busy={busySlideId === slide.id}
                onSelect={() => onSelect(slide.id)}
                onDuplicate={() => onDuplicate(slide.id)}
                onDelete={() => onDelete(slide.id)}
                onToggleActive={(next) => onToggleActive(slide.id, next)}
                onMoveUp={() => handleMoveUp(index)}
                onMoveDown={() => handleMoveDown(index)}
              />
            ))}
          </div>
        </SortableContext>
        <DragOverlay>
          {activeSlide ? <SlideCardOverlay slide={activeSlide} index={activeSlideIndex} /> : null}
        </DragOverlay>
      </DndContext>

      <Button type="button" variant="outline" size="sm" className="mt-2 w-full" onClick={onAdd} disabled={atLimit} loading={adding} title={atLimit ? "En fazla 20 slayt eklenebilir." : undefined}>
        <Plus className="h-3.5 w-3.5" />
        Slayt Ekle
      </Button>
    </aside>
  );
}
