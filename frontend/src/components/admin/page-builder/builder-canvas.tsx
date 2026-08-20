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
  ArrowDown,
  ArrowUp,
  ArrowUpToLine,
  Columns2,
  Columns3,
  Columns4,
  GripVertical,
  PanelTop,
  Plus,
  Rows2,
  Settings2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { blockRegistry, createBlock, type PaletteBlockType } from "@/lib/page-builder/registry";
import {
  containerDepth,
  containerIdOf,
  countNodes,
  findNode,
  findParentId,
  getContainerChildIds,
  getContainerChildren,
  insertNode,
  isContainerAtCapacity,
  moveNode,
  needsConfirmToUnwrap,
  removeNode,
  setContainerChildren,
  subtreeDepth,
  toContainerId,
  unwrapContainer,
  updateNode,
  wrapInContainer,
} from "@/lib/page-builder/containers";
import {
  MAX_CHILDREN_PER_CONTAINER,
  MAX_CONTAINER_DEPTH,
  MAX_TOTAL_PAGE_NODES,
  ROW_CHILDREN_READABILITY_WARNING_THRESHOLD,
  type BuilderContainerId,
  type ContainerNode,
  type ContentBlock,
  type PageNode,
} from "@/lib/page-builder/types";
import { LayoutMenu } from "./layout-menu";
import { HeroBlockEditor } from "./blocks/hero-block";
import { TextBlockEditor } from "./blocks/text-block";
import { ImageBlockEditor } from "./blocks/image-block";
import { GalleryBlockEditor } from "./blocks/gallery-block";
import { CtaBlockEditor } from "./blocks/cta-block";
import { FeaturedProductsBlockEditor } from "./blocks/featured-products-block";
import { FeaturedPortfolioBlockEditor } from "./blocks/featured-portfolio-block";

/**
 * §2.4 mimar dokümanı — ÖZYİNELEMELİ editör ağacı. v2'nin iki-seviyeli (kök + sütun) sabit
 * yapısının yerini, herhangi bir derinlikte (`MAX_CONTAINER_DEPTH` = 4'e kadar) iç içe geçebilen
 * `container` düğümleri alır. Tek `DndContext` en dışta kalır (`closestCorners` KORUNUR); her
 * konteyner kendi `SortableContext`'ini + (yalnızca BOŞKEN) `useDroppable`'ını taşır.
 */

function nodeLabel(node: PageNode): string {
  return node.type === "container" ? "Konteyner" : blockRegistry[node.type].label;
}

function ContentBlockBody({ block, onChange }: { block: ContentBlock; onChange: (block: ContentBlock) => void }) {
  switch (block.type) {
    case "hero":
      return <HeroBlockEditor block={block} onChange={onChange} />;
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

interface Ctx {
  onMove: (id: string, direction: -1 | 1) => void;
  onMoveToParent: (id: string) => void;
  onRemove: (id: string) => void;
  onUpdateContent: (block: ContentBlock) => void;
  onWrap: (id: string) => void;
  onUnwrap: (containerId: string) => void;
  onAddChild: (containerId: BuilderContainerId, type: PaletteBlockType) => void;
  onSelectContainer: (id: string) => void;
  selectedContainerId: string | null;
}

/** §5 ui-designer dokümanı — bir konteynerin İÇİNDEKİ yaprak bloklar için sessiz "bare" ipucu. */
function BareChromeHint() {
  return (
    <span title="Dış boşluk konteynerden geliyor (bu bloğun kendi sayfa dolgusu yok)">
      <PanelTop className="h-3.5 w-3.5 shrink-0 text-foreground/30" aria-hidden />
    </span>
  );
}

function ContentBlockCard({
  block,
  parentId,
  index,
  total,
  ctx,
  dragHandle,
}: {
  block: ContentBlock;
  parentId: BuilderContainerId;
  index: number;
  total: number;
  ctx: Ctx;
  dragHandle: ReactNode;
}) {
  const isBare = parentId !== "root";

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {dragHandle}
          <span className="truncate text-sm font-medium text-foreground">{blockRegistry[block.type].label}</span>
          {isBare && <BareChromeHint />}
          <LayoutMenu mode="wrap" onSelect={() => ctx.onWrap(block.id)} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isBare && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Üst konteynere taşı"
              title="Üst konteynere taşı"
              onClick={() => ctx.onMoveToParent(block.id)}
            >
              <ArrowUpToLine />
            </Button>
          )}
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Yukarı taşı" onClick={() => ctx.onMove(block.id, -1)} disabled={index === 0}>
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Aşağı taşı"
            onClick={() => ctx.onMove(block.id, 1)}
            disabled={index === total - 1}
          >
            <ArrowDown />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Bloğu sil" onClick={() => ctx.onRemove(block.id)}>
            <Trash2 />
          </Button>
        </div>
      </div>
      <div className="pt-4">
        <ContentBlockBody block={block} onChange={ctx.onUpdateContent} />
      </div>
    </div>
  );
}

