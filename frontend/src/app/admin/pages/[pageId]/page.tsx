"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as pagesApi from "@/lib/api/pages";
import * as revisionsApi from "@/lib/api/revisions";
import * as localesApi from "@/lib/api/locales";
import type { ContentStatus, ContentTranslations, Locale as LocaleDto } from "@/lib/api/types";
import { MAX_CONTAINER_DEPTH, MAX_TOTAL_PAGE_NODES, type BuilderContainerId, type ContainerNode, type PageNode } from "@/lib/page-builder/types";
import { normalizePageNodes } from "@/lib/page-builder/normalize";
import {
  containerDepth,
  countNodes,
  findNode,
  getContainerChildren,
  insertNode,
  isContainerAtCapacity,
  subtreeDepth,
  toContainerId,
  updateContainerSettings,
} from "@/lib/page-builder/containers";
import { createContainerFromPreset, type LayoutPreset } from "@/lib/page-builder/presets";
import { useAutosave } from "@/hooks/use-autosave";
import { useAuth } from "@/context/auth-context";
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
import { BlockList } from "@/components/admin/page-builder/block-list";
import { BuilderCanvas } from "@/components/admin/page-builder/builder-canvas";
import { ContainerSettingsPanel } from "@/components/admin/page-builder/container-settings-panel";
import { SeoPreview } from "@/components/admin/seo-preview";
import { RevisionHistory } from "@/components/admin/revision-history";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import {
  getTranslatedField,
  setTranslatedField,
  computeLocaleStatus,
  localeStatusDetail,
  isFallbackField,
} from "@/lib/i18n/translation-helpers";
import { AlertCircle, AlertTriangle, ChevronLeft, FileText, Scale, Search, History as HistoryIcon } from "lucide-react";
import { motion } from "framer-motion";

/** SEO sekmesindeki alan-bazlı çeviri durumunun hesaplandığı alan kümesi (§2.3). `blocks` İçerik
 *  sekmesinde ayrıca kontrol edilir — TR "kaynak dil" olduğu için bu liste yalnızca override alanlarıdır. */
const TRANSLATABLE_FIELD_KEYS = ["title", "blocks", "seoTitle", "seoDescription", "ogTitle", "canonicalUrl"];

