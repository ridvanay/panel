"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as productsApi from "@/lib/api/products";
import * as revisionsApi from "@/lib/api/revisions";
import * as localesApi from "@/lib/api/locales";
import type {
  ContentStatus,
  ContentTranslations,
  Locale as LocaleDto,
  Media,
  ProductCategory,
  ProductDocument,
  ProductImage,
  ProductVariant,
  ProductVariantOption,
} from "@/lib/api/types";
import { useAutosave } from "@/hooks/use-autosave";
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
import { LocaleTabs } from "@/components/admin/locale-tabs";
import { LocaleFallbackBadge, FALLBACK_FIELD_CLASSES } from "@/components/admin/locale-fallback-badge";
import { MediaSelectField } from "@/components/admin/media/media-select-field";
import { GalleryField } from "@/components/admin/media/gallery-field";
import { SeoPreview } from "@/components/admin/seo-preview";
import { RevisionHistory } from "@/components/admin/revision-history";
import { VariantAxesEditor } from "@/components/admin/products/variant-axes-editor";
import { ProductVariantsPanel } from "@/components/admin/products/product-variants-panel";
import { ProductDocumentsPanel } from "@/components/admin/products/product-documents-panel";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { computeLocaleStatus, getTranslatedField, isFallbackField, localeStatusDetail, setTranslatedField } from "@/lib/i18n/translation-helpers";
import { AlertCircle, AlertTriangle, ChevronLeft, FileText, Layers, Search, History as HistoryIcon } from "lucide-react";

const CURRENCIES = ["TRY", "USD", "EUR", "GBP"] as const;

