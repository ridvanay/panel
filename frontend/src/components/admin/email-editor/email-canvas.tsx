"use client";

import { useMemo, useState } from "react";
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
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { emailBlockRegistry } from "@/lib/email-blocks/registry";
import type { EmailBlock } from "@/lib/api/types";

interface EmailBlockCardProps {
  block: EmailBlock;
  index: number;
  total: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
}

/** design-notes §A.2 — seçili blok: kenarlık kalınlığı değişimi (1px → 4px) + `Badge` "Düzenleniyor". */
function EmailBlockCard({ block, index, total, selected, onSelect, onMove, onRemove }: EmailBlockCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const meta = emailBlockRegistry[block.type];
  const Icon = meta.icon;

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => onSelect(block.id)}
      className={cn(
        "cursor-pointer rounded-xl bg-card p-4 shadow-sm transition-colors",
        selected
          ? "border-l-4 border-l-primary border-y border-r border-primary/20 bg-primary/8"
          : "border border-border",
        isDragging && "opacity-50"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Sürükle: ${meta.label}`}
            className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-md text-foreground/40 hover:bg-surface-muted hover:text-foreground/70 active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <Icon className="h-4 w-4 shrink-0 text-foreground/50" />
          <span className="truncate text-sm font-medium text-foreground">{meta.label}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {selected && (
            <Badge tone="primary" size="sm">
              Düzenleniyor
            </Badge>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Yukarı taşı"
            onClick={(e) => {
              e.stopPropagation();
              onMove(block.id, -1);
            }}
            disabled={index === 0}
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Aşağı taşı"
            onClick={(e) => {
              e.stopPropagation();
              onMove(block.id, 1);
            }}
            disabled={index === total - 1}
          >
            <ArrowDown />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Bloğu sil"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(block.id);
            }}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmailBlockOverlay({ block }: { block: EmailBlock }) {
  const meta = emailBlockRegistry[block.type];
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 shadow-lg ring-2 ring-primary/40">
      <GripVertical className="h-4 w-4 text-foreground/40" />
      <Icon className="h-4 w-4 text-foreground/50" />
      <span className="text-sm font-medium text-foreground">{meta.label}</span>
    </div>
  );
}

/**
 * §10.16.11 — orta tuval: dnd-kit ile blok sıralama, `nav-tree-editor.tsx`'teki KURULUMLA
 * tutarlı: `PointerSensor` (distance 6) + `KeyboardSensor`, tek `SortableContext` +
 * `verticalListSortingStrategy` (e-posta blokları düz bir listedir, izdüşüm mantığı GEREKMEZ).
 */
export function EmailCanvas({
  blocks,
  onChange,
  selectedBlockId,
  onSelect,
}: {
  blocks: EmailBlock[];
  onChange: (blocks: EmailBlock[]) => void;
  selectedBlockId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const ids = useMemo(() => blocks.map((b) => b.id), [blocks]);
  const activeBlock = activeId ? blocks.find((b) => b.id === activeId) ?? null : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = blocks.findIndex((b) => b.id === active.id);
    const newIndex = blocks.findIndex((b) => b.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onChange(arrayMove(blocks, oldIndex, newIndex));
  }

  function moveBlock(id: string, direction: -1 | 1) {
    const index = blocks.findIndex((b) => b.id === id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= blocks.length) return;
    onChange(arrayMove(blocks, index, target));
  }

  function removeBlock(id: string) {
    onChange(blocks.filter((b) => b.id !== id));
    if (selectedBlockId === id) onSelect(null);
  }

  if (blocks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-foreground/50">
        Henüz blok yok — soldaki panelden bir blok ekleyin.
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="mx-auto max-w-2xl space-y-3">
          {blocks.map((block, index) => (
            <EmailBlockCard
              key={block.id}
              block={block}
              index={index}
              total={blocks.length}
              selected={block.id === selectedBlockId}
              onSelect={onSelect}
              onMove={moveBlock}
              onRemove={removeBlock}
            />
          ))}
        </div>
      </SortableContext>
      <DragOverlay>{activeBlock ? <EmailBlockOverlay block={activeBlock} /> : null}</DragOverlay>
    </DndContext>
  );
}
