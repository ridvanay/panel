"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartVertical,
  ArrowDown,
  ArrowUp,
  Columns2,
  Columns3,
  GripVertical,
  Info,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { blockRegistry } from "@/lib/page-builder/registry";
import {
  changeColumnCount,
  countAllBlocks,
  findContainerId,
  findItemById,
  getContainerBlockIds,
  insertIntoContainer,
  needsConfirmToShrink,
  needsConfirmToUnwrap,
  removeFromContainer,
  totalBlocksInColumns,
  unwrapColumns,
  updateColumnsData,
  wrapInColumns,
} from "@/lib/page-builder/columns";
import type { Block, BuilderContainerId, ColumnsBlock, LeafBlock, PageBlockGap, PageColumnCount, PageColumnVerticalAlign } from "@/lib/page-builder/types";
import { MAX_BLOCKS_PER_COLUMN, MAX_TOTAL_BLOCKS } from "@/lib/page-builder/types";
import { LayoutMenu, type LayoutValue } from "./layout-menu";
import { HeroBlockEditor } from "./blocks/hero-block";
import { TextBlockEditor } from "./blocks/text-block";
import { ImageBlockEditor } from "./blocks/image-block";
import { GalleryBlockEditor } from "./blocks/gallery-block";
import { CtaBlockEditor } from "./blocks/cta-block";
import { FeaturedProductsBlockEditor } from "./blocks/featured-products-block";
import { FeaturedPortfolioBlockEditor } from "./blocks/featured-portfolio-block";

const GAP_LABEL: Record<PageBlockGap, string> = { none: "Yok", sm: "Az", md: "Orta", lg: "Geniş" };

function blockLabel(block: Block): string {
  if (block.type === "columns") return "Sütunlar";
  return blockRegistry[block.type].label;
}

function LeafBlockBody({ block, onChange }: { block: LeafBlock; onChange: (block: LeafBlock) => void }) {
  switch (block.type) {
    case "text":
      return <TextBlockEditor block={block} onChange={onChange} />;
    case "image":
      return <ImageBlockEditor block={block} onChange={onChange} />;
    case "gallery":
      return <GalleryBlockEditor block={block} onChange={onChange} />;
    case "cta":
      return <CtaBlockEditor block={block} onChange={onChange} />;
    case "featured-products":
      return <FeaturedProductsBlockEditor block={block} onChange={onChange} />;
    case "featured-portfolio":
      return <FeaturedPortfolioBlockEditor block={block} onChange={onChange} />;
  }
}

/** Bir "sarmalanabilir" bloğun düzen değeri — sütun içindeki blokların menüsü YOKTUR (derinlik 1 kısıtı). */
function leafLayoutValue(): LayoutValue {
  return "full";
}

interface DragCtx {
  onLayoutChange: (blockId: string, value: LayoutValue) => void;
  onMoveTopLevel: (blockId: string, direction: -1 | 1) => void;
  onMoveInColumn: (columnsBlockId: string, columnId: string, blockId: string, direction: -1 | 1) => void;
  onRemoveTopLevel: (blockId: string) => void;
  onRemoveInColumn: (columnsBlockId: string, columnId: string, blockId: string) => void;
  onUpdateTopLevel: (block: Block) => void;
  onUpdateInColumn: (columnsBlockId: string, columnId: string, block: LeafBlock) => void;
  onColumnsPatch: (columnsBlockId: string, patch: Partial<ColumnsBlock["data"]>) => void;
}

