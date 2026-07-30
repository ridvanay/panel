import { Eye } from "lucide-react";

export function ViewCount({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm text-foreground/50">
      <Eye className="size-4" aria-hidden="true" />
      {count.toLocaleString("tr-TR")} görüntülenme
    </span>
  );
}
