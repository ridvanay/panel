"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import * as settingsApi from "@/lib/api/settings";
import * as pagesApi from "@/lib/api/pages";
import type { PermissionsMatrix, SitePage, SiteRole } from "@/lib/api/types";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import { PageHeading } from "@/components/admin/page-heading";
import { LocaleManager } from "@/components/admin/locale-manager";
import { cn } from "@/lib/utils";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { useT } from "@/context/i18n-context";
import type { SiteTemplate } from "@/lib/api/types";
import {
  AlertCircle,
  Briefcase,
  CheckCircle2,
  Globe,
  ImageIcon,
  Languages,
  Lock,
  Mail,
  ShieldCheck,
  ShoppingBag,
  Settings2,
} from "lucide-react";

const SITE_TEMPLATE_OPTIONS: { value: SiteTemplate; label: string; description: string; icon: typeof Globe }[] = [
  { value: "SHOWCASE", label: "Tanıtım Sitesi", description: "Kurumsal/tanıtım odaklı sayfalar.", icon: Globe },
  { value: "COMMERCE", label: "Satış Sitesi", description: "Ürün kataloğu ve satış akışı önerilir.", icon: ShoppingBag },
  { value: "PORTFOLIO", label: "Portföy Sitesi", description: "Proje/portföy vitrini önerilir.", icon: Briefcase },
];

const gridVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
} as const;

const ACTION_LABELS: Record<string, string> = {
  view: "Görüntüle",
  create: "Oluştur",
  edit: "Düzenle",
  delete: "Sil",
};

