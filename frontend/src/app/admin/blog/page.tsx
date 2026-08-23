"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, Download, Newspaper, Search, Tag } from "lucide-react";
import * as blogApi from "@/lib/api/blog";
import type { BlogCategory, BlogPost, BlogTag } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/link-button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/select";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { PageHeading } from "@/components/admin/page-heading";
import { ListPagination } from "@/components/admin/list-pagination";
import { ContentListTabs } from "@/components/admin/content-list/content-list-tabs";
import { ContentListBulkBar } from "@/components/admin/content-list/content-list-bulk-bar";
import { ContentListTable } from "@/components/admin/content-list/content-list-table";
import { useContentList } from "@/components/admin/content-list/use-content-list";
import { buildContentCsvColumns } from "@/components/admin/content-list/csv-columns";
import type { BlogQuickEditValues } from "@/components/admin/content-list/types";
import { CategorySelect } from "@/components/admin/blog/category-select";
import { TagSelect } from "@/components/admin/blog/tag-select";
import { useAuth } from "@/context/auth-context";
import { exportToCsv } from "@/lib/export-csv";

function matchesPost(post: BlogPost, query: string): boolean {
  return post.title.toLowerCase().includes(query);
}

/** Blog kategorisi, `ContentListEntity`'nin ORTAK alan setinde yok — bkz. `csv-columns.ts`. */
const blogCsvColumns = buildContentCsvColumns<BlogPost>((post) => post.category?.name ?? "—");

/** §10.14.5 — en fazla 3 chip + "+N" (sınırsız chip satır yüksekliğini patlatır). */
const MAX_VISIBLE_TAGS = 3;

function TagsCell({ tags }: { tags: BlogPost["tags"] }) {
  if (tags.length === 0) return <span className="text-foreground/70">—</span>;
  const visible = tags.slice(0, MAX_VISIBLE_TAGS);
  const rest = tags.length - visible.length;
  return (
    <>
      {visible.map((tag) => (
        <Badge key={tag.id} tone="neutral" size="sm">
          {tag.name}
        </Badge>
      ))}
      {rest > 0 && (
        <span
          className="text-xs text-foreground/60"
          title={tags
            .slice(MAX_VISIBLE_TAGS)
            .map((t) => t.name)
            .join(", ")}
        >
          +{rest}
        </span>
      )}
    </>
  );
}

