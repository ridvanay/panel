import { Button } from "@/components/ui/button";
import { blockRegistry, type PaletteBlockType } from "@/lib/page-builder/registry";

export function BlockList({ onAdd }: { onAdd: (type: PaletteBlockType) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {(Object.entries(blockRegistry) as [PaletteBlockType, { label: string }][]).map(([type, meta]) => (
        <Button key={type} type="button" variant="secondary" size="sm" onClick={() => onAdd(type)}>
          + {meta.label}
        </Button>
      ))}
    </div>
  );
}