function TopLevelBlockCard({ block, index, total, ctx }: { block: Block; index: number; total: number; ctx: DragCtx }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  if (block.type === "columns") {
    return (
      <div ref={setNodeRef} style={style} className={cn(isDragging && "opacity-50")}>
        <ColumnsContainerCard
          block={block}
          index={index}
          total={total}
          ctx={ctx}
          dragHandle={
            <button
              type="button"
              {...attributes}
              {...listeners}
              aria-label={`Sürükle: ${blockLabel(block)}`}
              className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-md text-foreground/40 hover:bg-surface-muted hover:text-foreground/70 active:cursor-grabbing"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("rounded-xl border border-border bg-card p-4 shadow-sm", isDragging && "opacity-50")}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Sürükle: ${blockLabel(block)}`}
            className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-md text-foreground/40 hover:bg-surface-muted hover:text-foreground/70 active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <span className="truncate text-sm font-medium text-foreground">{blockLabel(block)}</span>
          {block.type !== "hero" && (
            <LayoutMenu current={leafLayoutValue()} onSelect={(value) => ctx.onLayoutChange(block.id, value)} />
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Yukarı taşı"
            onClick={() => ctx.onMoveTopLevel(block.id, -1)}
            disabled={index === 0}
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Aşağı taşı"
            onClick={() => ctx.onMoveTopLevel(block.id, 1)}
            disabled={index === total - 1}
          >
            <ArrowDown />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Bloğu sil" onClick={() => ctx.onRemoveTopLevel(block.id)}>
            <Trash2 />
          </Button>
        </div>
      </div>
      <div className="pt-4">
        {block.type === "hero" ? (
          <HeroBlockEditor block={block} onChange={(next) => ctx.onUpdateTopLevel(next)} />
        ) : (
          <LeafBlockBody block={block} onChange={(next) => ctx.onUpdateTopLevel(next)} />
        )}
      </div>
    </div>
  );
}

function EmptyColumnDropZone({ containerId }: { containerId: BuilderContainerId }) {
  const { isOver, setNodeRef } = useDroppable({ id: containerId });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-24 items-center justify-center rounded-lg border-2 border-dashed border-border/50 text-center text-xs text-foreground/40 transition-colors",
        isOver && "border-primary bg-primary/5 text-primary"
      )}
    >
      Buraya blok sürükleyin
    </div>
  );
}

function ColumnLeafCard({
  block,
  index,
  total,
  columnsBlockId,
  columnId,
  ctx,
}: {
  block: LeafBlock;
  index: number;
  total: number;
  columnsBlockId: string;
  columnId: string;
  ctx: DragCtx;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("rounded-lg border border-border bg-card p-3 shadow-sm", isDragging && "opacity-50")}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-2">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Sürükle: ${blockLabel(block)}`}
            className="flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-md text-foreground/40 hover:bg-surface-muted hover:text-foreground/70 active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <span className="truncate text-xs font-medium text-foreground">{blockLabel(block)}</span>
          {/* §10.17.7 madde 1 — sütun İÇİNDEKİ bloklarda Düzen kontrolü HİÇ gösterilmez (derinlik-1 kısıtı). */}
        </div>
        <div className="flex shrink-0 gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Yukarı taşı"
            onClick={() => ctx.onMoveInColumn(columnsBlockId, columnId, block.id, -1)}
            disabled={index === 0}
          >
            <ArrowUp className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Aşağı taşı"
            onClick={() => ctx.onMoveInColumn(columnsBlockId, columnId, block.id, 1)}
            disabled={index === total - 1}
          >
            <ArrowDown className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Bloğu sil"
            onClick={() => ctx.onRemoveInColumn(columnsBlockId, columnId, block.id)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <div className="pt-3">
        <LeafBlockBody block={block} onChange={(next) => ctx.onUpdateInColumn(columnsBlockId, columnId, next)} />
      </div>
    </div>
  );
}

const VERTICAL_ALIGN_ICON: Record<PageColumnVerticalAlign, typeof AlignStartVertical> = {
  top: AlignStartVertical,
  center: AlignCenterVertical,
  bottom: AlignEndVertical,
};

function VerticalAlignControl({ value, onChange }: { value: PageColumnVerticalAlign; onChange: (v: PageColumnVerticalAlign) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-surface-muted p-0.5">
      {(["top", "center", "bottom"] as PageColumnVerticalAlign[]).map((v) => {
        const Icon = VERTICAL_ALIGN_ICON[v];
        const active = v === value;
        return (
          <Button
            key={v}
            type="button"
            size="icon-xs"
            variant={active ? "secondary" : "ghost"}
            aria-pressed={active}
            aria-label={`Dikey hizalama: ${v === "top" ? "Üst" : v === "center" ? "Orta" : "Alt"}`}
            onClick={() => onChange(v)}
          >
            <Icon className="h-3 w-3" />
          </Button>
        );
      })}
    </div>
  );
}

function RatioIcon({ left, right }: { left: number; right: number }) {
  return (
    <span className="flex h-3.5 w-6 gap-0.5" aria-hidden>
      <span className="rounded-[1px] bg-current" style={{ flex: left }} />
      <span className="rounded-[1px] bg-current" style={{ flex: right }} />
    </span>
  );
}

const RATIO_OPTIONS: { value: "1-1" | "2-1" | "1-2"; label: string; left: number; right: number }[] = [
  { value: "1-1", label: "Eşit", left: 1, right: 1 },
  { value: "2-1", label: "Sol geniş", left: 2, right: 1 },
  { value: "1-2", label: "Sağ geniş", left: 1, right: 2 },
];

function RatioControl({ value, onChange }: { value: "1-1" | "2-1" | "1-2"; onChange: (v: "1-1" | "2-1" | "1-2") => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-surface-muted p-0.5">
      {RATIO_OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <Button
            key={opt.value}
            type="button"
            size="icon-xs"
            variant={active ? "secondary" : "ghost"}
            aria-pressed={active}
            aria-label={opt.label}
            onClick={() => onChange(opt.value)}
          >
            <RatioIcon left={opt.left} right={opt.right} />
          </Button>
        );
      })}
    </div>
  );
}

