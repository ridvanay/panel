"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import type { Appointment, QaListenerHistoryEntry } from "@/lib/api/types";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const dateTimeFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "medium" });

interface QaListenerHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: Appointment | null;
}

/** Paket C — randevunun "Dinleyici geçmişi" (YALNIZCA ADMIN). Çağıran `key={appointment?.id}` verir. */
export function QaListenerHistoryDialog({ open, onOpenChange, appointment }: QaListenerHistoryDialogProps) {
  const [entries, setEntries] = useState<QaListenerHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !appointment) return;
    let cancelled = false;
    telehealthApi
      .getQaListenerHistory(appointment.id)
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open, appointment]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <History className="h-4 w-4" />
            </span>
            <div>
              <DialogTitle>Dinleyici geçmişi</DialogTitle>
              <DialogDescription className="mt-1">
                Bu görüşmeye kalite kontrol amacıyla katılan yetkililer, gerekçeleri ve giriş/çıkış zamanları.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {error ? (
          <Alert variant="error">{error}</Alert>
        ) : entries === null ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-5 w-5 text-primary" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-foreground/60">Bu görüşmeye henüz dinleyici katılmadı.</p>
        ) : (
          <ul className="max-h-96 space-y-3 overflow-y-auto">
            {entries.map((entry) => (
              <li key={entry.sessionId} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium text-foreground">{entry.adminEmail ?? "Silinmiş kullanıcı"}</p>
                <p className="mt-1 text-foreground/70">{entry.reason ?? "—"}</p>
                <p className="mt-2 text-xs text-foreground/50">
                  Giriş: {dateTimeFormatter.format(new Date(entry.joinedAt))} · Çıkış:{" "}
                  {entry.leftAt ? dateTimeFormatter.format(new Date(entry.leftAt)) : "çıkış kaydı yok"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
