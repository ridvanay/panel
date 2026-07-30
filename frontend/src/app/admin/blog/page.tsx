"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import * as blogApi from "@/lib/api/blog";
import type { BlogPost } from "@/lib/api/types";
import { LinkButton } from "@/components/ui/link-button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PostTable } from "@/components/admin/blog/post-table";
import { PageHeading } from "@/components/admin/page-heading";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { AlertCircle, Newspaper } from "lucide-react";

export default function AdminBlogListPage() {
  const [posts, setPosts] = useState<BlogPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BlogPost | null>(null);

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
          <PostTable posts={posts} deletingId={deletingId} onDelete={requestDelete} />
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
    </div>
  );
}
