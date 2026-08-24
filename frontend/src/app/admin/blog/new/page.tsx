"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, ChevronLeft, Newspaper } from "lucide-react";
import * as blogApi from "@/lib/api/blog";
import * as usersAdminApi from "@/lib/api/users-admin";
import type { AdminUser, BlogCategory, BlogTag } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { PostEditor } from "@/components/admin/blog/post-editor";
import { CategorySelect } from "@/components/admin/blog/category-select";
import { TagSelect } from "@/components/admin/blog/tag-select";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import { PageHeading } from "@/components/admin/page-heading";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { useAuth } from "@/context/auth-context";

// `blogApi.createPost` gövdesini BİREBİR yansıtan istemci tarafı zod şeması. `title` ve
// `contentHtml` mevcut davranışta HTML5 `required` ile korunuyordu — burada gerçek bir
// istemci tarafı doğrulama mesajına dönüştürülmesi KABUL EDİLEN bir iyileştirmedir.
const formSchema = z.object({
  title: z.string().min(1, "Başlık gerekli."),
  excerpt: z.string().optional(),
  coverImageUrl: z.string().optional(),
  categoryId: z.string().optional(),
  contentHtml: z.string().min(1, "İçerik gerekli."),
  authorId: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function NewBlogPostPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [tags, setTags] = useState<BlogTag[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [admins, setAdmins] = useState<AdminUser[]>([]);
  // §10.21 — blog kategori/etiket oluşturma-güncelleme SiteRole=ADMIN, MANAGER veya EDITOR'dür (§5.3 satır 3).
  const canCreateTaxonomy = user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "EDITOR";

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      excerpt: "",
      coverImageUrl: "",
      categoryId: "",
      contentHtml: "",
      // Varsayılan yazar giriş yapmış kullanıcıdır; ADMIN dropdown'dan değiştirene kadar override boş kalır.
      authorId: user?.id ?? "",
    },
  });

  useEffect(() => {
    (async () => {
      try {
        setCategories(await blogApi.listCategories());
      } catch {
        // Kategori listesi opsiyonel — form kategori olmadan da gönderilebilir.
      }
    })();
    (async () => {
      try {
        setTags(await blogApi.listTags());
      } catch {
        // Etiket listesi opsiyonel — form etiketsiz de gönderilebilir.
      }
    })();
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        const page = await usersAdminApi.listAdminUsers();
        setAdmins(page.items);
      } catch {
        // Yazar dropdown'u opsiyonel bir kolaylık — yüklenemezse form yine de gönderilebilir.
      }
    })();
  }, [isAdmin]);

  async function onSubmit(values: FormValues) {
    setError(null);
    try {
      const post = await blogApi.createPost({
        title: values.title,
        excerpt: values.excerpt || undefined,
        coverImageUrl: values.coverImageUrl || undefined,
        categoryId: values.categoryId || null,
        tagIds,
        contentHtml: values.contentHtml,
        authorId: isAdmin && values.authorId ? values.authorId : undefined,
      });
      toast.success("Yazı oluşturuldu.");
      router.push(`/admin/blog/${post.id}`);
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setError(message);
      toast.error(message);
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
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Field id="title" label="Başlık" error={errors.title?.message} required>
            {(inputProps) => <Input {...inputProps} {...register("title")} autoFocus />}
          </Field>

          <Field id="excerpt" label="Özet">
            {(inputProps) => <Textarea {...inputProps} {...register("excerpt")} rows={2} />}
          </Field>

          <Controller
            control={control}
            name="coverImageUrl"
            render={({ field }) => (
              <ImageUploadField id="coverImageUrl" label="Kapak görseli" value={field.value ?? ""} onChange={field.onChange} />
            )}
          />

          <Controller
            control={control}
            name="categoryId"
            render={({ field }) => (
              <CategorySelect
                id="category"
                categories={categories}
                value={field.value || null}
                onChange={(id) => field.onChange(id ?? "")}
                onCategoryCreated={(category) => setCategories((prev) => [...prev, category])}
                canCreate={canCreateTaxonomy}
              />
            )}
          />

          <TagSelect
            availableTags={tags}
            selectedIds={tagIds}
            onChange={setTagIds}
            onTagCreated={(tag) => setTags((prev) => [...prev, tag])}
            canCreate={canCreateTaxonomy}
          />

          {isAdmin && admins.length > 0 && (
            <Field id="authorId" label="Yazar" hint="Varsayılan olarak siz atanırsınız; ADMIN başka bir kullanıcı seçebilir.">
              {(inputProps) => (
                <Select {...inputProps} {...register("authorId")}>
                  {admins.map((admin) => (
                    <option key={admin.id} value={admin.id}>
                      {admin.name} ({admin.email})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground" id="contentHtml-label">
              İçerik
            </label>
            <Controller
              control={control}
              name="contentHtml"
              render={({ field }) => <PostEditor content={field.value} onChange={field.onChange} />}
            />
            {errors.contentHtml && (
              <p role="alert" className="mt-1.5 text-xs text-danger">
                {errors.contentHtml.message}
              </p>
            )}
          </div>

          <Button type="submit" loading={isSubmitting}>
            Oluştur ve devam et
          </Button>
        </form>
      </Card>
      </motion.div>
    </div>
  );
}
