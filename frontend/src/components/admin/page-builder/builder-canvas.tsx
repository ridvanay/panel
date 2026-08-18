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
  AlertTriangle,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartVertical,
  ArrowDown,
  ArrowUp,
  Columns2,
  Columns3,
  GripVertical,
  Info,
  Minus,
  Plus,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { blockRegistry, createBlock, type PaletteBlockType } from "@/lib/page-builder/registry";
import {
  addColumnToRow,
  collapseColumnIfEmpty,
  countAllBlocks,
  findContainerId,
  findItemById,
  getContainerBlockIds,
  insertIntoContainer,
  needsConfirmToUnwrap,
  removeFromContainer,
  resolveColumnWidth,
  setColumnWidth,
  totalBlocksInColumns,
  unwrapColumns,
  updateColumnsData,
  wrapInColumns,
} from "@/lib/page-builder/columns";
import type { Block, BuilderContainerId, ColumnsBlock, LeafBlock, PageBlockGap, PageColumnVerticalAlign } from "@/lib/page-builder/types";
import { COLUMN_READABILITY_WARNING_THRESHOLD, MAX_BLOCKS_PER_COLUMN, MAX_COLUMNS_PER_ROW, MAX_TOTAL_BLOCKS } from "@/lib/page-builder/types";
import { LayoutMenu } from "./layout-menu";
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

