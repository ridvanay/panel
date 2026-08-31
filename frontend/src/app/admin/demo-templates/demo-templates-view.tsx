"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  LayoutTemplate,
  Lock,
  MinusCircle,
  PlusCircle,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/context/auth-context";
import * as demoTemplatesApi from "@/lib/api/demo-templates";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type {
  DemoTemplateConflictDetails,
  DemoTemplateContents,
  DemoTemplateImportResult,
  DemoTemplateReplacesField,
  DemoTemplateSummary,
} from "@/lib/api/types";
import { PageHeading } from "@/components/admin/page-heading";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

// §6.1 yıkıcılık matrisi — bağlayıcı, madde madde gösterilmesi ZORUNLU
// (`.claude/architect-scope-demo-template-import.md` §6.1 / §11).
const REPLACES_LABELS: Record<DemoTemplateReplacesField, string> = {
  appearance: "Site renkleri, tipografi ve bileşen stilleri",
  siteSettings: "Site adı, slogan, header buton metni/linki ve footer telif metni",
  navigation: "Navigasyon menünüz",
  footer: "Footer sütunlarınız ve linkleriniz",
  socialLinks: "Sosyal medya linkleriniz",
  homePage: "Ana sayfa ayarınız (yalnızca \"Ana sayfa yap\" seçiliyse)",
};

const CONTENTS_LABELS: { key: keyof DemoTemplateContents; label: string }[] = [
  { key: "pages", label: "sayfa" },
  { key: "sliders", label: "slider" },
  { key: "slides", label: "slayt" },
  { key: "portfolioCategories", label: "portföy kategorisi" },
  { key: "portfolioItems", label: "portföy öğesi" },
  { key: "navigationItems", label: "navigasyon öğesi" },
  { key: "footerColumns", label: "footer sütunu" },
  { key: "mediaAssets", label: "medya varlığı" },
];

interface ConflictState {
  template: DemoTemplateSummary;
  details: DemoTemplateConflictDetails | null;
}

