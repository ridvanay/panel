"use client";

import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { AlertCircle, ArrowDown, ArrowUp, LayoutTemplate, Plus, Trash2 } from "lucide-react";
import * as settingsApi from "@/lib/api/settings";
import * as pagesApi from "@/lib/api/pages";
import * as navigationApi from "@/lib/api/navigation";
import type { SitePage, SocialPlatform, UpdateNavigationConfigRequest } from "@/lib/api/types";
import { PageHeading } from "@/components/admin/page-heading";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const HREF_HINT =
  "http(s):// ile başlayan tam bir bağlantı, / ile başlayan site-içi yol veya # ile başlayan bağlantı girin.";

const SOCIAL_PLATFORM_OPTIONS: { value: SocialPlatform; label: string }[] = [
  { value: "TWITTER", label: "Twitter / X" },
  { value: "GITHUB", label: "GitHub" },
  { value: "LINKEDIN", label: "LinkedIn" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "FACEBOOK", label: "Facebook" },
  { value: "YOUTUBE", label: "YouTube" },
  { value: "OTHER", label: "Diğer" },
];

interface LocalNavItem {
  localId: string;
  label: string;
  href: string;
}

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

function moveItem<T>(list: T[], index: number, direction: -1 | 1): T[] {
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
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [siteName, setSiteName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [publishedPages, setPublishedPages] = useState<SitePage[]>([]);

  const [navigationItems, setNavigationItems] = useState<LocalNavItem[]>([]);
  const [headerCtaLabel, setHeaderCtaLabel] = useState("");
  const [headerCtaHref, setHeaderCtaHref] = useState("");
  const [footerCopyrightText, setFooterCopyrightText] = useState("");
  const [socialLinks, setSocialLinks] = useState<LocalSocialLink[]>([]);
  const [footerColumns, setFooterColumns] = useState<LocalFooterColumn[]>([]);

  const load = useCallback(async () => {
    try {
      const [settings, pages, navConfig] = await Promise.all([
        settingsApi.getSettings(),
        pagesApi.listPages(),
        navigationApi.getNavigationConfig(),
      ]);

      setSiteName(settings.siteName);
      setLogoUrl(settings.logoUrl ?? "");
      setPublishedPages(pages.items.filter((page) => page.status === "PUBLISHED"));

      setHeaderCtaLabel(navConfig.headerCtaLabel ?? "");
      setHeaderCtaHref(navConfig.headerCtaHref ?? "");
      setFooterCopyrightText(navConfig.footerCopyrightText ?? "");

      setNavigationItems(
        [...navConfig.navigationItems]
          .sort((a, b) => a.order - b.order)
          .map((item) => ({ localId: crypto.randomUUID(), label: item.label, href: item.href }))
      );
      setSocialLinks(
        [...navConfig.socialLinks]
          .sort((a, b) => a.order - b.order)
          .map((link) => ({ localId: crypto.randomUUID(), platform: link.platform, url: link.url }))
      );
      setFooterColumns(
        [...navConfig.footerColumns]
          .sort((a, b) => a.order - b.order)
          .map((column) => ({
            localId: crypto.randomUUID(),
            title: column.title,
            links: [...column.links]
              .sort((a, b) => a.order - b.order)
              .map((link) => ({ localId: crypto.randomUUID(), label: link.label, href: link.href })),
          }))
      );

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

  // --- Navigasyon menüsü ---
  function addNavItem() {
    setNavigationItems((prev) => [...prev, { localId: crypto.randomUUID(), label: "", href: "" }]);
  }
  function updateNavItem(index: number, patch: Partial<Omit<LocalNavItem, "localId">>) {
    setNavigationItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }
  function moveNavItem(index: number, direction: -1 | 1) {
    setNavigationItems((prev) => moveItem(prev, index, direction));
  }
  function removeNavItem(index: number) {
    setNavigationItems((prev) => prev.filter((_, i) => i !== index));
  }

  // --- Sosyal medya linkleri ---
  function addSocialLink() {
    setSocialLinks((prev) => [...prev, { localId: crypto.randomUUID(), platform: "TWITTER", url: "" }]);
  }
  function updateSocialLink(index: number, patch: Partial<Omit<LocalSocialLink, "localId">>) {
    setSocialLinks((prev) => prev.map((link, i) => (i === index ? { ...link, ...patch } : link)));
  }
  function moveSocialLink(index: number, direction: -1 | 1) {
    setSocialLinks((prev) => moveItem(prev, index, direction));
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
    setFooterColumns((prev) => moveItem(prev, index, direction));
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
      prev.map((col, i) => (i === columnIndex ? { ...col, links: moveItem(col.links, linkIndex, direction) } : col))
    );
  }
  function removeFooterColumnLink(columnIndex: number, linkIndex: number) {
    setFooterColumns((prev) =>
      prev.map((col, i) => (i === columnIndex ? { ...col, links: col.links.filter((_, j) => j !== linkIndex) } : col))
    );
  }

  async function handleSave() {
    setSaveError(null);
    setSaving(true);
    try {
      const payload: UpdateNavigationConfigRequest = {
        headerCtaLabel: headerCtaLabel.trim() || null,
        headerCtaHref: headerCtaHref.trim() || null,
        footerCopyrightText: footerCopyrightText.trim() || null,
        navigationItems: navigationItems.map((item, index) => ({ label: item.label, href: item.href, order: index })),
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
        <PageHeading icon={LayoutTemplate} title="Navigasyon Yönetimi" description="Header menüsü, CTA butonu ve footer'ı yönetin." />
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {loadError}
          </span>
        </Alert>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="space-y-6">
        <PageHeading icon={LayoutTemplate} title="Navigasyon Yönetimi" description="Header menüsü, CTA butonu ve footer'ı yönetin." />
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      </div>
    );
  }

  const previewSettings = { siteName, logoUrl: logoUrl || null, homePageId: null, siteTemplate: "SHOWCASE" as const };
  // Henüz label/href/url doldurulmamış yeni eklenen satırlar önizlemeye YANSITILMAZ — aksi
  // halde SiteHeader/SiteFooter bunları `<a href="">` (erişilebilir ismi olmayan link, axe-core
  // "link-name" kritik ihlali) olarak render eder (bkz. qa-agent a11y bulgusu).
  const previewNavigationItems = navigationItems
    .filter((item) => item.label.trim() && item.href.trim())
    .map((item, index) => ({
      id: item.localId,
      label: item.label,
      href: item.href,
      order: index,
    }));
  const previewSocialLinks = socialLinks
    .filter((link) => link.url.trim())
    .map((link, index) => ({
      id: link.localId,
      platform: link.platform,
      url: link.url,
      order: index,
    }));
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
      <PageHeading
        icon={LayoutTemplate}
        title="Navigasyon Yönetimi"
        description="Header menüsü, CTA butonu ve footer'ı yönetin."
        actions={
          <Button loading={saving} onClick={handleSave}>
            Kaydet
          </Button>
        }
      />

      {saveError && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {saveError}
          </span>
        </Alert>
      )}

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

          <SectionCard title="Navigasyon Menüsü" description="Header'da görünecek menü linkleri. Boş bırakılırsa yayındaki sayfalar otomatik listelenir.">
            <div className="space-y-3">
              {navigationItems.length === 0 && (
                <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-foreground/50">
                  Henüz menü öğesi yok.
                </p>
              )}
              {navigationItems.map((item, index) => (
                <div key={item.localId} className="flex flex-wrap items-end gap-2 rounded-lg border border-border/60 p-3">
                  <div className="min-w-[140px] flex-1 space-y-1.5">
                    <label htmlFor={`nav-label-${item.localId}`} className="block text-xs font-medium text-foreground/70">
                      Etiket
                    </label>
                    <Input
                      id={`nav-label-${item.localId}`}
                      value={item.label}
                      onChange={(e) => updateNavItem(index, { label: e.target.value })}
                      placeholder="Ör. Hakkımızda"
                    />
                  </div>
                  <div className="min-w-[180px] flex-1 space-y-1.5">
                    <label htmlFor={`nav-href-${item.localId}`} className="block text-xs font-medium text-foreground/70">
                      Bağlantı
                    </label>
                    <Input
                      id={`nav-href-${item.localId}`}
                      value={item.href}
                      onChange={(e) => updateNavItem(index, { href: e.target.value })}
                      placeholder="/hakkimizda"
                    />
                  </div>
                  <RowActions
                    index={index}
                    length={navigationItems.length}
                    onMoveUp={() => moveNavItem(index, -1)}
                    onMoveDown={() => moveNavItem(index, 1)}
                    onRemove={() => removeNavItem(index)}
                  />
                </div>
              ))}
              <p className="text-xs text-foreground/50">{HREF_HINT}</p>
              <Button type="button" variant="secondary" size="sm" onClick={addNavItem}>
                <Plus /> Menü Öğesi Ekle
              </Button>
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
    </div>
  );
}
