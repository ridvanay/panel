import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import type { BulkContentAction } from "@/lib/api/types";
import type { ContentListFilter } from "./types";

/** Toplu işlem `<Select>`'inde gösterilecek seçenekler — aktif sekmeye ve role göre değişir. */
type BulkSelectAction = BulkContentAction | "delete";

const ACTIVE_TAB_ACTIONS: { value: BulkSelectAction; label: string }[] = [
  { value: "publish", label: "Yayınla" },
  { value: "draft", label: "Taslağa Al" },
  { value: "trash", label: "Çöpe Taşı" },
];

const TRASHED_TAB_ACTIONS: { value: BulkSelectAction; label: string }[] = [
  { value: "restore", label: "Geri Yükle" },
  { value: "delete", label: "Kalıcı Sil" },
];

interface ContentListBulkBarProps {
  selectedCount: number;
  activeFilter: ContentListFilter;
  isAdmin: boolean;
  action: BulkSelectAction;
  onActionChange: (action: BulkSelectAction) => void;
  onApply: () => void;
  applying: boolean;
  onClearSelection: () => void;
  /** CSV dışa aktarma gibi entity'ye özgü ekstra aksiyonlar. */
  extraActions?: ReactNode;
}

export function ContentListBulkBar({
  selectedCount,
  activeFilter,
  isAdmin,
  action,
  onActionChange,
  onApply,
  applying,
  onClearSelection,
  extraActions,
}: ContentListBulkBarProps) {
  const options = (activeFilter === "trashed" ? TRASHED_TAB_ACTIONS : ACTIVE_TAB_ACTIONS).filter(
    (opt) => opt.value !== "delete" || isAdmin
  );

  return (
    <Card className="flex flex-wrap items-center gap-3 p-4">
      <span className="text-sm font-medium text-foreground">{selectedCount} seçili</span>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Toplu işlem seç"
          value={action}
          onChange={(e) => onActionChange(e.target.value as BulkSelectAction)}
          className="w-full sm:w-40"
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
        <Button variant="outline" size="sm" loading={applying} onClick={onApply}>
          Uygula
        </Button>
        {extraActions}
      </div>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onClearSelection}>
        Seçimi Temizle
      </Button>
    </Card>
  );
}
