"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Briefcase,
  FileText,
  LayoutTemplate,
  ListTree,
  Newspaper,
  Plus,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import * as settingsApi from "@/lib/api/settings";
import * as pagesApi from "@/lib/api/pages";
import * as blogApi from "@/lib/api/blog";
import * as productsApi from "@/lib/api/products";
import * as portfolioApi from "@/lib/api/portfolio";
import * as navigationApi from "@/lib/api/navigation";
import type { SitePage, SocialPlatform, UpdateNavigationConfigRequest } from "@/lib/api/types";
import { PageHeading } from "@/components/admin/page-heading";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { useModules } from "@/context/modules-context";
import { ContentPickerPanel, type ContentPickerSection } from "@/components/admin/navigation/content-picker-panel";
import { NavTreeEditor } from "@/components/admin/navigation/nav-tree-editor";
import { appendRootItems, toNavigationItemsPayload, type FlatNavItem } from "@/components/admin/navigation/nav-tree-utils";

const HREF_HINT =
  "http(s):// ile başlayan tam bir bağlantı, / ile başlayan site-içi yol veya # ile başlayan bağlantı girin.";

const UNSAVED_CHANGES_WARNING = "Kaydedilmemiş değişiklikleriniz var. Yine de ayrılmak istiyor musunuz?";

const SOCIAL_PLATFORM_OPTIONS: { value: SocialPlatform; label: string }[] = [
  { value: "TWITTER", label: "Twitter / X" },
  { value: "GITHUB", label: "GitHub" },
  { value: "LINKEDIN", label: "LinkedIn" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "FACEBOOK", label: "Facebook" },
  { value: "YOUTUBE", label: "YouTube" },
  { value: "OTHER", label: "Diğer" },
];

interface LocalSocialLink {
  localId: string;
  platform: SocialPlatform;
  url: string;
}

interface LocalFooterLink {
  localId: string;
  label: string;
  href: string;
}

interface LocalFooterColumn {
  localId: string;
  title: string;
  links: LocalFooterLink[];
}

interface LocationsSnapshot {
  siteName: string;
  logoUrl: string;
  headerCtaLabel: string;
  headerCtaHref: string;
  footerCopyrightText: string;
  socialLinks: { platform: SocialPlatform; url: string }[];
  footerColumns: { title: string; links: { label: string; href: string }[] }[];
}

function moveItemInList<T>(list: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="space-y-4">
      <div>
        <h2 className="admin-h2">{title}</h2>
        {description && <p className="mt-1 admin-text-secondary">{description}</p>}
      </div>
      {children}
    </Card>
  );
}

function RowActions({
  index,
  length,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  index: number;
  length: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex shrink-0 gap-1">
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Yukarı taşı" onClick={onMoveUp} disabled={index === 0}>
        <ArrowUp />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Aşağı taşı"
        onClick={onMoveDown}
        disabled={index === length - 1}
      >
        <ArrowDown />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Sil" onClick={onRemove}>
        <Trash2 />
      </Button>
    </div>
  );
}