function ColumnsContainerCard({
  block,
  index,
  total,
  ctx,
  dragHandle,
}: {
  block: ColumnsBlock;
  index: number;
  total: number;
  ctx: DragCtx;
  dragHandle: ReactNode;
}) {
  const { columnCount, ratio, gap, verticalAlign, columns } = block.data;
  const ColumnIcon = columnCount === 3 ? Columns3 : Columns2;

  return (
    <div className="rounded-xl border-2 border-dashed border-border/70 bg-surface-muted/30 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {dragHandle}
          <ColumnIcon className="h-4 w-4 shrink-0 text-foreground/50" />
          <span className="text-sm font-medium text-foreground">{columnCount} Sütun</span>
          <span className="text-xs text-foreground/50">· Boşluk: {GAP_LABEL[gap]}</span>
          <span title="Mobilde bu sütunlar alt alta sıralanır">
            <Info className="h-3.5 w-3.5 shrink-0 text-foreground/35" aria-hidden />
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <VerticalAlignControl value={verticalAlign} onChange={(v) => ctx.onColumnsPatch(block.id, { verticalAlign: v })} />
          {columnCount === 2 && (
            <RatioControl
              value={ratio as "1-1" | "2-1" | "1-2"}
              onChange={(v) => ctx.onColumnsPatch(block.id, { ratio: v })}
            />
          )}
          <LayoutMenu current={columnCount as LayoutValue} onSelect={(value) => ctx.onLayoutChange(block.id, value)} />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Yukarı taşı"
            onClick={() => ctx.onMoveTopLevel(block.id, -1)}
            disabled={index === 0}
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Aşağı taşı"
            onClick={() => ctx.onMoveTopLevel(block.id, 1)}
            disabled={index === total - 1}
          >
            <ArrowDown />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Sütunları sil" onClick={() => ctx.onRemoveTopLevel(block.id)}>
            <Trash2 />
          </Button>
        </div>
      </div>

      <div className={cn("grid grid-cols-1", columnCount === 2 ? "md:grid-cols-2" : "md:grid-cols-3", "gap-3")}>
        {columns.map((col) => {
          const containerId: BuilderContainerId = `col:${col.id}`;
          const ids = col.blocks.map((b) => b.id);
          return (
            <div key={col.id} className="min-w-0 space-y-2">
              <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                {col.blocks.length === 0 ? (
                  <EmptyColumnDropZone containerId={containerId} />
                ) : (
                  <div className="space-y-2">
                    {col.blocks.map((leaf, leafIndex) => (
                      <ColumnLeafCard
                        key={leaf.id}
                        block={leaf}
                        index={leafIndex}
                        total={col.blocks.length}
                        columnsBlockId={block.id}
                        columnId={col.id}
                        ctx={ctx}
                      />
                    ))}
                  </div>
                )}
              </SortableContext>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function BuilderCanvas({ blocks, onChange }: { blocks: Block[]; onChange: (blocks: Block[]) => void }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingUnwrap, setPendingUnwrap] = useState<{ columnsBlockId: string; blockCount: number; columnCount: number } | null>(
    null
  );
  const [pendingShrink, setPendingShrink] = useState<{ columnsBlockId: string; newCount: PageColumnCount; blockCount: number } | null>(
    null
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const rootIds = useMemo(() => blocks.map((b) => b.id), [blocks]);
  const activeItem = activeId ? findItemById(blocks, activeId) : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  /**
   * BUG DÜZELTMESİ (qa-agent, `admin-page-builder-columns.spec.ts` "BUG (frontend-agent)" testi) —
   * eskiden `onDragOver` her pointer hareketinde `blocks` state'ini MUTASYONA UĞRATIYORDU (canlı
   * yeniden-sıralama önizlemesi için). DOLU bir sütuna bırakırken bu, bir GERİ BESLEME DÖNGÜSÜNE
   * yol açıyordu: state değişir → hedef/kaynak listelerin DOM düzeni kayar → dnd-kit droppable
   * dikdörtgenlerini yeniden ölçer (sürekli ölçüm varsayılan davranışıdır) → çarpışma sonucu
   * DEĞİŞİR (kök liste ile sütun arasında) → `onDragOver` TEKRAR tetiklenir → state TEKRAR
   * değişir → ... Blok bir "root" konumu ile bir "sütun" konumu arasında salınırken, React bu iki
   * konumu FARKLI alt ağaçlar olarak görüyor (aynı `id` anahtarına rağmen), bu yüzden o bloğun
   * (bir Metin bloğuysa) TipTap editörü ardı ardına unmount/mount ediliyor — yığın izinde görülen
   * `PureEditorContent.componentDidMount → init → forceUpdate` TAM OLARAK budur ve sonunda React'in
   * "Maximum update depth exceeded" güvenlik sınırını aşıyordu.
   *
   * DÜZELTME: `email-canvas.tsx`/`nav-tree-editor.tsx` ile AYNI, kanıtlanmış desen — sürükleme
   * SIRASINDA state HİÇ mutasyona uğratılmaz (görsel geri bildirim `DragOverlay` + boş sütunun
   * `useDroppable().isOver`'ı üzerinden, state'ten BAĞIMSIZ olarak zaten sağlanıyor); konteynerler
   * arası taşıma VE aynı konteyner içi sıralama TEK SEFERDE, yalnızca bırakma anında (`onDragEnd`)
   * hesaplanıp uygulanır. Sonuç: tam bir sürükleme hareketi başına state TAM OLARAK bir kez
   * değişir — geri besleme döngüsü YAPISAL OLARAK imkânsız hale gelir.
   */
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);
    if (activeIdStr === overIdStr) return;

    const fromContainer = findContainerId(blocks, activeIdStr);
    if (!fromContainer) return;

    let toContainer = findContainerId(blocks, overIdStr);
    if (!toContainer && (overIdStr === "root" || overIdStr.startsWith("col:"))) toContainer = overIdStr as BuilderContainerId;
    if (!toContainer) return;

    const item = findItemById(blocks, activeIdStr);
    if (!item) return;
    // Derinlik ≤1 kısıtı: `columns`/`hero` bir sütunun İÇİNE konulamaz (§10.17.3).
    if (toContainer !== "root" && (item.type === "columns" || item.type === "hero")) return;

    if (fromContainer === toContainer) {
      // Aynı konteyner içinde sıralama.
      const ids = getContainerBlockIds(blocks, fromContainer);
      const oldIndex = ids.indexOf(activeIdStr);
      let newIndex = ids.indexOf(overIdStr);
      if (newIndex === -1) newIndex = ids.length > 0 ? ids.length - 1 : 0;
      if (oldIndex === -1 || oldIndex === newIndex) return;
      const { blocks: afterRemove, removed } = removeFromContainer(blocks, fromContainer, activeIdStr);
      if (!removed) return;
      onChange(insertIntoContainer(afterRemove, fromContainer, newIndex, removed));
      return;
    }

    // Konteynerler arası taşıma (root → sütun, sütun → root, sütun → sütun — DOLU sütun dahil).
    if (toContainer.startsWith("col:")) {
      const targetIds = getContainerBlockIds(blocks, toContainer);
      if (targetIds.length >= MAX_BLOCKS_PER_COLUMN) return;
    }

    const { blocks: afterRemove, removed } = removeFromContainer(blocks, fromContainer, activeIdStr);
    if (!removed) return;
    const targetIds = getContainerBlockIds(afterRemove, toContainer);
    let insertIndex = targetIds.indexOf(overIdStr);
    if (insertIndex === -1) insertIndex = targetIds.length;
    onChange(insertIntoContainer(afterRemove, toContainer, insertIndex, removed));
  }

  function requestLayoutChange(blockId: string, value: LayoutValue) {
    const item = findItemById(blocks, blockId);
    if (!item) return;

    if (item.type !== "columns") {
      if (value === "full") return;
      if (countAllBlocks(blocks) >= MAX_TOTAL_BLOCKS) return;
      onChange(wrapInColumns(blocks, blockId, value));
      return;
    }

    if (value === "full") {
      if (needsConfirmToUnwrap(item)) {
        setPendingUnwrap({ columnsBlockId: item.id, blockCount: totalBlocksInColumns(item), columnCount: item.data.columnCount });
        return;
      }
      onChange(unwrapColumns(blocks, item.id));
      return;
    }

    if (value === item.data.columnCount) return;
    if (needsConfirmToShrink(item, value)) {
      const movedCount = item.data.columns.slice(value).reduce((sum, col) => sum + col.blocks.length, 0);
      setPendingShrink({ columnsBlockId: item.id, newCount: value, blockCount: movedCount });
      return;
    }
    onChange(changeColumnCount(blocks, item.id, value));
  }

  function moveTopLevel(blockId: string, direction: -1 | 1) {
    const index = blocks.findIndex((b) => b.id === blockId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  }

  function moveInColumn(columnsBlockId: string, columnId: string, blockId: string, direction: -1 | 1) {
    onChange(
      blocks.map((b) => {
        if (b.id !== columnsBlockId || b.type !== "columns") return b;
        const columns = b.data.columns.map((col) => {
          if (col.id !== columnId) return col;
          const index = col.blocks.findIndex((l) => l.id === blockId);
          const target = index + direction;
          if (index === -1 || target < 0 || target >= col.blocks.length) return col;
          const next = [...col.blocks];
          [next[index], next[target]] = [next[target]!, next[index]!];
          return { ...col, blocks: next };
        });
        return { ...b, data: { ...b.data, columns } };
      })
    );
  }

  function removeTopLevel(blockId: string) {
    onChange(blocks.filter((b) => b.id !== blockId));
  }

  function removeInColumn(columnsBlockId: string, columnId: string, blockId: string) {
    onChange(
      blocks.map((b) => {
        if (b.id !== columnsBlockId || b.type !== "columns") return b;
        const columns = b.data.columns.map((col) =>
          col.id === columnId ? { ...col, blocks: col.blocks.filter((l) => l.id !== blockId) } : col
        );
        return { ...b, data: { ...b.data, columns } };
      })
    );
  }

  function updateTopLevel(next: Block) {
    onChange(blocks.map((b) => (b.id === next.id ? next : b)));
  }

  function updateInColumn(columnsBlockId: string, columnId: string, next: LeafBlock) {
    onChange(
      blocks.map((b) => {
        if (b.id !== columnsBlockId || b.type !== "columns") return b;
        const columns = b.data.columns.map((col) =>
          col.id === columnId ? { ...col, blocks: col.blocks.map((l) => (l.id === next.id ? next : l)) } : col
        );
        return { ...b, data: { ...b.data, columns } };
      })
    );
  }

  function columnsPatch(columnsBlockId: string, patch: Partial<ColumnsBlock["data"]>) {
    onChange(updateColumnsData(blocks, columnsBlockId, patch));
  }

  const ctx: DragCtx = {
    onLayoutChange: requestLayoutChange,
    onMoveTopLevel: moveTopLevel,
    onMoveInColumn: moveInColumn,
    onRemoveTopLevel: removeTopLevel,
    onRemoveInColumn: removeInColumn,
    onUpdateTopLevel: updateTopLevel,
    onUpdateInColumn: updateInColumn,
    onColumnsPatch: columnsPatch,
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        {blocks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-foreground/50">
            Henüz blok yok — yukarıdan bir blok ekleyin.
          </div>
        ) : (
          <SortableContext items={rootIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-4">
              {blocks.map((block, index) => (
                <TopLevelBlockCard key={block.id} block={block} index={index} total={blocks.length} ctx={ctx} />
              ))}
            </div>
          </SortableContext>
        )}
        <DragOverlay>
          {activeItem ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 shadow-lg ring-2 ring-primary/40">
              <GripVertical className="h-4 w-4 text-foreground/40" />
              <span className="text-sm font-medium text-foreground">{blockLabel(activeItem as Block)}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <ConfirmDialog
        open={pendingUnwrap !== null}
        onOpenChange={(open) => !open && setPendingUnwrap(null)}
        tone="warning"
        title="Sütunlar tam genişliğe dönüştürülsün mü?"
        description={
          pendingUnwrap
            ? `${pendingUnwrap.columnCount} sütundaki ${pendingUnwrap.blockCount} blok tek bir sütuna, sırasıyla alt alta taşınacak. İçerik SİLİNMEZ.`
            : undefined
        }
        confirmText="Tam Genişliğe Dönüştür"
        cancelText="Vazgeç"
        onConfirm={() => {
          if (pendingUnwrap) onChange(unwrapColumns(blocks, pendingUnwrap.columnsBlockId));
          setPendingUnwrap(null);
        }}
      />

      <ConfirmDialog
        open={pendingShrink !== null}
        onOpenChange={(open) => !open && setPendingShrink(null)}
        tone="warning"
        title="Sütun sayısı azaltılsın mı?"
        description={
          pendingShrink
            ? `Kaldırılan sütun(lar)daki ${pendingShrink.blockCount} blok, son sütunun sonuna taşınacak. İçerik SİLİNMEZ.`
            : undefined
        }
        confirmText="Daralt"
        cancelText="Vazgeç"
        onConfirm={() => {
          if (pendingShrink) onChange(changeColumnCount(blocks, pendingShrink.columnsBlockId, pendingShrink.newCount));
          setPendingShrink(null);
        }}
      />
    </>
  );
}
