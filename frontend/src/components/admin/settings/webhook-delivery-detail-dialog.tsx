"use client";

import { AlertCircle, Lock, RefreshCw } from "lucide-react";
import { useWebhookDelivery } from "@/hooks/use-outbound-webhooks";
import type { WebhookDeliverySummary } from "@/lib/api/types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { WEBHOOK_DELIVERY_ERROR_LABELS, WEBHOOK_DELIVERY_STATUS_LABELS, WEBHOOK_DELIVERY_STATUS_TONES } from "./webhook-labels";

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

function formatDate(iso: string | null): string {
  return iso ? dateFormatter.format(new Date(iso)) : "—";
}

function isRedactedPayload(payload: unknown): payload is { redacted: true } {
  return Boolean(payload) && typeof payload === "object" && payload !== null && "redacted" in payload;
}

interface WebhookDeliveryDetailDialogProps {
  webhookId: string | null;
  /** Liste satırından gelen özet — yalnızca başlık/eylem etkinliği için kullanılır, detay ayrı çekilir. */
  delivery: WebhookDeliverySummary | null;
  onOpenChange: (open: boolean) => void;
  onRedeliver: (delivery: WebhookDeliverySummary) => void;
  redeliverPending: boolean;
}

/**
 * `GET .../deliveries/{deliveryId}` detayı — tam `payload` + `responseBodySnippet` (ilk 512
 * karakter) yalnızca bu ucun yanıtında döner (ARCHITECTURE.md §10.13.8). 7 gün sonra
 * `containsPii: true` kayıtların `payload`'ı redakte edilir; bu durumda yeniden gönderim
 * backend'de `409` döner — buton bu bilgiye göre önden devre dışı bırakılır.
 */
export function WebhookDeliveryDetailDialog({
  webhookId,
  delivery,
  onOpenChange,
  onRedeliver,
  redeliverPending,
}: WebhookDeliveryDetailDialogProps) {
  const query = useWebhookDelivery(webhookId ?? "", delivery?.id ?? null, { enabled: delivery !== null });
  const detail = query.data;

  return (
    <Dialog open={delivery !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Gönderim Detayı</DialogTitle>
          <DialogDescription>{delivery?.event}</DialogDescription>
        </DialogHeader>

        {query.isError && (
          <Alert variant="error">
            <span className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {friendlyErrorMessage(query.error)}
              </span>
              <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
                Tekrar Dene
              </Button>
            </span>
          </Alert>
        )}

        {query.isPending && (
          <div className="space-y-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={WEBHOOK_DELIVERY_STATUS_TONES[detail.status]} solid>
                {WEBHOOK_DELIVERY_STATUS_LABELS[detail.status]}
              </Badge>
              <span className="text-xs text-foreground/60">
                Deneme {detail.attemptCount}/{detail.maxAttempts}
              </span>
              {detail.responseStatus !== null && <span className="text-xs text-foreground/60">HTTP {detail.responseStatus}</span>}
              {detail.durationMs !== null && <span className="text-xs text-foreground/60">{detail.durationMs} ms</span>}
              {detail.containsPii && (
                <span className="inline-flex items-center gap-1 text-xs text-warning">
                  <Lock className="h-3 w-3" />
                  Kişisel veri içerir
                </span>
              )}
            </div>

            {detail.errorCode && (
              <Alert variant="error">
                {WEBHOOK_DELIVERY_ERROR_LABELS[detail.errorCode]}
                {detail.errorMessage && <span className="mt-1 block text-xs opacity-80">{detail.errorMessage}</span>}
              </Alert>
            )}

            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">Gövde (payload)</p>
              {isRedactedPayload(detail.payload) ? (
                <p className="rounded-lg border border-dashed border-border p-3 text-xs text-foreground/60">
                  Bu gönderimin gövdesi, kişisel veri saklama süresi (7 gün) dolduğu için redakte edildi.
                </p>
              ) : (
                <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-surface-muted p-3 text-xs text-foreground/80">
                  {JSON.stringify(detail.payload, null, 2)}
                </pre>
              )}
            </div>

            {detail.responseBodySnippet && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-foreground">Yanıt (ilk 512 karakter)</p>
                <pre className="max-h-32 overflow-auto rounded-lg border border-border bg-surface-muted p-3 text-xs text-foreground/80">
                  {detail.responseBodySnippet}
                </pre>
              </div>
            )}

            <p className="text-xs text-foreground/50">Oluşturulma: {formatDate(detail.createdAt)}</p>
          </div>
        )}

        <DialogFooter>
          {detail && detail.status === "FAILED" && (
            <Button
              type="button"
              variant="outline"
              disabled={isRedactedPayload(detail.payload)}
              loading={redeliverPending}
              onClick={() => delivery && onRedeliver(delivery)}
            >
              <RefreshCw className="h-4 w-4" />
              Yeniden Gönder
            </Button>
          )}
          <Button type="button" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
