import type { ReactNode } from "react";
import Link from "next/link";
import { Eye, MoreVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
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

/** Durum rozetinin tonu/etiketi — `SCHEDULED` mor tonda ayrışır (yayında/taslaktan farklı). */
function statusBadgeProps(status: ContentListEntity["status"]): { tone: "success" | "warning" | "primary"; label: string } {
  if (status === "PUBLISHED") return { tone: "success", label: "Yayında" };
  if (status === "SCHEDULED") return { tone: "primary", label: "Zamanlanmış" };
  return { tone: "warning", label: "Taslak" };
}

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
    <>
      {/* Masaüstü/tablet (≥768px): tam tablo görünümü. */}
      <div className="hidden overflow-hidden rounded-xl border border-border bg-card shadow-sm md:block">
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
                  <TableRow
                    key={item.id}
                    className="border-l-4 border-l-primary border-y border-primary/20 bg-primary/8 hover:bg-primary/8"
                  >
                    <TableCell colSpan={colSpan} className="p-4">
                      <div className="animate-in fade-in-0 slide-in-from-top-1 duration-200 flex flex-col gap-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_1fr]">
                          <div className="space-y-1">
                            <label htmlFor={`quick-edit-title-${item.id}`} className="block text-xs font-medium text-foreground/60">
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
                            <label htmlFor={`quick-edit-slug-${item.id}`} className="block text-xs font-medium text-foreground/60">
                              Slug
                            </label>
                            <Input
                              id={`quick-edit-slug-${item.id}`}
                              value={quickEditValues.slug}
                              onChange={(e) => onQuickEditChange({ slug: e.target.value })}
                            />
                          </div>
                          <div className="space-y-1">
                            <label htmlFor={`quick-edit-status-${item.id}`} className="block text-xs font-medium text-foreground/60">
                              Durum
                            </label>
                            <Select
                              id={`quick-edit-status-${item.id}`}
                              className="min-w-36"
                              value={quickEditValues.status}
                              onChange={(e) => onQuickEditChange({ status: e.target.value as QuickEditValues["status"] })}
                            >
                              <option value="DRAFT">Taslak</option>
                              <option value="PUBLISHED">Yayında</option>
                            </Select>
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2">
                          <Button type="button" size="sm" loading={quickEditSaving} onClick={onQuickEditSave}>
                            Güncelle
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={onQuickEditCancel} disabled={quickEditSaving}>
                            İptal
                          </Button>
                        </div>
                        {quickEditError && (
                          <p role="alert" className="animate-in fade-in-0 duration-150 text-xs text-danger">
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
                    <Link href={editHref(item)} className="admin-link">
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
                    <Badge tone={statusBadgeProps(item.status).tone} size="lg" solid>
                      {statusBadgeProps(item.status).label}
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

      {/* Mobil (<768px): kart listesi görünümü. */}
      <div className="space-y-3 md:hidden">
        {items.map((item) => {
          const busy = busyId === item.id;

          if (editingId === item.id) {
            return (
              <div key={item.id} className="rounded-xl border border-l-4 border-l-primary border-primary/20 bg-primary/8 p-4 shadow-sm">
                <div className="animate-in fade-in-0 slide-in-from-top-1 duration-200 grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <label htmlFor={`quick-edit-title-m-${item.id}`} className="block text-xs font-medium text-foreground/60">
                      Başlık
                    </label>
                    <Input
                      id={`quick-edit-title-m-${item.id}`}
                      className="h-11"
                      value={quickEditValues.title}
                      onChange={(e) => onQuickEditChange({ title: e.target.value })}
                      autoFocus
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor={`quick-edit-slug-m-${item.id}`} className="block text-xs font-medium text-foreground/60">
                      Slug
                    </label>
                    <Input
                      id={`quick-edit-slug-m-${item.id}`}
                      className="h-11"
                      value={quickEditValues.slug}
                      onChange={(e) => onQuickEditChange({ slug: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor={`quick-edit-status-m-${item.id}`} className="block text-xs font-medium text-foreground/60">
                      Durum
                    </label>
                    <Select
                      id={`quick-edit-status-m-${item.id}`}
                      className="h-11"
                      value={quickEditValues.status}
                      onChange={(e) => onQuickEditChange({ status: e.target.value as QuickEditValues["status"] })}
                    >
                      <option value="DRAFT">Taslak</option>
                      <option value="PUBLISHED">Yayında</option>
                    </Select>
                  </div>
                  {quickEditError && (
                    <p role="alert" className="animate-in fade-in-0 duration-150 text-xs text-danger">
                      {quickEditError}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      className="h-11 w-full sm:w-auto"
                      loading={quickEditSaving}
                      onClick={onQuickEditSave}
                    >
                      Güncelle
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-full sm:w-auto"
                      onClick={onQuickEditCancel}
                      disabled={quickEditSaving}
                    >
                      İptal
                    </Button>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div
              key={item.id}
              className={cn(
                "rounded-xl border border-border bg-card p-4 shadow-sm",
                selectedIds.has(item.id) && "border-primary ring-1 ring-primary/30"
              )}
            >
              <div className="flex items-start gap-3">
                <div className="-m-2 flex size-11 shrink-0 items-center justify-center">
                  <Checkbox
                    aria-label={`${item.title} öğesini seç`}
                    checked={selectedIds.has(item.id)}
                    onCheckedChange={() => onToggleSelect(item.id)}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <Link
                    href={editHref(item)}
                    className="line-clamp-2 text-[15px] font-semibold leading-snug text-primary"
                  >
                    {item.title}
                  </Link>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`${item.title} için işlemler`}
                        className="relative shrink-0 after:absolute after:-inset-2"
                      />
                    }
                  >
                    <MoreVertical className="h-4 w-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {isTrashed ? (
                      <>
                        <DropdownMenuItem disabled={busy} onClick={() => onRestore(item)}>
                          Geri Yükle
                        </DropdownMenuItem>
                        {isAdmin && (
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={busy}
                            onClick={() => onRequestPermanentDelete(item)}
                          >
                            Kalıcı Sil
                          </DropdownMenuItem>
                        )}
                      </>
                    ) : (
                      <>
                        <DropdownMenuItem render={<Link href={editHref(item)} />}>Düzenle</DropdownMenuItem>
                        <DropdownMenuItem disabled={busy} onClick={() => onStartQuickEdit(item)}>
                          Hızlı Düzenle
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" disabled={busy} onClick={() => onTrash(item)}>
                          Çöpe Taşı
                        </DropdownMenuItem>
                        {item.status === "PUBLISHED" && (
                          <DropdownMenuItem render={<Link href={viewHref(item)} target="_blank" rel="noopener noreferrer" />}>
                            Görüntüle
                          </DropdownMenuItem>
                        )}
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-11 text-xs text-foreground/70">
                {item.author && <span>{item.author.name}</span>}
                {categoryColumn && <span>{categoryColumn.render(item)}</span>}
                <MobileDateText item={item} />
              </div>

              <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/60 pt-3 pl-11">
                <div className="flex items-center gap-2">
                  <Badge tone={statusBadgeProps(item.status).tone} size="lg" solid>
                    {statusBadgeProps(item.status).label}
                  </Badge>
                  <SeoScoreBadge score={item.seoScore} issues={item.seoScoreIssues} entityLabel={item.title} />
                </div>
                <div className="flex items-center gap-1 text-xs text-foreground/60">
                  <Eye className="h-3.5 w-3.5" />
                  {item.viewCount.toLocaleString("tr-TR")}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function dateCellParts(item: ContentListEntity): { label: string; value: string | null } {
  if (item.deletedAt) {
    return { label: "Çöpe Taşındı", value: item.deletedAt };
  }
  if (item.status === "PUBLISHED") {
    return { label: "Yayınlandı", value: item.publishedAt };
  }
  return { label: "Son Düzenleme", value: item.updatedAt };
}

function DateCell({ item }: { item: ContentListEntity }) {
  const { label, value } = dateCellParts(item);

  return (
    <div>
      <p className="text-xs font-medium text-foreground">{label}</p>
      <p className="text-xs text-foreground/70">{value ? new Date(value).toLocaleDateString("tr-TR") : "—"}</p>
    </div>
  );
}

/** Mobil kartlardaki meta satırı için tarih etiketi+değeri tek satırda gösterir. */
function MobileDateText({ item }: { item: ContentListEntity }) {
  const { label, value } = dateCellParts(item);

  return (
    <span>
      {label}: {value ? new Date(value).toLocaleDateString("tr-TR") : "—"}
    </span>
  );
}