function actionLabel(key: string) {
  return ACTION_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

const ROLE_LETTERS: Record<SiteRole, string> = {
  ADMIN: "A",
  EDITOR: "E",
  VIEWER: "V",
};

interface GeneralSettingsSnapshot {
  siteName: string;
  logoUrl: string;
  homePageId: string;
  siteTemplate: SiteTemplate;
}

function RoleBadge({ role, active }: { role: SiteRole; active: boolean }) {
  return (
    <span
      title={`${role}${active ? " — izinli" : " — izinsiz"}`}
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold ring-1 transition",
        active ? "bg-primary/15 text-primary ring-primary/30" : "bg-muted text-muted-foreground/60 ring-border"
      )}
    >
      {ROLE_LETTERS[role]}
    </span>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Globe;
  title: string;
  description: string;
}) {
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

export default function AdminSettingsPage() {
  const t = useT();
  const [activeTab, setActiveTab] = useState("general");

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const [siteName, setSiteName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [homePageId, setHomePageId] = useState("");
  const [siteTemplate, setSiteTemplate] = useState<SiteTemplate>("SHOWCASE");
  const [publishedPages, setPublishedPages] = useState<SitePage[]>([]);
  const [snapshot, setSnapshot] = useState<GeneralSettingsSnapshot | null>(null);

  const [permissions, setPermissions] = useState<PermissionsMatrix | null>(null);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [permissionsError, setPermissionsError] = useState<string | null>(null);
  // Başarılı ya da başarısız (örn. 403) fark etmeksizin "bu oturumda zaten denendi" bayrağı.
  // Ref olduğu için değişimi bileşeni yeniden render etmez / effect'i yeniden tetiklemez.
  const permissionsAttemptedRef = useRef(false);

  const load = useCallback(async () => {
    // Yeniden deneme (retry) senaryosunda önceki hata mesajı ekranda takılı kalmasın diye
    // her çağrıda sıfırlanır — ilk yüklemede zaten `null` olduğundan davranış değişmez.
    setLoadError(null);
    try {
      const [settings, pages] = await Promise.all([settingsApi.getSettings(), pagesApi.listPages()]);
      setSiteName(settings.siteName);
      setLogoUrl(settings.logoUrl ?? "");
      setHomePageId(settings.homePageId ?? "");
      setSiteTemplate(settings.siteTemplate);
      setPublishedPages(pages.items.filter((page) => page.status === "PUBLISHED"));
      setSnapshot({
        siteName: settings.siteName,
        logoUrl: settings.logoUrl ?? "",
        homePageId: settings.homePageId ?? "",
        siteTemplate: settings.siteTemplate,
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

  const hasUnsavedChanges = useMemo(() => {
    if (!snapshot) return false;
    return (
      siteName !== snapshot.siteName ||
      logoUrl !== snapshot.logoUrl ||
      homePageId !== snapshot.homePageId ||
      siteTemplate !== snapshot.siteTemplate
    );
  }, [siteName, logoUrl, homePageId, siteTemplate, snapshot]);

  // §10.12.8 — ortak hook: beforeunload + `/admin` linklerine capture-phase tıklama uyarısı
  // (davranış öncekiyle AYNI, sadece kod paylaşılıyor).
  const { confirmDiscard } = useUnsavedChangesGuard({ enabled: hasUnsavedChanges });

  const loadPermissions = useCallback(async () => {
    // Ref kontrolü senkron ve stabildir: aynı render/effect döngüsünde iki kez
    // çağrılsa bile (StrictMode dahil) ikinci çağrı burada engellenir.
    if (permissionsAttemptedRef.current) return;
    permissionsAttemptedRef.current = true;
    setPermissionsLoading(true);
    setPermissionsError(null);
    try {
      const matrix = await settingsApi.getPermissionsMatrix();
      setPermissions(matrix);
    } catch (err) {
      setPermissionsError(friendlyErrorMessage(err));
    } finally {
      setPermissionsLoading(false);
    }
  }, []);

  // Sekme "Güvenlik & Rol İzinleri" ilk seçildiğinde matrisi getirir; başarılı ya da
  // başarısız (örn. 403) sonuçtan bağımsız olarak bileşenin ömrü boyunca sadece 1 kez dener.
  // `loadPermissions` referansı sabit (deps: []) olduğu için bu effect yalnızca `activeTab`
  // değiştiğinde yeniden çalışır; state güncellemeleri effect'i tekrar tetiklemez.
  useEffect(() => {
    if (activeTab === "security") {
      (async () => {
        await loadPermissions();
      })();
    }
  }, [activeTab, loadPermissions]);

  const actionColumns = useMemo(() => {
    if (!permissions) return [] as string[];
    const seen = new Set<string>();
    const columns: string[] = [];
    for (const mod of permissions.modules) {
      for (const key of Object.keys(mod.actions)) {
        if (!seen.has(key)) {
          seen.add(key);
          columns.push(key);
        }
      }
    }
    return columns;
  }, [permissions]);

  async function handleSave() {
    setSaveError(null);
    setSaved(false);
    setSaving(true);
    try {
      await settingsApi.updateSettings({
        siteName,
        logoUrl: logoUrl || null,
        homePageId: homePageId || null,
        siteTemplate,
      });
      setSaved(true);
      setSnapshot({ siteName, logoUrl, homePageId, siteTemplate });
      toast.success("Ayarlar kaydedildi.");
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
        <PageHeading
          icon={Settings2}
          title="Ayarlar"
          description="Sitenin adı, logosu ve ana sayfası gibi genel ayarlarını buradan yönet."
        />
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
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeading
        icon={Settings2}
        title="Ayarlar"
        description="Sitenin adı, logosu ve ana sayfası gibi genel ayarlarını buradan yönet."
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const nextTab = String(value);
          if (activeTab === "general" && hasUnsavedChanges && nextTab !== activeTab) {
            if (!confirmDiscard()) return;
          }
          setActiveTab(nextTab);
        }}
      >
        <TabsList variant="line">
          <TabsTrigger value="general">
            <Settings2 className="h-3.5 w-3.5" />
            Genel Ayarlar
            {hasUnsavedChanges && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />}
          </TabsTrigger>
          <TabsTrigger value="security">
            <ShieldCheck className="h-3.5 w-3.5" />
            Güvenlik &amp; Rol İzinleri
          </TabsTrigger>
          <TabsTrigger value="integrations">
            <Mail className="h-3.5 w-3.5" />
            E-posta / API Yapılandırmaları
          </TabsTrigger>
          <TabsTrigger value="languages">
            <Languages className="h-3.5 w-3.5" />
            {t("localeManager.tabLabel")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-6 space-y-6 outline-none">
          <AnimatePresence>
            {(saveError || saved) && (
              <motion.div
                key="settings-status"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-3"
              >
                {saveError && (
                  <Alert variant="error">
                    <span className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      {saveError}
                    </span>
                  </Alert>
                )}
                {saved && (
                  <Alert variant="success">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      Ayarlar kaydedildi.
                    </span>
                  </Alert>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div
            variants={gridVariants}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 gap-4 lg:grid-cols-3"
          >
            <motion.div variants={cardVariants} className="lg:col-span-2">
              <Card className="space-y-4">
                <SectionHeader icon={Globe} title="Genel" description="Sitenizin adı ve genel kimliği." />
                <Field
                  id="siteName"
                  label="Site adı"
                  hint="Logo yüklenmemişse header ve footer'da kullanılır. Sloganı düzenlemek ve canlı önizlemeyi görmek için Navigasyon → Site Kimliği bölümüne gidin."
                >
                  {(inputProps) => <Input {...inputProps} value={siteName} onChange={(e) => setSiteName(e.target.value)} />}
                </Field>
              </Card>
            </motion.div>

            <motion.div variants={cardVariants} className="lg:col-span-1">
              <Card className="space-y-4">
                <SectionHeader
                  icon={Settings2}
                  title="Sayfa Ayarları"
                  description="Ziyaretçilerin karşılaşacağı ana sayfayı seçin."
                />
                <Field id="homePageId" label="Ana sayfa" hint="Seçilmezse varsayılan tanıtım sayfası gösterilir.">
                  {(inputProps) => (
                    <Select {...inputProps} value={homePageId} onChange={(e) => setHomePageId(e.target.value)}>
                      <option value="">Varsayılan (tanıtım sayfası)</option>
                      {publishedPages.map((page) => (
                        <option key={page.id} value={page.id}>
                          {page.title}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </Card>
            </motion.div>

            <motion.div variants={cardVariants} className="lg:col-span-3">
              <Card className="space-y-4">
                <SectionHeader
                  icon={ShoppingBag}
                  title="Site Şablonu"
                  description="Sitenizin ağırlıklı kullanım amacını seçin — bu seçim SADECE modül önerisi göstermek içindir, hiçbir modülü otomatik açıp kapatmaz."
                />
                <div role="radiogroup" aria-label="Site şablonu" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {SITE_TEMPLATE_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    const active = option.value === siteTemplate;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setSiteTemplate(option.value)}
                        className={cn(
                          "flex items-start gap-2.5 rounded-lg border p-3 text-left transition-all duration-300",
                          active ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                            active ? "bg-primary/15 text-primary" : "bg-muted text-foreground/60"
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-foreground">{option.label}</span>
                          <span className="block text-xs text-foreground/60">{option.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Card>
            </motion.div>

            <motion.div variants={cardVariants} className="lg:col-span-3">
              <Card className="space-y-4">
                <SectionHeader icon={ImageIcon} title="Görünüm" description="Sitenizin logosu ve marka görseli." />
                <ImageUploadField id="logoUrl" label="Logo" value={logoUrl} onChange={setLogoUrl} />
              </Card>
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="sticky bottom-6 z-10 flex justify-end"
          >
            <Card className="flex items-center gap-3 p-3 shadow-lg">
              {hasUnsavedChanges && !saving && (
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
        </TabsContent>

        <TabsContent value="security" className="mt-6 outline-none">
          <motion.div variants={cardVariants} initial="hidden" animate="show">
            <Card className="space-y-4">
              <SectionHeader
                icon={ShieldCheck}
                title="Rol İzin Matrisi"
                description="Hangi rolün hangi modülde neler yapabildiğinin salt-okunur görünümü."
              />

              {permissionsError && (
                <Alert variant="error">
                  <span className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      {permissionsError}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        permissionsAttemptedRef.current = false;
                        void loadPermissions();
                      }}
                    >
                      Tekrar Dene
                    </Button>
                  </span>
                </Alert>
              )}

              {!permissionsError && permissionsLoading && (
                <div className="flex items-center justify-center py-10">
                  <Spinner className="h-6 w-6 text-primary" />
                </div>
              )}

              {!permissionsError && !permissionsLoading && permissions && (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Modül</TableHead>
                        {actionColumns.map((col) => (
                          <TableHead key={col} className="text-center">
                            {actionLabel(col)}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {permissions.modules.map((mod) => (
                        <TableRow key={mod.module}>
                          <TableCell className="font-medium whitespace-nowrap text-foreground">{mod.label}</TableCell>
                          {actionColumns.map((col) => {
                            const rolesForAction = mod.actions[col];
                            if (!rolesForAction) {
                              return (
                                <TableCell key={col} className="text-center text-muted-foreground">
                                  —
                                </TableCell>
                              );
                            }
                            return (
                              <TableCell key={col}>
                                <div className="flex items-center justify-center gap-1">
                                  {permissions.roles.map((role) => (
                                    <RoleBadge key={role} role={role} active={rolesForAction.includes(role)} />
                                  ))}
                                </div>
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  <p className="flex items-start gap-1.5 admin-text-secondary">
                    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Bu izin matrisi sistem tarafından tanımlanır ve bu ekrandan değiştirilemez.
                  </p>
                </>
              )}
            </Card>
          </motion.div>
        </TabsContent>

        <TabsContent value="integrations" className="mt-6 outline-none">
          <motion.div variants={cardVariants} initial="hidden" animate="show">
            <Card className="space-y-4">
              <SectionHeader
                icon={Mail}
                title="E-posta / API Yapılandırmaları"
                description="SMTP ve API entegrasyon ayarları."
              />

              <div className="inline-flex items-center gap-2 rounded-full border border-warning/30 bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
                <Lock className="h-3.5 w-3.5" />
                Yakında — bu yapılandırma henüz bu ortamda desteklenmiyor.
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id="smtpHost" label="SMTP Host">
                  {(inputProps) => <Input {...inputProps} disabled placeholder="smtp.ornek.com" />}
                </Field>
                <Field id="smtpPort" label="SMTP Port">
                  {(inputProps) => <Input {...inputProps} disabled placeholder="587" />}
                </Field>
                <Field id="smtpUser" label="SMTP Kullanıcı Adı">
                  {(inputProps) => <Input {...inputProps} disabled placeholder="ornek@site.com" />}
                </Field>
                <Field id="smtpPassword" label="SMTP Parola">
                  {(inputProps) => <Input {...inputProps} type="password" disabled placeholder="••••••••" />}
                </Field>
                <div className="sm:col-span-2">
                  <Field id="apiKey" label="API Anahtarı" hint="Harici entegrasyonlar için.">
                    {(inputProps) => <Input {...inputProps} disabled placeholder="sk_live_…" />}
                  </Field>
                </div>
              </div>

              <p className="flex items-start gap-1.5 admin-text-secondary">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Bu yapılandırma henüz bu ortamda desteklenmiyor.
              </p>
            </Card>
          </motion.div>
        </TabsContent>

        <TabsContent value="languages" className="mt-6 outline-none">
          <motion.div variants={cardVariants} initial="hidden" animate="show">
            <Card className="space-y-4">
              <SectionHeader
                icon={Languages}
                title={t("localeManager.title")}
                description={t("localeManager.description")}
              />
              <LocaleManager />
            </Card>
          </motion.div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