/** §3.1 ui-designer dokümanı — 4 derinlik seviyesi, kenarlık yoğunluğu + sol vurgu çubuğu + rozet. */
const DEPTH_STYLE: Record<1 | 2 | 3 | 4, { border: string; accent: string; bg: string; padding: string }> = {
  1: { border: "border-border/70", accent: "border-l-primary/20", bg: "bg-surface-muted/30", padding: "p-4" },
  2: { border: "border-border/60", accent: "border-l-primary/40", bg: "bg-surface-muted/20", padding: "p-3.5" },
  3: { border: "border-border/50", accent: "border-l-primary/60", bg: "bg-surface-muted/15", padding: "p-3" },
  4: { border: "border-border/40", accent: "border-l-primary/80", bg: "bg-surface-muted/10", padding: "p-2.5" },
};

function depthStyle(depth: number) {
  const clamped = Math.min(Math.max(Math.round(depth), 1), 4) as 1 | 2 | 3 | 4;
  return DEPTH_STYLE[clamped];
}

function EmptyContainerDropZone({
  containerId,
  atMax,
  onAdd,
}: {
  containerId: BuilderContainerId;
  atMax: boolean;
  onAdd: (type: PaletteBlockType) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: containerId });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border/50 text-center text-xs text-foreground/40 transition-colors",
        isOver && "border-primary bg-primary/5 text-primary"
      )}
    >
      <p>Buraya blok sürükleyin</p>
      <span className="text-foreground/30">veya</span>
      <AddContentMenu disabled={atMax} onAdd={onAdd} />
    </div>
  );
}

