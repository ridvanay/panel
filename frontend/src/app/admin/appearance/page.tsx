"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  AlertCircle,
  AlertTriangle,
  AlignLeft,
  ArrowUpCircle,
  AtSign,
  Briefcase,
  CheckCircle2,
  Code2,
  Cookie,
  ExternalLink,
  EyeOff,
  FileQuestion,
  Image as ImageIcon,
  LayoutTemplate,
  Link2,
  Mail,
  MessageCircle,
  Paintbrush,
  Palette,
  PanelTop,
  Share2,
  ShieldAlert,
  Sparkles,
  ThumbsUp,
  ToggleRight,
  Type,
  Wrench,
} from "lucide-react";
import * as appearanceApi from "@/lib/api/appearance";
import * as settingsApi from "@/lib/api/settings";
import * as pagesApi from "@/lib/api/pages";
import * as navigationApi from "@/lib/api/navigation";
import type {
  AppearancePreset,
  Media,
  NavigationConfigDto,
  PageHeaderStyle,
  SiteAppearance,
  SiteCustomCode,
  SiteFont,
  SiteSettings,
  SitePage,
  SocialShareNetwork,
  UpdateSiteAppearanceRequest,
} from "@/lib/api/types";
import { PageHeading } from "@/components/admin/page-heading";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Accordion, AccordionItem, AccordionTrigger, AccordionPanel } from "@/components/ui/accordion";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MediaSelectField } from "@/components/admin/media/media-select-field";
import { ColorField } from "@/components/admin/appearance/color-field";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { fieldErrorsFrom, friendlyErrorMessage } from "@/lib/api/friendly-error";
import { getFooterLogoHeight } from "@/lib/site-settings/logo";
import { SITE_FONT_OPTIONS } from "@/lib/site-settings/appearance";
import { SITE_FONT_FAMILY, SITE_FONT_VARIABLES } from "@/lib/site-settings/site-fonts";
import { cn } from "@/lib/utils";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";

/** design-notes-appearance-panel.md §0 — 9 sekme, sıra `SiteAppearance` şemasındaki bölümlerle birebir. */
const TAB_ITEMS: { value: string; label: string; icon: typeof Palette }[] = [
  { value: "brand", label: "Logo & Marka", icon: Palette },
  { value: "presets", label: "Tasarım Ön Ayarları", icon: Sparkles },
  { value: "pageHeader", label: "Sayfa Başlığı Düzeni", icon: LayoutTemplate },
  { value: "colors", label: "Stil / Renk", icon: Paintbrush },
  { value: "social", label: "Sosyal Medya Paylaşımı", icon: Share2 },
  { value: "typography", label: "Yazı Tipi", icon: Type },
  { value: "features", label: "Ekstra Özellikler", icon: ToggleRight },
  { value: "customCode", label: "Özel CSS / JS", icon: Code2 },
  { value: "notFound", label: "404 Sayfası", icon: FileQuestion },
];

const PAGE_HEADER_STYLE_OPTIONS: { value: PageHeaderStyle; label: string; description: string; icon: typeof ImageIcon }[] = [
  { value: "BANNER", label: "Banner", description: "Arka planı olan geniş başlık bloğu", icon: ImageIcon },
  { value: "PLAIN", label: "Sade", description: "Düz metin başlık (varsayılan)", icon: AlignLeft },
  { value: "HIDDEN", label: "Gizli", description: "Başlık bloğu hiç gösterilmez", icon: EyeOff },
];

const SOCIAL_SHARE_OPTIONS: { value: SocialShareNetwork; label: string; icon: typeof AtSign }[] = [
  { value: "TWITTER", label: "Twitter / X", icon: AtSign },
  { value: "FACEBOOK", label: "Facebook", icon: ThumbsUp },
  { value: "LINKEDIN", label: "LinkedIn", icon: Briefcase },
  { value: "WHATSAPP", label: "WhatsApp", icon: MessageCircle },
  { value: "EMAIL", label: "E-posta", icon: Mail },
  { value: "COPY_LINK", label: "Linki Kopyala", icon: Link2 },
];

const COOKIE_BANNER_TEXT_PLACEHOLDER =
  "Bu site deneyiminizi iyileştirmek için çerezler kullanır. Sitede gezinmeye devam ederek çerez kullanımını kabul etmiş olursunuz.";
const COOKIE_BANNER_HREF_PLACEHOLDER = "/gizlilik-politikasi";
const MAINTENANCE_MESSAGE_PLACEHOLDER = "Sitemizde bakım çalışması yapıyoruz. Kısa süre içinde geri döneceğiz.";

interface AppearanceFormState {
  presetKey: string | null;
  pageHeaderStyle: PageHeaderStyle;
  pageHeaderBackgroundColor: string;
  pageHeaderBackgroundMediaId: string | null;
  pageHeaderOverlayOpacity: number;
  primaryColor: string;
  secondaryColor: string;
  buttonColor: string;
  buttonTextColor: string;
  linkColor: string;
  headingFont: SiteFont;
  bodyFont: SiteFont;
  baseFontSize: number;
  socialShareEnabled: boolean;
  socialShareNetworks: SocialShareNetwork[];
  backToTopEnabled: boolean;
  stickyHeaderEnabled: boolean;
  cookieBannerEnabled: boolean;
  cookieBannerText: string;
  cookieBannerPolicyHref: string;
  maintenanceModeEnabled: boolean;
  maintenanceMessage: string;
  notFoundTitle: string;
  notFoundMessage: string;
  notFoundButtonLabel: string;
  notFoundButtonHref: string;
}

