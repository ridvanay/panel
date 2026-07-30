"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as blogApi from "@/lib/api/blog";
import type { BlogCategory, ContentStatus } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { PostEditor } from "@/components/admin/blog/post-editor";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

export default function EditBlogPostPage({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = use(params);
  const router = useRouter();

  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState<ContentStatus>("DRAFT");
  const [contentHtml, setContentHtml] = useState("");
  const [viewCount, setViewCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const [post, cats] = await Promise.all([blogApi.getPost(postId), blogApi.listCategories().catch(() => [])]);
      setTitle(post.title);
      setSlug(post.slug);
      setExcerpt(post.excerpt ?? "");
      setCoverImageUrl(post.coverImageUrl ?? "");
      setCategoryId(post.category?.id ?? "");
      setStatus(post.status);
      setContentHtml(post.contentHtml);
      setViewCount(post.viewCount);
      setCategories(cats);
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
      await load();
    } catch (err) {
      setSaveError(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Bu yazıyı silmek istediğinize emin misiniz?")) return;
    setDeleting(true);
    try {
      await blogApi.deletePost(postId);
      router.push("/admin/blog");
    } catch (err) {
      setSaveError(friendlyErrorMessage(err));
      setDeleting(false);
    }
  }

  if (loadError) {
    return <Alert variant="error">{loadError}</Alert>;
  }

  if (!loaded) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Yazıyı Düzenle</h1>
          <p className="mt-1 text-sm text-foreground/60">{viewCount.toLocaleString("tr-TR")} görüntülenme</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" loading={deleting} onClick={handleDelete}>
            Sil
          </Button>
          <Button loading={saving} onClick={handleSave}>
            Kaydet
          </Button>
        </div>
      </div>

      {saveError && <Alert variant="error">{saveError}</Alert>}

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
    </div>
  );
}
