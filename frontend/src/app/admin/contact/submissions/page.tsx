"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertCircle, ChevronLeft, Inbox, Search, Trash2 } from "lucide-react";
import * as contactApi from "@/lib/api/contact";
import type { ContactSubmissionStatus, ContactSubmissionSummary } from "@/lib/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select } from "@/components/ui/select";
import { PageHeading } from "@/components/admin/page-heading";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const STATUS_LABEL: Record<ContactSubmissionStatus, string> = {
  NEW: "Yeni",
  READ: "Okundu",
  ARCHIVED: "Arşivlendi",
  SPAM: "Spam",
};

const STATUS_TONE: Record<ContactSubmissionStatus, "primary" | "neutral" | "danger"> = {
  NEW: "primary",
  READ: "neutral",
  ARCHIVED: "neutral",
  SPAM: "danger",
};

export default function ContactSubmissionsPage() {
  const [items, setItems] = useState<ContactSubmissionSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<ContactSubmissionStatus | undefined>(undefined);
  const [q, setQ] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ContactSubmissionSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (filterStatus: ContactSubmissionStatus | undefined, query: string) => {
    setItems(null);
    setLoadError(null);
    try {
      const page = await contactApi.listSubmissions({ status: filterStatus, q: query || undefined });
      setItems(page.items);
      setNextCursor(page.meta.nextCursor);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => load(status, q), 300);
    return () => clearTimeout(handle);
  }, [status, q, load]);

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await contactApi.listSubmissions({ status, q: q || undefined, cursor: nextCursor });
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setNextCursor(page.meta.nextCursor);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await contactApi.deleteSubmission(deleteTarget.id);
      toast.success("Gönderim silindi.");
      setDeleteTarget(null);
      setItems((prev) => prev?.filter((i) => i.id !== deleteTarget.id) ?? null);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/contact" className="inline-flex items-center gap-1 text-sm text-foreground/60 transition-colors hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
          İletişim Formu
        </Link>
      </div>

      <PageHeading icon={Inbox} title="Gelen Kutusu" description="İletişim formuna yapılan gönderimler." />

      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="max-w-xs">
          <InputGroupAddon align="inline-start">
            <Search className="h-3.5 w-3.5 text-foreground/40" />
          </InputGroupAddon>
          <InputGroupInput placeholder="Ad veya e-posta ara…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Ad veya e-posta ara" />
        </InputGroup>
        <Select
          className="max-w-40"
          value={status ?? ""}
          onChange={(e) => setStatus((e.target.value || undefined) as ContactSubmissionStatus | undefined)}
          aria-label="Duruma göre filtrele"
        >
          <option value="">Tüm durumlar</option>
          {(Object.keys(STATUS_LABEL) as ContactSubmissionStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      </div>

      {loadError && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {loadError}
          </span>
        </Alert>
      )}

      {!loadError && items === null && (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      )}

      {!loadError && items !== null && items.length === 0 && (
        <EmptyState icon={Inbox} title="Gönderim yok" description="Bu filtreye uyan bir gönderim bulunamadı." />
      )}

      {!loadError && items !== null && items.length > 0 && (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className={`flex items-center justify-between gap-3 rounded-xl border p-4 shadow-sm ${
                item.status === "NEW" ? "border-primary/30 bg-primary/5" : "border-border bg-card"
              }`}
            >
              <Link href={`/admin/contact/submissions/${item.id}`} className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-foreground">{item.name}</span>
                  <Badge tone={STATUS_TONE[item.status]} size="sm">
                    {STATUS_LABEL[item.status]}
                  </Badge>
                  {item.notificationError && (
                    <span title={item.notificationError}>
                      <Badge tone="warning" size="sm">
                        Bildirim gönderilemedi
                      </Badge>
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-foreground/60">
                  {item.email} · {new Date(item.createdAt).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" })}
                </p>
              </Link>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`${item.name} gönderimini sil`}
                disabled={busyId === item.id}
                onClick={() => setDeleteTarget(item)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}

          {nextCursor && (
            <div className="flex justify-center pt-2">
              <Button type="button" variant="outline" loading={loadingMore} onClick={handleLoadMore}>
                Daha Fazla Yükle
              </Button>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        tone="danger"
        title="Gönderimi sil"
        description="Bu gönderimi kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz — çöp kutusu yoktur."
        confirmText="Sil"
        loading={busyId === deleteTarget?.id}
        onConfirm={handleDelete}
      />
    </div>
  );
}
