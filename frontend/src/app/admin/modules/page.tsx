"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Blocks, Lock } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { useModules } from "@/context/modules-context";
import * as modulesApi from "@/lib/api/modules";
import * as settingsApi from "@/lib/api/settings";
import type { SiteModule, SiteTemplate } from "@/lib/api/types";
import { PageHeading } from "@/components/admin/page-heading";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

/**
 * `.claude/architect-scope-telehealth-recording.md` F7 — bu modül anahtarını AÇMADAN ÖNCE
 * (toggle'a tıklayınca, onaydan ÖNCE) bir uyarı dialogu gösterilir. Metin bağlayıcıdır, AYNEN
 * kullanılır. Diğer modüllerin toggle davranışı DEĞİŞTİRİLMEZ — yalnızca BU anahtar için genel
 * toggle akışına ek bir onay adımı eklenir.
 */
const RECORDING_MODULE_KEY = "telehealth-recording";
const RECORDING_MODULE_WARNING =
  "Görüşme kaydı özel nitelikli sağlık verisi (ses+görüntü) oluşturur ve kalıcılaştırır. Bu özelliği etkinleştirmeden önce KVKK/GDPR uyumluluğu için gerçek bir hukuk danışmanına danışmanız ÖNEMLE ÖNERİLİR.";

export default function AdminModulesPage() {
  const { user } = useAuth();
  const { refetch } = useModules();
  const isAdmin = user?.role === "ADMIN";

  const [modules, setModules] = useState<SiteModule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  // F7 — `telehealth-recording` AÇILMADAN ÖNCE gösterilen ek onay adımı; diğer modüller bu state'i
  // HİÇ KULLANMAZ (`handleToggle` doğrudan çağrılır).
  const [recordingWarningModule, setRecordingWarningModule] = useState<SiteModule | null>(null);
  // Yalnızca görsel bir ipucu için — "Önerilen" rozetini göstermek amacıyla mevcut site
  // şablonu ayrıca çekilir, herhangi bir modülün aktif/pasif davranışını ETKİLEMEZ.
  const [siteTemplate, setSiteTemplate] = useState<SiteTemplate | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, settings] = await Promise.all([modulesApi.listModules(), settingsApi.getSettings()]);
      setModules(list);
      setSiteTemplate(settings.siteTemplate);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function handleToggle(module: SiteModule, enabled: boolean) {
    setPendingKey(module.key);
    try {
      await modulesApi.updateModule(module.key, enabled);
      toast.success(`"${module.label}" modülü ${enabled ? "etkinleştirildi" : "devre dışı bırakıldı"}.`);
      await load();
      await refetch();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setPendingKey(null);
    }
  }

  /**
   * F7 — genel toggle akışının giriş noktası. `telehealth-recording`'i ETKİNLEŞTİRMEK
   * (`checked === true`) isteniyorsa `handleToggle` DOĞRUDAN çağrılmaz, önce uyarı dialogu açılır;
   * dialogtaki onaydan sonra `handleToggle` çağrılır. Kapatma (`checked === false`) VE diğer TÜM
   * modüller bu ek adımdan ETKİLENMEZ.
   */
  function handleToggleRequest(module: SiteModule, enabled: boolean) {
    if (module.key === RECORDING_MODULE_KEY && enabled) {
      setRecordingWarningModule(module);
      return;
    }
    void handleToggle(module, enabled);
  }

  return (
    <div className="space-y-6">
      <PageHeading
        icon={Blocks}
        title="Modüller"
        description="Sitenizdeki eklenti/modüllerin aktif ya da pasif olduğunu buradan yönetin."
      />

      {!isAdmin && (
        <Alert variant="info">
          <span className="flex items-center gap-2">
            <Lock className="h-4 w-4 shrink-0" />
            Modülleri yalnızca ADMIN rolündeki kullanıcılar değiştirebilir. Bu ekranı salt-okunur görüntülüyorsunuz.
          </span>
        </Alert>
      )}

      {error && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      )}

      {!error && modules === null ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : !error && modules !== null && modules.length === 0 ? (
        <EmptyState
          icon={Blocks}
          title="Henüz kayıtlı modül yok"
          description="Modüller eklendiğinde burada yönetebilirsiniz."
        />
      ) : (
        !error &&
        modules !== null && (
          <div className="space-y-3">
            {modules.map((module) => (
              <Card key={module.key} className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">{module.label}</p>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {module.key}
                    </span>
                    {siteTemplate && module.recommendedFor?.includes(siteTemplate) && (
                      <Badge tone="primary" size="sm">
                        Önerilen
                      </Badge>
                    )}
                  </div>
                  {module.description && <p className="text-sm text-foreground/60">{module.description}</p>}
                  {module.updatedAt && (
                    <p className="text-xs text-foreground/40">
                      Son güncelleme: {formatDate(module.updatedAt)}
                      {module.updatedBy && ` · ${module.updatedBy.name}`}
                    </p>
                  )}
                </div>
                <Switch
                  aria-label={`${module.label} modülünü ${module.enabled ? "devre dışı bırak" : "etkinleştir"}`}
                  checked={module.enabled}
                  disabled={!isAdmin || pendingKey === module.key}
                  onCheckedChange={(checked) => handleToggleRequest(module, checked)}
                />
              </Card>
            ))}
          </div>
        )
      )}

      <ConfirmDialog
        open={recordingWarningModule !== null}
        onOpenChange={(open) => !open && setRecordingWarningModule(null)}
        title="Görüşme Kaydını Etkinleştir"
        description={RECORDING_MODULE_WARNING}
        confirmText="Anladım, Etkinleştir"
        tone="warning"
        loading={recordingWarningModule !== null && pendingKey === recordingWarningModule.key}
        onConfirm={() => {
          if (!recordingWarningModule) return;
          const targetModule = recordingWarningModule;
          setRecordingWarningModule(null);
          void handleToggle(targetModule, true);
        }}
      />
    </div>
  );
}