interface PageSnapshot {
  title: string;
  slug: string;
  status: ContentStatus;
  scheduledAt: string;
  seoTitle: string;
  seoDescription: string;
  blocks: PageNode[];
  ogTitle: string;
  ogImageUrl: string;
  canonicalUrl: string;
  noIndex: boolean;
  isLegalDocument: boolean;
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

export default function PageBuilderPage({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = use(params);
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [locales, setLocales] = useState<LocaleDto[]>([]);
  const [locale, setLocale] = useState<string>("");

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [status, setStatus] = useState<ContentStatus>("DRAFT");
  const [scheduledAt, setScheduledAt] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [blocks, setBlocks] = useState<PageNode[]>([]);
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(null);
  const [ogTitle, setOgTitle] = useState("");
  const [ogImageUrl, setOgImageUrl] = useState("");
  const [canonicalUrl, setCanonicalUrl] = useState("");
  const [noIndex, setNoIndex] = useState(false);
  const [isLegalDocument, setIsLegalDocument] = useState(false);
  const [translations, setTranslations] = useState<ContentTranslations>({});
  const [savedTranslations, setSavedTranslations] = useState<ContentTranslations>({});
  const [viewCount, setViewCount] = useState(0);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<PageSnapshot | null>(null);
  // Metin bloklarındaki PostEditor (TipTap) içeriği yalnızca ilk mount'ta okur (uncontrolled).
  // `load()` her çalıştığında (ilk yükleme, versiyon restore) bu sayaç artırılır ve
  // BuilderCanvas'ın `key`'ine dahil edilerek tüm blok editörleri TAM REMOUNT edilir —
  // böylece restore sonrası editör state'i her zaman güncel blok verisiyle senkron kalır.
  const [editorGeneration, setEditorGeneration] = useState(0);

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
        // Dil listesi çekilemezse editör tek-dilli (varsayılan) davranışa düşer — çökmez.
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

  const enBlocks = useMemo(() => normalizePageNodes(translations[locale]?.blocks ?? []), [translations, locale]);

  function setEnBlocks(nextBlocks: PageNode[]) {
    setTranslations((prev) => ({ ...prev, [locale]: { ...(prev[locale] ?? {}), blocks: nextBlocks as unknown as unknown[] } }));
  }

  const activeNodes = isDefaultLocale ? blocks : enBlocks;
  const setActiveNodes = isDefaultLocale ? setBlocks : setEnBlocks;
  const selectedContainer = selectedContainerId
    ? ((findNode(activeNodes, selectedContainerId) as ContainerNode | null) ?? null)
    : null;
  const selectedContainerDepth = selectedContainer ? containerDepth(activeNodes, selectedContainer.id) : 0;
  const targetLabel = selectedContainer ? `Konteyner (Seviye ${selectedContainerDepth})` : "Sayfa (kök)";
  const layoutPickerDisabled = selectedContainer !== null && selectedContainerDepth >= MAX_CONTAINER_DEPTH;

  /** Yeni bir düğümü (içerik bloğu veya Layout Picker ön ayarı) seçili konteynere (yoksa köke)
   *  ekler — `MAX_TOTAL_PAGE_NODES`, `MAX_CHILDREN_PER_CONTAINER` (kök HARİÇ, bkz. types.ts) ve
   *  `MAX_CONTAINER_DEPTH` sınırlarını burada, EKLEME ANINDA önleyici olarak uygular. */
  function addNodeToTarget(node: PageNode) {
    if (countNodes(activeNodes) >= MAX_TOTAL_PAGE_NODES) return;
    const targetContainerId: BuilderContainerId = selectedContainer ? toContainerId(selectedContainer.id) : "root";
    if (selectedContainer) {
      if (isContainerAtCapacity(activeNodes, targetContainerId)) return;
      if (selectedContainerDepth + subtreeDepth(node) > MAX_CONTAINER_DEPTH) return;
    }
    const children = getContainerChildren(activeNodes, targetContainerId);
    setActiveNodes(insertNode(activeNodes, targetContainerId, children.length, node));
  }

  function addLayoutPreset(preset: LayoutPreset) {
    addNodeToTarget(createContainerFromPreset(preset));
  }

  const load = useCallback(async () => {
    try {
      const page = await pagesApi.getPage(pageId);
      const loadedBlocks = normalizePageNodes(page.blocks);
      setTitle(page.title);
      setSlug(page.slug);
      setStatus(page.status);
      setScheduledAt(toDatetimeLocalValue(page.scheduledAt));
      setSeoTitle(page.seoTitle ?? "");
      setSeoDescription(page.seoDescription ?? "");
      setBlocks(loadedBlocks);
      setOgTitle(page.ogTitle ?? "");
      setOgImageUrl(page.ogImageUrl ?? "");
      setCanonicalUrl(page.canonicalUrl ?? "");
      setNoIndex(page.noIndex);
      setIsLegalDocument(page.isLegalDocument);
      setTranslations(page.translations ?? {});
      setSavedTranslations(page.translations ?? {});
      setViewCount(page.viewCount);
      setPublishedAt(page.publishedAt);
      setEditorGeneration((prev) => prev + 1);
      setSelectedContainerId(null);
      setSnapshot({
        title: page.title,
        slug: page.slug,
        status: page.status,
        scheduledAt: toDatetimeLocalValue(page.scheduledAt),
        seoTitle: page.seoTitle ?? "",
        seoDescription: page.seoDescription ?? "",
        blocks: loadedBlocks,
        ogTitle: page.ogTitle ?? "",
        ogImageUrl: page.ogImageUrl ?? "",
        canonicalUrl: page.canonicalUrl ?? "",
        noIndex: page.noIndex,
        isLegalDocument: page.isLegalDocument,
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
      scheduledAt !== snapshot.scheduledAt ||
      seoTitle !== snapshot.seoTitle ||
      seoDescription !== snapshot.seoDescription ||
      JSON.stringify(blocks) !== JSON.stringify(snapshot.blocks) ||
      ogTitle !== snapshot.ogTitle ||
      ogImageUrl !== snapshot.ogImageUrl ||
      canonicalUrl !== snapshot.canonicalUrl ||
      noIndex !== snapshot.noIndex ||
      isLegalDocument !== snapshot.isLegalDocument ||
      JSON.stringify(translations) !== snapshot.translations
    );
  }, [
    title,
    slug,
    status,
    scheduledAt,
    seoTitle,
    seoDescription,
    blocks,
    ogTitle,
    ogImageUrl,
    canonicalUrl,
    noIndex,
    isLegalDocument,
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
  // Yalnızca varsayılan dil içeriği + yalnızca yüklendikten sonra aktif (çeviri sekmeleri bu turun kapsamı dışında).
  const { status: autosaveStatus, lastSavedAt: autosaveSavedAt } = useAutosave({
    values: [title, blocks],
    enabled: loaded && isDefaultLocale,
    save: () => pagesApi.autosavePage(pageId, { title, blocks }),
  });

  async function handleSave() {
    setSaveError(null);
    setSaving(true);
    try {
      await pagesApi.updatePage(pageId, {
        title,
        slug,
        status,
        scheduledAt: status === "SCHEDULED" ? new Date(scheduledAt).toISOString() : null,
        seoTitle: seoTitle || null,
        seoDescription: seoDescription || null,
        blocks: blocks as unknown as Record<string, unknown>[],
        ogTitle: ogTitle || null,
        ogImageUrl: ogImageUrl || null,
        canonicalUrl: canonicalUrl || null,
        noIndex,
        // §5.1 — yalnızca ADMIN gönderebilir (EDITOR → 403); EDITOR oturumunda alan HİÇ eklenmez.
        ...(isAdmin ? { isLegalDocument } : {}),
        translations,
      });
      toast.success("Sayfa kaydedildi.");
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
            <h1 className="admin-h1">Sayfa Düzenleyici</h1>
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

          <Card className="min-w-0 space-y-4">
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

            <div className="grid gap-4 sm:grid-cols-2">
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

            {isAdmin && (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Scale className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-foreground">Hukuki belge</p>
                    <p className="text-xs text-foreground/60">
                      Gizlilik politikası, KVKK aydınlatma metni, kullanım koşulları vb. — işaretlenirse
                      çevrilmemiş dillerde bu sayfanın gövdesi sessizce varsayılan dile DÜŞMEZ; bunun yerine
                      ziyaretçiye açık bir bildirim + varsayılan dildeki sürüme bağlantı gösterilir (KVKK m.10 /
                      GDPR m.12). Bu bir görsel etiket DEĞİL, çeviri davranışını değiştiren bir anahtardır.
                    </p>
                  </div>
                </div>
                <Switch checked={isLegalDocument} onCheckedChange={setIsLegalDocument} />
              </div>
            )}
          </Card>

          <div>
            <h2 className="admin-h2">
              İçerik blokları {!isDefaultLocale && <span className="text-foreground/40">({locale.toUpperCase()})</span>}
            </h2>
            <p className="mt-1 admin-text-secondary">Sayfaya blok/düzen ekleyin ve sırasını düzenleyin.</p>
            <div className="mt-4">
              <BlockList
                onAddLayout={addLayoutPreset}
                targetLabel={targetLabel}
                layoutDisabled={layoutPickerDisabled}
                layoutDisabledReason={layoutPickerDisabled ? "Maksimum iç içe geçme derinliğine ulaşıldı (4)" : undefined}
              />
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
              <div className="min-w-0">
                <BuilderCanvas
                  key={`${isDefaultLocale ? "default" : locale}-${editorGeneration}`}
                  nodes={activeNodes}
                  onChange={setActiveNodes}
                  selectedContainerId={selectedContainer?.id ?? null}
                  onSelectContainer={setSelectedContainerId}
                />
              </div>
              {selectedContainer && (
                <div className="lg:sticky lg:top-6 lg:self-start">
                  <ContainerSettingsPanel
                    container={selectedContainer}
                    depth={selectedContainerDepth}
                    onChange={(patch) => setActiveNodes(updateContainerSettings(activeNodes, selectedContainer.id, patch))}
                    onClose={() => setSelectedContainerId(null)}
                  />
                </div>
              )}
            </div>
          </div>
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
                  {(inputProps) => {
                    const fallback = !isDefaultLocale && isFallbackField(translations, locale, "seoTitle", seoTitle);
                    return (
                      <>
                        {fallback && defaultLocale && (
                          <div className="mb-1 flex justify-end">
                            <LocaleFallbackBadge defaultLabel={defaultLocale.nativeLabel} />
                          </div>
                        )}
                        <Input
                          {...inputProps}
                          className={fallback ? FALLBACK_FIELD_CLASSES : undefined}
                          placeholder={fallback ? seoTitle : undefined}
                          value={isDefaultLocale ? seoTitle : getEnField("seoTitle")}
                          onChange={(e) =>
                            isDefaultLocale ? setSeoTitle(e.target.value) : setEnField("seoTitle", e.target.value)
                          }
                        />
                      </>
                    );
                  }}
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
                      onChange={(e) =>
                        isDefaultLocale ? setOgTitle(e.target.value) : setEnField("ogTitle", e.target.value)
                      }
                    />
                  )}
                </Field>
                {isDefaultLocale && (
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
