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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeading } from "@/components/admin/page-heading";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { AlertCircle, FileText } from "lucide-react";

export default function AdminPagesListPage() {
  const [pages, setPages] = useState<SitePage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SitePage | null>(null);

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
      setError(friendlyErrorMessage(err));
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Başlık</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Durum</TableHead>
              <TableHead className="text-right">Görüntülenme</TableHead>
              <TableHead className="text-right">İşlemler</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pages.map((page) => (
              <TableRow key={page.id}>
                <TableCell>
                  <Link href={`/admin/pages/${page.id}`} className="font-medium text-foreground hover:text-primary">
                    {page.title}
                  </Link>
                </TableCell>
                <TableCell className="text-foreground/60">/{page.slug}</TableCell>
                <TableCell>
                  <Badge tone={page.status === "PUBLISHED" ? "success" : "neutral"}>
                    {page.status === "PUBLISHED" ? "Yayında" : "Taslak"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right text-foreground/60">{page.viewCount.toLocaleString("tr-TR")}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setPendingDelete(page)}>
                    Sil
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
