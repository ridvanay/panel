"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as blogApi from "@/lib/api/blog";
import type { BlogCategory, ContentStatus } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PostEditor } from "@/components/admin/blog/post-editor";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { AlertCircle, ChevronLeft } from "lucide-react";

interface PostSnapshot {
  title: string;
  slug: string;
  excerpt: string;
  coverImageUrl: string;
  categoryId: string;
  status: ContentStatus;
  contentHtml: string;
}

export default function EditBlogPostPage({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = use(params);
  const router = useRouter();

  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState<ContentStatus>("DRAFT");
  const [contentHtml, setContentHtml] = useState("");
  const [viewCount, setViewCount] = useState(0);
  const [snapshot, setSnapshot] = useState<PostSnapshot | null>(null);

  const load = useCallback(async () => {
    try {
      const [post, cats] = await Promise.all([blogApi.getPost(postId), blogApi.listCategories().catch(() => [])]);
      const nextSnapshot: PostSnapshot = {
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt ?? "",
        coverImageUrl: post.coverImageUrl ?? "",
        categoryId: post.category?.id ?? "",
        status: post.status,
        contentHtml: post.contentHtml,
      };
      setTitle(nextSnapshot.title);
      setSlug(nextSnapshot.slug);
      setExcerpt(nextSnapshot.excerpt);
      setCoverImageUrl(nextSnapshot.coverImageUrl);
      setCategoryId(nextSnapshot.categoryId);
      setStatus(nextSnapshot.status);
      setContentHtml(nextSnapshot.contentHtml);
      setViewCount(post.viewCount);
      setCategories(cats);
      setSnapshot(nextSnapshot);
      setLoaded(true);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, [postId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const hasUnsavedChanges = useMemo(() => {
    if (!snapshot) return false;
    return (
      title !== snapshot.title ||
      slug !== snapshot.slug ||
      excerpt !== snapshot.excerpt ||
      coverImageUrl !== snapshot.coverImageUrl ||
      categoryId !== snapshot.categoryId ||
      status !== snapshot.status ||
      contentHtml !== snapshot.contentHtml
    );
  }, [title, slug, excerpt, coverImageUrl, categoryId, status, contentHtml, snapshot]);

  async function handleSave() {
    setSaveError(null);
    setSaving(true);
    try {
      await blogApi.updatePost(postId, {
        title,
        slug,
        excerpt: excerpt || null,
        coverImageUrl: coverImageUrl || null,
        categoryId: categoryId || null,
        status,
        contentHtml,
      });
      toast.success("Yazı kaydedildi.");
      await load();
    } catch (err) {
      setSaveError(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await blogApi.deletePost(postId);
      toast.success("Yazı silindi.");
      router.push("/admin/blog");
    } catch (err) {
      setSaveError(friendlyErrorMessage(err));
      setDeleting(false);
    }
  }

  if (loadError) {
    return (
      <Alert variant="error">
        <span className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {loadError}
        </span>
      </Alert>
    );
  }

  if (!loaded) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-24">
      <div>
        <Link
          href="/admin/blog"
          className="inline-flex items-center gap-1 text-sm text-foreground/60 transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Blog Yazıları
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Yazıyı Düzenle</h1>
            <p className="mt-1 text-sm text-foreground/60">{viewCount.toLocaleString("tr-TR")} görüntülenme</p>
          </div>
          {hasUnsavedChanges && (
            <Badge tone="primary">
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-primary" />
              Kaydedilmemiş değişiklik
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setDeleteDialogOpen(true)}>
            Sil
          </Button>
        </div>
      </div>

      {saveError && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {saveError}
          </span>
        </Alert>
      )}

      <Card className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="title" label="Başlık" required>
            {(inputProps) => <Input {...inputProps} required value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field id="slug" label="Slug (URL)" required>
            {(inputProps) => <Input {...inputProps} required value={slug} onChange={(e) => setSlug(e.target.value)} />}
          </Field>
        </div>

        <Field id="excerpt" label="Özet">
          {(inputProps) => <Textarea {...inputProps} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} rows={2} />}
        </Field>

        <ImageUploadField id="coverImageUrl" label="Kapak görseli" value={coverImageUrl} onChange={setCoverImageUrl} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="category" label="Kategori">
            {(inputProps) => (
              <Select {...inputProps} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Kategorisiz</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="status" label="Durum">
            {(inputProps) => (
              <Select {...inputProps} value={status} onChange={(e) => setStatus(e.target.value as ContentStatus)}>
                <option value="DRAFT">Taslak</option>
                <option value="PUBLISHED">Yayında</option>
              </Select>
            )}
          </Field>
        </div>
      </Card>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">İçerik</label>
        <PostEditor content={contentHtml} onChange={setContentHtml} />
      </div>

      <div className="sticky bottom-6 z-10 flex justify-end">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface/95 px-4 py-3 shadow-lg backdrop-blur">
          {saving && <span className="text-xs text-foreground/60">Kaydediliyor…</span>}
          <Button loading={saving} onClick={handleSave}>
            Kaydet
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Yazıyı sil"
        description="Bu yazıyı silmek istediğinize emin misiniz? Bu işlem geri alınamaz."
        confirmText="Sil"
        destructive
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