function AddContentMenu({ onAdd, disabled }: { onAdd: (type: PaletteBlockType) => void; disabled?: boolean }) {
  const options = Object.entries(blockRegistry) as [PaletteBlockType, { label: string }][];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            aria-label="Konteynere blok ekle"
            disabled={disabled}
            title={disabled ? `Bir konteynerde en fazla ${MAX_CHILDREN_PER_CONTAINER} öğe olabilir` : "Konteynere blok ekle"}
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

function ContainerCard({
  container,
  parentId,
  index,
  total,
  depth,
  ctx,
  dragHandle,
}: {
  container: ContainerNode;
  parentId: BuilderContainerId;
  index: number;
  total: number;
  depth: number;
  ctx: Ctx;
  dragHandle: ReactNode;
}) {
  const ds = depthStyle(depth);
  const isRow = container.settings.direction === "row";
  const Icon = !isRow ? Rows2 : container.children.length >= 4 ? Columns4 : container.children.length === 3 ? Columns3 : Columns2;
  const atMaxChildren = container.children.length >= MAX_CHILDREN_PER_CONTAINER;
  const atMaxDepth = depth >= MAX_CONTAINER_DEPTH;
  const tooManyForReadability = isRow && container.children.length >= ROW_CHILDREN_READABILITY_WARNING_THRESHOLD;
  const isBare = parentId !== "root";
  const selected = ctx.selectedContainerId === container.id;
  const containerId = toContainerId(container.id);
  const childIds = container.children.map((c) => c.id);

  return (
    <div
      className={cn(
        "space-y-3 rounded-xl border-2 border-dashed",
        ds.border,
        ds.bg,
        ds.padding,
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background"
      )}
    >
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        className={cn("flex flex-wrap items-center justify-between gap-2 rounded-r-md border-l-4 py-1 pl-2 cursor-pointer", ds.accent)}
        onClick={() => ctx.onSelectContainer(container.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            ctx.onSelectContainer(container.id);
          }
        }}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {dragHandle}
          <Icon className="h-4 w-4 shrink-0 text-foreground/50" />
          <span className="text-sm font-medium text-foreground">{isRow ? `${container.children.length} Sütun` : "Konteyner"}</span>
          <Badge tone="neutral" size="sm">
            {atMaxDepth ? `Seviye ${depth} · Maks.` : `Seviye ${depth}`}
          </Badge>
          {isBare && <BareChromeHint />}
          {tooManyForReadability && (
            <span className="flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] text-warning">
              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
              Bu satırda {container.children.length} öğe var — okunabilirlik azalabilir.
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Konteyner ayarları"
            title="Konteyner ayarları"
            onClick={() => ctx.onSelectContainer(container.id)}
          >
            <Settings2 />
          </Button>
          <LayoutMenu mode="unwrap" onSelect={() => ctx.onUnwrap(container.id)} />
          {isBare && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Üst konteynere taşı"
              title="Üst konteynere taşı"
              onClick={() => ctx.onMoveToParent(container.id)}
            >
              <ArrowUpToLine />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Yukarı taşı"
            onClick={() => ctx.onMove(container.id, -1)}
            disabled={index === 0}
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Aşağı taşı"
            onClick={() => ctx.onMove(container.id, 1)}
            disabled={index === total - 1}
          >
            <ArrowDown />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Konteyneri sil" onClick={() => ctx.onRemove(container.id)}>
            <Trash2 />
          </Button>
        </div>
      </div>

      <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
        {container.children.length === 0 ? (
          <EmptyContainerDropZone containerId={containerId} atMax={atMaxChildren} onAdd={(type) => ctx.onAddChild(containerId, type)} />
        ) : (
          <div className={cn("flex gap-3", isRow ? "flex-col md:flex-row" : "flex-col")}>
            {container.children.map((child, childIndex) => (
              <div key={child.id} className={cn("min-w-0", isRow && "md:flex-1")}>
                <NodeCard node={child} parentId={containerId} index={childIndex} total={container.children.length} depth={depth + 1} ctx={ctx} />
              </div>
            ))}
          </div>
        )}
      </SortableContext>
    </div>
  );
}

function NodeCard({
  node,
  parentId,
  index,
  total,
  depth,
  ctx,
}: {
  node: PageNode;
  parentId: BuilderContainerId;
  index: number;
  total: number;
  depth: number;
  ctx: Ctx;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const dragHandle = (
    <button
      type="button"
      {...attributes}
      {...listeners}
      aria-label={`Sürükle: ${nodeLabel(node)}`}
      className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-md text-foreground/40 hover:bg-surface-muted hover:text-foreground/70 active:cursor-grabbing"
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && "opacity-50")}>
      {node.type === "container" ? (
        <ContainerCard container={node} parentId={parentId} index={index} total={total} depth={depth} ctx={ctx} dragHandle={dragHandle} />
      ) : (
        <ContentBlockCard block={node} parentId={parentId} index={index} total={total} ctx={ctx} dragHandle={dragHandle} />
      )}
    </div>
  );
}

export function BuilderCanvas({
  nodes,
  onChange,
  selectedContainerId,
  onSelectContainer,
}: {
  nodes: PageNode[];
  onChange: (nodes: PageNode[]) => void;
  selectedContainerId: string | null;
  onSelectContainer: (id: string | null) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingUnwrap, setPendingUnwrap] = useState<{ containerId: string; nodeCount: number } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const rootIds = useMemo(() => nodes.map((n) => n.id), [nodes]);
  const activeNode = activeId ? findNode(nodes, activeId) : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  /**
   * BUG DÜZELTMESİ (qa-agent, v2 `admin-page-builder-columns.spec.ts`) — state SÜRÜKLEME
   * SIRASINDA (`onDragOver`) HİÇ mutasyona uğratılmaz (görsel geri bildirim `DragOverlay` +
   * boş konteynerin `useDroppable().isOver`'ı üzerinden, state'ten BAĞIMSIZ sağlanır);
   * konteynerler arası taşıma VE aynı konteyner içi sıralama TEK SEFERDE, yalnızca bırakma
   * anında (`onDragEnd`) hesaplanıp uygulanır — bkz. v2 yorumundaki geri besleme döngüsü analizi
   * (aynı desen, artık herhangi bir derinlikte).
   */
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const activeIdStr = String(active.id);
    const overIdStr = String(over.id);
    if (activeIdStr === overIdStr) return;

    const fromParentId = findParentId(nodes, activeIdStr);
    if (!fromParentId) return;

    let toParentId = findParentId(nodes, overIdStr);
    if (!toParentId && (overIdStr === "root" || overIdStr.startsWith("container:"))) {
      toParentId = overIdStr as BuilderContainerId;
    }
    if (!toParentId) return;

    if (fromParentId === toParentId) {
      const ids = getContainerChildIds(nodes, fromParentId);
      const oldIndex = ids.indexOf(activeIdStr);
      let newIndex = ids.indexOf(overIdStr);
      if (newIndex === -1) newIndex = ids.length > 0 ? ids.length - 1 : 0;
      if (oldIndex === -1 || oldIndex === newIndex) return;
      const children = getContainerChildren(nodes, fromParentId);
      const next = [...children];
      const [moved] = next.splice(oldIndex, 1);
      next.splice(newIndex, 0, moved!);
      onChange(setContainerChildren(nodes, fromParentId, next));
      return;
    }

    // Konteynerler arası taşıma — `moveNode` KENDİ İÇİNDE `isDescendant` + kapasite + derinlik
    // guard'larını uygular (bkz. `containers.ts`); herhangi bir ihlalde ağaç DEĞİŞMEDEN döner.
    const targetIds = getContainerChildIds(nodes, toParentId);
    let insertIndex = targetIds.indexOf(overIdStr);
    if (insertIndex === -1) insertIndex = targetIds.length;
    onChange(moveNode(nodes, activeIdStr, toParentId, insertIndex));
  }

  function move(id: string, direction: -1 | 1) {
    const parentId = findParentId(nodes, id);
    if (!parentId) return;
    const siblings = getContainerChildren(nodes, parentId);
    const index = siblings.findIndex((n) => n.id === id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= siblings.length) return;
    const next = [...siblings];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(setContainerChildren(nodes, parentId, next));
  }

  /** a11y yedeği (§2.4) — dnd-kit sürüklemesine eşdeğer, klavyeyle "bir üst konteynere kaç". */
  function moveToParent(id: string) {
    const parentId = findParentId(nodes, id);
    if (!parentId || parentId === "root") return;
    const parentRawId = containerIdOf(parentId)!;
    const grandParentId = findParentId(nodes, parentRawId);
    if (!grandParentId) return;
    const grandSiblings = getContainerChildren(nodes, grandParentId);
    const insertIndex = grandSiblings.findIndex((n) => n.id === parentRawId) + 1;
    onChange(moveNode(nodes, id, grandParentId, insertIndex));
  }

  function remove(id: string) {
    const { nodes: next, removed } = removeNode(nodes, id);
    if (!removed) return;
    onChange(next);
    if (selectedContainerId === id) onSelectContainer(null);
  }

  function updateContent(block: ContentBlock) {
    onChange(updateNode(nodes, block.id, () => block));
  }

  function wrap(id: string) {
    if (countNodes(nodes) >= MAX_TOTAL_PAGE_NODES) return;
    const target = findNode(nodes, id);
    if (!target) return;
    const ownDepth = containerDepth(nodes, id);
    if (ownDepth === 0 || ownDepth + subtreeDepth(target) > MAX_CONTAINER_DEPTH) return;
    onChange(wrapInContainer(nodes, id));
  }

  function requestUnwrap(containerId: string) {
    const node = findNode(nodes, containerId);
    if (!node || node.type !== "container") return;
    if (needsConfirmToUnwrap(node)) {
      setPendingUnwrap({ containerId, nodeCount: countNodes(node.children) });
      return;
    }
    onChange(unwrapContainer(nodes, containerId));
  }

  function addChild(containerId: BuilderContainerId, type: PaletteBlockType) {
    if (countNodes(nodes) >= MAX_TOTAL_PAGE_NODES) return;
    if (isContainerAtCapacity(nodes, containerId)) return;
    const children = getContainerChildren(nodes, containerId);
    onChange(insertNode(nodes, containerId, children.length, createBlock(type)));
  }

  const ctx: Ctx = {
    onMove: move,
    onMoveToParent: moveToParent,
    onRemove: remove,
    onUpdateContent: updateContent,
    onWrap: wrap,
    onUnwrap: requestUnwrap,
    onAddChild: addChild,
    onSelectContainer,
    selectedContainerId,
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
        {nodes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-foreground/50">
            Henüz blok yok — yukarıdan bir blok veya düzen ekleyin.
          </div>
        ) : (
          <SortableContext items={rootIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-4">
              {nodes.map((node, index) => (
                <NodeCard key={node.id} node={node} parentId="root" index={index} total={nodes.length} depth={1} ctx={ctx} />
              ))}
            </div>
          </SortableContext>
        )}
        <DragOverlay>
          {activeNode ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 shadow-lg ring-2 ring-primary/40">
              <GripVertical className="h-4 w-4 text-foreground/40" />
              <span className="text-sm font-medium text-foreground">{nodeLabel(activeNode)}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <ConfirmDialog
        open={pendingUnwrap !== null}
        onOpenChange={(open) => !open && setPendingUnwrap(null)}
        tone="warning"
        title="Konteyner kaldırılsın mı?"
        description={
          pendingUnwrap
            ? `İçindeki ${pendingUnwrap.nodeCount} öğe, sırasıyla üst seviyeye taşınacak. İçerik SİLİNMEZ.`
            : undefined
        }
        confirmText="Konteyneri Kaldır"
        cancelText="Vazgeç"
        onConfirm={() => {
          if (pendingUnwrap) onChange(unwrapContainer(nodes, pendingUnwrap.containerId));
          setPendingUnwrap(null);
        }}
      />
    </>
  );
}
