"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import * as blogApi from "@/lib/api/blog";
import type { BlogPost } from "@/lib/api/types";
import { LinkButton } from "@/components/ui/link-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PostTable } from "@/components/admin/blog/post-table";
import { PageHeading } from "@/components/admin/page-heading";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { exportToCsv } from "@/lib/export-csv";
import { AlertCircle, Download, Newspaper } from "lucide-react";

export default function AdminBlogListPage() {
  const [posts, setPosts] = useState<BlogPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BlogPost | null>(null);

  // Toplu işlemler için seçim durumu.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const page = await blogApi.listPosts();
      setPosts(page.items);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  function requestDelete(postId: string) {
    const post = posts?.find((p) => p.id === postId) ?? null;
    setPendingDelete(post);
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    const postId = pendingDelete.id;
    setDeletingId(postId);
    try {
      await blogApi.deletePost(postId);
      toast.success("Yazı silindi.");
      setPendingDelete(null);
      await load();
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  function toggleSelect(postId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!posts) return;
    setSelectedIds((prev) => (prev.size === posts.length ? new Set() : new Set(posts.map((p) => p.id))));
  }

  const allSelected = posts !== null && posts.length > 0 && selectedIds.size === posts.length;

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    setBulkDeleting(true);
    let successCount = 0;
    let failCount = 0;

    for (const id of ids) {
      try {
        await blogApi.deletePost(id);
        successCount += 1;
      } catch {
        failCount += 1;
      }
    }

    setBulkDeleting(false);
    setBulkDeleteConfirmOpen(false);
    setSelectedIds(new Set());
    await load();

    if (successCount > 0 && failCount === 0) {
      toast.success(successCount === 1 ? "1 yazı silindi." : `${successCount} yazı silindi.`);
    } else if (successCount > 0 && failCount > 0) {
      toast.success(`${successCount} yazı silindi, ${failCount} yazı silinemedi.`);
    } else if (failCount > 0) {
      toast.error(failCount === 1 ? "Yazı silinemedi." : `${failCount} yazı silinemedi.`);
    }
  }

  function handleBulkExport() {
    if (!posts) return;
    const selectedPosts = posts.filter((p) => selectedIds.has(p.id));
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
        actions={<LinkButton href="/admin/blog/new">Yeni Yazı</LinkButton>}
      />

      {error && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </span>
        </Alert>
      )}

      {selectedIds.size > 0 && (
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <span className="text-sm font-medium text-foreground">{selectedIds.size} seçili</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="destructive" size="sm" onClick={() => setBulkDeleteConfirmOpen(true)}>
              Toplu Sil
            </Button>
            <Button variant="outline" size="sm" onClick={handleBulkExport}>
              <Download className="h-4 w-4" />
              CSV Dışa Aktar
            </Button>
          </div>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelectedIds(new Set())}>
            Seçimi Temizle
          </Button>
        </Card>
      )}

      {posts === null ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : posts.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <EmptyState
            icon={Newspaper}
            title="Henüz yazı yok"
            description="İlk blog yazınızı oluşturarak başlayın."
            action={<LinkButton href="/admin/blog/new">Yeni Yazı</LinkButton>}
          />
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <PostTable
            posts={posts}
            deletingId={deletingId}
            onDelete={requestDelete}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            allSelected={allSelected}
          />
        </motion.div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Yazıyı sil"
        description={pendingDelete ? `"${pendingDelete.title}" yazısını silmek istediğinize emin misiniz? Bu işlem geri alınamaz.` : undefined}
        confirmText="Sil"
        destructive
        loading={deletingId === pendingDelete?.id}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={bulkDeleteConfirmOpen}
        onOpenChange={(open) => {
          if (!open) setBulkDeleteConfirmOpen(false);
        }}
        title="Yazıları toplu sil"
        description={`${selectedIds.size} yazıyı silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`}
        confirmText="Sil"
        destructive
        loading={bulkDeleting}
        onConfirm={handleBulkDelete}
      />
    </div>
  );
}