function formFromDto(dto: SiteAppearance): AppearanceFormState {
  return {
    presetKey: dto.presetKey,
    pageHeaderStyle: dto.pageHeaderStyle,
    pageHeaderBackgroundColor: dto.pageHeaderBackgroundColor ?? "#ffffff",
    pageHeaderBackgroundMediaId: dto.pageHeaderBackgroundMediaId,
    pageHeaderOverlayOpacity: dto.pageHeaderOverlayOpacity,
    primaryColor: dto.primaryColor,
    secondaryColor: dto.secondaryColor,
    buttonColor: dto.buttonColor,
    buttonTextColor: dto.buttonTextColor,
    linkColor: dto.linkColor,
    headingFont: dto.headingFont,
    bodyFont: dto.bodyFont,
    baseFontSize: dto.baseFontSize,
    socialShareEnabled: dto.socialShareEnabled,
    socialShareNetworks: dto.socialShareNetworks,
    backToTopEnabled: dto.backToTopEnabled,
    stickyHeaderEnabled: dto.stickyHeaderEnabled,
    cookieBannerEnabled: dto.cookieBannerEnabled,
    cookieBannerText: dto.cookieBannerText ?? "",
    cookieBannerPolicyHref: dto.cookieBannerPolicyHref ?? "",
    maintenanceModeEnabled: dto.maintenanceModeEnabled,
    maintenanceMessage: dto.maintenanceMessage ?? "",
    notFoundTitle: dto.notFoundTitle ?? "",
    notFoundMessage: dto.notFoundMessage ?? "",
    notFoundButtonLabel: dto.notFoundButtonLabel ?? "",
    notFoundButtonHref: dto.notFoundButtonHref ?? "",
  };
}

/** Boş metin `null`'a çevrilir (§10.12.7 ile tutarlı — "kod kaldırmak/alan temizlemek güvenlidir" deseni). */
const NULLABLE_TEXT_FIELDS = new Set<keyof AppearanceFormState>([
  "cookieBannerText",
  "cookieBannerPolicyHref",
  "maintenanceMessage",
  "notFoundTitle",
  "notFoundMessage",
  "notFoundButtonLabel",
  "notFoundButtonHref",
]);

function toRequestValue(key: keyof AppearanceFormState, value: unknown): unknown {
  if (NULLABLE_TEXT_FIELDS.has(key)) {
    const trimmed = String(value).trim();
    return trimmed || null;
  }
  return value;
}

const COLOR_FIELDS = ["primaryColor", "secondaryColor", "buttonColor", "buttonTextColor", "linkColor"] as const;
const TYPOGRAPHY_FIELDS = ["headingFont", "bodyFont", "baseFontSize"] as const;

/** §10.12.9 — Panelin 9 sekmesinden 8'i (`brand` dahil, salt-okunur olduğu için hiç dirty olmaz;
 * `customCode` HARİÇ) `PATCH /admin/appearance`'a gider. `colors`/`typography` bölümleri
 * `presetKey`'i de gönderir — §10.12.3 "elle değişiklik → presetKey: null" kararının kalıcı
 * olması için (yalnızca `presets` sekmesinden kaydedilseydi bu kural diğer iki sekmeden
 * kaydedildiğinde kaybolurdu). */
const SECTION_FIELDS = {
  presets: ["presetKey", ...COLOR_FIELDS, ...TYPOGRAPHY_FIELDS],
  pageHeader: ["pageHeaderStyle", "pageHeaderBackgroundColor", "pageHeaderBackgroundMediaId", "pageHeaderOverlayOpacity"],
  colors: ["presetKey", ...COLOR_FIELDS],
  social: ["socialShareEnabled", "socialShareNetworks"],
  typography: ["presetKey", ...TYPOGRAPHY_FIELDS],
  features: [
    "backToTopEnabled",
    "stickyHeaderEnabled",
    "cookieBannerEnabled",
    "cookieBannerText",
    "cookieBannerPolicyHref",
    "maintenanceModeEnabled",
    "maintenanceMessage",
  ],
  notFound: ["notFoundTitle", "notFoundMessage", "notFoundButtonLabel", "notFoundButtonHref"],
} satisfies Record<string, (keyof AppearanceFormState)[]>;

type SectionKey = keyof typeof SECTION_FIELDS;
const SECTION_KEYS = Object.keys(SECTION_FIELDS) as SectionKey[];

function buildSectionPayload(form: AppearanceFormState, section: SectionKey): UpdateSiteAppearanceRequest {
  const payload: Record<string, unknown> = {};
  for (const key of SECTION_FIELDS[section]) {
    payload[key] = toRequestValue(key, form[key]);
  }
  // `SECTION_FIELDS`'in her girişi `UpdateSiteAppearanceRequest`'in bilinen bir alt kümesidir —
  // dinamik anahtar ataması TypeScript'in statik obje-şekli kontrolüyle ifade edilemediği için
  // burada tek bir kontrollü `as` kullanılıyor (backend zaten `.strict()` ile bilinmeyen alanı reddeder).
  return payload as UpdateSiteAppearanceRequest;
}

function buildFullPayload(form: AppearanceFormState): UpdateSiteAppearanceRequest {
  const keys = new Set<keyof AppearanceFormState>();
  for (const section of SECTION_KEYS) {
    for (const key of SECTION_FIELDS[section]) keys.add(key);
  }
  const payload: Record<string, unknown> = {};
  for (const key of keys) payload[key] = toRequestValue(key, form[key]);
  return payload as UpdateSiteAppearanceRequest;
}

function fieldsEqual(a: AppearanceFormState, b: AppearanceFormState, keys: readonly (keyof AppearanceFormState)[]): boolean {
  return keys.every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]));
}

function SectionHeader({ icon: Icon, title, description }: { icon: typeof Palette; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <h2 className="admin-h2">{title}</h2>
        <p className="mt-0.5 admin-text-secondary">{description}</p>
      </div>
    </div>
  );
}

function DirtyDot() {
  return <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />;
}

function SectionSaveButton({ dirty, saving, onClick }: { dirty: boolean; saving: boolean; onClick: () => void }) {
  return (
    <div className="flex justify-end">
      <Button type="button" size="sm" variant={dirty ? "default" : "secondary"} loading={saving} onClick={onClick}>
        Bu bölümü kaydet
      </Button>
    </div>
  );
}

