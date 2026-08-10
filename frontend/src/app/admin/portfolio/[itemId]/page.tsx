"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as portfolioApi from "@/lib/api/portfolio";
import * as revisionsApi from "@/lib/api/revisions";
import type { ContentStatus, Media, PortfolioCategory, PortfolioImage } from "@/lib/api/types";
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
import { MediaSelectField } from "@/components/admin/media/media-select-field";
import { GalleryField } from "@/components/admin/media/gallery-field";
import { SeoPreview } from "@/components/admin/seo-preview";
import { RevisionHistory } from "@/components/admin/revision-history";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { AlertCircle, AlertTriangle, ChevronLeft, FileText, Search, History as HistoryIcon } from "lucide-react";

interface PortfolioItemSnapshot {
  title: string;
  slug: string;
  summary: string;
  contentHtml: string;
  clientName: string;
  projectUrl: string;
  completedAt: string;
  order: string;
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

/** ISO datetime string'i `date` input'unun beklediği `YYYY-MM-DD` biçimine çevirir — UTC tabanlı,
 *  `completedAt: new Date(dateInput).toISOString()` çeviriminin TERSİ (bkz. handleSave). */
function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export default function EditPortfolioItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = use(params);
  const router = useRouter();

  const [categories, setCategories] = useState<PortfolioCategory[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [summary, setSummary] = useState("");
  const [contentHtml, setContentHtml] = useState("");
  const [clientName, setClientName] = useState("");
  const [projectUrl, setProjectUrl] = useState("");
  const [completedAt, setCompletedAt] = useState("");
  const [order, setOrder] = useState("0");
  const [categoryId, setCategoryId] = useState("");
  const [coverMedia, setCoverMedia] = useState<Media | null>(null);
  const [images, setImages] = useState<PortfolioImage[]>([]);
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
  const [snapshot, setSnapshot] = useState<PortfolioItemSnapshot | null>(null);

  const load = useCallback(async () => {
    try {
      const [item, cats] = await Promise.all([
        portfolioApi.getPortfolioItem(itemId),
        portfolioApi.listPortfolioCategories().catch(() => []),
      ]);
      const nextSnapshot: PortfolioItemSnapshot = {
        title: item.title,
        slug: item.slug,
        summary: item.summary ?? "",
        contentHtml: item.contentHtml,
        clientName: item.clientName ?? "",
        projectUrl: item.projectUrl ?? "",
        completedAt: toDateInputValue(item.completedAt),
        order: String(item.order),
        categoryId: item.category?.id ?? "",
        coverMediaId: item.coverMedia?.id ?? "",
        status: item.status,
        scheduledAt: toDatetimeLocalValue(item.scheduledAt),
        seoTitle: item.seoTitle ?? "",
        seoDescription: item.seoDescription ?? "",
        ogTitle: item.ogTitle ?? "",
        ogImageUrl: item.ogImageUrl ?? "",
        canonicalUrl: item.canonicalUrl ?? "",
        noIndex: item.noIndex,
      };
      setTitle(nextSnapshot.title);
      setSlug(nextSnapshot.slug);
      setSummary(nextSnapshot.summary);
      setContentHtml(nextSnapshot.contentHtml);
      setClientName(nextSnapshot.clientName);
      setProjectUrl(nextSnapshot.projectUrl);
      setCompletedAt(nextSnapshot.completedAt);
      setOrder(nextSnapshot.order);
      setCategoryId(nextSnapshot.categoryId);
      setCoverMedia(item.coverMedia);
      setImages(item.images);
      setStatus(nextSnapshot.status);
      setScheduledAt(nextSnapshot.scheduledAt);
      setSeoTitle(nextSnapshot.seoTitle);
      setSeoDescription(nextSnapshot.seoDescription);
      setOgTitle(nextSnapshot.ogTitle);
      setOgImageUrl(nextSnapshot.ogImageUrl);
      setCanonicalUrl(nextSnapshot.canonicalUrl);
      setNoIndex(nextSnapshot.noIndex);
      setViewCount(item.viewCount);
      setPublishedAt(item.publishedAt);
      setCategories(cats);
      setSnapshot(nextSnapshot);
      setLoaded(true);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, [itemId]);

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
      summary !== snapshot.summary ||
      contentHtml !== snapshot.contentHtml ||
      clientName !== snapshot.clientName ||
      projectUrl !== snapshot.projectUrl ||
      completedAt !== snapshot.completedAt ||
      order !== snapshot.order ||
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
    summary,
    contentHtml,
    clientName,
    projectUrl,
    completedAt,
    order,
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

  // Sessiz crash/kapatma-kurtarma güvenlik ağı — mevcut "Kaydet" butonunun/`hasUnsavedChanges`
  // akışının YERİNE GEÇMEZ (bkz. `use-autosave.ts`), bu yüzden başarıda `snapshot` GÜNCELLENMEZ.
  // Yalnızca serbest metin alanları (`title`/`summary`/`contentHtml`) — `status`/`slug`/`order`/
  // `clientName`/`projectUrl`/`completedAt`/SEO/çeviri bu uçtan DEĞİŞTİRİLEMEZ.
  const { status: autosaveStatus, lastSavedAt: autosaveSavedAt } = useAutosave({
    values: [title, summary, contentHtml],
    enabled: loaded,
    save: () => portfolioApi.autosavePortfolioItem(itemId, { title, summary: summary || null, contentHtml }),
  });

  /**
   * `projectUrl` geçerli URL kontrolü — backend zaten aynı kuralı uyguluyor
   * (bkz. portfolio.schemas.ts::CreatePortfolioItemRequestSchema.projectUrl), ama kullanıcıya
   * isteği hiç göndermeden anlık geri bildirim vermek için burada da tekrarlanır.
   */
  function validate(): string | null {
    const trimmedUrl = projectUrl.trim();
    if (trimmedUrl && !isValidUrl(trimmedUrl)) {
      return "Geçerli bir URL girin (https://...).";
    }
    if (!order.trim() || Number.isNaN(Number(order)) || !Number.isInteger(Number(order))) {
      return "Sıra için tam sayı girin.";
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
      await portfolioApi.updatePortfolioItem(itemId, {
        title,
        slug,
        summary: summary || null,
        contentHtml,
        clientName: clientName || null,
        projectUrl: projectUrl || null,
        completedAt: completedAt ? new Date(completedAt).toISOString() : null,
        order: Number(order),
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
      toast.success("Portföy öğesi kaydedildi.");
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
    const updated = await portfolioApi.addPortfolioImage(itemId, media.id);
    setImages(updated.images);
  }

  async function handleRemoveImage(imageId: string) {
    const updated = await portfolioApi.removePortfolioImage(itemId, imageId);
    setImages(updated.images);
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await portfolioApi.deletePortfolioItem(itemId);
      toast.success("Portföy öğesi silindi.");
      router.push("/admin/portfolio");
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
          href="/admin/portfolio"
          className="inline-flex items-center gap-1 text-sm text-foreground/60 transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Portföy
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <h1 className="admin-h1">Portföy Öğesini Düzenle</h1>
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
          <TabsTrigger value="revisions">
            <HistoryIcon className="h-3.5 w-3.5" />
            Geçmiş Sürümler
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

            <Field id="summary" label="Özet">
              {(inputProps) => <Textarea {...inputProps} value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} />}
            </Field>

            <Field id="contentHtml" label="İçerik" hint="Şimdilik düz metin — zengin metin editörü sonraki bir iyileştirmedir.">
              {(inputProps) => (
                <Textarea {...inputProps} value={contentHtml} onChange={(e) => setContentHtml(e.target.value)} rows={6} />
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="clientName" label="Müşteri" hint="Opsiyonel.">
                {(inputProps) => <Input {...inputProps} value={clientName} onChange={(e) => setClientName(e.target.value)} />}
              </Field>
              <Field id="projectUrl" label="Proje URL'si" hint="Opsiyonel.">
                {(inputProps) => (
                  <Input
                    {...inputProps}
                    type="url"
                    placeholder="https://…"
                    value={projectUrl}
                    onChange={(e) => setProjectUrl(e.target.value)}
                  />
                )}
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="completedAt" label="Tamamlanma tarihi" hint="Opsiyonel.">
                {(inputProps) => (
                  <Input {...inputProps} type="date" value={completedAt} onChange={(e) => setCompletedAt(e.target.value)} />
                )}
              </Field>
              <Field id="order" label="Sıra" hint="Düşük sayı önce gösterilir." required>
                {(inputProps) => (
                  <Input {...inputProps} type="number" step="1" required value={order} onChange={(e) => setOrder(e.target.value)} />
                )}
              </Field>
            </div>

            <MediaSelectField id="coverMedia" label="Kapak görseli" value={coverMedia} onChange={setCoverMedia} />

            <GalleryField
              id="gallery"
              label="Galeri"
              hint="Kapak görseli dışında, portföy detay sayfasında gösterilecek ek görseller."
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
                description={seoDescription || summary}
                slug={slug}
                imageUrl={ogImageUrl || coverMedia?.url}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="revisions" className="mt-6 outline-none">
          <RevisionHistory
            entityLabel="Portföy öğesi"
            loadRevisions={(cursor) => revisionsApi.listPortfolioItemRevisions(itemId, cursor)}
            onRestore={async (revisionId) => {
              await revisionsApi.restorePortfolioItemRevision(itemId, revisionId);
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
        title="Portföy öğesini sil"
        description="Bu portföy öğesini silmek istediğinize emin misiniz? Bu işlem geri alınamaz."
        confirmText="Sil"
        destructive
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
