"use client";

import { motion } from "framer-motion";
import { AlertCircle, Download, Newspaper, Search, Tag } from "lucide-react";
import * as blogApi from "@/lib/api/blog";
import type { BlogPost } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
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
import { useAuth } from "@/context/auth-context";
import { exportToCsv } from "@/lib/export-csv";

function matchesPost(post: BlogPost, query: string): boolean {
  return post.title.toLowerCase().includes(query);
}

export default function AdminBlogListPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const list = useContentList<BlogPost>({
    fetchList: blogApi.listPosts,
    updateItem: (id, input) => blogApi.updatePost(id, input),
    trashItem: blogApi.deletePost,
    restoreItem: blogApi.restorePost,
    permanentDeleteItem: blogApi.permanentDeletePost,
    bulkAction: blogApi.bulkPostsAction,
    matches: matchesPost,
    nounSingular: "Yazı",
  });

  function handleBulkExport() {
    const selectedPosts = list.tabItems.filter((p) => list.selectedIds.has(p.id));
    if (selectedPosts.length === 0) return;
    exportToCsv("secili-blog-yazilari.csv", selectedPosts, [
      { key: "title", label: "Başlık" },
      {
        key: "category",
        label: "Kategori",
        format: (value) => (value as BlogPost["category"])?.name ?? "—",
      },
      {
        key: "status",
        label: "Durum",
        format: (value) => (value === "PUBLISHED" ? "Yayında" : "Taslak"),
      },
      {
        key: "viewCount",
        label: "Görüntülenme",
        format: (value) => String(value),
      },
    ]);
  }

  return (
    <div className="space-y-6">
      <PageHeading
        icon={Newspaper}
        title="Blog Yazıları"
        description="Yayınlanan ve taslak yazıların listesi."
        actions={
          <div className="flex items-center gap-2">
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
            {list.totalPages > 10 && (
              <Select
                aria-label="Sayfa boyutu"
                value={list.pageSize}
                onChange={(e) => list.setPageSize(Number(e.target.value))}
                className="w-24"
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
                categoryColumn={{
                  header: "Kategori",
                  render: (post) => post.category?.name ?? "—",
                }}
              />
            </motion.div>
          )}

          {list.totalPages > 10 && <ListPagination page={list.page} totalPages={list.totalPages} onPageChange={list.setPage} />}
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
