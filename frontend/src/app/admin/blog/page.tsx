"use client";

import { useCallback, useEffect, useState } from "react";
import * as blogApi from "@/lib/api/blog";
import type { BlogPost } from "@/lib/api/types";
import { LinkButton } from "@/components/ui/link-button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { PostTable } from "@/components/admin/blog/post-table";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

export default function AdminBlogListPage() {
  const [posts, setPosts] = useState<BlogPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  async function handleDelete(postId: string) {
    if (!confirm("Bu yazıyı silmek istediğinize emin misiniz?")) return;
    setDeletingId(postId);
    try {
      await blogApi.deletePost(postId);
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
          <h1 className="text-2xl font-semibold text-foreground">Blog Yazıları</h1>
          <p className="mt-1 text-sm text-foreground/60">Yayınlanan ve taslak yazıların listesi.</p>
        </div>
        <LinkButton href="/admin/blog/new">Yeni Yazı</LinkButton>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {posts === null ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : (
        <PostTable posts={posts} deletingId={deletingId} onDelete={handleDelete} />
      )}
    </div>
  );
}
