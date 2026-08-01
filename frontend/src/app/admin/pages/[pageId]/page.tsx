"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as pagesApi from "@/lib/api/pages";
import * as revisionsApi from "@/lib/api/revisions";
import type { ContentStatus, ContentTranslations } from "@/lib/api/types";
import type { Block, BlockType } from "@/lib/page-builder/types";
import { createBlock } from "@/lib/page-builder/registry";
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
import { BlockList } from "@/components/admin/page-builder/block-list";
import { BuilderCanvas } from "@/components/admin/page-builder/builder-canvas";
import { SeoPreview } from "@/components/admin/seo-preview";
import { RevisionHistory } from "@/components/admin/revision-history";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { AlertCircle, ChevronLeft, FileText, Search, History as HistoryIcon } from "lucide-react";
import { motion } from "framer-motion";

type Locale = "TR" | "EN";

interface PageSnapshot {
  title: string;
  slug: string;
  status: ContentStatus;
  seoTitle: string;
  seoDescription: string;
  blocks: Block[];
  ogTitle: string;
  ogImageUrl: string;
  canonicalUrl: string;
  noIndex: boolean;
  translations: string;
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

export default function PageBuilderPage({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = use(params);
  const router = useRouter();

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [locale, setLocale] = useState<Locale>("TR");

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState<ContentStatus>("DRAFT");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [ogTitle, setOgTitle] = useState("");
  const [ogImageUrl, setOgImageUrl] = useState("");
  const [canonicalUrl, setCanonicalUrl] = useState("");
  const [noIndex, setNoIndex] = useState(false);
  const [translations, setTranslations] = useState<ContentTranslations>({});
  const [viewCount, setViewCount] = useState(0);
  const [snapshot, setSnapshot] = useState<PageSnapshot | null>(null);

  function getEnField(key: string): string {
    const value = translations.EN?.[key];
    return typeof value === "string" ? value : "";
  }

  function setEnField(key: string, value: string) {
    setTranslations((prev) => ({ ...prev, EN: { ...(prev.EN ?? {}), [key]: value } }));
  }

  const enBlocks = (translations.EN?.blocks as unknown as Block[] | undefined) ?? [];

  function setEnBlocks(nextBlocks: Block[]) {
    setTranslations((prev) => ({ ...prev, EN: { ...(prev.EN ?? {}), blocks: nextBlocks as unknown as unknown[] } }));
  }

  const load = useCallback(async () => {
    try {
      const page = await pagesApi.getPage(pageId);
      const loadedBlocks = page.blocks as unknown as Block[];
      setTitle(page.title);
      setSlug(page.slug);
      setStatus(page.status);
      setSeoTitle(page.seoTitle ?? "");
      setSeoDescription(page.seoDescription ?? "");
      setBlocks(loadedBlocks);
      setOgTitle(page.ogTitle ?? "");
      setOgImageUrl(page.ogImageUrl ?? "");
      setCanonicalUrl(page.canonicalUrl ?? "");
      setNoIndex(page.noIndex);
      setTranslations(page.translations ?? {});
      setViewCount(page.viewCount);
      setSnapshot({
        title: page.title,
        slug: page.slug,
        status: page.status,
        seoTitle: page.seoTitle ?? "",
        seoDescription: page.seoDescription ?? "",
        blocks: loadedBlocks,
        ogTitle: page.ogTitle ?? "",
        ogImageUrl: page.ogImageUrl ?? "",
        canonicalUrl: page.canonicalUrl ?? "",
        noIndex: page.noIndex,
        translations: JSON.stringify(page.translations ?? {}),
      });
      setLoaded(true);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, [pageId]);

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
      status !== snapshot.status ||
      seoTitle !== snapshot.seoTitle ||
      seoDescription !== snapshot.seoDescription ||
      JSON.stringify(blocks) !== JSON.stringify(snapshot.blocks) ||
      ogTitle !== snapshot.ogTitle ||
      ogImageUrl !== snapshot.ogImageUrl ||
      canonicalUrl !== snapshot.canonicalUrl ||
      noIndex !== snapshot.noIndex ||
      JSON.stringify(translations) !== snapshot.translations
    );
  }, [
    title,
    slug,
    status,
    seoTitle,
    seoDescription,
    blocks,
    ogTitle,
    ogImageUrl,
    canonicalUrl,
    noIndex,
    translations,
    snapshot,
  ]);

  function addBlock(type: BlockType) {
    if (locale === "TR") {
      setBlocks((prev) => [...prev, createBlock(type)]);
    } else {
      setEnBlocks([...enBlocks, createBlock(type)]);
    }
  }

  async function handleSave() {
    setSaveError(null);
    setSaving(true);
    try {
      await pagesApi.updatePage(pageId, {
        title,
        slug,
        status,
        seoTitle: seoTitle || null,
        seoDescription: seoDescription || null,
        blocks: blocks as unknown as Record<string, unknown>[],
        ogTitle: ogTitle || null,
        ogImageUrl: ogImageUrl || null,
        canonicalUrl: canonicalUrl || null,
        noIndex,
        translations,
      });
      toast.success("Sayfa kaydedildi.");
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
      await pagesApi.deletePage(pageId);
      toast.success("Sayfa silindi.");
      router.push("/admin/pages");
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
    <div className="space-y-6 pb-24">
      <div>
        <Link
          href="/admin/pages"
          className="inline-flex items-center gap-1 text-sm text-foreground/60 transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Sayfalar
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Sayfa Düzenleyici</h1>
            <p className="mt-1 text-sm text-foreground/60">{viewCount.toLocaleString("tr-TR")} görüntülenme</p>
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

          <Card className="min-w-0 space-y-4">
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

            <Field id="status" label="Durum">
              {(inputProps) => (
                <Select {...inputProps} value={status} onChange={(e) => setStatus(e.target.value as ContentStatus)}>
                  <option value="DRAFT">Taslak</option>
                  <option value="PUBLISHED">Yayında</option>
                </Select>
              )}
            </Field>
          </Card>

          <div>
            <h2 className="text-base font-semibold text-foreground">
              İçerik blokları {locale === "EN" && <span className="text-foreground/40">(EN)</span>}
            </h2>
            <p className="mt-1 text-sm text-foreground/60">Sayfaya blok ekleyin ve sırasını düzenleyin.</p>
            <div className="mt-4">
              <BlockList onAdd={addBlock} />
            </div>
            <div className="mt-4">
              {locale === "TR" ? (
                <BuilderCanvas blocks={blocks} onChange={setBlocks} />
              ) : (
                <BuilderCanvas blocks={enBlocks} onChange={setEnBlocks} />
              )}
            </div>
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
                  description={seoDescription}
                  slug={slug}
                  imageUrl={ogImageUrl}
                />
              </motion.div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="revisions" className="mt-6 outline-none">
          <RevisionHistory
            entityLabel="Sayfa"
            loadRevisions={(cursor) => revisionsApi.listPageRevisions(pageId, cursor)}
            onRestore={async (revisionId) => {
              await revisionsApi.restorePageRevision(pageId, revisionId);
              await load();
            }}
          />
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
        title="Sayfayı sil"
        description="Bu sayfayı silmek istediğinize emin misiniz? Bu işlem geri alınamaz."
        confirmText="Sil"
        destructive
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
