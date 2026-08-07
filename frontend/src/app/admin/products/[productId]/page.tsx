"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as productsApi from "@/lib/api/products";
import type { ContentStatus, Media, ProductCategory, ProductImage } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MediaSelectField } from "@/components/admin/media/media-select-field";
import { GalleryField } from "@/components/admin/media/gallery-field";
import { SeoPreview } from "@/components/admin/seo-preview";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { AlertCircle, ChevronLeft, FileText, Search } from "lucide-react";

const CURRENCIES = ["TRY", "USD", "EUR", "GBP"] as const;

interface ProductSnapshot {
  title: string;
  slug: string;
  excerpt: string;
  descriptionHtml: string;
  priceLira: string;
  currency: string;
  taxRatePercent: string;
  discountPriceLira: string;
  sku: string;
  stockQuantity: string;
  categoryId: string;
  coverMediaId: string;
  status: ContentStatus;
  scheduledAt: string;
  seoTitle: string;
  seoDescription: string;
  ogTitle: string;
  ogImageUrl: string;
  canonicalUrl: string;
  noIndex: boolean;
}

/** ISO datetime string'i `datetime-local` input'unun beklediği `YYYY-MM-DDTHH:mm` biçimine çevirir. */
function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `datetime-local` `min` attribute'u için "şimdi" değeri — geçmiş tarih seçimini istemci tarafında engeller. */
function nowDatetimeLocalValue(): string {
  return toDatetimeLocalValue(new Date().toISOString());
}

function centsToLiraString(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toString();
}