export default function AdminBlogListPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  // §10.21 — blog kategori/etiket oluşturma-güncelleme SiteRole=ADMIN, MANAGER veya EDITOR'dür
  // (§5.3 satır 3); CUSTOMER/USER paneline zaten giremez, bu yüzden satır-içi oluşturma
  // tetikleyicisi yalnızca bu üç rol için render edilir.
  const canCreateTaxonomy = user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "EDITOR";

  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [tags, setTags] = useState<BlogTag[]>([]);
  // Etikete göre filtreleme — client-side, blog listesi zaten tam veriyi çekiyor (§10.14.5).
  const [tagFilter, setTagFilter] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setCategories(await blogApi.listCategories());
      } catch {
        // Kategori listesi opsiyonel — Hızlı Düzenle kategorisiz de çalışır.
      }
    })();
    (async () => {
      try {
        setTags(await blogApi.listTags());
      } catch {
        // Etiket listesi opsiyonel — Hızlı Düzenle/filtre etiketsiz de çalışır.
      }
    })();
  }, []);

  const filterTabItems = useCallback(
    (items: BlogPost[]) => (tagFilter ? items.filter((post) => post.tags.some((t) => t.id === tagFilter)) : items),
    [tagFilter]
  );

  const list = useContentList<BlogPost, BlogQuickEditValues>({
    fetchList: blogApi.listPosts,
    updateItem: (id, input) => blogApi.updatePost(id, input),
    trashItem: blogApi.deletePost,
    restoreItem: blogApi.restorePost,
    permanentDeleteItem: blogApi.permanentDeletePost,
    bulkAction: blogApi.bulkPostsAction,
    matches: matchesPost,
    nounSingular: "Yazı",
    quickEditExtras: (post) => ({
      categoryId: post.category?.id ?? null,
      tagIds: post.tags.map((t) => t.id),
    }),
    filterTabItems,
  });

  function handleTagFilterChange(value: string) {
    setTagFilter(value);
    list.setPage(1);
  }

  function handleExport() {
    if (list.tabItems.length === 0) return;
    exportToCsv("blog-yazilari.csv", list.tabItems, blogCsvColumns);
  }

  function handleBulkExport() {
    const selectedPosts = list.tabItems.filter((p) => list.selectedIds.has(p.id));
    if (selectedPosts.length === 0) return;
    exportToCsv("secili-blog-yazilari.csv", selectedPosts, blogCsvColumns);
  }

  return (
    <div className="space-y-6">
      <PageHeading
        icon={Newspaper}
        title="Blog Yazıları"
        description="Yayınlanan ve taslak yazıların listesi."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={list.loading || list.tabItems.length === 0}
            >
              <Download className="h-4 w-4" />
              Dışa Aktar
            </Button>
            <LinkButton href="/admin/blog/categories" variant="outline">
              <Tag className="h-4 w-4" />
              Kategoriler
            </LinkButton>
            <LinkButton href="/admin/blog/new">Yeni Yazı</LinkButton>
          </div>
        }
      />

      {list.error && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {list.error}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void list.reload()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      )}

      {list.loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : list.totalItemCount === 0 ? (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <EmptyState
            icon={Newspaper}
            title="Henüz yazı yok"
            description="İlk blog yazınızı oluşturarak başlayın."
            action={<LinkButton href="/admin/blog/new">Yeni Yazı</LinkButton>}
          />
        </motion.div>
      ) : (
        <>
          <ContentListTabs value={list.activeFilter} onValueChange={list.setActiveFilter} counts={list.counts} />

          <div className="flex flex-wrap items-center gap-3">
            <InputGroup className="w-full sm:max-w-xs border-2 border-border bg-muted">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="Başlığa göre ara..."
                aria-label="Başlığa göre ara"
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </InputGroup>
            {tags.length > 0 && (
              <Select
                aria-label="Etikete göre filtrele"
                value={tagFilter}
                onChange={(e) => handleTagFilterChange(e.target.value)}
                className="w-auto"
              >
                <option value="">Tüm etiketler</option>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </Select>
            )}
            {list.totalPages > 1 && (
              <Select
                aria-label="Sayfa boyutu"
                value={list.pageSize}
                onChange={(e) => list.setPageSize(Number(e.target.value))}
                className="w-auto"
              >
                <option value={10}>10 / sayfa</option>
                <option value={20}>20 / sayfa</option>
                <option value={50}>50 / sayfa</option>
              </Select>
            )}
          </div>

          {list.selectedIds.size > 0 && (
            <ContentListBulkBar
              selectedCount={list.selectedIds.size}
              activeFilter={list.activeFilter}
              isAdmin={isAdmin}
              action={list.bulkSelectAction}
              onActionChange={list.setBulkSelectAction}
              onApply={list.applyBulkSelectAction}
              applying={list.bulkApplying}
              onClearSelection={list.clearSelection}
              extraActions={
                <Button variant="outline" size="sm" onClick={handleBulkExport}>
                  <Download className="h-4 w-4" />
                  CSV Dışa Aktar
                </Button>
              }
            />
          )}

          {list.filteredCount === 0 ? (
            <EmptyState icon={Search} title="Sonuç bulunamadı" description="Arama kriterlerinize uyan bir yazı yok." />
          ) : (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <ContentListTable
                items={list.visibleItems}
                activeFilter={list.activeFilter}
                isAdmin={isAdmin}
                selectedIds={list.selectedIds}
                onToggleSelect={list.toggleSelect}
                onToggleSelectAll={list.toggleSelectAll}
                allSelected={list.allSelected}
                editingId={list.editingId}
                quickEditValues={list.quickEditValues}
                quickEditSaving={list.quickEditSaving}
                quickEditError={list.quickEditError}
                onQuickEditChange={list.updateQuickEditValues}
                onQuickEditSave={list.saveQuickEdit}
                onQuickEditCancel={list.cancelQuickEdit}
                onStartQuickEdit={list.startQuickEdit}
                busyId={list.busyId}
                onTrash={list.handleTrash}
                onRestore={list.handleRestore}
                onRequestPermanentDelete={list.requestPermanentDelete}
                editHref={(post) => `/admin/blog/${post.id}`}
                viewHref={(post) => `/blog/${post.slug}`}
                extraColumns={[
                  {
                    key: "category",
                    header: "Kategori",
                    render: (post) => post.category?.name ?? "—",
                  },
                  {
                    key: "tags",
                    header: "Etiketler",
                    className: "w-48 flex flex-wrap items-center gap-1 whitespace-normal",
                    render: (post) => <TagsCell tags={post.tags} />,
                  },
                ]}
                quickEditExtraFields={({ values, onChange, disabled }) => (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <CategorySelect
                      id={`quick-edit-category-${list.editingId}`}
                      categories={categories}
                      value={values.categoryId}
                      onChange={(categoryId) => onChange({ categoryId })}
                      onCategoryCreated={(category) => setCategories((prev) => [...prev, category])}
                      disabled={disabled}
                      canCreate={canCreateTaxonomy}
                    />
                    <TagSelect
                      availableTags={tags}
                      selectedIds={values.tagIds}
                      onChange={(tagIds) => onChange({ tagIds })}
                      onTagCreated={(tag) => setTags((prev) => [...prev, tag])}
                      disabled={disabled}
                      canCreate={canCreateTaxonomy}
                    />
                  </div>
                )}
              />
            </motion.div>
          )}

          {list.totalPages > 1 && <ListPagination page={list.page} totalPages={list.totalPages} onPageChange={list.setPage} />}
        </>
      )}

      <ConfirmDialog
        open={list.pendingPermanentDelete !== null}
        onOpenChange={(open) => {
          if (!open) list.cancelPermanentDelete();
        }}
        title="Yazıyı kalıcı sil"
        description={
          list.pendingPermanentDelete
            ? `"${list.pendingPermanentDelete.title}" yazısını kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`
            : undefined
        }
        confirmText="Kalıcı Sil"
        destructive
        loading={list.permanentDeleting}
        onConfirm={list.confirmPermanentDelete}
      />

      <ConfirmDialog
        open={list.pendingBulkPermanentDelete}
        onOpenChange={(open) => {
          if (!open) list.cancelBulkPermanentDelete();
        }}
        title="Yazıları kalıcı sil"
        description={`${list.selectedIds.size} yazıyı kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`}
        confirmText="Kalıcı Sil"
        destructive
        loading={list.bulkApplying}
        onConfirm={list.confirmBulkPermanentDelete}
      />
    </div>
  );
}
