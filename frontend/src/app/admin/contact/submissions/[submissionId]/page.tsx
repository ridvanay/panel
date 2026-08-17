"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, ChevronLeft, Trash2 } from "lucide-react";
import * as contactApi from "@/lib/api/contact";
import type { ContactSubmission, ContactSubmissionStatus } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const STATUS_LABEL: Record<ContactSubmissionStatus, string> = {
  NEW: "Yeni",
  READ: "Okundu",
  ARCHIVED: "Arşivlendi",
  SPAM: "Spam",
};

export default function ContactSubmissionDetailPage({ params }: { params: Promise<{ submissionId: string }> }) {
  const { submissionId } = use(params);
  const router = useRouter();

  const [submission, setSubmission] = useState<ContactSubmission | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusSaving, setStatusSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await contactApi.getSubmission(submissionId);
      setSubmission(data);
      setLoaded(true);
      // Detay GET yan etkisizdir (okundu işaretlemez) — açılınca ayrıca "READ" olarak işaretlenir.
      if (data.status === "NEW") {
        const updated = await contactApi.updateSubmissionStatus(submissionId, { status: "READ" });
        setSubmission(updated);
      }
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, [submissionId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function handleStatusChange(status: ContactSubmissionStatus) {
    if (!submission) return;
    setStatusSaving(true);
    try {
      const updated = await contactApi.updateSubmissionStatus(submissionId, { status });
      setSubmission(updated);
      toast.success("Durum güncellendi.");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await contactApi.deleteSubmission(submissionId);
      toast.success("Gönderim silindi.");
      router.push("/admin/contact/submissions");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
      setDeleting(false);
    }
  }

  if (loadError) {
    return (
      <Alert variant="error">
        <span className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {loadError}
        </span>
      </Alert>
    );
  }

  if (!loaded || !submission) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-16">
      <div>
        <Link href="/admin/contact/submissions" className="inline-flex items-center gap-1 text-sm text-foreground/60 transition-colors hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
          Gelen Kutusu
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="admin-h1">{submission.name}</h1>
          <p className="mt-1 admin-text-secondary">{submission.email}</p>
        </div>
        <Button type="button" variant="ghost" onClick={() => setDeleteDialogOpen(true)}>
          <Trash2 className="h-4 w-4" />
          Sil
        </Button>
      </div>

      {submission.notificationError && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Bildirim e-postası gönderilemedi: {submission.notificationError}
          </span>
        </Alert>
      )}

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="admin-h2">Durum</h2>
          <Select
            className="max-w-40"
            value={submission.status}
            disabled={statusSaving}
            onChange={(e) => handleStatusChange(e.target.value as ContactSubmissionStatus)}
            aria-label="Durum"
          >
            {(Object.keys(STATUS_LABEL) as ContactSubmissionStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>
        <p className="text-xs text-foreground/50">
          Gönderildi: {new Date(submission.createdAt).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" })}
        </p>
      </Card>

      <Card className="space-y-3">
        <h2 className="admin-h2">Mesaj İçeriği</h2>
        <dl className="space-y-3">
          {Object.entries(submission.data).map(([key, value]) => (
            <div key={key}>
              <dt className="font-mono text-xs text-foreground/50">{key}</dt>
              <dd className="whitespace-pre-wrap text-sm text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="space-y-2">
        <h2 className="admin-h2">KVKK / Onay</h2>
        {submission.consentAt ? (
          <>
            <p className="text-sm text-foreground/80">
              Onaylandı: {new Date(submission.consentAt).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" })}
            </p>
            {submission.consentTextSnapshot && (
              <p className="text-xs text-foreground/50">&ldquo;{submission.consentTextSnapshot}&rdquo;</p>
            )}
          </>
        ) : (
          <Badge tone="neutral" size="sm">
            Onay kaydı yok
          </Badge>
        )}
        {submission.piiRedactedAt ? (
          <p className="text-xs text-foreground/50">IP/tarayıcı bilgisi {new Date(submission.piiRedactedAt).toLocaleDateString("tr-TR")} tarihinde redakte edildi (KVKK, 30 gün).</p>
        ) : (
          <p className="text-xs text-foreground/50">
            IP: {submission.ipAddress ?? "—"} · Tarayıcı: {submission.userAgent ?? "—"}
          </p>
        )}
      </Card>

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        tone="danger"
        title="Gönderimi sil"
        description="Bu gönderimi kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz."
        confirmText="Sil"
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
