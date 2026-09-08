"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis, restrictToWindowEdges } from "@dnd-kit/modifiers";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ListTree } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { NAVIGATION_MAX_DEPTH } from "@/lib/navigation-constants";
import { DropIndicator, NavTreeRow, NavTreeRowOverlay } from "./nav-tree-row";
import {
  buildTree,
  canIndent,
  canMoveDownSibling,
  canMoveUpSibling,
  canOutdent,
  flattenDepthFirst,
  indentItem,
  moveItem,
  moveSibling,
  outdentItem,
  previewProjection,
  removeItemCascade,
  updateItem,
  type DropProjection,
  type FlatNavItem,
  type NavTreeNode,
} from "./nav-tree-utils";

interface NavTreeEditorProps {
  items: FlatNavItem[];
  onChange: (items: FlatNavItem[]) => void;
  hrefHint: string;
}

/** Çocuk konteynerinin rehber çizgisi opaklığı — derinlik arttıkça soluklaşır, dikkat köke kalır
 * (ui-designer kararı (a) — `.claude/ui-designer-navigation-flyout-spec.md`). `depth` burada wrap
 * edilen ÇOCUK düğümlerin derinliğidir (1, 2 veya 3); renk kodlaması/metin rozeti KULLANILMAZ. */
function guideLineOpacityClass(depth: number): string {
  if (depth <= 1) return "border-border/60";
  if (depth === 2) return "border-border/40";
  return "border-border/25";
}

interface NavTreeBranchProps {
  nodes: NavTreeNode[];
  depth: number;
  items: FlatNavItem[];
  activeId: string | null;
  overId: string | null;
  projection: DropProjection | null;
  onIndent: (id: string) => void;
  onOutdent: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onUpdate: (id: string, patch: { label?: string; href?: string }) => void;
  onRemove: (id: string) => void;
  hrefHint: string;
}

/**
 * Özyinelemeli ağaç dalı (architect-scope §2) — kök ve ARBİTRARY derinlikteki tüm alt seviyeleri
 * AYNI bileşenle render eder; sabit iki-seviyelik JSX'in yerini alır. Girinti, ui-designer kararı
 * (a) gereği her seviyede sabit `ml-2 pl-3` (8+12=20px) konteyner iç içe geçmesiyle KÜMÜLATİF
 * olarak oluşur (0/20/40/60px) — derinlik başına ayrı bir hesaplanmış `style` GEREKMEZ. Gerçek
 * derinlik sınırı zaten veri modelinde/validasyonda (`NAVIGATION_MAX_DEPTH`) uygulandığı için
 * buradaki `depth > NAVIGATION_MAX_DEPTH` kontrolü SADECE savunma amaçlıdır (bozuk state
 * render'ı sonsuz döngüye/aşırı derinliğe sokmasın).
 */
