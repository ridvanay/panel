"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import * as blogApi from "@/lib/api/blog";
import type { BlogCategory } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { PostEditor } from "@/components/admin/blog/post-editor";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

export default function NewBlogPostPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<BlogCategory[]>([]);

  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [contentHtml, setContentHtml] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setCategories(await blogApi.listCategories());
      } catch {
        // Kategori listesi opsiyonel — form kategori olmadan da gönderilebilir.
      }
    })();
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const post = await blogApi.createPost({
        title,
        excerpt: excerpt || undefined,
        coverImageUrl: coverImageUrl || undefined,
        categoryId: categoryId || null,
        contentHtml,
      });
      router.push(`/admin/blog/${post.id}`);
    } catch (err) {
      setError(friendlyErrorMessage(err));
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold text-foreground">Yeni Yazı</h1>

      <Card className="mt-6">
        {error && (
          <Alert variant="error" className="mb-4">
            {error}
          </Alert>
        )}
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <Field id="title" label="Başlık" required>
            {(inputProps) => (
              <Input {...inputProps} required value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
            )}
          </Field>

          <Field id="excerpt" label="Özet">
            {(inputProps) => <Textarea {...inputProps} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} rows={2} />}
          </Field>

          <ImageUploadField id="coverImageUrl" label="Kapak görseli" value={coverImageUrl} onChange={setCoverImageUrl} />

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

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">İçerik</label>
            <PostEditor content={contentHtml} onChange={setContentHtml} />
          </div>

          <Button type="submit" loading={creating}>
            Oluştur ve devam et
          </Button>
        </form>
      </Card>
    </div>
  );
}
