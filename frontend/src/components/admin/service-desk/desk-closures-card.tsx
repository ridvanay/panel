"use client";

import { useState, type FormEvent } from "react";
import { CalendarOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { createClosure, deleteClosure, type ServiceDeskClosure } from "@/lib/api/service-desk-admin";
import { formatDateOnly } from "./service-desk-format";

/** 409 `CLOSURE_HAS_CONSULTATIONS`: sunucu sayıyı `details.count` ile verebilir; yoksa genel mesaj. */
export function closureConflictMessage(err: ApiClientError): string {
  const count = err.details?.count?.[0] ?? err.details?.consultations?.[0];
  return count
    ? `Bu güne planlanmış ${count} görüşme var. Önce görüşmeleri iptal edin, sonra günü kapatın.`
    : "Bu güne planlanmış görüşmeler var. Önce görüşmeleri iptal edin, sonra günü kapatın.";
}

/** Tatil günleri: tarih + iç not (sağlık verisi yazmayın). Liste, ekleme ve silme. */
export function DeskClosuresCard({
  closures,
  canEdit,
  onChanged,
}: {
  closures: ServiceDeskClosure[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ServiceDeskClosure | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!date) {
      setError("Tarih seçin.");
      return;
    }
    setError(null);
    setAdding(true);
    try {
      await createClosure({ date, note: note.trim() || undefined });
      setDate("");
      setNote("");
      toast.success("Tatil günü eklendi.");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiClientError && err.code === "CLOSURE_HAS_CONSULTATIONS" ? closureConflictMessage(err) : friendlyErrorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  async function remove() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteClosure(pendingDelete.id);
      toast.success("Tatil günü silindi.");
      setPendingDelete(null);
      onChanged();
    } catch (err) {
      setError(friendlyErrorMessage(err));
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="space-y-4" data-testid="desk-closures-card">
      <div>
        <h2 className="admin-h2 flex items-center gap-2">
          <CalendarOff className="h-4 w-4" aria-hidden="true" />
          Tatil günleri
        </h2>
        <p className="mt-1 admin-text-secondary">Seçilen günlerde hasta saat göremez. Not yalnızca iç kullanım içindir; sağlık bilgisi yazmayın.</p>
      </div>
      {error && <Alert variant="error">{error}</Alert>}
      {canEdit && (
        <form onSubmit={(e) => void add(e)} className="flex flex-wrap items-end gap-3">
          <Field id="closure-date" label="Tarih" required>
            {(p) => <Input {...p} type="date" className="w-auto" value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
          <Field id="closure-note" label="İç not (isteğe bağlı)">
            {(p) => <Input {...p} className="w-64 max-w-full" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          <Button type="submit" loading={adding}>
            Tatil günü ekle
          </Button>
        </form>
      )}
      {closures.length === 0 ? (
        <p className="admin-text-secondary" data-testid="desk-closures-empty">
          Yaklaşan tatil günü yok.
        </p>
      ) : (
        <ul className="divide-y divide-border" aria-label="Tatil günleri">
          {closures.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium text-foreground">{formatDateOnly(c.date)}</span>
                {c.note && <span className="ms-2 text-foreground/60">{c.note}</span>}
              </span>
              {canEdit && (
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`${formatDateOnly(c.date)} tatil gününü sil`} onClick={() => setPendingDelete(c)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Tatil günü silinsin mi?"
        description={pendingDelete ? `${formatDateOnly(pendingDelete.date)} günü yeniden rezervasyona açılır.` : undefined}
        confirmText="Sil"
        tone="danger"
        loading={deleting}
        onConfirm={() => void remove()}
      />
    </Card>
  );
}