/** §9 frontend-agent madde 10 — Products editöründe çeviri editörü BUGÜN YOK, bu turda eklendi. */
const TRANSLATABLE_FIELD_KEYS = ["title", "excerpt", "descriptionHtml", "seoTitle", "seoDescription", "ogTitle", "canonicalUrl"];

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
  translations: string;
  variantOptions: string;
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
  const [locales, setLocales] = useState<LocaleDto[]>([]);
  const [locale, setLocale] = useState<string>("");
  const [translations, setTranslations] = useState<ContentTranslations>({});
  const [savedTranslations, setSavedTranslations] = useState<ContentTranslations>({});

  const defaultLocale = locales.find((l) => l.isDefault) ?? null;
  const isDefaultLocale = !defaultLocale || locale === defaultLocale.code;

  useEffect(() => {
    (async () => {
      try {
        const data = await localesApi.listAdminLocales();
        const sorted = [...data].sort((a, b) => a.sortOrder - b.sortOrder);
        setLocales(sorted);
        setLocale((prev) => prev || sorted.find((l) => l.isDefault)?.code || sorted[0]?.code || "tr");
      } catch {
        setLocale((prev) => prev || "tr");
      }
    })();
  }, []);

  function getEnField(key: string): string {
    return getTranslatedField(translations, locale, key);
  }

  function setEnField(key: string, value: string) {
    setTranslatedField(setTranslations, locale, key, value);
  }

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
  const [variantOptions, setVariantOptions] = useState<ProductVariantOption[]>([]);
  // `variantOptions`'ın SUNUCUDA KAYITLI hali — `ProductVariantsPanel`'in "yeni varyasyon ekle"
  // formuna kaynaklık eder (backend `POST .../variants`'ı BUNA göre doğrular, yerel taslağa değil).
  const [savedVariantOptions, setSavedVariantOptions] = useState<ProductVariantOption[]>([]);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [documents, setDocuments] = useState<ProductDocument[]>([]);
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
        translations: JSON.stringify(product.translations ?? {}),
        variantOptions: JSON.stringify(product.variantOptions ?? []),
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
      setVariantOptions(product.variantOptions ?? []);
      setSavedVariantOptions(product.variantOptions ?? []);
      setVariants(product.variants ?? []);
      setDocuments(product.documents ?? []);
      setStatus(nextSnapshot.status);
      setScheduledAt(nextSnapshot.scheduledAt);
      setSeoTitle(nextSnapshot.seoTitle);
      setSeoDescription(nextSnapshot.seoDescription);
      setOgTitle(nextSnapshot.ogTitle);
      setOgImageUrl(nextSnapshot.ogImageUrl);
      setCanonicalUrl(nextSnapshot.canonicalUrl);
      setNoIndex(nextSnapshot.noIndex);
      setTranslations(product.translations ?? {});
      setSavedTranslations(product.translations ?? {});
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
      noIndex !== snapshot.noIndex ||
      JSON.stringify(translations) !== snapshot.translations ||
      JSON.stringify(variantOptions) !== snapshot.variantOptions
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
    variantOptions,
    coverMedia,
    status,
    scheduledAt,
    seoTitle,
    seoDescription,
    ogTitle,
    ogImageUrl,
    canonicalUrl,
    noIndex,
    translations,
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

  // Sessiz crash/kapatma-kurtarma güvenlik ağı — mevcut "Kaydet" butonunun/`hasUnsavedChanges`
  // akışının YERİNE GEÇMEZ (bkz. `use-autosave.ts`), bu yüzden başarıda `snapshot` GÜNCELLENMEZ.
  // Yalnızca serbest metin alanları (`title`/`excerpt`/`descriptionHtml`) — ticari alanlar
  // (fiyat/indirim/SKU/stok/durum) bu uçtan DEĞİŞTİRİLEMEZ (bkz. AutosaveProductRequest).
  const { status: autosaveStatus, lastSavedAt: autosaveSavedAt } = useAutosave({
    values: [title, excerpt, descriptionHtml],
    enabled: loaded,
    save: () => productsApi.autosaveProduct(productId, { title, excerpt: excerpt || null, descriptionHtml }),
  });

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
        // §1.4 — tam-replace; mevcut varyasyonlardan biri yeni tanımla uyuşmuyorsa backend 409 döner
        // (`ProductVariantsPanel`'in üstündeki uyarı bunu önceden bildirir).
        variantOptions,
        status,
        scheduledAt: status === "SCHEDULED" ? new Date(scheduledAt).toISOString() : null,
        seoTitle: seoTitle || null,
        seoDescription: seoDescription || null,
        ogTitle: ogTitle || null,
        ogImageUrl: ogImageUrl || null,
        canonicalUrl: canonicalUrl || null,
        noIndex,
        translations,
      });
      toast.success("Ürün kaydedildi.");
      setSavedTranslations(translations);
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
          <TabsTrigger value="variants">
            <Layers className="h-3.5 w-3.5" />
            Varyasyon &amp; Döküman
          </TabsTrigger>
          <TabsTrigger value="seo">
            <Search className="h-3.5 w-3.5" />
            SEO &amp; Sosyal
          </TabsTrigger>
          <TabsTrigger value="revisions">
            <HistoryIcon className="h-3.5 w-3.5" />
            Geçmiş Sürümler
          </TabsTrigger>
        </TabsList>

        <TabsContent value="content" className="mt-6 space-y-6 outline-none">
          {locales.length > 0 && (
            <div className="flex justify-end">
              <LocaleTabs
                locales={locales}
                value={locale}
                onValueChange={setLocale}
                statusFor={(code) => computeLocaleStatus(savedTranslations, code, TRANSLATABLE_FIELD_KEYS)}
                partialDetailFor={(code) => localeStatusDetail(savedTranslations, code, TRANSLATABLE_FIELD_KEYS)}
              />
            </div>
          )}

          <Card className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="title" label="Başlık" required={isDefaultLocale}>
                {(inputProps) => {
                  const fallback = !isDefaultLocale && isFallbackField(translations, locale, "title", title);
                  return (
                    <>
                      {fallback && defaultLocale && (
                        <div className="mb-1 flex justify-end">
                          <LocaleFallbackBadge defaultLabel={defaultLocale.nativeLabel} />
                        </div>
                      )}
                      <Input
                        {...inputProps}
                        required={isDefaultLocale}
                        className={fallback ? FALLBACK_FIELD_CLASSES : undefined}
                        placeholder={fallback ? title : undefined}
                        value={isDefaultLocale ? title : getEnField("title")}
                        onChange={(e) => (isDefaultLocale ? setTitle(e.target.value) : setEnField("title", e.target.value))}
                      />
                    </>
                  );
                }}
              </Field>
              <Field id="slug" label="Slug (URL)" required>
                {(inputProps) => <Input {...inputProps} required value={slug} onChange={(e) => setSlug(e.target.value)} />}
              </Field>
            </div>

            <Field id="excerpt" label="Özet">
              {(inputProps) => (
                <Textarea
                  {...inputProps}
                  value={isDefaultLocale ? excerpt : getEnField("excerpt")}
                  onChange={(e) => (isDefaultLocale ? setExcerpt(e.target.value) : setEnField("excerpt", e.target.value))}
                  rows={2}
                />
              )}
            </Field>

            <Field id="descriptionHtml" label="Açıklama" hint="Şimdilik düz metin — zengin metin editörü sonraki bir iyileştirmedir.">
              {(inputProps) => (
                <Textarea
                  {...inputProps}
                  value={isDefaultLocale ? descriptionHtml : getEnField("descriptionHtml")}
                  onChange={(e) =>
                    isDefaultLocale ? setDescriptionHtml(e.target.value) : setEnField("descriptionHtml", e.target.value)
                  }
                  rows={6}
                />
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
              <Field
                id="stockQuantity"
                label="Stok adedi"
                required={variants.length === 0}
                hint={
                  variants.length > 0
                    ? `Bu ürün varyasyonlu — stok varyasyon seviyesinde yönetilir. Toplam: Σ ${variants.reduce((sum, v) => sum + v.stockQuantity, 0)}`
                    : undefined
                }
              >
                {(inputProps) => (
                  <Input
                    {...inputProps}
                    type="number"
                    step="1"
                    min="0"
                    required={variants.length === 0}
                    disabled={variants.length > 0}
                    value={variants.length > 0 ? String(variants.reduce((sum, v) => sum + v.stockQuantity, 0)) : stockQuantity}
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

        <TabsContent value="variants" className="mt-6 space-y-6 outline-none">
          <Card className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Varyasyon eksenleri</h2>
              <p className="mt-1 text-xs text-foreground/60">
                Renk/Beden gibi eksenler tanımlayın (en fazla 2 eksen, eksen başına en fazla 12 değer). Değişiklikler
                yalnızca sayfanın üstündeki &quot;Kaydet&quot; butonuyla kalıcı olur.
              </p>
            </div>
            <VariantAxesEditor value={variantOptions} onChange={setVariantOptions} />
          </Card>

          <Card className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Varyasyon kombinasyonları</h2>
              <p className="mt-1 text-xs text-foreground/60">
                Her satır (sku/fiyat/stok/görsel) kendi &quot;Kaydet&quot; butonuyla ANINDA kaydedilir.
              </p>
            </div>
            <ProductVariantsPanel
              productId={productId}
              savedAxes={savedVariantOptions}
              axesDirty={JSON.stringify(variantOptions) !== JSON.stringify(savedVariantOptions)}
              variants={variants}
              onVariantsChange={setVariants}
            />
          </Card>

          <Card className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Teknik dökümanlar (PDF)</h2>
              <p className="mt-1 text-xs text-foreground/60">
                Ürün detay sayfasında indirilebilir PDF kartları olarak gösterilir. Ekleme/kaldırma ANINDA kaydedilir.
              </p>
            </div>
            <ProductDocumentsPanel productId={productId} documents={documents} onDocumentsChange={setDocuments} />
          </Card>
        </TabsContent>

        <TabsContent value="seo" className="mt-6 outline-none">
          <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
            <div className="min-w-0 space-y-4">
              {locales.length > 0 && (
                <div className="flex justify-end">
                  <LocaleTabs
                    locales={locales}
                    value={locale}
                    onValueChange={setLocale}
                    statusFor={(code) => computeLocaleStatus(savedTranslations, code, TRANSLATABLE_FIELD_KEYS)}
                    partialDetailFor={(code) => localeStatusDetail(savedTranslations, code, TRANSLATABLE_FIELD_KEYS)}
                  />
                </div>
              )}
              <Card className="space-y-4">
                <Field id="seoTitle" label="SEO başlığı">
                  {(inputProps) => (
                    <Input
                      {...inputProps}
                      value={isDefaultLocale ? seoTitle : getEnField("seoTitle")}
                      onChange={(e) => (isDefaultLocale ? setSeoTitle(e.target.value) : setEnField("seoTitle", e.target.value))}
                    />
                  )}
                </Field>
                <Field id="seoDescription" label="SEO açıklaması">
                  {(inputProps) => (
                    <Textarea
                      {...inputProps}
                      value={isDefaultLocale ? seoDescription : getEnField("seoDescription")}
                      onChange={(e) =>
                        isDefaultLocale ? setSeoDescription(e.target.value) : setEnField("seoDescription", e.target.value)
                      }
                      rows={2}
                    />
                  )}
                </Field>
                <Field id="ogTitle" label="Sosyal medya (OG) başlığı" hint="Boş bırakılırsa SEO başlığı kullanılır.">
                  {(inputProps) => (
                    <Input
                      {...inputProps}
                      value={isDefaultLocale ? ogTitle : getEnField("ogTitle")}
                      onChange={(e) => (isDefaultLocale ? setOgTitle(e.target.value) : setEnField("ogTitle", e.target.value))}
                    />
                  )}
                </Field>
                {isDefaultLocale && (
                  <Field id="ogImageUrl" label="Sosyal medya (OG) görseli URL'si" hint="Boş bırakılırsa kapak görseli kullanılır.">
                    {(inputProps) => <Input {...inputProps} value={ogImageUrl} onChange={(e) => setOgImageUrl(e.target.value)} />}
                  </Field>
                )}
                <Field id="canonicalUrl" label="Canonical URL" hint="Boş bırakılırsa otomatik belirlenir.">
                  {(inputProps) => (
                    <Input
                      {...inputProps}
                      type="url"
                      placeholder="https://…"
                      value={isDefaultLocale ? canonicalUrl : getEnField("canonicalUrl")}
                      onChange={(e) =>
                        isDefaultLocale ? setCanonicalUrl(e.target.value) : setEnField("canonicalUrl", e.target.value)
                      }
                    />
                  )}
                </Field>
                {isDefaultLocale && (
                  <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-foreground">İndekslemeyi engelle</p>
                      <p className="text-xs text-foreground/60">Arama motorları bu içeriği indekslemesin.</p>
                    </div>
                    <Switch checked={noIndex} onCheckedChange={setNoIndex} />
                  </div>
                )}
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

        <TabsContent value="revisions" className="mt-6 outline-none">
          <RevisionHistory
            entityLabel="Ürün"
            loadRevisions={(cursor) => revisionsApi.listProductRevisions(productId, cursor)}
            onRestore={async (revisionId) => {
              await revisionsApi.restoreProductRevision(productId, revisionId);
              await load();
            }}
          />
        </TabsContent>
      </Tabs>

      <div className="sticky bottom-6 z-10 flex justify-end">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface/95 px-4 py-3 shadow-lg backdrop-blur">
          {saving && <span className="text-xs text-foreground/60">Kaydediliyor…</span>}
          {/* Autosave göstergesi — "Kaydediliyor…" (elle kaydetme) metniyle KARIŞTIRILMASIN diye
              ayrı, göze batmayan bir stil kullanılır; ikisi aynı anda görünebilir. */}
          {autosaveStatus === "saving" && (
            <span className="text-xs text-foreground/40">Taslak kaydediliyor…</span>
          )}
          {autosaveStatus === "saved" && autosaveSavedAt && (
            <span className="text-xs text-foreground/40">
              Taslak kaydedildi{" "}
              {new Date(autosaveSavedAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {autosaveStatus === "error" && (
            <span title="Taslak otomatik kaydedilemedi. 'Kaydet' butonuyla elle kaydedebilirsiniz.">
              <AlertTriangle
                className="h-3.5 w-3.5 text-warning/70"
                aria-label="Taslak otomatik kaydedilemedi. 'Kaydet' butonuyla elle kaydedebilirsiniz."
              />
            </span>
          )}
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
