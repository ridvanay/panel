"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, ListTree, Pencil, Plus, RotateCw, Send, Trash2, Webhook as WebhookIcon } from "lucide-react";
import {
  flattenWebhooks,
  useDeleteWebhook,
  useRotateWebhookSecret,
  useTestWebhook,
  useUpdateWebhook,
  useWebhooksList,
} from "@/hooks/use-outbound-webhooks";
import type { CreateOutboundWebhookResponse, OutboundWebhook } from "@/lib/api/types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { WEBHOOK_STATUS_LABELS, WEBHOOK_STATUS_TONES } from "./webhook-labels";
import { WebhookFormDialog } from "./webhook-form-dialog";
import { WebhookSecretRevealDialog, type WebhookSecretReveal } from "./webhook-secret-reveal-dialog";
import { WebhookDeliveriesDialog } from "./webhook-deliveries-dialog";

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

function formatDate(iso: string | null): string {
  return iso ? dateFormatter.format(new Date(iso)) : "—";
}

const MAX_EVENT_BADGES = 3;

/**
 * `/admin/settings` → "Webhook'lar" sekmesi. Giden (outbound) webhook yönetimi
 * (ARCHITECTURE.md §10.13.8/§10.13.10) — `POST /webhooks/stripe` (GELEN, mevcut, dokunulmaz)
 * sistemiyle KARIŞTIRILMAMALI. TÜM uçlar yalnızca `SiteRole=ADMIN`.
 */
