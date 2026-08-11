"use client";

import { MoreVertical } from "lucide-react";
import type { Media } from "@/lib/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** `image/svg+xml` → "SVG+XML", `image/png` → "PNG" gibi MIME alt-türünü rozet metnine çevirir. */
function mimeSubtype(mimeType: string): string {
  return (mimeType.split("/")[1] ?? mimeType).toUpperCase();
}

interface MediaListTableProps {
  items: Media[];
  selectedIds: Set<string>;
  allSelected: boolean;
  onToggleSelect: (mediaId: string) => void;
  onToggleSelectAll: () => void;
  onCopy: (url: string) => void;
  onPreview: (media: Media) => void;
  onDelete: (media: Media) => void;
  /**
   * §10.11.5 — shift/ctrl/cmd tıklamayla satırın kendisine tıklanınca çağrılır (checkbox HARİÇ,
   * checkbox zaten `onToggleSelect` ile tekil toggle yapıyor). `true` dönerse satır kendi normal
   * davranışını (bugün yok) TETİKLEMEZ — bkz. `useMultiSelect().handleItemClick`.
   */
  onRowClick?: (mediaId: string, modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => boolean;
}

/**
 * Medya kütüphanesi için WordPress-tarzı liste (tablo) görünümü.
 * `content-list-table.tsx`'in masaüstü tablo yapısından sadeleştirilmiştir — mobilde ayrı bir
 * kart varyantı yok, `Table`'ın yerleşik yatay kaydırma sarmalayıcısına güvenilir (Grid görünümü
 * zaten mobilde birincil deneyimdir).
 */
export function MediaListTable({
  items,
  selectedIds,
  allSelected,
  onToggleSelect,
  onToggleSelectAll,
  onCopy,
  onPreview,
  onDelete,
  onRowClick,
}: MediaListTableProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <Table>
        <TableHeader className="bg-muted">
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                aria-label="Tümünü seç"
                checked={allSelected}
                indeterminate={selectedIds.size > 0 && !allSelected}
                onCheckedChange={onToggleSelectAll}
              />
            </TableHead>
            <TableHead className="w-auto">Dosya</TableHead>
            <TableHead className="w-24">Tür</TableHead>
            <TableHead className="w-24">Boyut</TableHead>
            <TableHead className="w-28">Ölçüler</TableHead>
            <TableHead className="w-36">Yükleme Tarihi</TableHead>
            <TableHead className="w-16 text-right">İşlemler</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((media) => (
            <TableRow
              key={media.id}
              className="group even:bg-muted hover:bg-primary/8 dark:hover:bg-primary/10"
              onClick={(e) => {
                // §10.11.5 — yalnızca shift/ctrl/cmd tıklamayı yakalar; düz tıklama satırda bugün
                // hiçbir davranışı tetiklemez (checkbox/⋮ menüsü zaten kendi tıklamalarını yönetiyor).
                if (e.shiftKey || e.ctrlKey || e.metaKey) onRowClick?.(media.id, e);
              }}
            >
              <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  aria-label={`${media.filename} öğesini seç`}
                  checked={selectedIds.has(media.id)}
                  onCheckedChange={() => onToggleSelect(media.id)}
                />
              </TableCell>
              <TableCell className="w-auto">
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- yüklenen medya URL'si, next/image remotePatterns henüz tanımlı değil */}
                  <img src={media.url} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
                  <span className="truncate text-sm font-medium text-foreground" title={media.filename}>
                    {media.filename}
                  </span>
                </div>
              </TableCell>
              <TableCell className="w-24">
                <Badge tone="neutral" size="sm">
                  {mimeSubtype(media.mimeType)}
                </Badge>
              </TableCell>
              <TableCell className="w-24 text-foreground/70">{formatSize(media.sizeBytes)}</TableCell>
              <TableCell className="w-28 text-foreground/70">
                {media.width && media.height ? `${media.width}×${media.height}` : "—"}
              </TableCell>
              <TableCell className="w-36 text-xs text-foreground/70">
                {new Date(media.createdAt).toLocaleDateString("tr-TR")}
              </TableCell>
              <TableCell className="w-16 text-right" onClick={(e) => e.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${media.filename} için işlemler`}
                      />
                    }
                  >
                    <MoreVertical className="h-4 w-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onCopy(media.url)}>URL&apos;yi Kopyala</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onPreview(media)}>Önizle</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => onDelete(media)}>
                      Sil
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