export function DemoTemplatesView() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const [templates, setTemplates] = useState<DemoTemplateSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [confirmTarget, setConfirmTarget] = useState<DemoTemplateSummary | null>(null);
  const [setAsHomePage, setSetAsHomePage] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [forceImporting, setForceImporting] = useState(false);

  const [result, setResult] = useState<DemoTemplateImportResult | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await demoTemplatesApi.fetchDemoTemplates();
      setTemplates(list);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  function openConfirm(template: DemoTemplateSummary) {
    setImportError(null);
    setSetAsHomePage(true);
    setConfirmTarget(template);
  }

  async function runImport(template: DemoTemplateSummary, options: { force: boolean }) {
    const setBusy = options.force ? setForceImporting : setImporting;
    setBusy(true);
    setImportError(null);
    try {
      const res = await demoTemplatesApi.importDemoTemplate(template.key, {
        confirm: true,
        force: options.force,
        setAsHomePage,
      });
      setConfirmTarget(null);
      setConflict(null);
      setResult(res);
      await load(); // "Uygulandı" rozetini yerelde tazele
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409 && !options.force) {
        // `error.details` (`ApiClientError.details` genel tipi Record<string,string[]> varsayar;
        // gerçek çalışma-zamanı şekli burada AYRICA okunur — bkz. sliders/page.tsx::extractUsedBy
        // ile AYNI desen).
        const details = (err.details as unknown as DemoTemplateConflictDetails | undefined) ?? null;
        setConfirmTarget(null);
        setConflict({ template, details });
      } else if (err instanceof ApiClientError && err.status === 429) {
        setImportError("Çok fazla deneme yapıldı. Lütfen bir dakika bekleyip tekrar deneyin.");
      } else {
        // 422 (`confirm` eksik — savunma amaçlı; bu istemci her zaman `confirm: true` gönderir) ve
        // diğer beklenmeyen hatalar için backend mesajı olduğu gibi gösterilir.
        setImportError(friendlyErrorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  function closeConfirm() {
    if (importing) return;
    setConfirmTarget(null);
    setImportError(null);
  }

  function closeConflict() {
    if (forceImporting) return;
    setConflict(null);
    setImportError(null);
  }

  /** Başarı sonrası ZORUNLU tam sayfa yenileme (§11 bağlayıcı UI kuralı) — appearance/nav/footer
   *  değişti, mevcut istemci state'i (`AccentProvider`/`ModulesProvider` dahil, ikisi de yalnızca
   *  mount'ta fetch eder) artık yalandır. Next.js `router.refresh()` yalnızca sunucu bileşenlerini
   *  yeniden getirir ve bu istemci context'lerini INVALIDATE ETMEZ — bu yüzden tam bir tarayıcı
   *  yenilemesi (`window.location.reload()`) kullanılır. */
  function closeResult() {
    setResult(null);
    window.location.reload();
  }

  return (
    <div className="space-y-6">
      <PageHeading
        icon={LayoutTemplate}
        title="Hazır Şablonlar"
        description="Tek tıkla sitenize kurumsal bir demo görünümü uygulayın; ardından kendi içeriğinizle değiştirin."
      />

      {!isAdmin && (
        <Alert variant="info">
          <span className="flex items-center gap-2">
            <Lock className="h-4 w-4 shrink-0" />
            Hazır şablonları yalnızca ADMIN rolündeki kullanıcılar uygulayabilir. Bu ekranı salt-okunur görüntülüyorsunuz.
          </span>
        </Alert>
      )}

      {loadError && (
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
      )}

      {!loadError && templates === null && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Şablonlar yükleniyor">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="space-y-4 p-0 overflow-hidden">
              <Skeleton className="aspect-video w-full rounded-none" />
              <div className="space-y-3 p-5">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-8 w-full" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {!loadError && templates !== null && templates.length === 0 && (
        <EmptyState
          icon={LayoutTemplate}
          title="Henüz demo şablonu yok"
          description="Yeni hazır şablonlar eklendiğinde burada listelenecek."
        />
      )}

      {!loadError && templates !== null && templates.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => {
            const applied = template.appliedAt !== null;
            return (
              <motion.div key={template.key} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                <Card className="flex h-full flex-col overflow-hidden p-0">
                  <div className="relative aspect-video w-full overflow-hidden bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element -- küçük statik önizleme, next/image gerekmez (frontend/public statiği, Media DEĞİL) */}
                    <img src={template.previewImageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                    {applied && (
                      <span className="absolute right-2 top-2">
                        <Badge tone="success" solid>
                          Uygulandı
                        </Badge>
                      </span>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col gap-3 p-5">
                    <div>
                      <h3 className="font-heading text-base font-semibold text-foreground">{template.name}</h3>
                      <p className="mt-1 text-sm text-foreground/60">{template.description}</p>
                    </div>

                    {template.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {template.tags.map((tag) => (
                          <Badge key={tag} tone="neutral" size="sm">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {template.palette.length > 0 && (
                      <div className="flex items-center gap-1.5" aria-hidden="true">
                        {template.palette.map((hex, i) => (
                          <span key={`${hex}-${i}`} className="h-4 w-4 rounded-full border border-border/60" style={{ backgroundColor: hex }} />
                        ))}
                      </div>
                    )}

                    {applied && template.appliedAt && (
                      <p className="text-xs text-foreground/50">
                        {formatDate(template.appliedAt)} tarihinde
                        {template.appliedByName ? ` ${template.appliedByName} tarafından` : ""} uygulandı.
                        {template.appliedPageId && (
                          <>
                            {" "}
                            <Link href={`/admin/pages/${template.appliedPageId}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                              Sayfayı aç
                            </Link>
                          </>
                        )}
                      </p>
                    )}

                    <div className="mt-auto pt-2">
                      {isAdmin ? (
                        <Button type="button" className="w-full" variant={applied ? "outline" : "default"} onClick={() => openConfirm(template)}>
                          <Sparkles className="h-4 w-4" />
                          {applied ? "Yeniden Uygula" : "Uygula"}
                        </Button>
                      ) : (
                        <div className="space-y-1.5">
                          <Button
                            type="button"
                            className="w-full"
                            disabled
                            aria-label="Uygula (yalnızca yöneticiler için)"
                            title="Bu işlemi yalnızca yöneticiler yapabilir"
                          >
                            <Sparkles className="h-4 w-4" />
                            Uygula
                          </Button>
                          <p className="text-center text-xs text-foreground/50">Bu işlemi yalnızca yöneticiler yapabilir.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Onay diyaloğu — §6.1 yıkıcılık matrisi madde madde + ilerleme göstergesi. */}
      <Dialog open={confirmTarget !== null} onOpenChange={(open) => !open && closeConfirm()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
                <AlertTriangle className="h-4 w-4" />
              </span>
              <div>
                <DialogTitle>&quot;{confirmTarget?.name}&quot; şablonunu uygula</DialogTitle>
                <DialogDescription className="mt-1">Bu işlem sitenizde kalıcı değişiklikler yapar ve geri alınamaz.</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <Alert variant="warning">
            Navigasyon menünüz, footer&apos;ınız, sosyal medya linkleriniz ve site renkleriniz SİLİNİP şablonunkilerle
            değiştirilecek.
          </Alert>

          {confirmTarget?.replaces && confirmTarget.replaces.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium tracking-wide text-foreground/50 uppercase">Üzerine yazılacak / silinecek</p>
              <ul className="space-y-1 text-sm">
                {confirmTarget.replaces.map((field) => (
                  <li key={field} className="flex items-start gap-2">
                    <MinusCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
                    <span>{REPLACES_LABELS[field]}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {confirmTarget && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium tracking-wide text-foreground/50 uppercase">Yeni eklenecek içerik</p>
              <div className="grid grid-cols-2 gap-1.5 text-sm text-foreground/70">
                {CONTENTS_LABELS.filter((c) => confirmTarget.contents[c.key] > 0).map((c) => (
                  <span key={c.key} className="flex items-center gap-1.5">
                    <PlusCircle className="h-3.5 w-3.5 shrink-0 text-success" />
                    {confirmTarget.contents[c.key]} {c.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-foreground">Ana sayfa yap</p>
              <p className="text-xs text-foreground/60">Oluşturulan sayfa sitenizin yeni ana sayfası olur.</p>
            </div>
            <Switch checked={setAsHomePage} onCheckedChange={setSetAsHomePage} aria-label="Oluşturulan sayfayı ana sayfa yap" />
          </div>

          {importing && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-foreground/70">
              <Spinner className="h-4 w-4 shrink-0 text-primary" />
              Şablon uygulanıyor, bu birkaç saniye sürebilir…
            </div>
          )}

          {importError && (
            <Alert variant="error">
              <span className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {importError}
              </span>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeConfirm} disabled={importing}>
              Vazgeç
            </Button>
            <Button
              type="button"
              variant="warning"
              loading={importing}
              onClick={() => confirmTarget && void runImport(confirmTarget, { force: false })}
            >
              Uygula
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 409 — şablon zaten uygulanmış: ikinci onay + `force: true` ile yeniden uygulama. */}
      <Dialog open={conflict !== null} onOpenChange={(open) => !open && closeConflict()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
                <AlertTriangle className="h-4 w-4" />
              </span>
              <div>
                <DialogTitle>Şablon zaten uygulanmış</DialogTitle>
                <DialogDescription className="mt-1">
                  {conflict?.details ? (
                    <>
                      &quot;{conflict.template.name}&quot; şablonu {formatDate(conflict.details.importedAt)} tarihinde
                      {conflict.details.importedBy ? ` ${conflict.details.importedBy} tarafından` : ""} uygulanmış (sürüm{" "}
                      {conflict.details.version}). Yine de yeniden uygulansın mı?
                    </>
                  ) : (
                    <>&quot;{conflict?.template.name}&quot; şablonu daha önce uygulanmış. Yine de yeniden uygulansın mı?</>
                  )}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <Alert variant="info">
            Yeniden uygularsanız navigasyon, footer, sosyal linkler ve site görünümü güncel şablonla tekrar üzerine
            yazılır. Ancak önceki uygulamanın oluşturduğu sayfa, slider ve portföy içerikleri SİLİNMEZ — bunun yerine
            ikinci bir kopya oluşturulur.
          </Alert>

          {conflict?.details?.pageId && (
            <Link
              href={`/admin/pages/${conflict.details.pageId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Önceki uygulamanın sayfasını aç
            </Link>
          )}

          {forceImporting && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-foreground/70">
              <Spinner className="h-4 w-4 shrink-0 text-primary" />
              Şablon yeniden uygulanıyor, bu birkaç saniye sürebilir…
            </div>
          )}

          {importError && (
            <Alert variant="error">
              <span className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {importError}
              </span>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeConflict} disabled={forceImporting}>
              Vazgeç
            </Button>
            <Button
              type="button"
              variant="warning"
              loading={forceImporting}
              onClick={() => conflict && void runImport(conflict.template, { force: true })}
            >
              Yine de Yeniden Uygula
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Başarı sonucu — uyarılar tek tek listelenir + oluşturulan kayıtlara doğrudan bağlantı. */}
      <Dialog open={result !== null} onOpenChange={(open) => !open && closeResult()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
                <CheckCircle2 className="h-4 w-4" />
              </span>
              <div>
                <DialogTitle>Şablon uygulandı</DialogTitle>
                <DialogDescription className="mt-1">
                  {result && `Sürüm ${result.version} — ${formatDate(result.importedAt)}`}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {result && result.warnings.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium tracking-wide text-foreground/50 uppercase">Uyarılar</p>
              <ul className="space-y-1 text-sm">
                {result.warnings.map((warning, i) => (
                  <li key={i} className="flex items-start gap-2 text-warning">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{warning}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result && (
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/admin/pages/${result.pageId}`}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Oluşturulan sayfayı aç
              </Link>
              {result.sliderId && (
                <Link
                  href={`/admin/sliders/${result.sliderId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Slider&apos;ı aç
                </Link>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" onClick={closeResult}>
              Tamam
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