export default function EditProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = use(params);
  const router = useRouter();

  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [descriptionHtml, setDescriptionHtml] = useState("");
  const [priceLira, setPriceLira] = useState("");
  const [currency, setCurrency] = useState("TRY");
  const [taxRatePercent, setTaxRatePercent] = useState("");
  const [discountPriceLira, setDiscountPriceLira] = useState("");
  const [sku, setSku] = useState("");
  const [stockQuantity, setStockQuantity] = useState("0");
  const [categoryId, setCategoryId] = useState("");
  const [coverMedia, setCoverMedia] = useState<Media | null>(null);
  const [images, setImages] = useState<ProductImage[]>([]);
  const [status, setStatus] = useState<ContentStatus>("DRAFT");
  const [scheduledAt, setScheduledAt] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [ogTitle, setOgTitle] = useState("");
  const [ogImageUrl, setOgImageUrl] = useState("");
  const [canonicalUrl, setCanonicalUrl] = useState("");
  const [noIndex, setNoIndex] = useState(false);
  const [viewCount, setViewCount] = useState(0);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ProductSnapshot | null>(null);

  const load = useCallback(async () => {
    try {
      const [product, cats] = await Promise.all([
        productsApi.getProduct(productId),
        productsApi.listProductCategories().catch(() => []),
      ]);
      const nextSnapshot: ProductSnapshot = {
        title: product.title,
        slug: product.slug,
        excerpt: product.excerpt ?? "",
        descriptionHtml: product.descriptionHtml,
        priceLira: centsToLiraString(product.priceCents),
        currency: product.currency,
        taxRatePercent: product.taxRatePercent !== null ? String(product.taxRatePercent) : "",
        discountPriceLira: centsToLiraString(product.discountPriceCents),
        sku: product.sku ?? "",
        stockQuantity: String(product.stockQuantity),
        categoryId: product.category?.id ?? "",
        coverMediaId: product.coverMedia?.id ?? "",
        status: product.status,
        scheduledAt: toDatetimeLocalValue(product.scheduledAt),
        seoTitle: product.seoTitle ?? "",
        seoDescription: product.seoDescription ?? "",
        ogTitle: product.ogTitle ?? "",
        ogImageUrl: product.ogImageUrl ?? "",
        canonicalUrl: product.canonicalUrl ?? "",
        noIndex: product.noIndex,
      };
      setTitle(nextSnapshot.title);
      setSlug(nextSnapshot.slug);
      setExcerpt(nextSnapshot.excerpt);
      setDescriptionHtml(nextSnapshot.descriptionHtml);
      setPriceLira(nextSnapshot.priceLira);
      setCurrency(nextSnapshot.currency);
      setTaxRatePercent(nextSnapshot.taxRatePercent);
      setDiscountPriceLira(nextSnapshot.discountPriceLira);
      setSku(nextSnapshot.sku);
      setStockQuantity(nextSnapshot.stockQuantity);
      setCategoryId(nextSnapshot.categoryId);
      setCoverMedia(product.coverMedia);
      setImages(product.images);
      setStatus(nextSnapshot.status);
      setScheduledAt(nextSnapshot.scheduledAt);
      setSeoTitle(nextSnapshot.seoTitle);
      setSeoDescription(nextSnapshot.seoDescription);
      setOgTitle(nextSnapshot.ogTitle);
      setOgImageUrl(nextSnapshot.ogImageUrl);
      setCanonicalUrl(nextSnapshot.canonicalUrl);
      setNoIndex(nextSnapshot.noIndex);
      setViewCount(product.viewCount);
      setPublishedAt(product.publishedAt);
      setCategories(cats);
      setSnapshot(nextSnapshot);
      setLoaded(true);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, [productId]);

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
      descriptionHtml !== snapshot.descriptionHtml ||
      priceLira !== snapshot.priceLira ||
      currency !== snapshot.currency ||
      taxRatePercent !== snapshot.taxRatePercent ||
      discountPriceLira !== snapshot.discountPriceLira ||
      sku !== snapshot.sku ||
      stockQuantity !== snapshot.stockQuantity ||
      categoryId !== snapshot.categoryId ||
      (coverMedia?.id ?? "") !== snapshot.coverMediaId ||
      status !== snapshot.status ||
      scheduledAt !== snapshot.scheduledAt ||
      seoTitle !== snapshot.seoTitle ||
      seoDescription !== snapshot.seoDescription ||
      ogTitle !== snapshot.ogTitle ||
      ogImageUrl !== snapshot.ogImageUrl ||
      canonicalUrl !== snapshot.canonicalUrl ||
      noIndex !== snapshot.noIndex
    );
  }, [
    title,
    slug,
    excerpt,
    descriptionHtml,
    priceLira,
    currency,
    taxRatePercent,
    discountPriceLira,
    sku,
    stockQuantity,
    categoryId,
    coverMedia,
    status,
    scheduledAt,
    seoTitle,
    seoDescription,
    ogTitle,
    ogImageUrl,
    canonicalUrl,
    noIndex,
    snapshot,
  ]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  /**
   * `discountPriceCents < priceCents` çapraz kontrolü — backend zaten aynı kuralı uyguluyor
   * (bkz. products.routes.ts::assertDiscountBelowPrice), ama kullanıcıya isteği hiç
   * göndermeden anlık geri bildirim vermek için burada da tekrarlanır.
   */
  function validate(): string | null {
    const priceNum = Number(priceLira);
    if (!priceLira.trim() || Number.isNaN(priceNum) || priceNum <= 0) {
      return "Fiyat 0'dan büyük olmalı.";
    }
    const trimmedDiscount = discountPriceLira.trim();
    if (trimmedDiscount) {
      const discountNum = Number(trimmedDiscount);
      if (!Number.isNaN(discountNum) && discountNum >= priceNum) {
        return "İndirimli fiyat, normal fiyattan küçük olmalıdır.";
      }
    }
    return null;
  }

  async function handleSave() {
    const validationError = validate();
    if (validationError) {
      setSaveError(validationError);
      toast.error(validationError);
      return;
    }

    setSaveError(null);
    setSaving(true);
    try {
      const trimmedDiscount = discountPriceLira.trim();
      const trimmedTaxRate = taxRatePercent.trim();

      await productsApi.updateProduct(productId, {
        title,
        slug,
        excerpt: excerpt || null,
        descriptionHtml,
        priceCents: Math.round(Number(priceLira) * 100),
        currency,
        taxRatePercent: trimmedTaxRate ? Number(trimmedTaxRate) : null,
        discountPriceCents: trimmedDiscount ? Math.round(Number(trimmedDiscount) * 100) : null,
        sku: sku || null,
        stockQuantity: Number(stockQuantity),
        categoryId: categoryId || null,
        coverMediaId: coverMedia?.id ?? null,
        status,
        scheduledAt: status === "SCHEDULED" ? new Date(scheduledAt).toISOString() : null,
        seoTitle: seoTitle || null,
        seoDescription: seoDescription || null,
        ogTitle: ogTitle || null,
        ogImageUrl: ogImageUrl || null,
        canonicalUrl: canonicalUrl || null,
        noIndex,
      });
      toast.success("Ürün kaydedildi.");
      await load();
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddImage(media: Media) {
    const updated = await productsApi.addProductImage(productId, media.id);
    setImages(updated.images);
  }

  async function handleRemoveImage(imageId: string) {
    const updated = await productsApi.removeProductImage(productId, imageId);
    setImages(updated.images);
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await productsApi.deleteProduct(productId);
      toast.success("Ürün silindi.");
      router.push("/admin/products");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setSaveError(message);
      toast.error(message);
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
    <div className="mx-auto max-w-6xl space-y-6 pb-24">
      <div>
        <Link
          href="/admin/products"
          className="inline-flex items-center gap-1 text-sm text-foreground/60 transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Ürünler
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <h1 className="admin-h1">Ürünü Düzenle</h1>
            <p className="mt-1 admin-text-secondary">
              {viewCount.toLocaleString("tr-TR")} görüntülenme
              {status === "SCHEDULED" && !publishedAt && scheduledAt && (
                <>
                  {" "}
                  · Zamanlandı:{" "}
                  {new Date(scheduledAt).toLocaleString("tr-TR", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </>
              )}
            </p>
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

      <Tabs defaultValue="content">
        <TabsList>
          <TabsTrigger value="content">
            <FileText className="h-3.5 w-3.5" />
            İçerik
          </TabsTrigger>
          <TabsTrigger value="seo">
            <Search className="h-3.5 w-3.5" />
            SEO &amp; Sosyal
          </TabsTrigger>
        </TabsList>

        <TabsContent value="content" className="mt-6 space-y-6 outline-none">
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

            <Field id="descriptionHtml" label="Açıklama" hint="Şimdilik düz metin — zengin metin editörü sonraki bir iyileştirmedir.">
              {(inputProps) => (
                <Textarea {...inputProps} value={descriptionHtml} onChange={(e) => setDescriptionHtml(e.target.value)} rows={6} />
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="priceLira" label="Fiyat (TL)" required>
                {(inputProps) => (
                  <Input
                    {...inputProps}
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={priceLira}
                    onChange={(e) => setPriceLira(e.target.value)}
                  />
                )}
              </Field>
              <Field id="currency" label="Para birimi" required>
                {(inputProps) => (
                  <Select {...inputProps} value={currency} onChange={(e) => setCurrency(e.target.value)}>
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
              <Field id="discountPriceLira" label="İndirimli fiyat (TL)" hint="Opsiyonel.">
                {(inputProps) => (
                  <Input
                    {...inputProps}
                    type="number"
                    step="0.01"
                    min="0"
                    value={discountPriceLira}
                    onChange={(e) => setDiscountPriceLira(e.target.value)}
                  />
                )}
              </Field>
              <Field id="taxRatePercent" label="KDV oranı (%)" hint="Opsiyonel, fiyata dahildir.">
                {(inputProps) => (
                  <Input
                    {...inputProps}
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={taxRatePercent}
                    onChange={(e) => setTaxRatePercent(e.target.value)}
                  />
                )}
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="sku" label="SKU" hint="Opsiyonel.">
                {(inputProps) => <Input {...inputProps} value={sku} onChange={(e) => setSku(e.target.value)} />}
              </Field>
              <Field id="stockQuantity" label="Stok adedi" required>
                {(inputProps) => (
                  <Input
                    {...inputProps}
                    type="number"
                    step="1"
                    min="0"
                    required
                    value={stockQuantity}
                    onChange={(e) => setStockQuantity(e.target.value)}
                  />
                )}
              </Field>
            </div>

            <MediaSelectField id="coverMedia" label="Kapak görseli" value={coverMedia} onChange={setCoverMedia} />

            <GalleryField
              id="gallery"
              label="Galeri"
              hint="Kapak görseli dışında, ürün detay sayfasında gösterilecek ek görseller."
              images={images}
              onAdd={handleAddImage}
              onRemove={handleRemoveImage}
            />

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
                    <option value="SCHEDULED">Zamanlanmış</option>
                  </Select>
                )}
              </Field>
              {status === "SCHEDULED" && (
                <Field id="scheduledAt" label="Yayın tarihi" required>
                  {(inputProps) => (
                    <Input
                      {...inputProps}
                      type="datetime-local"
                      required
                      min={nowDatetimeLocalValue()}
                      value={scheduledAt}
                      onChange={(e) => setScheduledAt(e.target.value)}
                    />
                  )}
                </Field>
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="seo" className="mt-6 outline-none">
          <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
            <div className="min-w-0 space-y-4">
              <Card className="space-y-4">
                <Field id="seoTitle" label="SEO başlığı">
                  {(inputProps) => <Input {...inputProps} value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} />}
                </Field>
                <Field id="seoDescription" label="SEO açıklaması">
                  {(inputProps) => (
                    <Textarea {...inputProps} value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} rows={2} />
                  )}
                </Field>
                <Field id="ogTitle" label="Sosyal medya (OG) başlığı" hint="Boş bırakılırsa SEO başlığı kullanılır.">
                  {(inputProps) => <Input {...inputProps} value={ogTitle} onChange={(e) => setOgTitle(e.target.value)} />}
                </Field>
                <Field id="ogImageUrl" label="Sosyal medya (OG) görseli URL'si" hint="Boş bırakılırsa kapak görseli kullanılır.">
                  {(inputProps) => <Input {...inputProps} value={ogImageUrl} onChange={(e) => setOgImageUrl(e.target.value)} />}
                </Field>
                <Field id="canonicalUrl" label="Canonical URL" hint="Boş bırakılırsa otomatik belirlenir.">
                  {(inputProps) => (
                    <Input
                      {...inputProps}
                      type="url"
                      placeholder="https://…"
                      value={canonicalUrl}
                      onChange={(e) => setCanonicalUrl(e.target.value)}
                    />
                  )}
                </Field>
                <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-foreground">İndekslemeyi engelle</p>
                    <p className="text-xs text-foreground/60">Arama motorları bu içeriği indekslemesin.</p>
                  </div>
                  <Switch checked={noIndex} onCheckedChange={setNoIndex} />
                </div>
              </Card>
            </div>

            <div className="lg:sticky lg:top-6 lg:self-start">
              <SeoPreview
                title={ogTitle || seoTitle || title}
                description={seoDescription || excerpt}
                slug={slug}
                imageUrl={ogImageUrl || coverMedia?.url}
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>

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
        title="Ürünü sil"
        description="Bu ürünü silmek istediğinize emin misiniz? Bu işlem geri alınamaz."
        confirmText="Sil"
        destructive
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
