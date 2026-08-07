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
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

export default function AdminModulesPage() {
  const { user } = useAuth();
  const { refetch } = useModules();
  const isAdmin = user?.role === "ADMIN";

  const [modules, setModules] = useState<SiteModule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
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
                  onCheckedChange={(checked) => void handleToggle(module, checked)}
                />
              </Card>
            ))}
          </div>
        )
      )}
    </div>
  );
}
