"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import * as pagesApi from "@/lib/api/pages";
import type { SitePage } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

export default function AdminPagesListPage() {
  const [pages, setPages] = useState<SitePage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  async function handleDelete(pageId: string) {
    if (!confirm("Bu sayfayı silmek istediğinize emin misiniz?")) return;
    setDeletingId(pageId);
    try {
      await pagesApi.deletePage(pageId);
      await load();
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Sayfalar</h1>
          <p className="mt-1 text-sm text-foreground/60">Ana Sayfa, Hakkımızda gibi dinamik sayfaların listesi.</p>
        </div>
        <LinkButton href="/admin/pages/new">Yeni Sayfa</LinkButton>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {pages === null ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
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
            {pages.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-foreground/50">
                  Henüz sayfa yok
                </TableCell>
              </TableRow>
            )}
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
                  <Button variant="ghost" size="sm" loading={deletingId === page.id} onClick={() => handleDelete(page.id)}>
                    Sil
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