function NavTreeBranch({
  nodes,
  depth,
  items,
  activeId,
  overId,
  projection,
  onIndent,
  onOutdent,
  onMoveUp,
  onMoveDown,
  onUpdate,
  onRemove,
  hrefHint,
}: NavTreeBranchProps) {
  if (depth > NAVIGATION_MAX_DEPTH) return null;

  return (
    <>
      {nodes.map((node) => {
        const showIndicatorAbove = Boolean(activeId) && overId === node.item.id && projection !== null;
        return (
          <div key={node.item.id} className="space-y-2">
            {showIndicatorAbove && <DropIndicator depth={projection!.depth} />}
            <NavTreeRow
              item={node.item}
              canIndentItem={canIndent(items, node.item.id)}
              canOutdentItem={canOutdent(items, node.item.id)}
              canMoveUp={canMoveUpSibling(items, node.item.id)}
              canMoveDown={canMoveDownSibling(items, node.item.id)}
              onIndent={onIndent}
              onOutdent={onOutdent}
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
              onUpdate={onUpdate}
              onRemove={onRemove}
              hrefHint={hrefHint}
            />
            {node.children.length > 0 && (
              <div className={cn("relative ml-2 space-y-2 border-l border-dashed pl-3", guideLineOpacityClass(depth + 1))}>
                <NavTreeBranch
                  nodes={node.children}
                  depth={depth + 1}
                  items={items}
                  activeId={activeId}
                  overId={overId}
                  projection={projection}
                  onIndent={onIndent}
                  onOutdent={onOutdent}
                  onMoveUp={onMoveUp}
                  onMoveDown={onMoveDown}
                  onUpdate={onUpdate}
                  onRemove={onRemove}
                  hrefHint={hrefHint}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * Sağ panel — Karar 2-6: dnd-kit tabanlı, sürükle-bırakla sıralanabilir VE en fazla
 * `NAVIGATION_MAX_DEPTH + 1` seviye iç-içe geçirilebilen menü ağacı. dnd-kit'in resmi
 * "Sortable Tree" örneğindeki izdüşüm (projection) mantığı referans alınmıştır — somut kurallar
 * `nav-tree-utils.ts`'te.
 */
export function NavTreeEditor({ items, onChange, hrefHint }: NavTreeEditorProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [offsetLeft, setOffsetLeft] = useState(0);
  // `DragOverlay`'ı `document.body`'ye portal etmek için — SSR/hydration güvenliği (bkz. koordinat
  // sapması düzeltmesi): `document` yalnızca istemcide mevcut, bu yüzden mount SONRASI true olur.
  // `setState` senkron DEĞİL, `requestAnimationFrame` callback'i İÇİNDE — `react-hooks/set-state-in-effect`
  // kuralıyla uyumlu (bkz. `RevealPreviewBox`teki AYNI desen, builder-canvas.tsx).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // `useMemo`: `SortableContext`'in `items` prop'u (dnd-kit'in KENDİ context'i) referans
  // değişikliğine duyarlı — `sortableIds` her render'da YENİ bir dizi olursa, içindeki HER
  // `useSortable()` çağrısı (yani her `NavTreeRow`) context üzerinden re-render TETİKLENİR,
  // bu `NavTreeRow`'daki `memo`'yu tamamen ATLAR (memo sadece parent'ın prop'u değiştirince
  // devreye girer, context aboneliğini durduramaz). Sürükleme sırasında sadece `offsetLeft`/
  // `overId` değiştiğinde `items` AYNI kaldığı için bu referans da stabil kalmalı — gerçek
  // ölçümle doğrulanmış kök neden (bkz. PERFORMANCE_NOTES.md).
  const flat = useMemo(() => flattenDepthFirst(items), [items]);
  const sortableIds = useMemo(() => flat.map((item) => item.id), [flat]);
  const activeItem = activeId ? flat.find((item) => item.id === activeId) ?? null : null;
  const projection = previewProjection(items, activeId, overId, offsetLeft);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }
  function handleDragMove(event: DragMoveEvent) {
    setOffsetLeft(event.delta.x);
  }
  function handleDragOver(event: DragOverEvent) {
    setOverId(event.over ? String(event.over.id) : null);
  }
  function resetDragState() {
    setActiveId(null);
    setOverId(null);
    setOffsetLeft(0);
  }
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const finalOverId = over ? String(over.id) : null;
    const draggedId = String(active.id);
    if (finalOverId !== draggedId) {
      onChange(moveItem(items, draggedId, finalOverId, offsetLeft));
    }
    resetDragState();
  }

  // `useCallback`: NavTreeRow'a AYNI fonksiyon referansı geçilsin diye — id, closure yerine
  // parametre olarak alınıyor (bkz. nav-tree-row.tsx). Bu olmadan her satıra her render'da YENİ
  // bir inline callback geçiliyordu, bu da `memo`'yu anlamsız kılıp sürükleme sırasında TÜM
  // satırların yeniden render olmasına yol açıyordu (gerçek ölçüm: PERFORMANCE_NOTES.md).
  const handleIndent = useCallback((id: string) => onChange(indentItem(items, id)), [items, onChange]);
  const handleOutdent = useCallback((id: string) => onChange(outdentItem(items, id)), [items, onChange]);
  const handleMoveUp = useCallback((id: string) => onChange(moveSibling(items, id, -1)), [items, onChange]);
  const handleMoveDown = useCallback((id: string) => onChange(moveSibling(items, id, 1)), [items, onChange]);
  const handleUpdate = useCallback(
    (id: string, patch: { label?: string; href?: string }) => onChange(updateItem(items, id, patch)),
    [items, onChange]
  );
  const handleRemove = useCallback((id: string) => onChange(removeItemCascade(items, id)), [items, onChange]);

  // `useMemo`: `items` değişmediği sürece (ör. sürükleme sırasında sadece `offsetLeft`/`overId`
  // değiştiğinde) AYNI `tree` referansı korunur — `buildTree` zaten `item` referanslarını
  // koruyor (bkz. nav-tree-utils.ts), bu da `NavTreeRow`'un `memo` karşılaştırmasının satır
  // gerçekten değişmediyse geçerli olmasını sağlar. Hook kuralları gereği erken `return`'den
  // ÖNCE çağrılmalı.
  const tree = useMemo(() => buildTree(items), [items]);

  if (items.length === 0) {
    return (
      <EmptyState
        icon={ListTree}
        title="Menü öğesi yok"
        description='Soldaki panelden bir sayfa, yazı ya da özel bağlantı seçip "Menüye Ekle" butonuna tıklayın.'
      />
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToWindowEdges]}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={resetDragState}
    >
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          <NavTreeBranch
            nodes={tree}
            depth={0}
            items={items}
            activeId={activeId}
            overId={overId}
            projection={projection}
            onIndent={handleIndent}
            onOutdent={handleOutdent}
            onMoveUp={handleMoveUp}
            onMoveDown={handleMoveDown}
            onUpdate={handleUpdate}
            onRemove={handleRemove}
            hrefHint={hrefHint}
          />
          {/* Listenin sonuna bırakma (`over === null`) — Karar 5.6: pointer son satırın da altına
              geçtiğinde, gösterge ağacın en altında render edilir. */}
          {activeId && overId === null && projection && <DropIndicator depth={projection.depth} />}
        </div>
      </SortableContext>
      {mounted &&
        createPortal(
          <DragOverlay modifiers={[restrictToVerticalAxis, restrictToWindowEdges]}>
            {activeItem ? <NavTreeRowOverlay item={activeItem} /> : null}
          </DragOverlay>,
          document.body
        )}
    </DndContext>
  );
}
