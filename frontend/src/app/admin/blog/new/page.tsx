"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { AlertCircle, ChevronLeft, Newspaper } from "lucide-react";
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
import { PageHeading } from "@/components/admin/page-heading";
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
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/admin/blog"
        className="inline-flex items-center gap-1 text-sm text-foreground/60 transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Blog
      </Link>

      <PageHeading icon={Newspaper} title="Yeni Yazı" description="Başlığı ve içeriği girin, ardından kaydedip düzenlemeye devam edin." />

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Card>
        {error && (
          <Alert variant="error" className="mb-4">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </span>
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
      </motion.div>
    </div>
  );
}
