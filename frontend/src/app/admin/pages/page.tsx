"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import * as pagesApi from "@/lib/api/pages";
import type { SitePage } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/select";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeading } from "@/components/admin/page-heading";
import { ListPagination } from "@/components/admin/list-pagination";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { useFilteredList } from "@/hooks/use-filtered-list";
import { AlertCircle, FileText, Search } from "lucide-react";

function matchesSitePage(page: SitePage, query: string): boolean {
  return page.title.toLowerCase().includes(query) || page.slug.toLowerCase().includes(query);
}

export default function AdminPagesListPage() {
  const [pages, setPages] = useState<SitePage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SitePage | null>(null);

  const {
    search,
    setSearch,
    page: currentPage,
    setPage,
    pageSize,
    setPageSize,
    totalPages,
    filteredCount,
    items: visiblePages,
  } = useFilteredList(pages, matchesSitePage);

  const load = useCallback(async () => {
    try {
      const page = await pagesApi.listPages();
      setPages(page.items);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function handleDelete() {
    if (!pendingDelete) return;
    const pageId = pendingDelete.id;
    setDeletingId(pageId);
    try {
      await pagesApi.deletePage(pageId);
      toast.success("Sayfa silindi.");
      setPendingDelete(null);
      await load();
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeading
        icon={FileText}
        title="Sayfalar"
        description="Ana Sayfa, Hakkımızda gibi dinamik sayfaların listesi."
        actions={<LinkButton href="/admin/pages/new">Yeni Sayfa</LinkButton>}
      />

      {error && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </span>
        </Alert>
      )}

      {pages === null ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : pages.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Henüz sayfa yok"
          description="İlk sayfanızı oluşturarak başlayın."
          action={<LinkButton href="/admin/pages/new">Yeni Sayfa</LinkButton>}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <InputGroup className="w-full sm:max-w-xs">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="Başlık veya slug ara..."
                aria-label="Başlık veya slug ara"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </InputGroup>
            {totalPages > 10 && (
              <Select
                aria-label="Sayfa boyutu"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="w-24"
              >
                <option value={10}>10 / sayfa</option>
                <option value={20}>20 / sayfa</option>
                <option value={50}>50 / sayfa</option>
              </Select>
            )}
          </div>

          {filteredCount === 0 ? (
            <EmptyState icon={Search} title="Sonuç bulunamadı" description="Arama kriterlerinize uyan bir sayfa yok." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-auto">Başlık</TableHead>
                  <TableHead className="w-48">Slug</TableHead>
                  <TableHead className="w-28">Durum</TableHead>
                  <TableHead className="w-32 text-right">Görüntülenme</TableHead>
                  <TableHead className="w-24 text-right">İşlemler</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visiblePages.map((page) => (
                  <TableRow key={page.id}>
                    <TableCell className="w-auto">
                      <Link href={`/admin/pages/${page.id}`} className="font-medium text-foreground hover:text-primary">
                        {page.title}
                      </Link>
                    </TableCell>
                    <TableCell className="w-48 text-foreground/60">/{page.slug}</TableCell>
                    <TableCell className="w-28">
                      <Badge tone={page.status === "PUBLISHED" ? "success" : "warning"}>
                        {page.status === "PUBLISHED" ? "Yayında" : "Taslak"}
                      </Badge>
                    </TableCell>
                    <TableCell className="w-32 text-right text-foreground/60">
                      {page.viewCount.toLocaleString("tr-TR")}
                    </TableCell>
                    <TableCell className="w-24 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setPendingDelete(page)}>
                        Sil
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {totalPages > 10 && <ListPagination page={currentPage} totalPages={totalPages} onPageChange={setPage} />}
        </>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Sayfayı sil"
        description={pendingDelete ? `"${pendingDelete.title}" sayfasını silmek istediğinize emin misiniz? Bu işlem geri alınamaz.` : undefined}
        confirmText="Sil"
        destructive
        loading={deletingId === pendingDelete?.id}
        onConfirm={handleDelete}
      />
    </div>
  );
}
