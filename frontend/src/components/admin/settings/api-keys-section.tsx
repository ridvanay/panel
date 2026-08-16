"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, KeyRound, Pencil, Plus, ShieldOff, Trash2 } from "lucide-react";
import { flattenApiKeys, useApiKeysList, useDeleteApiKey, useRevokeApiKey } from "@/hooks/use-api-keys";
import type { ApiKey, CreateApiKeyResponse } from "@/lib/api/types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { API_KEY_SCOPE_LABELS, API_KEY_STATUS_LABELS, API_KEY_STATUS_TONES } from "./api-key-labels";
import { ApiKeyFormDialog } from "./api-key-form-dialog";
import { ApiKeyRevealDialog } from "./api-key-reveal-dialog";

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

function formatDate(iso: string | null): string {
  return iso ? dateFormatter.format(new Date(iso)) : "—";
}

/**
 * `/admin/settings` → "E-posta / API Yapılandırmaları" sekmesi altındaki API anahtarı
 * yönetim bloğu (ARCHITECTURE.md §10.13.3/§10.13.10). Liste/oluşturma/düzenleme/iptal/silme
 * uçlarının TÜMÜ yalnızca `SiteRole=ADMIN` — backend zaten 403 döner, bu ekran o kısıtı
 * varsayar (sayfa zaten `/admin/settings` altında, ayrı bir rol kontrolü GEREKMEZ).
 */
export function ApiKeysSection() {
  const query = useApiKeysList();
  const revoke = useRevokeApiKey();
  const del = useDeleteApiKey();

  const [formOpen, setFormOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<ApiKey | null>(null);
  const [revealed, setRevealed] = useState<CreateApiKeyResponse | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<ApiKey | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ApiKey | null>(null);

  const keys = flattenApiKeys(query.data?.pages);

  function openCreateForm() {
    setEditingKey(null);
    setFormOpen(true);
  }

  async function handleConfirmRevoke() {
    if (!pendingRevoke) return;
    try {
      await revoke.mutateAsync(pendingRevoke.id);
      toast.success("API anahtarı iptal edildi.");
      setPendingRevoke(null);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    try {
      await del.mutateAsync(pendingDelete.id);
      toast.success("API anahtarı silindi.");
      setPendingDelete(null);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    }
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="admin-h2">API Anahtarları</h2>
          <p className="mt-1 admin-text-secondary">
            Üçüncü parti entegrasyonların salt-okunur genel API&apos;ye (<code>/api/v1/public/*</code>) erişimi için
            anahtar üretin ve yönetin.
          </p>
        </div>
        <Button type="button" onClick={openCreateForm}>
          <Plus className="h-4 w-4" />
          Yeni Anahtar Oluştur
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

      {!query.isError && !query.isPending && keys.length === 0 && (
        <EmptyState
          icon={KeyRound}
          title="Henüz API anahtarı yok"
          description="Üçüncü parti bir entegrasyon eklemek için yeni bir anahtar oluşturun."
          action={
            <Button type="button" onClick={openCreateForm}>
              <Plus className="h-4 w-4" />
              Yeni Anahtar Oluştur
            </Button>
          }
        />
      )}

      {!query.isError && !query.isPending && keys.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>İsim</TableHead>
                <TableHead>Anahtar</TableHead>
                <TableHead>Yetki</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>Oluşturulma</TableHead>
                <TableHead>Son Kullanım</TableHead>
                <TableHead className="text-right">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="max-w-[220px] font-medium text-foreground">
                    {key.name}
                    {key.description && <p className="mt-0.5 truncate text-xs text-foreground/60">{key.description}</p>}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-foreground/70">{key.maskedKey}</TableCell>
                  <TableCell>
                    <Badge tone={key.scope === "READ_WRITE" ? "primary" : "neutral"}>{API_KEY_SCOPE_LABELS[key.scope]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge tone={API_KEY_STATUS_TONES[key.status]} solid>
                      {API_KEY_STATUS_LABELS[key.status]}
                    </Badge>
                    {key.expiresAt && key.status === "ACTIVE" && (
                      <p className="mt-1 text-xs text-foreground/50">Son kullanma: {formatDate(key.expiresAt)}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-foreground/60">{formatDate(key.createdAt)}</TableCell>
                  <TableCell className="text-foreground/60">{formatDate(key.lastUsedAt)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${key.name} anahtarını düzenle`}
                        onClick={() => {
                          setEditingKey(key);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {key.status === "ACTIVE" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${key.name} anahtarını iptal et`}
                          onClick={() => setPendingRevoke(key)}
                        >
                          <ShieldOff className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${key.name} anahtarını sil`}
                        onClick={() => setPendingDelete(key)}
                      >
                        <Trash2 className="h-4 w-4 text-danger" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
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

      <ApiKeyFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingKey(null);
        }}
        apiKey={editingKey}
        onCreated={(response) => setRevealed(response)}
      />

      <ApiKeyRevealDialog
        response={revealed}
        onOpenChange={(open) => {
          if (!open) setRevealed(null);
        }}
      />

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevoke(null);
        }}
        title="API anahtarını iptal et"
        description={
          pendingRevoke
            ? `"${pendingRevoke.name}" anahtarını iptal etmek istediğinize emin misiniz? İptal edilen anahtar anında geçersiz olur; bu işlem geri alınamaz.`
            : undefined
        }
        confirmText="İptal Et"
        tone="warning"
        loading={revoke.isPending}
        onConfirm={handleConfirmRevoke}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="API anahtarını kalıcı sil"
        description={
          pendingDelete
            ? `"${pendingDelete.name}" anahtarını kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`
            : undefined
        }
        confirmText="Kalıcı Sil"
        tone="danger"
        loading={del.isPending}
        onConfirm={handleConfirmDelete}
      />
    </Card>
  );
}
