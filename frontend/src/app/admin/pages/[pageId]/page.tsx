"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import * as pagesApi from "@/lib/api/pages";
import * as revisionsApi from "@/lib/api/revisions";
import * as localesApi from "@/lib/api/locales";
import type { ContentStatus, ContentTranslations, Locale as LocaleDto, PageEditMode } from "@/lib/api/types";
import type { ContainerNode, PageNode } from "@/lib/page-builder/types";
import { normalizePageNodes } from "@/lib/page-builder/normalize";
import { containerDepth, findNode, updateContainerSettings, wrapBareRootBlocks } from "@/lib/page-builder/containers";
import { useAutosave } from "@/hooks/use-autosave";
import { useAuth } from "@/context/auth-context";
import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { LocaleTabs } from "@/components/admin/locale-tabs";
import { LocaleFallbackBadge, FALLBACK_FIELD_CLASSES } from "@/components/admin/locale-fallback-badge";
import { BuilderCanvas } from "@/components/admin/page-builder/builder-canvas";
import { ContainerSettingsPanel } from "@/components/admin/page-builder/container-settings-panel";
import { TemplateEditorView } from "@/components/admin/page-builder/template-editor-view";
import { SeoPreview } from "@/components/admin/seo-preview";
import { RevisionHistory } from "@/components/admin/revision-history";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import {
  getTranslatedField,
  setTranslatedField,
  computeLocaleStatus,
  localeStatusDetail,
  isFallbackField,
} from "@/lib/i18n/translation-helpers";
import {
  AlertCircle,
  AlertTriangle,
  ChevronLeft,
  ExternalLink,
  FileText,
  LockKeyhole,
  Scale,
  Search,
  History as HistoryIcon,
} from "lucide-react";
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
  // §10.20 — architect-scope §6.4 madde 3 formülü BİREBİR.
  const canUseAdvancedBuilder = user?.canUseAdvancedBuilder ?? false;

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
  const [editMode, setEditMode] = useState<PageEditMode>("FREEFORM");
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

  // §10.20/§4.2 — aynı gerekçe `load()`'daki `isSimpleModePage` ile birebir: standart kullanıcı
  // (TEMPLATE sayfa, canUseAdvancedBuilder: false) kök yapıyı hiç DEĞİŞTİREMEDİĞİ için, çeviri
  // blokları da sarma işleminden geçmemeli — aksi halde `translations.<locale>.blocks` üzerindeki
  // yapısal diff guard'ı sarmayı "yapısal değişiklik" sayıp 403 döndürür.
  const enBlocks = useMemo(
    () =>
      editMode === "TEMPLATE" && !canUseAdvancedBuilder
        ? normalizePageNodes(translations[locale]?.blocks ?? [])
        : wrapBareRootBlocks(normalizePageNodes(translations[locale]?.blocks ?? [])),
    [translations, locale, editMode, canUseAdvancedBuilder]
  );

  function setEnBlocks(nextBlocks: PageNode[]) {
    setTranslations((prev) => ({ ...prev, [locale]: { ...(prev[locale] ?? {}), blocks: nextBlocks as unknown as unknown[] } }));
  }

  const activeNodes = isDefaultLocale ? blocks : enBlocks;
  const setActiveNodes = isDefaultLocale ? setBlocks : setEnBlocks;
  // design-notes-page-builder-standard-mode.md §2.1 — `BuilderCanvas` bu durumda HİÇ mount edilmez.
  const simpleMode = editMode === "TEMPLATE" && !canUseAdvancedBuilder;
  const selectedContainer = selectedContainerId
    ? ((findNode(activeNodes, selectedContainerId) as ContainerNode | null) ?? null)
    : null;
  const selectedContainerDepth = selectedContainer ? containerDepth(activeNodes, selectedContainer.id) : 0;

  const load = useCallback(async () => {
    try {
      const page = await pagesApi.getPage(pageId);
      // Editör-seviyesi otomatik göç (§3 kullanıcı isteği) — kökte "çıplak" (bir konteynerin
      // DIŞINDaki) düz bloklar varsa, editör açılırken KENDİ tek-sütunlu konteynerlerine sarılır.
      // Yalnızca admin görünümü içindir; `snapshot.blocks` de AYNI sarılmış değeri kullanır (bkz.
      // aşağısı), bu yüzden sayfayı SADECE açmak "Kaydedilmemiş değişiklik" bildirimini TETİKLEMEZ
      // — göç, admin başka bir şeyi kaydettiğinde sessizce kalıcı olur.
      // §10.20/§4.2 — standart kullanıcı (TEMPLATE sayfa, canUseAdvancedBuilder: false) için bu
      // sarma İSTEMCİ TARAFINDA "yapısal değişiklik" üretir: kayıtlı kökler henüz bir container'a
      // sarılı DEĞİLSE (örn. sayfa hiç gelişmiş kullanıcının "Kaydet"iyle "primed" edilmemişse),
      // sarma sonrası ağaç backend'in yapısal diff guard'ına (`assertTemplateEditAllowed`) göre
      // kayıtlıdan FARKLI sayılır ve 403 döner — standart kullanıcı zaten kök seviyesinde yapı
      // DEĞİŞTİREMEDİĞİ için sarmanın ona hiçbir faydası yok. `editMode`/`canUseAdvancedBuilder`
      // state'i bu satırda HENÜZ güncellenmediğinden (`simpleMode` bir önceki render'a ait), taze
      // yüklenen `page.editMode` doğrudan kullanılır.
      const isSimpleModePage = page.editMode === "TEMPLATE" && !canUseAdvancedBuilder;
      const loadedBlocks = isSimpleModePage
        ? normalizePageNodes(page.blocks)
        : wrapBareRootBlocks(normalizePageNodes(page.blocks));
      setTitle(page.title);
      setSlug(page.slug);
      setEditMode(page.editMode);
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
  }, [pageId, canUseAdvancedBuilder]);

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
        // §10.20/§4.2 — `slug` yalnızca gelişmiş kullanıcı için gönderilir; standart kullanıcı
        // (TEMPLATE sayfa, canUseAdvancedBuilder: false) bu alanı hiç DEĞİŞTİRMEDEN dahi gövdeye
        // eklerse backend `assertAdvancedFieldsAuthorized` VARLIK bazlı 403 döner (bkz. `isLegalDocument`
        // ile AYNI koşullu-alan deseni).
        ...(!simpleMode ? { slug } : {}),
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

  /** Üst araç çubuğundaki "Taslak Olarak Kaydet" — mevcut `updatePage` çağrısını `status: "DRAFT"`
   *  ile tetikler, YENİ bir backend endpoint'i gerektirmez. `status === "DRAFT"` iken çağrılabilir
   *  DEĞİL (buton disabled), bu yüzden burada ek koruma gerekmiyor. */
  async function handleSaveAsDraft() {
    setSaveError(null);
    setSaving(true);
    try {
      await pagesApi.updatePage(pageId, {
        title,
        status: "DRAFT",
        scheduledAt: null,
        seoTitle: seoTitle || null,
        seoDescription: seoDescription || null,
        blocks: blocks as unknown as Record<string, unknown>[],
        ogTitle: ogTitle || null,
        ogImageUrl: ogImageUrl || null,
        canonicalUrl: canonicalUrl || null,
        noIndex,
        ...(isAdmin ? { isLegalDocument } : {}),
        // §10.20/§4.2 — bkz. `handleSave` içindeki AYNI koşullu-alan yorumu.
        ...(!simpleMode ? { slug } : {}),
        translations,
      });
      toast.success("Sayfa taslak olarak kaydedildi.");
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

  // Ctrl+S / Cmd+S → handleSave() — tarayıcının varsayılan "Sayfayı Kaydet" iletişim kutusunu
  // engeller (preventDefault). Salt davranışsal bir kısayol, görsel bir karar içermez.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        handleSave();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, slug, status, scheduledAt, seoTitle, seoDescription, blocks, ogTitle, ogImageUrl, canonicalUrl, noIndex, isLegalDocument, translations]);

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
    <div className="space-y-6 pb-6">
      <div>
        <Link
          href="/admin/pages"
          className="inline-flex items-center gap-1 text-sm text-foreground/60 transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Sayfalar
        </Link>
      </div>

      {/* design-notes-page-builder-sticky-panel-and-toolbar.md §2.1 — `top-14` (56px), üstteki
          `AdminTopbar`in `sticky top-0 z-10` yüksekliğine göre hizalanmış, çakışmayı önler. */}
      <div className="sticky top-14 z-20 border-b border-border bg-surface/95 py-3 backdrop-blur">
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
            {/* design-notes-page-builder-standard-mode.md §4.1 — YALNIZCA gelişmiş kullanıcı görür
                (standart kullanıcı zaten TemplateEditorView'da, bu bağlam onun için gereksiz). */}
            {editMode === "TEMPLATE" && canUseAdvancedBuilder && (
              <Tooltip>
                <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>
                  <Badge tone="warning">
                    <LockKeyhole className="mr-1 h-3 w-3" />
                    Şablon Modu
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  Yapısal değişiklikleriniz (konteyner, düzen, stil) bu sayfayı düzenleyen standart
                  kullanıcıların formunu ETKİLER. Standart kullanıcılar yalnızca içerik alanlarını görür.
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
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

            {/* §4.1 — DELETE ucu artık `requireAdvancedBuilder` gerektiriyor; standart kullanıcıya
                gösterilmez (backend zaten 403 döner, bu yalnızca UI temizliği içindir). */}
            {canUseAdvancedBuilder && (
              <Button variant="ghost" onClick={() => setDeleteDialogOpen(true)}>
                Sil
              </Button>
            )}

            <span className="h-5 w-px bg-border" aria-hidden />

            <Button
              variant="secondary"
              disabled={status === "DRAFT"}
              title={status === "DRAFT" ? "Sayfa zaten taslak" : undefined}
              onClick={handleSaveAsDraft}
            >
              Taslak Olarak Kaydet
            </Button>

            {/* design-notes-page-builder-sticky-panel-and-toolbar.md §2.2 dip not + `appearance/page.tsx`
                satır ~770 — Base UI dokümantasyonu `<Button render={<Link/>}>` desenini a11y açısından
                yanlış kabul ediyor (linkin gerçek `link` rolünü ezer). Proje bu yüzden zaten `Link`i
                doğrudan `buttonVariants()` ile stillendirme kararını almış durumda; aynı konvansiyon
                burada da uygulanıyor (yalnızca AKTİF durumda — disabled halde gerçek bir link
                olmadığından, o dal normal bir `Button` kalıyor). */}
            {status === "PUBLISHED" ? (
              <Link
                href={`/${slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Önizle
              </Link>
            ) : (
              <Button variant="outline" disabled title="Önizlemek için sayfa önce yayınlanmalı">
                <ExternalLink className="h-3.5 w-3.5" />
                Önizle
              </Button>
            )}

            <Button className="relative" loading={saving} onClick={handleSave}>
              {hasUnsavedChanges && (
                <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-primary" aria-hidden />
              )}
              Kaydet
            </Button>
          </div>
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
            <p className="mt-1 admin-text-secondary">
              {simpleMode ? "İçerik alanlarını doldurun — yapı bu şablonda sabittir." : "Sayfaya blok/düzen ekleyin ve sırasını düzenleyin."}
            </p>

            {/* design-notes-page-builder-standard-mode.md §4.2 — YALNIZCA gelişmiş kullanıcı + TEMPLATE
                sayfa kombinasyonunda (aynı koşul, §4.1 rozetiyle tutarlı). */}
            {editMode === "TEMPLATE" && canUseAdvancedBuilder && (
              <Alert variant="warning" className="mt-4">
                <span className="flex items-start gap-2">
                  <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
                  Bu sayfa <strong>şablon modunda</strong>. Buradaki yapısal değişiklikler (konteyner
                  ekleme/silme, düzen, stil, animasyon) bu sayfayı düzenleyen standart kullanıcıların
                  form ekranını etkiler; onlar yalnızca metin/görsel/buton gibi içerik alanlarını görür.
                </span>
              </Alert>
            )}

            <div className="mt-4">
              {simpleMode ? (
                <TemplateEditorView nodes={activeNodes} onChange={setActiveNodes} />
              ) : (
                <>
                  <BuilderCanvas
                    key={`${isDefaultLocale ? "default" : locale}-${editorGeneration}`}
                    nodes={activeNodes}
                    onChange={setActiveNodes}
                    selectedContainerId={selectedContainer?.id ?? null}
                    onSelectContainer={setSelectedContainerId}
                  />

                  <Sheet
                    open={selectedContainer !== null}
                    onOpenChange={(open) => {
                      if (!open) setSelectedContainerId(null);
                    }}
                  >
                    <SheetContent side="right" showCloseButton={false} className="p-0 sm:max-w-[420px]">
                      <SheetHeader className="sr-only">
                        <SheetTitle>Konteyner Ayarları</SheetTitle>
                        <SheetDescription>Seçili konteynerin düzen, boşluk, arka plan ve ayırıcı ayarları.</SheetDescription>
                      </SheetHeader>
                      {selectedContainer && (
                        <ContainerSettingsPanel
                          container={selectedContainer}
                          depth={selectedContainerDepth}
                          onChange={(patch) => setActiveNodes(updateContainerSettings(activeNodes, selectedContainer.id, patch))}
                          onClose={() => setSelectedContainerId(null)}
                        />
                      )}
                    </SheetContent>
                  </Sheet>
                </>
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
            canRestore={canUseAdvancedBuilder}
          />
        </TabsContent>
      </Tabs>

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
