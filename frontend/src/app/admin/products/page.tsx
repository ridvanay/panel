"use client";

import { motion } from "framer-motion";
import { AlertCircle, Download, Search, ShoppingBag, Tag } from "lucide-react";
import * as productsApi from "@/lib/api/products";
import type { Product } from "@/lib/api/types";
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

function matchesProduct(product: Product, query: string): boolean {
  return product.title.toLowerCase().includes(query) || (product.sku ?? "").toLowerCase().includes(query);
}

/** Ürün kategorisi, `ContentListEntity`'nin ORTAK alan setinde yok — bkz. `csv-columns.ts`. */
const productCsvColumns = buildContentCsvColumns<Product>((product) => product.category?.name ?? "—");

export default function AdminProductsListPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const list = useContentList<Product>({
    fetchList: productsApi.listProducts,
    updateItem: (id, input) => productsApi.updateProduct(id, input),
    trashItem: productsApi.deleteProduct,
    restoreItem: productsApi.restoreProduct,
    permanentDeleteItem: productsApi.permanentDeleteProduct,
    bulkAction: productsApi.bulkProductsAction,
    matches: matchesProduct,
    nounSingular: "Ürün",
  });

  function handleExport() {
    if (list.tabItems.length === 0) return;
    exportToCsv("urunler.csv", list.tabItems, productCsvColumns);
  }

  function handleBulkExport() {
    const selectedProducts = list.tabItems.filter((p) => list.selectedIds.has(p.id));
    if (selectedProducts.length === 0) return;
    exportToCsv("secili-urunler.csv", selectedProducts, productCsvColumns);
  }

  return (
    <div className="space-y-6">
      <PageHeading
        icon={ShoppingBag}
        title="Ürünler"
        description="Ürün kataloğunun listesi."
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
            <LinkButton href="/admin/products/categories" variant="outline">
              <Tag className="h-4 w-4" />
              Kategoriler
            </LinkButton>
            <LinkButton href="/admin/products/new">Yeni Ürün</LinkButton>
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
            icon={ShoppingBag}
            title="Henüz ürün yok"
            description="İlk ürününüzü oluşturarak başlayın."
            action={<LinkButton href="/admin/products/new">Yeni Ürün</LinkButton>}
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
                placeholder="Başlığa veya SKU'ya göre ara..."
                aria-label="Başlığa veya SKU'ya göre ara"
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
            <EmptyState icon={Search} title="Sonuç bulunamadı" description="Arama kriterlerinize uyan bir ürün yok." />
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
                editHref={(product) => `/admin/products/${product.id}`}
                viewHref={(product) => `/products/${product.slug}`}
                categoryColumn={{
                  header: "Kategori",
                  render: (product) => product.category?.name ?? "—",
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
        title="Ürünü kalıcı sil"
        description={
          list.pendingPermanentDelete
            ? `"${list.pendingPermanentDelete.title}" ürününü kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`
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
        title="Ürünleri kalıcı sil"
        description={`${list.selectedIds.size} ürünü kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`}
        confirmText="Kalıcı Sil"
        destructive
        loading={list.bulkApplying}
        onConfirm={list.confirmBulkPermanentDelete}
      />
    </div>
  );
}
