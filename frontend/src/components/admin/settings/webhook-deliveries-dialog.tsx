"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Eye, History, RefreshCw } from "lucide-react";
import { flattenDeliveries, useRedeliverWebhookDelivery, useWebhookDeliveriesList } from "@/hooks/use-outbound-webhooks";
import type { OutboundWebhook, WebhookDeliveryStatus, WebhookDeliverySummary } from "@/lib/api/types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { WEBHOOK_DELIVERY_STATUS_LABELS, WEBHOOK_DELIVERY_STATUS_TONES } from "./webhook-labels";
import { WebhookDeliveryDetailDialog } from "./webhook-delivery-detail-dialog";

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

function formatDate(iso: string | null): string {
  return iso ? dateFormatter.format(new Date(iso)) : "—";
}

const STATUS_OPTIONS: WebhookDeliveryStatus[] = ["PENDING", "SENDING", "RETRYING", "SUCCEEDED", "FAILED"];

interface WebhookDeliveriesDialogProps {
  /** `null` = kapalı. */
  webhook: OutboundWebhook | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Bir webhook'un son gönderimlerini listeler (webhook başına en yeni 100 kayıt / 30 gün
 * saklanır, ARCHITECTURE.md §10.13.8). Devam eden (`PENDING`/`SENDING`/`RETRYING`) bir
 * gönderim varsa `useWebhookDeliveriesList` 4 sn'de bir kendiliğinden yeniler — sayfa
 * yenilemeye gerek yok.
 */
export function WebhookDeliveriesDialog({ webhook, onOpenChange }: WebhookDeliveriesDialogProps) {
  const [statusFilter, setStatusFilter] = useState<WebhookDeliveryStatus | "">("");
  const [selectedDelivery, setSelectedDelivery] = useState<WebhookDeliverySummary | null>(null);

  const query = useWebhookDeliveriesList(webhook?.id ?? "", { status: statusFilter || undefined }, { enabled: webhook !== null });
  const redeliver = useRedeliverWebhookDelivery(webhook?.id ?? "");

  const deliveries = flattenDeliveries(query.data?.pages);

  async function handleRedeliver(delivery: WebhookDeliverySummary) {
    try {
      await redeliver.mutateAsync(delivery.id);
      toast.success("Gönderim yeniden kuyruklandı.");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    }
  }

  return (
    <>
      <Dialog
        open={webhook !== null}
        onOpenChange={(open) => {
          if (!open) {
            setStatusFilter("");
            setSelectedDelivery(null);
          }
          onOpenChange(open);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Gönderim Günlüğü — {webhook?.name}</DialogTitle>
            <DialogDescription>Son gönderimler ve durumları. Başarısız gönderimleri yeniden gönderebilirsiniz.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-3">
            <Select
              aria-label="Durum filtresi"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as WebhookDeliveryStatus | "")}
              className="w-44"
            >
              <option value="">Tüm durumlar</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {WEBHOOK_DELIVERY_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          </div>

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

          {!query.isError && query.isPending && (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          )}

          {!query.isError && !query.isPending && deliveries.length === 0 && (
            <EmptyState
              icon={History}
              title="Henüz gönderim yok"
              description="Bu webhook için abone olunan bir olay gerçekleştiğinde ya da test gönderimi yapıldığında burada listelenecek."
            />
          )}

          {!query.isError && !query.isPending && deliveries.length > 0 && (
            <div className="max-h-[50vh] space-y-4 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Olay</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead>Deneme</TableHead>
                    <TableHead>Yanıt Kodu</TableHead>
                    <TableHead>Tarih</TableHead>
                    <TableHead className="text-right">İşlemler</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliveries.map((delivery) => (
                    <TableRow key={delivery.id}>
                      <TableCell className="font-mono text-xs text-foreground/80">{delivery.event}</TableCell>
                      <TableCell>
                        <Badge tone={WEBHOOK_DELIVERY_STATUS_TONES[delivery.status]} solid>
                          {WEBHOOK_DELIVERY_STATUS_LABELS[delivery.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-foreground/60">
                        {delivery.attemptCount}/{delivery.maxAttempts}
                      </TableCell>
                      <TableCell className="text-foreground/60">{delivery.responseStatus ?? "—"}</TableCell>
                      <TableCell className="text-foreground/60">{formatDate(delivery.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Gönderim detayını görüntüle"
                            onClick={() => setSelectedDelivery(delivery)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {delivery.status === "FAILED" && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Gönderimi yeniden gönder"
                              loading={redeliver.isPending && redeliver.variables === delivery.id}
                              onClick={() => void handleRedeliver(delivery)}
                            >
                              <RefreshCw className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {query.hasNextPage && (
                <div className="flex justify-center">
                  <Button variant="outline" size="sm" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                    Daha fazla yükle
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <WebhookDeliveryDetailDialog
        webhookId={webhook?.id ?? null}
        delivery={selectedDelivery}
        onOpenChange={(open) => {
          if (!open) setSelectedDelivery(null);
        }}
        onRedeliver={handleRedeliver}
        redeliverPending={redeliver.isPending}
      />
    </>
  );
}
