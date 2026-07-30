import { Button } from "@/components/ui/button";
import { blockRegistry } from "@/lib/page-builder/registry";
import type { BlockType } from "@/lib/page-builder/types";

export function BlockList({ onAdd }: { onAdd: (type: BlockType) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {(Object.entries(blockRegistry) as [BlockType, { label: string }][]).map(([type, meta]) => (
        <Button key={type} type="button" variant="secondary" size="sm" onClick={() => onAdd(type)}>
          + {meta.label}
        </Button>
      ))}
    </div>
  );
}