function PreviewPageHeaderBanner({
  backgroundColor,
  backgroundUrl,
  overlayOpacity,
}: {
  backgroundColor: string;
  backgroundUrl: string | null;
  overlayOpacity: number;
}) {
  return (
    <div
      className="relative flex h-16 w-full items-center justify-center overflow-hidden rounded-md"
      style={{
        backgroundColor,
        backgroundImage: backgroundUrl ? `url(${backgroundUrl})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="absolute inset-0 bg-black" style={{ opacity: overlayOpacity / 100 }} aria-hidden="true" />
      <span className="relative text-xs font-medium text-white">Örnek Sayfa Başlığı</span>
    </div>
  );
}

export default function AdminAppearancePage() {
  const [activeTab, setActiveTab] = useState("brand");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<AppearanceFormState | null>(null);
  const [snapshot, setSnapshot] = useState<AppearanceFormState | null>(null);
  const [pageHeaderBackgroundMedia, setPageHeaderBackgroundMedia] = useState<Media | null>(null);
  const [presets, setPresets] = useState<AppearancePreset[]>([]);

  const [siteSettings, setSiteSettings] = useState<SiteSettings | null>(null);
  const [navigation, setNavigation] = useState<NavigationConfigDto | null>(null);
  const [publishedPages, setPublishedPages] = useState<SitePage[]>([]);

  const [sectionSaving, setSectionSaving] = useState<SectionKey | "all" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  // --- Özel CSS/JS (ayrı PUT uçları, §10.12.6) ---
  const [customCodeMeta, setCustomCodeMeta] = useState<SiteCustomCode | null>(null);
  const [css, setCss] = useState("");
  const [js, setJs] = useState("");
  const [cssAcknowledged, setCssAcknowledged] = useState(false);
  const [jsAcknowledged, setJsAcknowledged] = useState(false);
  const [cssSaving, setCssSaving] = useState(false);
  const [jsSaving, setJsSaving] = useState(false);
  const [cssError, setCssError] = useState<string | null>(null);
  const [jsError, setJsError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [appearanceDto, presetsList, settings, customCodeDto, navConfig, pages] = await Promise.all([
        appearanceApi.getAdminAppearance(),
        appearanceApi.getPresets(),
        settingsApi.getSettings(),
        appearanceApi.getCustomCode(),
        navigationApi.getNavigationConfig(),
        pagesApi.listPages(),
      ]);

      const formState = formFromDto(appearanceDto);
      setForm(formState);
      setSnapshot(formState);
      // `SiteAppearance` yalnızca id + çözümlenmiş url döner (§10.12.2 tek FK) — `MediaSelectField`
      // görüntüleme için yalnızca `url`/`altText` okur, kalan alanlar bu ekranda kullanılmaz.
      setPageHeaderBackgroundMedia(
        appearanceDto.pageHeaderBackgroundMediaId && appearanceDto.pageHeaderBackgroundUrl
          ? {
              id: appearanceDto.pageHeaderBackgroundMediaId,
              url: appearanceDto.pageHeaderBackgroundUrl,
              altText: null,
              filename: "",
              mimeType: "",
              sizeBytes: 0,
              width: null,
              height: null,
              folderId: null,
              createdAt: "",
            }
          : null
      );
      setPresets(presetsList);
      setSiteSettings(settings);
      setNavigation(navConfig);
      setPublishedPages(pages.items.filter((page) => page.status === "PUBLISHED"));

      setCustomCodeMeta(customCodeDto);
      setCss(customCodeDto.css ?? "");
      setJs(customCodeDto.js ?? "");

      setLoaded(true);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  function isSectionDirty(section: SectionKey): boolean {
    if (!form || !snapshot) return false;
    return !fieldsEqual(form, snapshot, SECTION_FIELDS[section]);
  }

  const anyPatchSectionDirty = useMemo(() => {
    if (!form || !snapshot) return false;
    return SECTION_KEYS.some((key) => !fieldsEqual(form, snapshot, SECTION_FIELDS[key]));
  }, [form, snapshot]);
  const cssDirty = css !== (customCodeMeta?.css ?? "");
  const jsDirty = js !== (customCodeMeta?.js ?? "");

  // §10.12.8 — beforeunload/capture-click veri kaybını her ZAMAN korur (PATCH bölümleri + henüz
  // kaydedilmemiş özel kod); yapışkan "Tümünü Kaydet" çubuğu ise SADECE 8 PATCH bölümünü kapsar
  // (design-notes-appearance-panel.md §9 — customCode'un KENDİ Kaydet akışı vardır).
  const { confirmDiscard } = useUnsavedChangesGuard({ enabled: anyPatchSectionDirty || cssDirty || jsDirty });

  function isTabDirty(tab: string): boolean {
    if (tab === "customCode") return cssDirty || jsDirty;
    if (tab in SECTION_FIELDS) return isSectionDirty(tab as SectionKey);
    return false;
  }

  function requestTabChange(next: string) {
    if (isTabDirty(activeTab) && next !== activeTab) {
      if (!confirmDiscard()) return;
    }
    setActiveTab(next);
  }

  function updateField<K extends keyof AppearanceFormState>(key: K, value: AppearanceFormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  /** §10.12.3 — colors/typography sekmesinde tek bir alanı elle değiştirmek `presetKey`'i `null`'a düşürür. */
  function updateColorOrTypographyField<K extends keyof AppearanceFormState>(key: K, value: AppearanceFormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value, presetKey: null } : prev));
  }

  function applyPreset(preset: AppearancePreset) {
    // `AppearancePreset.values` tip olarak TÜM `UpdateSiteAppearanceRequest` alanlarını kabul eder
    // (openapi.yaml `allOf`), ama §10.12.3 gereği ön ayarlar YALNIZCA renk/tipografi taşır — bu
    // yüzden burada spread yerine bilinçli olarak SADECE o alt küme okunur (tip güvenliği için).
    const values = preset.values;
    setForm((prev) =>
      prev
        ? {
            ...prev,
            presetKey: preset.key,
            primaryColor: values.primaryColor ?? prev.primaryColor,
            secondaryColor: values.secondaryColor ?? prev.secondaryColor,
            buttonColor: values.buttonColor ?? prev.buttonColor,
            buttonTextColor: values.buttonTextColor ?? prev.buttonTextColor,
            linkColor: values.linkColor ?? prev.linkColor,
            headingFont: values.headingFont ?? prev.headingFont,
            bodyFont: values.bodyFont ?? prev.bodyFont,
            baseFontSize: values.baseFontSize ?? prev.baseFontSize,
          }
        : prev
    );
  }

  async function handleSaveSection(section: SectionKey) {
    if (!form) return;
    setSaveError(null);
    setFieldErrors({});
    setSectionSaving(section);
    try {
      const payload = buildSectionPayload(form, section);
      await appearanceApi.updateAppearance(payload);
      setSnapshot((prev) => (prev ? { ...prev, ...pickFields(form, SECTION_FIELDS[section]) } : prev));
      toast.success("Değişiklikler kaydedildi.");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setSaveError(message);
      setFieldErrors(fieldErrorsFrom(err));
      toast.error(message);
    } finally {
      setSectionSaving(null);
    }
  }

  async function handleSaveAll() {
    if (!form) return;
    setSaveError(null);
    setFieldErrors({});
    setSectionSaving("all");
    try {
      const payload = buildFullPayload(form);
      await appearanceApi.updateAppearance(payload);
      setSnapshot(form);
      toast.success("Görünüm ayarları kaydedildi.");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setSaveError(message);
      setFieldErrors(fieldErrorsFrom(err));
      toast.error(message);
    } finally {
      setSectionSaving(null);
    }
  }

  async function handleReset() {
    setResetting(true);
    try {
      const updated = await appearanceApi.resetAppearance();
      const formState = formFromDto(updated);
      setForm(formState);
      setSnapshot(formState);
      toast.success("Görünüm fabrika ayarlarına döndürüldü.");
      setResetDialogOpen(false);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setResetting(false);
    }
  }

  async function handleSaveCss() {
    setCssError(null);
    setCssSaving(true);
    try {
      const trimmed = css.trim();
      const result = await appearanceApi.updateCustomCss({ css: trimmed || null, acknowledged: trimmed ? cssAcknowledged : false });
      setCustomCodeMeta(result);
      setCss(result.css ?? "");
      setCssAcknowledged(false);
      toast.success("Özel CSS kaydedildi.");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setCssError(message);
      toast.error(message);
    } finally {
      setCssSaving(false);
    }
  }

  async function handleSaveJs() {
    setJsError(null);
    setJsSaving(true);
    try {
      const trimmed = js.trim();
      const result = await appearanceApi.updateCustomJs({ js: trimmed || null, acknowledged: trimmed ? jsAcknowledged : false });
      setCustomCodeMeta(result);
      setJs(result.js ?? "");
      setJsAcknowledged(false);
      toast.success("Özel JS kaydedildi.");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setJsError(message);
      toast.error(message);
    } finally {
      setJsSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <PageHeading icon={Palette} title="Görünüm" description="Sitenizin renklerini, fontlarını ve düzenini yönetin." />
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {loadError}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      </div>
    );
  }

  if (!loaded || !form || !siteSettings || !navigation) {
    return (
      <div className="space-y-6">
        <PageHeading icon={Palette} title="Görünüm" description="Sitenizin renklerini, fontlarını ve düzenini yönetin." />
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      </div>
    );
  }

  const previewCssVars = {
    "--site-primary": form.primaryColor,
    "--site-secondary": form.secondaryColor,
    "--site-button": form.buttonColor,
    "--site-button-text": form.buttonTextColor,
    "--site-link": form.linkColor,
    "--site-heading-font": SITE_FONT_FAMILY[form.headingFont],
    "--site-body-font": SITE_FONT_FAMILY[form.bodyFont],
    "--site-base-font-size": `${form.baseFontSize}px`,
  } as Record<string, string>;

  return (
    <div className="space-y-6">
      <PageHeading icon={Palette} title="Görünüm" description="Sitenizin renklerini, fontlarını ve düzenini yönetin." />

      {saveError && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {saveError}
          </span>
        </Alert>
      )}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <Tabs
          orientation="vertical"
          value={activeTab}
          onValueChange={(value) => requestTabChange(String(value))}
          className="min-w-0 flex-1 lg:flex-row"
        >
          <TabsList variant="line" className="w-full lg:sticky lg:top-6 lg:w-64 lg:shrink-0">
            {TAB_ITEMS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
                {isTabDirty(tab.value) && <DirtyDot />}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="min-w-0 max-w-2xl flex-1 space-y-6">
            {/* --- 1) Logo & Marka (salt-okunur özet) --- */}
            <TabsContent value="brand" className="mt-0 outline-none">
              <Card className="space-y-4">
                <SectionHeader
                  icon={Palette}
                  title="Logo & Marka"
                  description="Logo, site adı ve sloganınız Navigasyon ekranında yönetilir."
                />
                <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-surface-muted p-3">
                  {siteSettings.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- medya kütüphanesinden gelen URL, site-header.tsx ile AYNI gerekçe
                    <img src={siteSettings.logoUrl} alt="" className="h-8 w-auto object-contain" />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-xs font-semibold text-foreground/50">
                      {siteSettings.siteName?.trim().charAt(0).toUpperCase() || "S"}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{siteSettings.siteName || "Site adı tanımlanmamış"}</p>
                    <p className="truncate text-xs text-foreground/50">{siteSettings.tagline || "Slogan tanımlanmamış"}</p>
                  </div>
                </div>
                <Button type="button" variant="secondary" size="sm" render={<Link href="/admin/navigation?tab=locations" />}>
                  <ExternalLink className="h-3.5 w-3.5" /> Navigasyon&apos;da Düzenle
                </Button>
              </Card>
            </TabsContent>

            {/* --- 2) Tasarım Ön Ayarları --- */}
            <TabsContent value="presets" className="mt-0 space-y-4 outline-none">
              <Card className="space-y-4">
                <SectionHeader icon={Sparkles} title="Tasarım Ön Ayarları" description="Bir ön ayar seçin, sonra ileri seviye ayarlarla özelleştirin." />

                {form.presetKey === null && <Badge tone="neutral">Özel (ön ayar uygulanmadı)</Badge>}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Tasarım ön ayarı">
                  {presets.map((preset) => {
                    const active = form.presetKey === preset.key;
                    const values = preset.values;
                    return (
                      <button
                        key={preset.key}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => applyPreset(preset)}
                        className={cn(
                          "flex flex-col gap-3 rounded-lg border p-4 text-left transition-all duration-300",
                          active ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border hover:bg-muted"
                        )}
                      >
                        <div className="flex h-8 overflow-hidden rounded-md">
                          <span className="flex-1" style={{ backgroundColor: values.primaryColor }} />
                          <span className="flex-1" style={{ backgroundColor: values.secondaryColor }} />
                          <span className="flex-1" style={{ backgroundColor: values.buttonColor }} />
                          <span className="flex-1" style={{ backgroundColor: values.linkColor }} />
                        </div>
                        <div>
                          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                            {preset.label}
                            {active && <CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}
                          </p>
                          <p className="mt-0.5 text-xs text-foreground/60">{preset.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setResetDialogOpen(true)}>
                    Fabrika Ayarlarına Sıfırla
                  </Button>
                  <Button type="button" variant="link" size="sm" onClick={() => requestTabChange("colors")}>
                    İleri seviye renk/tipografi ayarlarına geç →
                  </Button>
                </div>
              </Card>
              <SectionSaveButton
                dirty={isSectionDirty("presets")}
                saving={sectionSaving === "presets"}
                onClick={() => void handleSaveSection("presets")}
              />
            </TabsContent>

            {/* --- 3) Sayfa Başlığı Düzeni --- */}
            <TabsContent value="pageHeader" className="mt-0 space-y-4 outline-none">
              <Card className="space-y-4">
                <SectionHeader icon={LayoutTemplate} title="Sayfa Başlığı Düzeni" description="Sayfa/yazı başlık bloğunun görünümü." />
                <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Sayfa başlığı düzeni">
                  {PAGE_HEADER_STYLE_OPTIONS.map((opt) => {
                    const active = form.pageHeaderStyle === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => updateField("pageHeaderStyle", opt.value)}
                        className={cn(
                          "flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-all duration-300",
                          active ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                        )}
                      >
                        <opt.icon className="h-5 w-5" />
                        <span className="text-sm font-medium text-foreground">{opt.label}</span>
                        <span className="text-xs text-foreground/60">{opt.description}</span>
                      </button>
                    );
                  })}
                </div>

                {form.pageHeaderStyle === "BANNER" && (
                  <div className="mt-4 space-y-4 rounded-lg border border-border/60 bg-surface-muted/50 p-4 animate-in fade-in-0 slide-in-from-top-1 duration-200">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <ColorField
                        id="pageHeaderBackgroundColor"
                        label="Zemin rengi (yedek)"
                        value={form.pageHeaderBackgroundColor}
                        onChange={(hex) => updateField("pageHeaderBackgroundColor", hex)}
                      />
                      <MediaSelectField
                        id="pageHeaderBackgroundMedia"
                        label="Arka plan görseli"
                        value={pageHeaderBackgroundMedia}
                        onChange={(media) => {
                          setPageHeaderBackgroundMedia(media);
                          updateField("pageHeaderBackgroundMediaId", media?.id ?? null);
                        }}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="pageHeaderOverlayOpacity" className="block text-sm font-medium text-foreground">
                        Karartma yoğunluğu (%{form.pageHeaderOverlayOpacity})
                      </label>
                      <input
                        type="range"
                        id="pageHeaderOverlayOpacity"
                        min={0}
                        max={100}
                        value={form.pageHeaderOverlayOpacity}
                        onChange={(e) => updateField("pageHeaderOverlayOpacity", Number(e.target.value))}
                        className="w-full accent-primary"
                      />
                      <p className="text-xs text-foreground/60">
                        Görselin üzerine binen koyu katman — başlık metninin okunabilirliğini korur.
                      </p>
                    </div>
                    <p className="text-xs text-foreground/50">
                      Hem görsel hem renk tanımlıysa GÖRSEL kazanır; renk yalnızca görsel yüklenene kadarki yedek zemindir.
                    </p>
                  </div>
                )}
              </Card>
              <SectionSaveButton
                dirty={isSectionDirty("pageHeader")}
                saving={sectionSaving === "pageHeader"}
                onClick={() => void handleSaveSection("pageHeader")}
              />
            </TabsContent>

            {/* --- 4) Stil / Renk --- */}
            <TabsContent value="colors" className="mt-0 space-y-4 outline-none">
              <Card className="space-y-4">
                <SectionHeader icon={Paintbrush} title="Stil / Renk" description="Sitenizin genel renk paleti." />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <ColorField
                    id="primaryColor"
                    label="Birincil Renk"
                    value={form.primaryColor}
                    onChange={(hex) => updateColorOrTypographyField("primaryColor", hex)}
                  />
                  <ColorField
                    id="secondaryColor"
                    label="İkincil Renk"
                    value={form.secondaryColor}
                    onChange={(hex) => updateColorOrTypographyField("secondaryColor", hex)}
                  />
                  <ColorField
                    id="buttonColor"
                    label="Buton Zemini"
                    value={form.buttonColor}
                    checkAgainst={form.buttonTextColor}
                    onChange={(hex) => updateColorOrTypographyField("buttonColor", hex)}
                  />
                  <ColorField
                    id="buttonTextColor"
                    label="Buton Metni"
                    value={form.buttonTextColor}
                    checkAgainst={form.buttonColor}
                    onChange={(hex) => updateColorOrTypographyField("buttonTextColor", hex)}
                  />
                  <ColorField
                    id="linkColor"
                    label="Bağlantı Rengi"
                    value={form.linkColor}
                    onChange={(hex) => updateColorOrTypographyField("linkColor", hex)}
                  />
                </div>
              </Card>
              <SectionSaveButton
                dirty={isSectionDirty("colors")}
                saving={sectionSaving === "colors"}
                onClick={() => void handleSaveSection("colors")}
              />
            </TabsContent>

            {/* --- 5) Sosyal Medya Paylaşımı --- */}
            <TabsContent value="social" className="mt-0 space-y-4 outline-none">
              <Card className="space-y-4">
                <SectionHeader icon={Share2} title="Sosyal Medya Paylaşımı" description="Yazı ve sayfa altında görünen paylaşım butonları." />
                <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 p-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Paylaşım butonlarını göster</p>
                    <p className="text-xs text-foreground/60">Ziyaretçiler içeriği bu ağlarda paylaşabilir.</p>
                  </div>
                  <Switch
                    checked={form.socialShareEnabled}
                    onCheckedChange={(checked) => updateField("socialShareEnabled", Boolean(checked))}
                    aria-label="Paylaşım butonlarını göster"
                  />
                </div>

                {form.socialShareEnabled && (
                  <div className="flex flex-wrap gap-2 animate-in fade-in-0 slide-in-from-top-1 duration-200">
                    {SOCIAL_SHARE_OPTIONS.map((opt) => {
                      const active = form.socialShareNetworks.includes(opt.value);
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            updateField(
                              "socialShareNetworks",
                              active
                                ? form.socialShareNetworks.filter((n) => n !== opt.value)
                                : [...form.socialShareNetworks, opt.value]
                            )
                          }
                          className={cn(
                            "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200",
                            active ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:bg-muted"
                          )}
                        >
                          <opt.icon className="h-3.5 w-3.5" /> {opt.label}
                        </button>
                      );
                    })}
                  </div>
                )}

                <p className="border-t border-border/60 pt-3 text-xs text-foreground/50">
                  Sitenizin kendi sosyal hesap linkleri (Twitter, Instagram vb.) burada değil —{" "}
                  <Link href="/admin/navigation?tab=locations" className="text-primary hover:underline">
                    Navigasyon&apos;da yönetilir
                  </Link>
                  .
                </p>
              </Card>
              <SectionSaveButton
                dirty={isSectionDirty("social")}
                saving={sectionSaving === "social"}
                onClick={() => void handleSaveSection("social")}
              />
            </TabsContent>

            {/* --- 6) Yazı Tipi --- */}
            <TabsContent value="typography" className="mt-0 space-y-4 outline-none">
              <Card className="space-y-5">
                <SectionHeader icon={Type} title="Yazı Tipi" description="Başlık ve gövde metni için fontlar." />

                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Başlık Fontu</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Başlık fontu">
                    {SITE_FONT_OPTIONS.map((opt) => {
                      const active = form.headingFont === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => updateColorOrTypographyField("headingFont", opt.value)}
                          className={cn(
                            "rounded-lg border p-3 text-left transition-all duration-300",
                            active ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                          )}
                          style={{ fontFamily: opt.cssFallback }}
                        >
                          <span className="block text-base text-foreground">Aa</span>
                          <span className="mt-1 block text-xs text-foreground/60" style={{ fontFamily: "inherit" }}>
                            {opt.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Gövde Fontu</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Gövde fontu">
                    {SITE_FONT_OPTIONS.map((opt) => {
                      const active = form.bodyFont === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => updateColorOrTypographyField("bodyFont", opt.value)}
                          className={cn(
                            "rounded-lg border p-3 text-left transition-all duration-300",
                            active ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                          )}
                          style={{ fontFamily: opt.cssFallback }}
                        >
                          <span className="block text-base text-foreground">Aa</span>
                          <span className="mt-1 block text-xs text-foreground/60" style={{ fontFamily: "inherit" }}>
                            {opt.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="baseFontSize" className="block text-sm font-medium text-foreground">
                    Gövde metni temel boyutu (%{form.baseFontSize}px)
                  </label>
                  <input
                    type="range"
                    id="baseFontSize"
                    min={14}
                    max={20}
                    step={1}
                    value={form.baseFontSize}
                    onChange={(e) => updateColorOrTypographyField("baseFontSize", Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </div>
              </Card>
              <SectionSaveButton
                dirty={isSectionDirty("typography")}
                saving={sectionSaving === "typography"}
                onClick={() => void handleSaveSection("typography")}
              />
            </TabsContent>

            {/* --- 7) Ekstra Özellikler --- */}
            <TabsContent value="features" className="mt-0 space-y-4 outline-none">
              <Card className="space-y-4">
                <SectionHeader icon={ToggleRight} title="Ekstra Özellikler" description="Sitenizde açıp kapatabileceğiniz küçük özellikler." />
                <Accordion className="divide-y-0">
                  <AccordionItem value="backToTopEnabled">
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <ArrowUpCircle className="h-4 w-4 shrink-0 text-foreground/50" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">Yukarı Çık Butonu</p>
                        <p className="text-xs text-foreground/60">Sayfa kaydırıldığında sağ altta beliren buton.</p>
                      </div>
                      <Switch
                        checked={form.backToTopEnabled}
                        onCheckedChange={(checked) => updateField("backToTopEnabled", Boolean(checked))}
                        aria-label="Yukarı Çık Butonu"
                      />
                    </div>
                  </AccordionItem>

                  <AccordionItem value="stickyHeaderEnabled">
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <PanelTop className="h-4 w-4 shrink-0 text-foreground/50" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">Yapışkan Header</p>
                        <p className="text-xs text-foreground/60">Sayfa kaydırılırken header üstte sabit kalır.</p>
                      </div>
                      <Switch
                        checked={form.stickyHeaderEnabled}
                        onCheckedChange={(checked) => updateField("stickyHeaderEnabled", Boolean(checked))}
                        aria-label="Yapışkan Header"
                      />
                    </div>
                  </AccordionItem>

                  <AccordionItem value="cookieBannerEnabled">
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <Cookie className="h-4 w-4 shrink-0 text-foreground/50" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">Çerez Bandı</p>
                        <p className="text-xs text-foreground/60">Bilgilendirme amaçlıdır — onay yönetimi yapmaz, hiçbir script&apos;i engellemez.</p>
                      </div>
                      <Switch
                        checked={form.cookieBannerEnabled}
                        onCheckedChange={(checked) => updateField("cookieBannerEnabled", Boolean(checked))}
                        aria-label="Çerez Bandı"
                      />
                      <AccordionTrigger className="w-auto p-1.5" aria-label="Çerez Bandı ek ayarları" />
                    </div>
                    <AccordionPanel className="space-y-3 px-3 pb-3">
                      <Field id="cookieBannerText" label="Çerez bandı metni">
                        {(p) => (
                          <Textarea
                            {...p}
                            rows={3}
                            value={form.cookieBannerText}
                            onChange={(e) => updateField("cookieBannerText", e.target.value)}
                            placeholder={COOKIE_BANNER_TEXT_PLACEHOLDER}
                            maxLength={500}
                          />
                        )}
                      </Field>
                      <Field id="cookieBannerPolicyHref" label="Politika bağlantısı">
                        {(p) => (
                          <Input
                            {...p}
                            value={form.cookieBannerPolicyHref}
                            onChange={(e) => updateField("cookieBannerPolicyHref", e.target.value)}
                            placeholder={COOKIE_BANNER_HREF_PLACEHOLDER}
                            maxLength={2048}
                          />
                        )}
                      </Field>
                    </AccordionPanel>
                  </AccordionItem>

                  <AccordionItem value="maintenanceModeEnabled">
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <Wrench className="h-4 w-4 shrink-0 text-foreground/50" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">Bakım Modu</p>
                        <p className="text-xs text-foreground/60">Site ziyaretçilerine bakım sayfası gösterir. Yönetim paneli etkilenmez.</p>
                      </div>
                      <Switch
                        checked={form.maintenanceModeEnabled}
                        onCheckedChange={(checked) => updateField("maintenanceModeEnabled", Boolean(checked))}
                        aria-label="Bakım Modu"
                      />
                      <AccordionTrigger className="w-auto p-1.5" aria-label="Bakım Modu ek ayarları" />
                    </div>
                    <AccordionPanel className="space-y-3 px-3 pb-3">
                      {form.maintenanceModeEnabled && (
                        <Alert variant="warning" className="text-xs">
                          Bakım modu yalnızca ziyaretçi sitesini etkiler — yönetim paneline erişiminiz kesilmez.
                        </Alert>
                      )}
                      <Field id="maintenanceMessage" label="Bakım modu mesajı">
                        {(p) => (
                          <Textarea
                            {...p}
                            rows={3}
                            value={form.maintenanceMessage}
                            onChange={(e) => updateField("maintenanceMessage", e.target.value)}
                            placeholder={MAINTENANCE_MESSAGE_PLACEHOLDER}
                            maxLength={500}
                          />
                        )}
                      </Field>
                    </AccordionPanel>
                  </AccordionItem>
                </Accordion>
              </Card>
              <SectionSaveButton
                dirty={isSectionDirty("features")}
                saving={sectionSaving === "features"}
                onClick={() => void handleSaveSection("features")}
              />
            </TabsContent>

            {/* --- 8) Özel CSS / JS --- */}
            <TabsContent value="customCode" className="mt-0 space-y-4 outline-none">
              {customCodeMeta && !customCodeMeta.customCodeEnabled && (
                <Alert variant="info">Özel kod düzenleme şu anda ortam tarafından devre dışı bırakılmış.</Alert>
              )}

              <Card className="space-y-3">
                <SectionHeader icon={Code2} title="Özel CSS" description="Sitenizin HTML'ine gömülen ek stil kuralları." />
                <Alert variant="warning">
                  <span className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      <span className="block font-medium">Bu alan sitenizin HTML&apos;ine doğrudan gömülür.</span>
                      Yalnızca güvendiğiniz kod parçacıklarını yapıştırın. Hatalı CSS sitenizin görünümünü bozabilir.
                    </span>
                  </span>
                </Alert>
                <Textarea
                  value={css}
                  onChange={(e) => setCss(e.target.value)}
                  rows={14}
                  spellCheck={false}
                  disabled={customCodeMeta ? !customCodeMeta.customCodeEnabled : false}
                  className="font-mono text-xs leading-relaxed"
                  placeholder="/* Örnek: .site-scope h1 { letter-spacing: -0.02em; } */"
                  aria-label="Özel CSS"
                />
                {cssError && (
                  <p role="alert" className="text-xs text-danger">
                    {cssError}
                  </p>
                )}
                <label className="flex items-start gap-2 text-sm text-foreground">
                  <Checkbox
                    checked={cssAcknowledged}
                    onCheckedChange={(checked) => setCssAcknowledged(Boolean(checked))}
                    disabled={customCodeMeta ? !customCodeMeta.customCodeEnabled : false}
                    className="mt-0.5"
                  />
                  Bu kodun ne yaptığını anlıyorum ve sonuçlarını kabul ediyorum.
                </label>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-foreground/50">
                    Son güncelleme: {customCodeMeta?.cssUpdatedBy?.name ?? "—"}
                    {customCodeMeta?.cssUpdatedAt ? ` · ${new Date(customCodeMeta.cssUpdatedAt).toLocaleString("tr-TR")}` : ""}
                  </p>
                  <Button
                    type="button"
                    loading={cssSaving}
                    disabled={(!cssAcknowledged && Boolean(css.trim())) || (customCodeMeta ? !customCodeMeta.customCodeEnabled : false)}
                    onClick={() => void handleSaveCss()}
                  >
                    CSS&apos;i Kaydet
                  </Button>
                </div>
              </Card>

              <Card className="space-y-3">
                <SectionHeader icon={ShieldAlert} title="Özel JS" description="Sitenizin kaynağından çalışan ek betik." />
                <Alert variant="error">
                  <span className="flex items-start gap-2">
                    <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      <span className="block font-medium">Bu alan her ziyaretçinin tarayıcısında sitenizin kendi kaynağından çalışır.</span>
                      Kötü niyetli veya hatalı kod; veri sızıntısına, oturum çalınmasına veya sitenizin çökmesine yol açabilir. Yalnızca ne
                      yaptığını TAM olarak anladığınız kodu ekleyin.
                    </span>
                  </span>
                </Alert>
                <Textarea
                  value={js}
                  onChange={(e) => setJs(e.target.value)}
                  rows={14}
                  spellCheck={false}
                  disabled={customCodeMeta ? !customCodeMeta.customCodeEnabled : false}
                  className="font-mono text-xs leading-relaxed"
                  placeholder="// Örnek: console.log('site yüklendi');"
                  aria-label="Özel JS"
                />
                {jsError && (
                  <p role="alert" className="text-xs text-danger">
                    {jsError}
                  </p>
                )}
                <label className="flex items-start gap-2 text-sm text-foreground">
                  <Checkbox
                    checked={jsAcknowledged}
                    onCheckedChange={(checked) => setJsAcknowledged(Boolean(checked))}
                    disabled={customCodeMeta ? !customCodeMeta.customCodeEnabled : false}
                    className="mt-0.5"
                  />
                  Bu kodun ne yaptığını anlıyorum ve sonuçlarını kabul ediyorum.
                </label>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-foreground/50">
                    Son güncelleme: {customCodeMeta?.jsUpdatedBy?.name ?? "—"}
                    {customCodeMeta?.jsUpdatedAt ? ` · ${new Date(customCodeMeta.jsUpdatedAt).toLocaleString("tr-TR")}` : ""}
                  </p>
                  <Button
                    type="button"
                    loading={jsSaving}
                    disabled={(!jsAcknowledged && Boolean(js.trim())) || (customCodeMeta ? !customCodeMeta.customCodeEnabled : false)}
                    onClick={() => void handleSaveJs()}
                  >
                    JS&apos;i Kaydet
                  </Button>
                </div>
              </Card>
            </TabsContent>

            {/* --- 9) 404 Sayfası --- */}
            <TabsContent value="notFound" className="mt-0 space-y-4 outline-none">
              <Card className="space-y-4">
                <SectionHeader icon={FileQuestion} title="404 Sayfası" description="Sayfa bulunamadığında gösterilecek özel metin." />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field
                    id="notFoundTitle"
                    label="Başlık"
                    hint='Boş bırakılırsa "Sayfa Bulunamadı" kullanılır.'
                    error={fieldErrors.notFoundTitle}
                  >
                    {(p) => (
                      <Input {...p} value={form.notFoundTitle} onChange={(e) => updateField("notFoundTitle", e.target.value)} maxLength={120} />
                    )}
                  </Field>
                  <Field id="notFoundButtonLabel" label="Buton Metni" hint="Href de doluysa gösterilir." error={fieldErrors.notFoundButtonLabel}>
                    {(p) => (
                      <Input
                        {...p}
                        value={form.notFoundButtonLabel}
                        onChange={(e) => updateField("notFoundButtonLabel", e.target.value)}
                        maxLength={60}
                      />
                    )}
                  </Field>
                  <div className="sm:col-span-2">
                    <Field id="notFoundMessage" label="Mesaj" error={fieldErrors.notFoundMessage}>
                      {(p) => (
                        <Textarea
                          {...p}
                          rows={3}
                          value={form.notFoundMessage}
                          onChange={(e) => updateField("notFoundMessage", e.target.value)}
                          maxLength={500}
                        />
                      )}
                    </Field>
                  </div>
                  <Field id="notFoundButtonHref" label="Buton Bağlantısı" hint="Varsayılan /." error={fieldErrors.notFoundButtonHref}>
                    {(p) => (
                      <Input
                        {...p}
                        value={form.notFoundButtonHref}
                        onChange={(e) => updateField("notFoundButtonHref", e.target.value)}
                        maxLength={2048}
                      />
                    )}
                  </Field>
                </div>

                <div className="rounded-lg border border-dashed border-border p-4 text-center">
                  <p className="text-sm font-medium text-foreground">{form.notFoundTitle || "Sayfa Bulunamadı"}</p>
                  <p className="mt-1 text-xs text-foreground/60">
                    {form.notFoundMessage || "Aradığınız sayfa taşınmış veya kaldırılmış olabilir."}
                  </p>
                  {form.notFoundButtonLabel && form.notFoundButtonHref && (
                    <span className="mt-3 inline-block rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground">
                      {form.notFoundButtonLabel}
                    </span>
                  )}
                </div>
              </Card>
              <SectionSaveButton
                dirty={isSectionDirty("notFound")}
                saving={sectionSaving === "notFound"}
                onClick={() => void handleSaveSection("notFound")}
              />
            </TabsContent>
          </div>
        </Tabs>

        {/* --- Sağ: Canlı Önizleme (Tabs'ın DIŞINDA — sekmeye bakmaksızın her zaman görünür) --- */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="w-full lg:sticky lg:top-6 lg:w-[420px] lg:shrink-0"
        >
          {activeTab === "customCode" ? (
            <Card className="space-y-3 p-6 text-center">
              <Code2 className="mx-auto h-8 w-8 text-foreground/30" />
              <p className="text-sm font-medium text-foreground">Özel kod önizlemede uygulanmaz</p>
              <p className="text-xs text-foreground/60">Kaydettikten sonra değişiklikleri görmek için siteyi yeni sekmede açın.</p>
              <Button type="button" variant="secondary" size="sm" render={<a href="/" target="_blank" rel="noreferrer" />}>
                <ExternalLink className="h-3.5 w-3.5" /> Siteyi Aç
              </Button>
            </Card>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-medium tracking-wide text-foreground/50 uppercase">Canlı Önizleme</p>
              <div
                className={`site-scope overflow-hidden rounded-xl border border-border ${SITE_FONT_VARIABLES}`}
                style={previewCssVars}
              >
                <SiteHeader
                  settings={siteSettings}
                  pages={publishedPages}
                  navigationItems={navigation.navigationItems}
                  ctaLabel={navigation.headerCtaLabel}
                  ctaHref={navigation.headerCtaHref}
                />
                <div className="flex min-h-32 flex-col items-center justify-center gap-2 bg-muted/30 px-4 py-10 text-center">
                  {form.pageHeaderStyle === "BANNER" && (
                    <PreviewPageHeaderBanner
                      backgroundColor={form.pageHeaderBackgroundColor}
                      backgroundUrl={pageHeaderBackgroundMedia?.url ?? null}
                      overlayOpacity={form.pageHeaderOverlayOpacity}
                    />
                  )}
                  <p className="text-xs text-foreground/40">Sayfa içeriği</p>
                </div>
                <SiteFooter
                  siteName={siteSettings.siteName}
                  logoUrl={siteSettings.logoUrl}
                  logoHeight={getFooterLogoHeight(siteSettings.headerLogoHeight)}
                  tagline={siteSettings.tagline}
                  socialLinks={navigation.socialLinks}
                  footerColumns={navigation.footerColumns}
                  copyrightText={navigation.footerCopyrightText}
                />
              </div>
              <p className="text-xs text-foreground/50">
                Değişiklikler yayına alındıktan sonra sitenizde en geç 60 saniye içinde görünür.
              </p>
            </div>
          )}
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.4 }}
        className="sticky bottom-6 z-10 flex justify-end"
      >
        <Card className="flex items-center gap-3 p-3 shadow-lg">
          {anyPatchSectionDirty && sectionSaving === null && (
            <span className="flex items-center gap-1.5 text-xs text-warning">
              <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />
              Kaydedilmemiş değişiklikler var
            </span>
          )}
          {sectionSaving === "all" && <span className="text-xs admin-text-secondary">Kaydediliyor…</span>}
          <Button type="button" loading={sectionSaving === "all"} onClick={() => void handleSaveAll()}>
            Tümünü Kaydet
          </Button>
        </Card>
      </motion.div>

      <ConfirmDialog
        open={resetDialogOpen}
        onOpenChange={setResetDialogOpen}
        title="Görünümü fabrika ayarlarına döndür"
        description="Renk ve tipografi ayarlarınız varsayılana döner. Özel CSS/JS ve diğer ayarlar ETKİLENMEZ."
        confirmText="Sıfırla"
        destructive
        loading={resetting}
        onConfirm={() => void handleReset()}
      />
    </div>
  );
}

function pickFields<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) result[key] = source[key];
  return result;
}
