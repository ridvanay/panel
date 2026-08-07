"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, ChevronLeft, ShoppingBag } from "lucide-react";
import * as productsApi from "@/lib/api/products";
import * as usersAdminApi from "@/lib/api/users-admin";
import type { AdminUser, Media, ProductCategory } from "@/lib/api/types";
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

const CURRENCIES = ["TRY", "USD", "EUR", "GBP"] as const;

// `productsApi.createProduct` gövdesini yansıtan istemci tarafı zod şeması. Fiyat alanları
// (`priceLira`/`discountPriceLira`) kullanıcıya TL cinsinden gösterilir — kuruşa çevirme
// yalnızca `onSubmit`'te, tek noktada yapılır (bkz. lib/format-price.ts'teki ters yön).
const formSchema = z
  .object({
    title: z.string().min(1, "Başlık gerekli."),
    slug: z.string().optional(),
    excerpt: z.string().optional(),
    descriptionHtml: z.string().optional(),
    priceLira: z.coerce
      .number({ invalid_type_error: "Geçerli bir fiyat girin." })
      .positive("Fiyat 0'dan büyük olmalı."),
    currency: z.string().min(1, "Para birimi gerekli."),
    taxRatePercent: z.string().optional(),
    discountPriceLira: z.string().optional(),
    sku: z.string().optional(),
    stockQuantity: z.coerce.number().int("Tam sayı girin.").min(0, "0 veya daha büyük olmalı."),
    categoryId: z.string().optional(),
    status: z.enum(["DRAFT", "PUBLISHED"]),
    authorId: z.string().optional(),
  })
  .refine(
    (data) => {
      const trimmed = data.discountPriceLira?.trim();
      if (!trimmed) return true;
      const discount = Number(trimmed);
      if (Number.isNaN(discount)) return true;
      return discount < data.priceLira;
    },
    { message: "İndirimli fiyat, normal fiyattan küçük olmalıdır.", path: ["discountPriceLira"] }
  );

type FormValues = z.infer<typeof formSchema>;

export default function NewProductPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [categories, setCategories] = useState<ProductCategory[]>([]);
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
      excerpt: "",
      descriptionHtml: "",
      priceLira: 0,
      currency: "TRY",
      taxRatePercent: "",
      discountPriceLira: "",
      sku: "",
      stockQuantity: 0,
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
        setCategories(await productsApi.listProductCategories());
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
      const trimmedDiscount = values.discountPriceLira?.trim();
      const trimmedTaxRate = values.taxRatePercent?.trim();

      const product = await productsApi.createProduct({
        title: values.title,
        slug: values.slug || undefined,
        excerpt: values.excerpt || undefined,
        descriptionHtml: values.descriptionHtml || undefined,
        priceCents: Math.round(values.priceLira * 100),
        currency: values.currency,
        taxRatePercent: trimmedTaxRate ? Number(trimmedTaxRate) : undefined,
        discountPriceCents: trimmedDiscount ? Math.round(Number(trimmedDiscount) * 100) : undefined,
        sku: values.sku || undefined,
        stockQuantity: values.stockQuantity,
        status: values.status,
        categoryId: values.categoryId || undefined,
        coverMediaId: coverMedia?.id ?? undefined,
        authorId: isAdmin && values.authorId ? values.authorId : undefined,
      });
      toast.success("Ürün oluşturuldu.");
      router.push(`/admin/products/${product.id}`);
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setError(message);
      toast.error(message);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/admin/products"
        className="inline-flex items-center gap-1 text-sm text-foreground/60 transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Ürünler
      </Link>

      <PageHeading
        icon={ShoppingBag}
        title="Yeni Ürün"
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

            <Field id="excerpt" label="Özet">
              {(inputProps) => <Textarea {...inputProps} {...register("excerpt")} rows={2} />}
            </Field>

            <Field id="descriptionHtml" label="Açıklama" hint="Şimdilik düz metin — zengin metin editörü sonraki bir iyileştirmedir.">
              {(inputProps) => <Textarea {...inputProps} {...register("descriptionHtml")} rows={5} />}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="priceLira" label="Fiyat (TL)" error={errors.priceLira?.message} required>
                {(inputProps) => (
                  <Input {...inputProps} type="number" step="0.01" min="0" {...register("priceLira")} />
                )}
              </Field>
              <Field id="currency" label="Para birimi" required>
                {(inputProps) => (
                  <Select {...inputProps} {...register("currency")}>
                    {CURRENCIES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="discountPriceLira" label="İndirimli fiyat (TL)" error={errors.discountPriceLira?.message} hint="Opsiyonel.">
                {(inputProps) => <Input {...inputProps} type="number" step="0.01" min="0" {...register("discountPriceLira")} />}
              </Field>
              <Field id="taxRatePercent" label="KDV oranı (%)" hint="Opsiyonel, fiyata dahildir.">
                {(inputProps) => <Input {...inputProps} type="number" step="0.01" min="0" max="100" {...register("taxRatePercent")} />}
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="sku" label="SKU" hint="Opsiyonel.">
                {(inputProps) => <Input {...inputProps} {...register("sku")} />}
              </Field>
              <Field id="stockQuantity" label="Stok adedi" error={errors.stockQuantity?.message} required>
                {(inputProps) => <Input {...inputProps} type="number" step="1" min="0" {...register("stockQuantity")} />}
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