interface DragCtx {
  onWrapToRow: (blockId: string) => void;
  onUnwrapRow: (columnsBlockId: string) => void;
  onAddColumn: (columnsBlockId: string, type: PaletteBlockType) => void;
  onColumnWidthChange: (columnsBlockId: string, columnId: string, width: number) => void;
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
            <LayoutMenu current="full" onSelect={(value) => value === "row" && ctx.onWrapToRow(block.id)} />
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

const MIN_COLUMN_WIDTH = 1;
const MAX_COLUMN_WIDTH = 4;

/**
 * §10.17.3 v2 madde 1 "veya kullanıcı manuel oranlayabilsin" — her sütunun kendi göreli genişlik
 * ağırlığı (1-4 arası). Yapısal değişikliklerde (sütun ekle/kaldır) otomatik eşitlemeyle
 * ÜZERİNE YAZILIR (bkz. columns.ts::addColumnToRow/collapseColumnIfEmpty) — bu yüzden bu kontrol
 * yalnızca "şu anki satır sabitken ince ayar" içindir.
 */
function ColumnWidthStepper({ width, onChange }: { width: number; onChange: (width: number) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border/50 bg-surface-muted/70 px-1 py-0.5 text-[10px] text-foreground/50">
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label="Genişliği azalt"
        disabled={width <= MIN_COLUMN_WIDTH}
        onClick={() => onChange(Math.max(MIN_COLUMN_WIDTH, width - 1))}
      >
        <Minus className="h-2.5 w-2.5" />
      </Button>
      <span className="min-w-[1.5ch] text-center tabular-nums" title="Göreli genişlik">
        {width}×
      </span>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label="Genişliği artır"
        disabled={width >= MAX_COLUMN_WIDTH}
        onClick={() => onChange(Math.min(MAX_COLUMN_WIDTH, width + 1))}
      >
        <Plus className="h-2.5 w-2.5" />
      </Button>
    </div>
  );
}

/** "+" — satırın sağına yeni bir blok/sütun eklemek için blok türü seçen menü (§10.17.3 v2 madde 1). */
const ADD_COLUMN_FORBIDDEN_TYPES = new Set<PaletteBlockType>(["hero"]);

function AddColumnMenu({ onAdd, disabled }: { onAdd: (type: PaletteBlockType) => void; disabled?: boolean }) {
  const options = (Object.entries(blockRegistry) as [PaletteBlockType, { label: string }][]).filter(
    ([type]) => !ADD_COLUMN_FORBIDDEN_TYPES.has(type)
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            aria-label="Satıra blok ekle"
            disabled={disabled}
            title={disabled ? `Bir satırda en fazla ${MAX_COLUMNS_PER_ROW} sütun olabilir` : "Satıra blok ekle"}
          />
        }
      >
        <Plus className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map(([type, meta]) => (
          <DropdownMenuItem key={type} onClick={() => onAdd(type)}>
            {meta.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
  const { gap, verticalAlign, columns } = block.data;
  const ColumnIcon = columns.length >= 3 ? Columns3 : Columns2;
  const atMaxColumns = columns.length >= MAX_COLUMNS_PER_ROW;
  const tooManyForReadability = columns.length >= COLUMN_READABILITY_WARNING_THRESHOLD;
  // §10.17.5 v2 — mobilde `flex-col` (tek sütun) tabanı, `md:` üzerinde `display:grid`e geçer;
  // sütun genişlikleri inline `gridTemplateColumns` (`fr` birimi) ile ayarlanır — arbitrary Tailwind
  // sınıfı DEĞİL, çünkü sütun sayısı/ağırlığı çalışma anında (runtime) belirlenir. Editördeki "+"
  // eklentisi (`minmax(80px,auto)`) yalnızca EDİTÖRE özgüdür, public render'da YOKTUR (bkz.
  // components/site/blocks/columns-block.tsx — WYSIWYG sütun düzeni için birebir aynı fr mantığı,
  // ancak add-tile'sız).
  // `resolveColumnWidth` eski (v1) `ratio` şeklini de hesaba katar — bkz. columns.ts başlık yorumu.
  const gridTemplate = [...columns.map((_, i) => `${resolveColumnWidth(block.data, i)}fr`), "minmax(96px,auto)"].join(" ");

  return (
    <div className="rounded-xl border-2 border-dashed border-border/70 bg-surface-muted/30 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {dragHandle}
          <ColumnIcon className="h-4 w-4 shrink-0 text-foreground/50" />
          <span className="text-sm font-medium text-foreground">{columns.length} Sütun</span>
          <span className="text-xs text-foreground/50">· Boşluk: {GAP_LABEL[gap]}</span>
          <span title="Mobilde bu sütunlar alt alta sıralanır">
            <Info className="h-3.5 w-3.5 shrink-0 text-foreground/35" aria-hidden />
          </span>
          {tooManyForReadability && (
            <span className="flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] text-warning">
              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
              Bu satırda çok fazla blok var, okunabilirlik azalabilir.
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <VerticalAlignControl value={verticalAlign} onChange={(v) => ctx.onColumnsPatch(block.id, { verticalAlign: v })} />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Tam Genişlik"
            title="Tam Genişliğe Dönüştür"
            onClick={() => ctx.onUnwrapRow(block.id)}
          >
            <Square className="h-4 w-4" />
          </Button>
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

      <div className="flex flex-col gap-3 md:grid" style={{ gridTemplateColumns: gridTemplate }}>
        {columns.map((col, colIndex) => {
          const containerId: BuilderContainerId = `col:${col.id}`;
          const ids = col.blocks.map((b) => b.id);
          return (
            <div key={col.id} className="min-w-0 space-y-2">
              <div className="flex justify-end">
                <ColumnWidthStepper
                  width={resolveColumnWidth(block.data, colIndex)}
                  onChange={(w) => ctx.onColumnWidthChange(block.id, col.id, w)}
                />
              </div>
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
        <div className="flex min-h-24 items-center justify-center">
          <AddColumnMenu disabled={atMaxColumns} onAdd={(type) => ctx.onAddColumn(block.id, type)} />
        </div>
      </div>
    </div>
  );
}

export function BuilderCanvas({ blocks, onChange }: { blocks: Block[]; onChange: (blocks: Block[]) => void }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingUnwrap, setPendingUnwrap] = useState<{ columnsBlockId: string; blockCount: number; columnCount: number } | null>(
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
    // §10.17.3 v2 madde 3 — otomatik sütun kaldırma/yeniden dengeleme SADECE bir bloğu SİLMENİN
    // (bkz. aşağıdaki `removeInColumn`) sonucudur; bir bloğu SÜRÜKLEYEREK başka bir sütuna
    // taşımak İÇERİĞİ SİLMEZ, bu yüzden kaynak sütun boşalsa bile (mevcut, test edilmiş v1
    // davranışıyla birebir aynı şekilde) boş bir bırakma alanı olarak KALIR — kaldırılmaz.
    onChange(insertIntoContainer(afterRemove, toContainer, insertIndex, removed));
  }

  function wrapToRow(blockId: string) {
    const item = findItemById(blocks, blockId);
    if (!item || item.type === "columns" || item.type === "hero") return;
    if (countAllBlocks(blocks) >= MAX_TOTAL_BLOCKS) return;
    onChange(wrapInColumns(blocks, blockId, 2));
  }

  function unwrapRow(columnsBlockId: string) {
    const item = findItemById(blocks, columnsBlockId);
    if (!item || item.type !== "columns") return;
    if (needsConfirmToUnwrap(item)) {
      setPendingUnwrap({ columnsBlockId: item.id, blockCount: totalBlocksInColumns(item), columnCount: item.data.columns.length });
      return;
    }
    onChange(unwrapColumns(blocks, item.id));
  }

  function addColumn(columnsBlockId: string, type: PaletteBlockType) {
    const item = findItemById(blocks, columnsBlockId);
    if (!item || item.type !== "columns") return;
    if (item.data.columns.length >= MAX_COLUMNS_PER_ROW) return;
    if (countAllBlocks(blocks) >= MAX_TOTAL_BLOCKS) return;
    onChange(addColumnToRow(blocks, columnsBlockId, createBlock(type) as LeafBlock));
  }

  function columnWidthChange(columnsBlockId: string, columnId: string, width: number) {
    onChange(setColumnWidth(blocks, columnsBlockId, columnId, width));
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
    const next = blocks.map((b) => {
      if (b.id !== columnsBlockId || b.type !== "columns") return b;
      const columns = b.data.columns.map((col) =>
        col.id === columnId ? { ...col, blocks: col.blocks.filter((l) => l.id !== blockId) } : col
      );
      return { ...b, data: { ...b.data, columns } };
    });
    // §10.17.3 v2 madde 3 — SİLİNEN bloğun sütunu bu işlemle boşaldıysa kaldırılır, kalanlar
    // eşitlenir, tek sütun kalırsa satır otomatik "Tam Genişlik"e döner (onay GEREKMEZ, içerik
    // kaybı yoktur). Satırdaki BAŞKA boş sütunlara (henüz doldurulmamış yer tutucular) dokunmaz.
    onChange(collapseColumnIfEmpty(next, columnsBlockId, columnId));
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
    onWrapToRow: wrapToRow,
    onUnwrapRow: unwrapRow,
    onAddColumn: addColumn,
    onColumnWidthChange: columnWidthChange,
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
            ? `${pendingUnwrap.columnCount} sütundaki ${pendingUnwrap.blockCount} blok, sırasıyla alt alta tam genişlik bloklarına dönüştürülecek. İçerik SİLİNMEZ.`
            : undefined
        }
        confirmText="Tam Genişliğe Dönüştür"
        cancelText="Vazgeç"
        onConfirm={() => {
          if (pendingUnwrap) onChange(unwrapColumns(blocks, pendingUnwrap.columnsBlockId));
          setPendingUnwrap(null);
        }}
      />

    </>
  );
}
