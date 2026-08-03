import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SeoScoreBadge } from "./seo-score-badge";
import type { ContentListEntity, ContentListFilter, QuickEditValues } from "./types";

interface ContentListTableProps<T extends ContentListEntity> {
  items: T[];
  activeFilter: ContentListFilter;
  isAdmin: boolean;

  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  allSelected: boolean;

  editingId: string | null;
  quickEditValues: QuickEditValues;
  quickEditSaving: boolean;
  quickEditError: string | null;
  onQuickEditChange: (values: Partial<QuickEditValues>) => void;
  onQuickEditSave: () => void;
  onQuickEditCancel: () => void;
  onStartQuickEdit: (item: T) => void;

  busyId: string | null;
  onTrash: (item: T) => void;
  onRestore: (item: T) => void;
  onRequestPermanentDelete: (item: T) => void;

  editHref: (item: T) => string;
  viewHref: (item: T) => string;

  /** Blog'a özgü Kategori sütunu — Sayfalar'da bu prop verilmez, sütun render edilmez. */
  categoryColumn?: {
    header: string;
    render: (item: T) => ReactNode;
  };
}

const columnCountBase = 7; // Checkbox, Başlık, Yazar, SEO, Durum, Tarih, Görüntülenme

export function ContentListTable<T extends ContentListEntity>({
  items,
  activeFilter,
  isAdmin,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  allSelected,
  editingId,
  quickEditValues,
  quickEditSaving,
  quickEditError,
  onQuickEditChange,
  onQuickEditSave,
  onQuickEditCancel,
  onStartQuickEdit,
  busyId,
  onTrash,
  onRestore,
  onRequestPermanentDelete,
  editHref,
  viewHref,
  categoryColumn,
}: ContentListTableProps<T>) {
  const colSpan = columnCountBase + (categoryColumn ? 1 : 0);
  const isTrashed = activeFilter === "trashed";

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
            <TableHead className="w-auto">Başlık</TableHead>
            <TableHead className="w-36">Yazar</TableHead>
            {categoryColumn && <TableHead className="w-36">{categoryColumn.header}</TableHead>}
            <TableHead className="w-20">SEO</TableHead>
            <TableHead className="w-24">Durum</TableHead>
            <TableHead className="w-36">Tarih</TableHead>
            <TableHead className="w-28 text-right">Görüntülenme</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            if (editingId === item.id) {
              return (
                <TableRow key={item.id} className="border-l-2 border-l-primary bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={colSpan} className="p-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
                      <div className="space-y-1">
                        <label htmlFor={`quick-edit-title-${item.id}`} className="text-xs font-medium text-foreground/60">
                          Başlık
                        </label>
                        <Input
                          id={`quick-edit-title-${item.id}`}
                          value={quickEditValues.title}
                          onChange={(e) => onQuickEditChange({ title: e.target.value })}
                          autoFocus
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`quick-edit-slug-${item.id}`} className="text-xs font-medium text-foreground/60">
                          Slug
                        </label>
                        <Input
                          id={`quick-edit-slug-${item.id}`}
                          value={quickEditValues.slug}
                          onChange={(e) => onQuickEditChange({ slug: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={`quick-edit-status-${item.id}`} className="text-xs font-medium text-foreground/60">
                          Durum
                        </label>
                        <Select
                          id={`quick-edit-status-${item.id}`}
                          value={quickEditValues.status}
                          onChange={(e) => onQuickEditChange({ status: e.target.value as QuickEditValues["status"] })}
                        >
                          <option value="DRAFT">Taslak</option>
                          <option value="PUBLISHED">Yayında</option>
                        </Select>
                      </div>
                      <div className="flex items-end gap-2">
                        <Button type="button" size="sm" loading={quickEditSaving} onClick={onQuickEditSave}>
                          Güncelle
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={onQuickEditCancel} disabled={quickEditSaving}>
                          İptal
                        </Button>
                      </div>
                      {quickEditError && (
                        <p role="alert" className="text-xs text-danger sm:col-span-4">
                          {quickEditError}
                        </p>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            }

            const busy = busyId === item.id;

            return (
              <TableRow key={item.id} className="group even:bg-muted hover:bg-primary/8 dark:hover:bg-primary/10">
                <TableCell className="w-10">
                  <Checkbox
                    aria-label={`${item.title} öğesini seç`}
                    checked={selectedIds.has(item.id)}
                    onCheckedChange={() => onToggleSelect(item.id)}
                  />
                </TableCell>
                <TableCell className="w-auto">
                  <Link href={editHref(item)} className="font-semibold text-primary hover:text-primary-hover hover:underline underline-offset-2 dark:text-primary-hover">
                    {item.title}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-foreground/70 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    {isTrashed ? (
                      <>
                        <button
                          type="button"
                          className="hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-50"
                          disabled={busy}
                          onClick={() => onRestore(item)}
                        >
                          Geri Yükle
                        </button>
                        {isAdmin && (
                          <>
                            <span className="text-foreground/30" aria-hidden>
                              |
                            </span>
                            <button
                              type="button"
                              className="hover:text-danger hover:underline disabled:pointer-events-none disabled:opacity-50"
                              disabled={busy}
                              onClick={() => onRequestPermanentDelete(item)}
                            >
                              Kalıcı Sil
                            </button>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <Link href={editHref(item)} className="hover:text-foreground hover:underline">
                          Düzenle
                        </Link>
                        <span className="text-foreground/30" aria-hidden>
                          |
                        </span>
                        <button
                          type="button"
                          aria-expanded={editingId === item.id}
                          className="hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-50"
                          disabled={busy}
                          onClick={() => onStartQuickEdit(item)}
                        >
                          Hızlı Düzenle
                        </button>
                        <span className="text-foreground/30" aria-hidden>
                          |
                        </span>
                        <button
                          type="button"
                          className="hover:text-danger hover:underline disabled:pointer-events-none disabled:opacity-50"
                          disabled={busy}
                          onClick={() => onTrash(item)}
                        >
                          Çöpe Taşı
                        </button>
                        {item.status === "PUBLISHED" && (
                          <>
                            <span className="text-foreground/30" aria-hidden>
                              |
                            </span>
                            <Link href={viewHref(item)} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">
                              Görüntüle
                            </Link>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </TableCell>
                <TableCell className="w-36">
                  {item.author ? (
                    <span className="text-foreground/70">{item.author.name}</span>
                  ) : (
                    <span className="text-foreground/70">—</span>
                  )}
                </TableCell>
                {categoryColumn && <TableCell className="w-36 text-foreground/70">{categoryColumn.render(item)}</TableCell>}
                <TableCell className="w-20">
                  <SeoScoreBadge score={item.seoScore} issues={item.seoScoreIssues} entityLabel={item.title} />
                </TableCell>
                <TableCell className="w-24">
                  <Badge tone={item.status === "PUBLISHED" ? "success" : "warning"} size="lg" solid>
                    {item.status === "PUBLISHED" ? "Yayında" : "Taslak"}
                  </Badge>
                </TableCell>
                <TableCell className="w-36">
                  <DateCell item={item} />
                </TableCell>
                <TableCell className="w-28 text-right text-foreground/70">{item.viewCount.toLocaleString("tr-TR")}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function DateCell({ item }: { item: ContentListEntity }) {
  let label: string;
  let value: string | null;

  if (item.deletedAt) {
    label = "Çöpe Taşındı";
    value = item.deletedAt;
  } else if (item.status === "PUBLISHED") {
    label = "Yayınlandı";
    value = item.publishedAt;
  } else {
    label = "Son Düzenleme";
    value = item.updatedAt;
  }

  return (
    <div>
      <p className="text-xs font-medium text-foreground">{label}</p>
      <p className="text-xs text-foreground/70">{value ? new Date(value).toLocaleDateString("tr-TR") : "—"}</p>
    </div>
  );
}