export function WebhooksSection() {
  const query = useWebhooksList();
  const updateMutation = useUpdateWebhook();
  const deleteMutation = useDeleteWebhook();
  const testMutation = useTestWebhook();
  const rotateMutation = useRotateWebhookSecret();

  const [formOpen, setFormOpen] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<OutboundWebhook | null>(null);
  const [reveal, setReveal] = useState<WebhookSecretReveal | null>(null);
  const [pendingDelete, setPendingDelete] = useState<OutboundWebhook | null>(null);
  const [pendingRotate, setPendingRotate] = useState<OutboundWebhook | null>(null);
  const [deliveriesFor, setDeliveriesFor] = useState<OutboundWebhook | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const webhooks = flattenWebhooks(query.data?.pages);

  function openCreateForm() {
    setEditingWebhook(null);
    setFormOpen(true);
  }

  function handleCreated(response: CreateOutboundWebhookResponse) {
    setReveal({ webhookName: response.webhook.name, plainSecret: response.plainSecret });
  }

  async function handleToggleStatus(webhook: OutboundWebhook) {
    const nextStatus = webhook.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    setTogglingId(webhook.id);
    try {
      await updateMutation.mutateAsync({ webhookId: webhook.id, input: { status: nextStatus } });
      toast.success(nextStatus === "ACTIVE" ? "Webhook etkinleştirildi." : "Webhook duraklatıldı.");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setTogglingId(null);
    }
  }

  async function handleTest(webhook: OutboundWebhook) {
    setTestingId(webhook.id);
    try {
      await testMutation.mutateAsync(webhook.id);
      toast.success("Test gönderimi kuyruklandı — sonucu Gönderim Günlüğü'nden takip edebilirsiniz.");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setTestingId(null);
    }
  }

  async function handleConfirmRotate() {
    if (!pendingRotate) return;
    try {
      const result = await rotateMutation.mutateAsync(pendingRotate.id);
      setPendingRotate(null);
      setReveal({ webhookName: result.webhook.name, plainSecret: result.plainSecret });
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    try {
      await deleteMutation.mutateAsync(pendingDelete.id);
      toast.success("Webhook silindi.");
      setPendingDelete(null);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    }
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="admin-h2">Giden Webhook&apos;lar</h2>
          <p className="mt-1 admin-text-secondary">
            İçerik/sipariş olaylarında dış sistemlere HMAC imzalı POST istekleri gönderin. En fazla 20 webhook
            tanımlanabilir.
          </p>
        </div>
        <Button type="button" onClick={openCreateForm}>
          <Plus className="h-4 w-4" />
          Yeni Webhook Ekle
        </Button>
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

      {!query.isError && !query.isPending && webhooks.length === 0 && (
        <EmptyState
          icon={WebhookIcon}
          title="Henüz webhook yok"
          description="Bir olay gerçekleştiğinde dış sisteminize bildirim göndermek için webhook ekleyin."
          action={
            <Button type="button" onClick={openCreateForm}>
              <Plus className="h-4 w-4" />
              Yeni Webhook Ekle
            </Button>
          }
        />
      )}

      {!query.isError && !query.isPending && webhooks.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>İsim / URL</TableHead>
                <TableHead>Olaylar</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>Son Tetiklenme</TableHead>
                <TableHead className="text-right">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {webhooks.map((webhook) => {
                const extraEvents = webhook.events.length - MAX_EVENT_BADGES;
                return (
                  <TableRow key={webhook.id}>
                    <TableCell className="max-w-[260px]">
                      <p className="font-medium text-foreground">{webhook.name}</p>
                      <p className="truncate text-xs text-foreground/60" title={webhook.url}>
                        {webhook.url}
                      </p>
                    </TableCell>
                    <TableCell className="max-w-[240px]">
                      <div className="flex flex-wrap gap-1">
                        {webhook.events.slice(0, MAX_EVENT_BADGES).map((event) => (
                          <Badge key={event}>{event}</Badge>
                        ))}
                        {extraEvents > 0 && <Badge tone="neutral">+{extraEvents}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge tone={WEBHOOK_STATUS_TONES[webhook.status]} solid>
                          {WEBHOOK_STATUS_LABELS[webhook.status]}
                        </Badge>
                        {webhook.status !== "DISABLED" && (
                          <Switch
                            aria-label={webhook.status === "ACTIVE" ? "Webhook'u duraklat" : "Webhook'u etkinleştir"}
                            checked={webhook.status === "ACTIVE"}
                            disabled={togglingId === webhook.id}
                            onCheckedChange={() => void handleToggleStatus(webhook)}
                          />
                        )}
                      </div>
                      {webhook.status === "DISABLED" && (
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="mt-1 h-auto p-0"
                          loading={togglingId === webhook.id}
                          onClick={() => void handleToggleStatus(webhook)}
                        >
                          Yeniden etkinleştir
                        </Button>
                      )}
                    </TableCell>
                    <TableCell className="text-foreground/60">{formatDate(webhook.lastTriggeredAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`${webhook.name} için test gönderimi yap`}
                              loading={testingId === webhook.id}
                              onClick={() => void handleTest(webhook)}
                            >
                              <Send className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Test gönderimi (PING)</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`${webhook.name} gönderim günlüğü`}
                              onClick={() => setDeliveriesFor(webhook)}
                            >
                              <ListTree className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Gönderim Günlüğü</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`${webhook.name} secret'ını döndür`}
                              onClick={() => setPendingRotate(webhook)}
                            >
                              <RotateCw className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Secret&apos;ı Döndür</TooltipContent>
                        </Tooltip>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${webhook.name} webhook'unu düzenle`}
                          onClick={() => {
                            setEditingWebhook(webhook);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${webhook.name} webhook'unu sil`}
                          onClick={() => setPendingDelete(webhook)}
                        >
                          <Trash2 className="h-4 w-4 text-danger" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {query.hasNextPage && (
            <div className="flex justify-center">
              <Button variant="outline" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                Daha fazla yükle
              </Button>
            </div>
          )}
        </>
      )}

      <WebhookFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingWebhook(null);
        }}
        webhook={editingWebhook}
        onCreated={(response) => {
          setFormOpen(false);
          setEditingWebhook(null);
          handleCreated(response);
        }}
      />

      <WebhookSecretRevealDialog
        reveal={reveal}
        onOpenChange={(open) => {
          if (!open) setReveal(null);
        }}
      />

      <WebhookDeliveriesDialog
        webhook={deliveriesFor}
        onOpenChange={(open) => {
          if (!open) setDeliveriesFor(null);
        }}
      />

      <ConfirmDialog
        open={pendingRotate !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRotate(null);
        }}
        title="Secret'ı döndür"
        description={
          pendingRotate
            ? `"${pendingRotate.name}" webhook'unun imzalama secret'ı yenilenecek. Eski secret ANINDA geçersiz olur — alıcı sisteminizi güncellemeden önceki gönderimler doğrulanamaz.`
            : undefined
        }
        confirmText="Döndür"
        tone="warning"
        loading={rotateMutation.isPending}
        onConfirm={handleConfirmRotate}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Webhook'u sil"
        description={
          pendingDelete
            ? `"${pendingDelete.name}" webhook'unu silmek istediğinize emin misiniz? İlişkili tüm gönderim kayıtları da silinecek. Bu işlem geri alınamaz.`
            : undefined
        }
        confirmText="Kalıcı Sil"
        tone="danger"
        loading={deleteMutation.isPending}
        onConfirm={handleConfirmDelete}
      />
    </Card>
  );
}