export default function AdminNavigationPage() {
  const { isModuleEnabled } = useModules();

  const [activeTab, setActiveTab] = useState("menus");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [siteName, setSiteName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [publishedPages, setPublishedPages] = useState<SitePage[]>([]);
  const [publishedPosts, setPublishedPosts] = useState<{ id: string; title: string; slug: string }[]>([]);
  const [publishedProducts, setPublishedProducts] = useState<{ id: string; title: string; slug: string }[]>([]);
  const [publishedPortfolioItems, setPublishedPortfolioItems] = useState<{ id: string; title: string; slug: string }[]>([]);

  const [navigationItems, setNavigationItems] = useState<FlatNavItem[]>([]);
  const [menuSnapshot, setMenuSnapshot] = useState<FlatNavItem[]>([]);

  const [headerCtaLabel, setHeaderCtaLabel] = useState("");
  const [headerCtaHref, setHeaderCtaHref] = useState("");
  const [footerCopyrightText, setFooterCopyrightText] = useState("");
  const [socialLinks, setSocialLinks] = useState<LocalSocialLink[]>([]);
  const [footerColumns, setFooterColumns] = useState<LocalFooterColumn[]>([]);
  const [locationsSnapshot, setLocationsSnapshot] = useState<LocationsSnapshot | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [settings, pages, navConfig, posts, products, portfolioItems] = await Promise.all([
        settingsApi.getSettings(),
        pagesApi.listPages(),
        navigationApi.getNavigationConfig(),
        blogApi.listPosts(),
        productsApi.listProducts(),
        portfolioApi.listPortfolioItems(),
      ]);

      setSiteName(settings.siteName);
      setLogoUrl(settings.logoUrl ?? "");
      setPublishedPages(pages.items.filter((page) => page.status === "PUBLISHED"));
      setPublishedPosts(
        posts.items.filter((post) => post.status === "PUBLISHED").map((post) => ({ id: post.id, title: post.title, slug: post.slug }))
      );
      setPublishedProducts(
        products.items
          .filter((product) => product.status === "PUBLISHED")
          .map((product) => ({ id: product.id, title: product.title, slug: product.slug }))
      );
      setPublishedPortfolioItems(
        portfolioItems.items
          .filter((item) => item.status === "PUBLISHED")
          .map((item) => ({ id: item.id, title: item.title, slug: item.slug }))
      );

      setHeaderCtaLabel(navConfig.headerCtaLabel ?? "");
      setHeaderCtaHref(navConfig.headerCtaHref ?? "");
      setFooterCopyrightText(navConfig.footerCopyrightText ?? "");

      const loadedNavItems: FlatNavItem[] = [...navConfig.navigationItems]
        .sort((a, b) => a.order - b.order)
        .map((item) => ({ id: item.id, label: item.label, href: item.href, parentId: item.parentId }));
      setNavigationItems(loadedNavItems);
      setMenuSnapshot(loadedNavItems);

      const loadedSocialLinks = [...navConfig.socialLinks]
        .sort((a, b) => a.order - b.order)
        .map((link) => ({ localId: crypto.randomUUID(), platform: link.platform, url: link.url }));
      setSocialLinks(loadedSocialLinks);

      const loadedFooterColumns = [...navConfig.footerColumns]
        .sort((a, b) => a.order - b.order)
        .map((column) => ({
          localId: crypto.randomUUID(),
          title: column.title,
          links: [...column.links]
            .sort((a, b) => a.order - b.order)
            .map((link) => ({ localId: crypto.randomUUID(), label: link.label, href: link.href })),
        }));
      setFooterColumns(loadedFooterColumns);

      setLocationsSnapshot({
        siteName: settings.siteName,
        logoUrl: settings.logoUrl ?? "",
        headerCtaLabel: navConfig.headerCtaLabel ?? "",
        headerCtaHref: navConfig.headerCtaHref ?? "",
        footerCopyrightText: navConfig.footerCopyrightText ?? "",
        socialLinks: loadedSocialLinks.map((l) => ({ platform: l.platform, url: l.url })),
        footerColumns: loadedFooterColumns.map((c) => ({ title: c.title, links: c.links.map((l) => ({ label: l.label, href: l.href })) })),
      });

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

  // --- Kaydedilmemiş değişiklik takibi (Karar 1: sekme başına ayrı bayrak) ---
  const menuHasUnsavedChanges = useMemo(
    () => JSON.stringify(navigationItems) !== JSON.stringify(menuSnapshot),
    [navigationItems, menuSnapshot]
  );
  const locationsHasUnsavedChanges = useMemo(() => {
    if (!locationsSnapshot) return false;
    const current: LocationsSnapshot = {
      siteName,
      logoUrl,
      headerCtaLabel,
      headerCtaHref,
      footerCopyrightText,
      socialLinks: socialLinks.map((l) => ({ platform: l.platform, url: l.url })),
      footerColumns: footerColumns.map((c) => ({ title: c.title, links: c.links.map((l) => ({ label: l.label, href: l.href })) })),
    };
    return JSON.stringify(current) !== JSON.stringify(locationsSnapshot);
  }, [siteName, logoUrl, headerCtaLabel, headerCtaHref, footerCopyrightText, socialLinks, footerColumns, locationsSnapshot]);

  function hasUnsavedChangesForTab(tab: string) {
    return tab === "menus" ? menuHasUnsavedChanges : locationsHasUnsavedChanges;
  }

  // --- Sosyal medya linkleri ---
  function addSocialLink() {
    setSocialLinks((prev) => [...prev, { localId: crypto.randomUUID(), platform: "TWITTER", url: "" }]);
  }
  function updateSocialLink(index: number, patch: Partial<Omit<LocalSocialLink, "localId">>) {
    setSocialLinks((prev) => prev.map((link, i) => (i === index ? { ...link, ...patch } : link)));
  }
  function moveSocialLink(index: number, direction: -1 | 1) {
    setSocialLinks((prev) => moveItemInList(prev, index, direction));
  }
  function removeSocialLink(index: number) {
    setSocialLinks((prev) => prev.filter((_, i) => i !== index));
  }

  // --- Footer sütunları ---
  function addFooterColumn() {
    setFooterColumns((prev) => [...prev, { localId: crypto.randomUUID(), title: "", links: [] }]);
  }
  function updateFooterColumnTitle(index: number, title: string) {
    setFooterColumns((prev) => prev.map((col, i) => (i === index ? { ...col, title } : col)));
  }
  function moveFooterColumn(index: number, direction: -1 | 1) {
    setFooterColumns((prev) => moveItemInList(prev, index, direction));
  }
  function removeFooterColumn(index: number) {
    setFooterColumns((prev) => prev.filter((_, i) => i !== index));
  }
  function addFooterColumnLink(columnIndex: number) {
    setFooterColumns((prev) =>
      prev.map((col, i) =>
        i === columnIndex ? { ...col, links: [...col.links, { localId: crypto.randomUUID(), label: "", href: "" }] } : col
      )
    );
  }
  function updateFooterColumnLink(columnIndex: number, linkIndex: number, patch: Partial<Omit<LocalFooterLink, "localId">>) {
    setFooterColumns((prev) =>
      prev.map((col, i) =>
        i === columnIndex
          ? { ...col, links: col.links.map((link, j) => (j === linkIndex ? { ...link, ...patch } : link)) }
          : col
      )
    );
  }
  function moveFooterColumnLink(columnIndex: number, linkIndex: number, direction: -1 | 1) {
    setFooterColumns((prev) =>
      prev.map((col, i) => (i === columnIndex ? { ...col, links: moveItemInList(col.links, linkIndex, direction) } : col))
    );
  }
  function removeFooterColumnLink(columnIndex: number, linkIndex: number) {
    setFooterColumns((prev) =>
      prev.map((col, i) => (i === columnIndex ? { ...col, links: col.links.filter((_, j) => j !== linkIndex) } : col))
    );
  }

  // --- Menü ağacı: içerikten ekleme ---
  const existingHrefs = useMemo(() => new Set(navigationItems.map((item) => item.href)), [navigationItems]);

  function handleAddItems(items: { label: string; href: string }[]) {
    setNavigationItems((prev) => appendRootItems(prev, items.map((item) => ({ id: crypto.randomUUID(), ...item }))));
  }

  const pickerSections: ContentPickerSection[] = useMemo(() => {
    const sections: ContentPickerSection[] = [
      {
        key: "pages",
        label: "Sayfalar",
        icon: FileText,
        items: publishedPages.map((page) => ({ id: page.id, title: page.title, href: `/${page.slug}` })),
      },
      {
        key: "blog",
        label: "Blog Yazıları",
        icon: Newspaper,
        items: publishedPosts.map((post) => ({ id: post.id, title: post.title, href: `/blog/${post.slug}` })),
      },
    ];
    if (isModuleEnabled("products")) {
      sections.push({
        key: "products",
        label: "Ürünler",
        icon: ShoppingBag,
        items: publishedProducts.map((product) => ({ id: product.id, title: product.title, href: `/products/${product.slug}` })),
      });
    }
    if (isModuleEnabled("portfolio")) {
      sections.push({
        key: "portfolio",
        label: "Portföy",
        icon: Briefcase,
        items: publishedPortfolioItems.map((item) => ({ id: item.id, title: item.title, href: `/portfolio/${item.slug}` })),
      });
    }
    return sections;
  }, [publishedPages, publishedPosts, publishedProducts, publishedPortfolioItems, isModuleEnabled]);

  async function handleSave() {
    setSaveError(null);
    setSaving(true);
    try {
      const payload: UpdateNavigationConfigRequest = {
        headerCtaLabel: headerCtaLabel.trim() || null,
        headerCtaHref: headerCtaHref.trim() || null,
        footerCopyrightText: footerCopyrightText.trim() || null,
        navigationItems: toNavigationItemsPayload(navigationItems),
        socialLinks: socialLinks.map((link, index) => ({ platform: link.platform, url: link.url, order: index })),
        footerColumns: footerColumns.map((col, index) => ({
          title: col.title,
          order: index,
          links: col.links.map((link, linkIndex) => ({ label: link.label, href: link.href, order: linkIndex })),
        })),
      };

      await Promise.all([
        settingsApi.updateSettings({ siteName, logoUrl: logoUrl || null }),
        navigationApi.updateNavigationConfig(payload),
      ]);

      toast.success("Navigasyon kaydedildi.");
      setMenuSnapshot(navigationItems);
      setLocationsSnapshot({
        siteName,
        logoUrl,
        headerCtaLabel,
        headerCtaHref,
        footerCopyrightText,
        socialLinks: socialLinks.map((l) => ({ platform: l.platform, url: l.url })),
        footerColumns: footerColumns.map((c) => ({ title: c.title, links: c.links.map((l) => ({ label: l.label, href: l.href })) })),
      });
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <PageHeading icon={LayoutTemplate} title="Navigasyon Yönetimi" description="Menüleri ve site konumlarını yönetin." />
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

  if (!loaded) {
    return (
      <div className="space-y-6">
        <PageHeading icon={LayoutTemplate} title="Navigasyon Yönetimi" description="Menüleri ve site konumlarını yönetin." />
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      </div>
    );
  }

  const previewSettings = { siteName, logoUrl: logoUrl || null, homePageId: null, siteTemplate: "SHOWCASE" as const };
  // Henüz label/href doldurulmamış yeni eklenen satırlar önizlemeye YANSITILMAZ — aksi halde
  // SiteHeader/SiteFooter bunları `<a href="">` (erişilebilir ismi olmayan link, axe-core
  // "link-name" kritik ihlali) olarak render eder.
  const previewNavigationItems = toNavigationItemsPayload(
    navigationItems.filter((item) => item.label.trim() && item.href.trim())
  );
  const previewSocialLinks = socialLinks
    .filter((link) => link.url.trim())
    .map((link, index) => ({ id: link.localId, platform: link.platform, url: link.url, order: index }));
  const previewFooterColumns = footerColumns.map((col, index) => ({
    id: col.localId,
    title: col.title,
    order: index,
    links: col.links
      .filter((link) => link.label.trim() && link.href.trim())
      .map((link, linkIndex) => ({ id: link.localId, label: link.label, href: link.href, order: linkIndex })),
  }));

  return (
    <div className="space-y-6">
      <PageHeading icon={LayoutTemplate} title="Navigasyon Yönetimi" description="Menüleri ve site konumlarını yönetin." />

      {saveError && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {saveError}
          </span>
        </Alert>
      )}

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const nextTab = String(value);
          if (hasUnsavedChangesForTab(activeTab) && nextTab !== activeTab) {
            if (!window.confirm(UNSAVED_CHANGES_WARNING)) return;
          }
          setActiveTab(nextTab);
        }}
      >
        <TabsList variant="line">
          <TabsTrigger value="menus">
            <ListTree className="h-3.5 w-3.5" />
            Menüleri Düzenle
            {menuHasUnsavedChanges && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />}
          </TabsTrigger>
          <TabsTrigger value="locations">
            <LayoutTemplate className="h-3.5 w-3.5" />
            Konumları Yönet
            {locationsHasUnsavedChanges && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="menus" className="mt-6 outline-none">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="w-full lg:sticky lg:top-6 lg:w-[340px] lg:shrink-0"
            >
              <Card className="space-y-3 p-2">
                <div className="px-2 pt-1">
                  <h2 className="admin-h2">İçerik Ekle</h2>
                  <p className="mt-1 admin-text-secondary">Bir sayfa, yazı ya da özel bağlantı seçip menüye ekleyin.</p>
                </div>
                <ContentPickerPanel
                  sections={pickerSections}
                  existingHrefs={existingHrefs}
                  hrefHint={HREF_HINT}
                  onAddItems={handleAddItems}
                />
              </Card>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              className="min-w-0 flex-1"
            >
              <Card className="space-y-4">
                <div>
                  <h2 className="admin-h2">Menü Yapısı</h2>
                  <p className="mt-1 admin-text-secondary">
                    Sürükleyerek sıralayın; sağa sürükleyerek (veya girinti butonlarıyla) bir üst öğenin altına taşıyın.
                  </p>
                </div>
                <NavTreeEditor items={navigationItems} onChange={setNavigationItems} hrefHint={HREF_HINT} />
              </Card>
            </motion.div>
          </div>
        </TabsContent>

        <TabsContent value="locations" className="mt-6 outline-none">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_420px] lg:items-start">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              <SectionCard title="Logo & Marka" description="Sitenin adı ve logosu — header'da ve önizlemede kullanılır.">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label htmlFor="siteName" className="block text-sm font-medium text-foreground">
                      Site adı
                    </label>
                    <Input id="siteName" value={siteName} onChange={(e) => setSiteName(e.target.value)} />
                  </div>
                  <ImageUploadField id="logoUrl" label="Logo" value={logoUrl} onChange={setLogoUrl} />
                </div>
              </SectionCard>

              <SectionCard title="Header CTA" description="Header'da menünün sağında öne çıkan buton (opsiyonel).">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label htmlFor="ctaLabel" className="block text-sm font-medium text-foreground">
                      Buton metni
                    </label>
                    <Input id="ctaLabel" value={headerCtaLabel} onChange={(e) => setHeaderCtaLabel(e.target.value)} placeholder="Giriş Yap" />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="ctaHref" className="block text-sm font-medium text-foreground">
                      Bağlantı
                    </label>
                    <Input id="ctaHref" value={headerCtaHref} onChange={(e) => setHeaderCtaHref(e.target.value)} placeholder="/login" />
                  </div>
                </div>
                <p className="text-xs text-foreground/50">{HREF_HINT} Her iki alan da doluysa buton gösterilir.</p>
              </SectionCard>

              <SectionCard title="Footer" description="Footer'daki telif hakkı metni.">
                <div className="space-y-1.5">
                  <label htmlFor="footerCopyright" className="block text-sm font-medium text-foreground">
                    Telif hakkı metni
                  </label>
                  <Input
                    id="footerCopyright"
                    value={footerCopyrightText}
                    onChange={(e) => setFooterCopyrightText(e.target.value)}
                    placeholder={`© ${new Date().getFullYear()} ${siteName || "Site"}`}
                  />
                  <p className="text-xs text-foreground/60">
                    Boş bırakılırsa © {new Date().getFullYear()} {siteName || "Site"} otomatik gösterilir. Doldurursanız yıl otomatik
                    eklenmez, isterseniz metne kendiniz yazın.
                  </p>
                </div>
              </SectionCard>

              <SectionCard title="Sosyal Medya Linkleri" description="Footer'da gösterilecek sosyal medya ikonları.">
                <div className="space-y-3">
                  {socialLinks.length === 0 && (
                    <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-foreground/50">
                      Henüz sosyal link yok.
                    </p>
                  )}
                  {socialLinks.map((link, index) => (
                    <div key={link.localId} className="flex flex-wrap items-end gap-2 rounded-lg border border-border/60 p-3">
                      <div className="min-w-[140px] space-y-1.5">
                        <label htmlFor={`social-platform-${link.localId}`} className="block text-xs font-medium text-foreground/70">
                          Platform
                        </label>
                        <Select
                          id={`social-platform-${link.localId}`}
                          value={link.platform}
                          onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                            updateSocialLink(index, { platform: e.target.value as SocialPlatform })
                          }
                        >
                          {SOCIAL_PLATFORM_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="min-w-[180px] flex-1 space-y-1.5">
                        <label htmlFor={`social-url-${link.localId}`} className="block text-xs font-medium text-foreground/70">
                          URL
                        </label>
                        <Input
                          id={`social-url-${link.localId}`}
                          value={link.url}
                          onChange={(e) => updateSocialLink(index, { url: e.target.value })}
                          placeholder="https://twitter.com/..."
                        />
                      </div>
                      <RowActions
                        index={index}
                        length={socialLinks.length}
                        onMoveUp={() => moveSocialLink(index, -1)}
                        onMoveDown={() => moveSocialLink(index, 1)}
                        onRemove={() => removeSocialLink(index)}
                      />
                    </div>
                  ))}
                  <p className="text-xs text-foreground/50">{HREF_HINT}</p>
                  <Button type="button" variant="secondary" size="sm" onClick={addSocialLink}>
                    <Plus /> Sosyal Link Ekle
                  </Button>
                </div>
              </SectionCard>

              <SectionCard title="Footer Sütunları" description="Footer'da sütunlar halinde gösterilecek link grupları.">
                <div className="space-y-4">
                  {footerColumns.length === 0 && (
                    <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-foreground/50">
                      Henüz footer sütunu yok.
                    </p>
                  )}
                  {footerColumns.map((column, columnIndex) => (
                    <Card key={column.localId} className="space-y-3 bg-surface-muted/40">
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="min-w-[160px] flex-1 space-y-1.5">
                          <label htmlFor={`col-title-${column.localId}`} className="block text-xs font-medium text-foreground/70">
                            Sütun başlığı
                          </label>
                          <Input
                            id={`col-title-${column.localId}`}
                            value={column.title}
                            onChange={(e) => updateFooterColumnTitle(columnIndex, e.target.value)}
                            placeholder="Ör. Şirket"
                          />
                        </div>
                        <RowActions
                          index={columnIndex}
                          length={footerColumns.length}
                          onMoveUp={() => moveFooterColumn(columnIndex, -1)}
                          onMoveDown={() => moveFooterColumn(columnIndex, 1)}
                          onRemove={() => removeFooterColumn(columnIndex)}
                        />
                      </div>

                      <div className="space-y-2 pl-2">
                        {column.links.map((link, linkIndex) => (
                          <div key={link.localId} className="flex flex-wrap items-end gap-2 rounded-lg border border-border/60 p-3">
                            <div className="min-w-[120px] flex-1 space-y-1.5">
                              <label htmlFor={`col-link-label-${link.localId}`} className="block text-xs font-medium text-foreground/70">
                                Etiket
                              </label>
                              <Input
                                id={`col-link-label-${link.localId}`}
                                value={link.label}
                                onChange={(e) => updateFooterColumnLink(columnIndex, linkIndex, { label: e.target.value })}
                                placeholder="Ör. Gizlilik Politikası"
                              />
                            </div>
                            <div className="min-w-[140px] flex-1 space-y-1.5">
                              <label htmlFor={`col-link-href-${link.localId}`} className="block text-xs font-medium text-foreground/70">
                                Bağlantı
                              </label>
                              <Input
                                id={`col-link-href-${link.localId}`}
                                value={link.href}
                                onChange={(e) => updateFooterColumnLink(columnIndex, linkIndex, { href: e.target.value })}
                                placeholder="/gizlilik"
                              />
                            </div>
                            <RowActions
                              index={linkIndex}
                              length={column.links.length}
                              onMoveUp={() => moveFooterColumnLink(columnIndex, linkIndex, -1)}
                              onMoveDown={() => moveFooterColumnLink(columnIndex, linkIndex, 1)}
                              onRemove={() => removeFooterColumnLink(columnIndex, linkIndex)}
                            />
                          </div>
                        ))}
                        <Button type="button" variant="secondary" size="sm" onClick={() => addFooterColumnLink(columnIndex)}>
                          <Plus /> Link Ekle
                        </Button>
                      </div>
                    </Card>
                  ))}
                  <p className="text-xs text-foreground/50">{HREF_HINT}</p>
                  <Button type="button" variant="secondary" size="sm" onClick={addFooterColumn}>
                    <Plus /> Sütun Ekle
                  </Button>
                </div>
              </SectionCard>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
              className="space-y-2 lg:sticky lg:top-6"
            >
              <p className="text-xs font-medium tracking-wide text-foreground/50 uppercase">Canlı Önizleme</p>
              <div className="overflow-hidden rounded-xl border border-border">
                <SiteHeader
                  settings={previewSettings}
                  pages={publishedPages}
                  navigationItems={previewNavigationItems}
                  ctaLabel={headerCtaLabel}
                  ctaHref={headerCtaHref}
                />
                <div className="flex min-h-24 items-center justify-center bg-muted/30 px-4 py-8 text-center text-xs text-foreground/40">
                  Sayfa içeriği
                </div>
                <SiteFooter
                  siteName={siteName}
                  socialLinks={previewSocialLinks}
                  footerColumns={previewFooterColumns}
                  copyrightText={footerCopyrightText}
                />
              </div>
            </motion.div>
          </div>
        </TabsContent>
      </Tabs>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.4 }}
        className="sticky bottom-6 z-10 flex justify-end"
      >
        <Card className="flex items-center gap-3 p-3 shadow-lg">
          {(menuHasUnsavedChanges || locationsHasUnsavedChanges) && !saving && (
            <span className="flex items-center gap-1.5 text-xs text-warning">
              <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />
              Kaydedilmemiş değişiklikler var
            </span>
          )}
          {saving && <span className="text-xs admin-text-secondary">Kaydediliyor…</span>}
          <Button type="button" loading={saving} onClick={handleSave}>
            Kaydet
          </Button>
        </Card>
      </motion.div>
    </div>
  );
}
