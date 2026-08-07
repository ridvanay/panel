"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as blogApi from "@/lib/api/blog";
import * as revisionsApi from "@/lib/api/revisions";
import type { BlogCategory, ContentStatus, ContentTranslations } from "@/lib/api/types";
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
import { PostEditor } from "@/components/admin/blog/post-editor";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import { SeoPreview } from "@/components/admin/seo-preview";
import { RevisionHistory } from "@/components/admin/revision-history";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { AlertCircle, AlertTriangle, ChevronLeft, FileText, Search, History as HistoryIcon } from "lucide-react";
import { motion } from "framer-motion";

type Locale = "TR" | "EN";

interface PostSnapshot {
  title: string;
  slug: string;
  excerpt: string;
  coverImageUrl: string;
  categoryId: string;
  status: ContentStatus;
  scheduledAt: string;
  contentHtml: string;
  seoTitle: string;
  seoDescription: string;
  ogTitle: string;
  ogImageUrl: string;
  canonicalUrl: string;
  noIndex: boolean;
  translations: string;
}

/**
 * ISO datetime string'i `datetime-local` input'unun beklediği `YYYY-MM-DDTHH:mm` biçimine
 * çevirir. Saat dilimi dönüşümüne GİRMEZ (basit tutulur) — `Date` yerel saatle string üretir.
 */
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

