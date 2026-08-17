"use client";

import { motion } from "framer-motion";
import { AlertCircle, Download, FileText, Search } from "lucide-react";
import * as pagesApi from "@/lib/api/pages";
import type { SitePage } from "@/lib/api/types";
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
import { buildContentCsvColumns } from "@/components/admin/content-list/csv-columns";
import { useAuth } from "@/context/auth-context";
import { exportToCsv } from "@/lib/export-csv";

function matchesSitePage(page: SitePage, query: string): boolean {
  return page.title.toLowerCase().includes(query) || page.slug.toLowerCase().includes(query);
}

// Sayfalar'da kategori kavramı yok — Blog'la aynı ORTAK sütun seti, kategori sütunu hariç.
const pageCsvColumns = buildContentCsvColumns<SitePage>();

export default function AdminPagesListPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const list = useContentList<SitePage>({
    fetchList: pagesApi.listPages,
    updateItem: (id, input) => pagesApi.updatePage(id, input),
    trashItem: pagesApi.deletePage,
    restoreItem: pagesApi.restorePage,
    permanentDeleteItem: pagesApi.permanentDeletePage,
    bulkAction: pagesApi.bulkPagesAction,
    matches: matchesSitePage,
    nounSingular: "Sayfa",
  });

  function handleExport() {
    if (list.tabItems.length === 0) return;
    exportToCsv("sayfalar.csv", list.tabItems, pageCsvColumns);
  }

  function handleBulkExport() {
    const selectedPages = list.tabItems.filter((p) => list.selectedIds.has(p.id));
    if (selectedPages.length === 0) return;
    exportToCsv("secili-sayfalar.csv", selectedPages, pageCsvColumns);
  }

  return (
    <div className="space-y-6">
      <PageHeading
        icon={FileText}
        title="Sayfalar"
        description="Ana Sayfa, Hakkımızda gibi dinamik sayfaların listesi."
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
            <LinkButton href="/admin/pages/new">Yeni Sayfa</LinkButton>
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
            icon={FileText}
            title="Henüz sayfa yok"
            description="İlk sayfanızı oluşturarak başlayın."
            action={<LinkButton href="/admin/pages/new">Yeni Sayfa</LinkButton>}
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
                placeholder="Başlık veya slug ara..."
                aria-label="Başlık veya slug ara"
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </InputGroup>
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
            <EmptyState icon={Search} title="Sonuç bulunamadı" description="Arama kriterlerinize uyan bir sayfa yok." />
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
                editHref={(page) => `/admin/pages/${page.id}`}
                viewHref={(page) => `/${page.slug}`}
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
        title="Sayfayı kalıcı sil"
        description={
          list.pendingPermanentDelete
            ? `"${list.pendingPermanentDelete.title}" sayfasını kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`
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
        title="Sayfaları kalıcı sil"
        description={`${list.selectedIds.size} sayfayı kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`}
        confirmText="Kalıcı Sil"
        destructive
        loading={list.bulkApplying}
        onConfirm={list.confirmBulkPermanentDelete}
      />
    </div>
  );
}
