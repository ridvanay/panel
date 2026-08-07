"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, Briefcase, ChevronLeft } from "lucide-react";
import * as portfolioApi from "@/lib/api/portfolio";
import * as usersAdminApi from "@/lib/api/users-admin";
import type { AdminUser, Media, PortfolioCategory } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { MediaSelectField } from "@/components/admin/media/media-select-field";
import { PageHeading } from "@/components/admin/page-heading";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { useAuth } from "@/context/auth-context";

/** Backend'deki `slugify` (bkz. `backend/src/lib/slug.ts`) ile eşdeğer, sadece istemci tarafı önizlemesi içindir. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/ç/g, "c")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ı/g, "i")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// `portfolioApi.createPortfolioItem` gövdesini yansıtan istemci tarafı zod şeması —
// `admin/products/new/page.tsx` ile BİREBİR aynı patern, ticari alanlar yerine
// `clientName`/`projectUrl`/`completedAt`/`order` (bkz. görev notu).
const formSchema = z
  .object({
    title: z.string().min(1, "Başlık gerekli."),
    slug: z.string().optional(),
    summary: z.string().optional(),
    contentHtml: z.string().optional(),
    clientName: z.string().optional(),
    projectUrl: z.string().optional(),
    completedAt: z.string().optional(),
    order: z.coerce.number({ invalid_type_error: "Geçerli bir sayı girin." }).int("Tam sayı girin."),
    categoryId: z.string().optional(),
    status: z.enum(["DRAFT", "PUBLISHED"]),
    authorId: z.string().optional(),
  })
  .refine((data) => !data.projectUrl?.trim() || isValidUrl(data.projectUrl.trim()), {
    message: "Geçerli bir URL girin (https://...).",
    path: ["projectUrl"],
  });

type FormValues = z.infer<typeof formSchema>;

export default function NewPortfolioItemPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [categories, setCategories] = useState<PortfolioCategory[]>([]);
  const [coverMedia, setCoverMedia] = useState<Media | null>(null);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [admins, setAdmins] = useState<AdminUser[]>([]);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      slug: "",
      summary: "",
      contentHtml: "",
      clientName: "",
      projectUrl: "",
      completedAt: "",
      order: 0,
      categoryId: "",
      status: "DRAFT",
      // Varsayılan yazar giriş yapmış kullanıcıdır; ADMIN dropdown'dan değiştirene kadar override boş kalır.
      authorId: user?.id ?? "",
    },
  });

  const title = useWatch({ control, name: "title" });

  useEffect(() => {
    (async () => {
      try {
        setCategories(await portfolioApi.listPortfolioCategories());
      } catch {
        // Kategori listesi opsiyonel — form kategori olmadan da gönderilebilir.
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

  function handleTitleChange(value: string) {
    if (!slugManuallyEdited) {
      setValue("slug", slugify(value));
    }
  }

  function handleSlugChange() {
    setSlugManuallyEdited(true);
  }

  async function onSubmit(values: FormValues) {
    setError(null);
    try {
      const item = await portfolioApi.createPortfolioItem({
        title: values.title,
        slug: values.slug || undefined,
        summary: values.summary || undefined,
        contentHtml: values.contentHtml || undefined,
        clientName: values.clientName || undefined,
        projectUrl: values.projectUrl || undefined,
        completedAt: values.completedAt ? new Date(values.completedAt).toISOString() : undefined,
        order: values.order,
        status: values.status,
        categoryId: values.categoryId || undefined,
        coverMediaId: coverMedia?.id ?? undefined,
        authorId: isAdmin && values.authorId ? values.authorId : undefined,
      });
      toast.success("Portföy öğesi oluşturuldu.");
      router.push(`/admin/portfolio/${item.id}`);
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setError(message);
      toast.error(message);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/admin/portfolio"
        className="inline-flex items-center gap-1 text-sm text-foreground/60 transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Portföy
      </Link>

      <PageHeading
        icon={Briefcase}
        title="Yeni Proje"
        description="Temel bilgileri girin, ardından kaydedip düzenlemeye devam edin."
      />

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
              {(inputProps) => (
                <Input
                  {...inputProps}
                  {...register("title", { onChange: (e) => handleTitleChange(e.target.value) })}
                  autoFocus
                />
              )}
            </Field>

            <Field id="slug" label="Slug (URL)" hint="Boş bırakılırsa başlıktan otomatik oluşturulur.">
              {(inputProps) => <Input {...inputProps} {...register("slug", { onChange: handleSlugChange })} />}
            </Field>

            <Field id="summary" label="Özet">
              {(inputProps) => <Textarea {...inputProps} {...register("summary")} rows={2} />}
            </Field>

            <Field id="contentHtml" label="İçerik" hint="Şimdilik düz metin — zengin metin editörü sonraki bir iyileştirmedir.">
              {(inputProps) => <Textarea {...inputProps} {...register("contentHtml")} rows={5} />}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="clientName" label="Müşteri" hint="Opsiyonel.">
                {(inputProps) => <Input {...inputProps} {...register("clientName")} />}
              </Field>
              <Field id="projectUrl" label="Proje URL'si" error={errors.projectUrl?.message} hint="Opsiyonel.">
                {(inputProps) => <Input {...inputProps} type="url" placeholder="https://…" {...register("projectUrl")} />}
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="completedAt" label="Tamamlanma tarihi" hint="Opsiyonel.">
                {(inputProps) => <Input {...inputProps} type="date" {...register("completedAt")} />}
              </Field>
              <Field id="order" label="Sıra" error={errors.order?.message} hint="Düşük sayı önce gösterilir." required>
                {(inputProps) => <Input {...inputProps} type="number" step="1" {...register("order")} />}
              </Field>
            </div>

            <MediaSelectField id="coverMedia" label="Kapak görseli" value={coverMedia} onChange={setCoverMedia} />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="category" label="Kategori">
                {(inputProps) => (
                  <Select {...inputProps} {...register("categoryId")}>
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
                  <Select {...inputProps} {...register("status")}>
                    <option value="DRAFT">Taslak</option>
                    <option value="PUBLISHED">Yayında</option>
                  </Select>
                )}
              </Field>
            </div>

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

            <Button type="submit" loading={isSubmitting} disabled={!title?.trim()}>
              Oluştur ve devam et
            </Button>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}