/** İçerik + SEO sekmelerinde TR/EN override arasında geçiş için küçük segmented control. */
function LocaleToggle({ locale, onChange }: { locale: Locale; onChange: (locale: Locale) => void }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-muted p-1">
      {(["TR", "EN"] as const).map((option) => (
        <Button
          key={option}
          type="button"
          size="xs"
          variant={locale === option ? "default" : "ghost"}
          onClick={() => onChange(option)}
        >
          {option}
        </Button>
      ))}
    </div>
  );
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
  const [locale, setLocale] = useState<Locale>("TR");

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState<ContentStatus>("DRAFT");
  const [scheduledAt, setScheduledAt] = useState("");
  const [contentHtml, setContentHtml] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [ogTitle, setOgTitle] = useState("");
  const [ogImageUrl, setOgImageUrl] = useState("");
  const [canonicalUrl, setCanonicalUrl] = useState("");
  const [noIndex, setNoIndex] = useState(false);
  const [translations, setTranslations] = useState<ContentTranslations>({});
  const [viewCount, setViewCount] = useState(0);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<PostSnapshot | null>(null);
  // TipTap `useEditor({ content })` içeriği yalnızca ilk mount'ta okur (uncontrolled).
  // `load()` her çalıştığında (ilk yükleme, versiyon restore) bu sayaç artırılır ve
  // PostEditor'ın `key`'ine dahil edilerek editör TAM REMOUNT edilir — böylece restore
  // sonrası editör state'i her zaman güncel `contentHtml` ile senkron kalır.
  const [editorGeneration, setEditorGeneration] = useState(0);

  function getEnField(key: string): string {
    const value = translations.EN?.[key];
    return typeof value === "string" ? value : "";
  }

  function setEnField(key: string, value: string) {
    setTranslations((prev) => ({ ...prev, EN: { ...(prev.EN ?? {}), [key]: value } }));
  }

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
        scheduledAt: toDatetimeLocalValue(post.scheduledAt),
        contentHtml: post.contentHtml,
        seoTitle: post.seoTitle ?? "",
        seoDescription: post.seoDescription ?? "",
        ogTitle: post.ogTitle ?? "",
        ogImageUrl: post.ogImageUrl ?? "",
        canonicalUrl: post.canonicalUrl ?? "",
        noIndex: post.noIndex,
        translations: JSON.stringify(post.translations ?? {}),
      };
      setTitle(nextSnapshot.title);
      setSlug(nextSnapshot.slug);
      setExcerpt(nextSnapshot.excerpt);
      setCoverImageUrl(nextSnapshot.coverImageUrl);
      setCategoryId(nextSnapshot.categoryId);
      setStatus(nextSnapshot.status);
      setScheduledAt(nextSnapshot.scheduledAt);
      setContentHtml(nextSnapshot.contentHtml);
      setSeoTitle(nextSnapshot.seoTitle);
      setSeoDescription(nextSnapshot.seoDescription);
      setOgTitle(nextSnapshot.ogTitle);
      setOgImageUrl(nextSnapshot.ogImageUrl);
      setCanonicalUrl(nextSnapshot.canonicalUrl);
      setNoIndex(nextSnapshot.noIndex);
      setTranslations(post.translations ?? {});
      setViewCount(post.viewCount);
      setPublishedAt(post.publishedAt);
      setCategories(cats);
      setSnapshot(nextSnapshot);
      setLoaded(true);
      setEditorGeneration((prev) => prev + 1);
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
      scheduledAt !== snapshot.scheduledAt ||
      contentHtml !== snapshot.contentHtml ||
      seoTitle !== snapshot.seoTitle ||
      seoDescription !== snapshot.seoDescription ||
      ogTitle !== snapshot.ogTitle ||
      ogImageUrl !== snapshot.ogImageUrl ||
      canonicalUrl !== snapshot.canonicalUrl ||
      noIndex !== snapshot.noIndex ||
      JSON.stringify(translations) !== snapshot.translations
    );
  }, [
    title,
    slug,
    excerpt,
    coverImageUrl,
    categoryId,
    status,
    scheduledAt,
    contentHtml,
    seoTitle,
    seoDescription,
    ogTitle,
    ogImageUrl,
    canonicalUrl,
    noIndex,
    translations,
    snapshot,
  ]);

  // Kaydedilmemiş değişiklik varken sekmeyi kapatma/yenileme/tamamen ayrılma girişiminde
  // tarayıcının native uyarısını göster (bkz. admin/settings/page.tsx'teki aynı patern).
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
  // Yalnızca TR içerik + yalnızca yüklendikten sonra aktif (EN çevirisi bu turun kapsamı dışında).
  const { status: autosaveStatus, lastSavedAt: autosaveSavedAt } = useAutosave({
    values: [title, excerpt, contentHtml],
    enabled: loaded && locale === "TR",
    save: () => blogApi.autosavePost(postId, { title, excerpt: excerpt || null, contentHtml }),
  });

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
        scheduledAt: status === "SCHEDULED" ? new Date(scheduledAt).toISOString() : null,
        contentHtml,
        seoTitle: seoTitle || null,
        seoDescription: seoDescription || null,
        ogTitle: ogTitle || null,
        ogImageUrl: ogImageUrl || null,
        canonicalUrl: canonicalUrl || null,
        noIndex,
        translations,
      });
      toast.success("Yazı kaydedildi.");
      await load();
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setSaveError(message);
      toast.error(message);
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
            <h1 className="admin-h1">Yazıyı Düzenle</h1>
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
          <div className="flex justify-end">
            <LocaleToggle locale={locale} onChange={setLocale} />
          </div>

          <Card className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="title" label="Başlık" required={locale === "TR"}>
                {(inputProps) => (
                  <Input
                    {...inputProps}
                    required={locale === "TR"}
                    value={locale === "TR" ? title : getEnField("title")}
                    onChange={(e) =>
                      locale === "TR" ? setTitle(e.target.value) : setEnField("title", e.target.value)
                    }
                  />
                )}
              </Field>
              <Field id="slug" label="Slug (URL)" required>
                {(inputProps) => <Input {...inputProps} required value={slug} onChange={(e) => setSlug(e.target.value)} />}
              </Field>
            </div>

            <Field id="excerpt" label="Özet">
              {(inputProps) => (
                <Textarea
                  {...inputProps}
                  value={locale === "TR" ? excerpt : getEnField("excerpt")}
                  onChange={(e) =>
                    locale === "TR" ? setExcerpt(e.target.value) : setEnField("excerpt", e.target.value)
                  }
                  rows={2}
                />
              )}
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

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              İçerik {locale === "EN" && <span className="text-foreground/40">(EN)</span>}
            </label>
            <PostEditor
              key={`${locale}-${editorGeneration}`}
              content={locale === "TR" ? contentHtml : getEnField("contentHtml")}
              onChange={(html) => (locale === "TR" ? setContentHtml(html) : setEnField("contentHtml", html))}
            />
          </div>
        </TabsContent>

        <TabsContent value="seo" className="mt-6 outline-none">
          <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
            <div className="min-w-0 space-y-4">
              <div className="flex justify-end">
                <LocaleToggle locale={locale} onChange={setLocale} />
              </div>

              <Card className="space-y-4">
                <Field id="seoTitle" label="SEO başlığı">
                  {(inputProps) => (
                    <Input
                      {...inputProps}
                      value={locale === "TR" ? seoTitle : getEnField("seoTitle")}
                      onChange={(e) =>
                        locale === "TR" ? setSeoTitle(e.target.value) : setEnField("seoTitle", e.target.value)
                      }
                    />
                  )}
                </Field>
                <Field id="seoDescription" label="SEO açıklaması">
                  {(inputProps) => (
                    <Textarea
                      {...inputProps}
                      value={locale === "TR" ? seoDescription : getEnField("seoDescription")}
                      onChange={(e) =>
                        locale === "TR" ? setSeoDescription(e.target.value) : setEnField("seoDescription", e.target.value)
                      }
                      rows={2}
                    />
                  )}
                </Field>
                <Field id="ogTitle" label="Sosyal medya (OG) başlığı" hint="Boş bırakılırsa SEO başlığı kullanılır.">
                  {(inputProps) => (
                    <Input
                      {...inputProps}
                      value={locale === "TR" ? ogTitle : getEnField("ogTitle")}
                      onChange={(e) =>
                        locale === "TR" ? setOgTitle(e.target.value) : setEnField("ogTitle", e.target.value)
                      }
                    />
                  )}
                </Field>
                {locale === "TR" && (
                  <ImageUploadField
                    id="ogImageUrl"
                    label="Sosyal medya (OG) görseli"
                    value={ogImageUrl}
                    onChange={setOgImageUrl}
                  />
                )}
                <Field id="canonicalUrl" label="Canonical URL" hint="Boş bırakılırsa otomatik belirlenir.">
                  {(inputProps) => (
                    <Input
                      {...inputProps}
                      type="url"
                      placeholder="https://…"
                      value={locale === "TR" ? canonicalUrl : getEnField("canonicalUrl")}
                      onChange={(e) =>
                        locale === "TR" ? setCanonicalUrl(e.target.value) : setEnField("canonicalUrl", e.target.value)
                      }
                    />
                  )}
                </Field>
                {locale === "TR" && (
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
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                <SeoPreview
                  title={ogTitle || seoTitle || title}
                  description={seoDescription || excerpt}
                  slug={slug}
                  imageUrl={ogImageUrl || coverImageUrl}
                />
              </motion.div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="revisions" className="mt-6 outline-none">
          <RevisionHistory
            entityLabel="Yazı"
            loadRevisions={(cursor) => revisionsApi.listPostRevisions(postId, cursor)}
            onRestore={async (revisionId) => {
              await revisionsApi.restorePostRevision(postId, revisionId);
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
