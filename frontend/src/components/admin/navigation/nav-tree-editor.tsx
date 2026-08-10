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
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ListTree } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { DropIndicator, NavTreeRow, NavTreeRowOverlay } from "./nav-tree-row";
import {
  buildTree,
  canIndent,
  canOutdent,
  flattenDepthFirst,
  indentItem,
  moveItem,
  outdentItem,
  previewProjection,
  removeItemCascade,
  updateItem,
  type FlatNavItem,
} from "./nav-tree-utils";

interface NavTreeEditorProps {
  items: FlatNavItem[];
  onChange: (items: FlatNavItem[]) => void;
  hrefHint: string;
}

/**
 * Sağ panel — Karar 2-6: dnd-kit tabanlı, sürükle-bırakla sıralanabilir VE en fazla 2 seviye
 * iç-içe geçirilebilen menü ağacı. dnd-kit'in resmi "Sortable Tree" örneğindeki izdüşüm
 * (projection) mantığı referans alınmıştır — somut kurallar `nav-tree-utils.ts`'te.
 */
export function NavTreeEditor({ items, onChange, hrefHint }: NavTreeEditorProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [offsetLeft, setOffsetLeft] = useState(0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const flat = flattenDepthFirst(items);
  const sortableIds = flat.map((item) => item.id);
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

  function handleIndent(id: string) {
    onChange(indentItem(items, id));
  }
  function handleOutdent(id: string) {
    onChange(outdentItem(items, id));
  }
  function handleUpdate(id: string, patch: { label?: string; href?: string }) {
    onChange(updateItem(items, id, patch));
  }
  function handleRemove(id: string) {
    onChange(removeItemCascade(items, id));
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={ListTree}
        title="Menü öğesi yok"
        description='Soldaki panelden bir sayfa, yazı ya da özel bağlantı seçip "Menüye Ekle" butonuna tıklayın.'
      />
    );
  }

  const tree = buildTree(items);

  function renderIndicatorAbove(rowId: string) {
    if (!activeId || overId !== rowId || !projection) return null;
    return <DropIndicator depth={projection.depth} />;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={resetDragState}
    >
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {tree.map((node) => (
            <div key={node.item.id} className="space-y-2">
              {renderIndicatorAbove(node.item.id)}
              <NavTreeRow
                item={node.item}
                canIndentItem={canIndent(items, node.item.id)}
                canOutdentItem={canOutdent(items, node.item.id)}
                onIndent={() => handleIndent(node.item.id)}
                onOutdent={() => handleOutdent(node.item.id)}
                onUpdate={(patch) => handleUpdate(node.item.id, patch)}
                onRemove={() => handleRemove(node.item.id)}
                hrefHint={hrefHint}
              />
              {node.children.length > 0 && (
                <div className="relative ml-3 space-y-2 border-l border-dashed border-border/60 pl-5">
                  {node.children.map((child) => (
                    <div key={child.id} className="space-y-2">
                      {renderIndicatorAbove(child.id)}
                      <NavTreeRow
                        item={child}
                        canIndentItem={canIndent(items, child.id)}
                        canOutdentItem={canOutdent(items, child.id)}
                        onIndent={() => handleIndent(child.id)}
                        onOutdent={() => handleOutdent(child.id)}
                        onUpdate={(patch) => handleUpdate(child.id, patch)}
                        onRemove={() => handleRemove(child.id)}
                        hrefHint={hrefHint}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {/* Listenin sonuna bırakma (`over === null`) — Karar 5.6: pointer son satırın da altına
              geçtiğinde, gösterge ağacın en altında render edilir. */}
          {activeId && overId === null && projection && <DropIndicator depth={projection.depth} />}
        </div>
      </SortableContext>
      <DragOverlay>{activeItem ? <NavTreeRowOverlay item={activeItem} /> : null}</DragOverlay>
    </DndContext>
  );
}
