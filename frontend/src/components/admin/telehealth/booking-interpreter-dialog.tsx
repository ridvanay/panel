"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Languages } from "lucide-react";
import * as interpreterApi from "@/lib/api/interpreter";
import type { AppointmentBooking, BookingInterpreterState } from "@/lib/api/types";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const STATUS_LABELS: Record<string, string> = {
  ASSIGNED: "Atandı",
  JOINED: "Görüşmede",
  LEFT: "Ayrıldı (tekrar katılabilir)",
  REMOVED: "Doktor çıkardı",
  CANCELLED: "Kaldırıldı",
};

/**
 * Paket AA — rezervasyonun "Tercüman" kartı. Hastanın talebi varsa gösterilir; dile göre uygun
 * tercümanlar (aktif, taahhütlü, o saatte başka atamasıyla çakışmayan) sunucudan gelir. Ata /
 * değiştir / kaldır — her işlem audit'e yazılır; kaldırılan tercüman odadaysa çıkarılır.
 */
export function BookingInterpreterDialog({ booking, onOpenChange }: { booking: AppointmentBooking | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={booking !== null} onOpenChange={onOpenChange}>
      {/* Rezervasyon değişince gövde yeniden kurulur (durum sıfırlanır). */}
      {booking && <BookingInterpreterBody key={booking.id} booking={booking} />}
    </Dialog>
  );
}

function BookingInterpreterBody({ booking }: { booking: AppointmentBooking }) {
  const [state, setState] = useState<BookingInterpreterState | null>(null);
  const [language, setLanguage] = useState("");
  const [interpreterId, setInterpreterId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (bookingId: string, lang?: string) => {
    setError(null);
    try {
      const next = await interpreterApi.getBookingInterpreter(bookingId, lang || undefined);
      setState(next);
      setLanguage((prev) => prev || next.request?.language || next.active?.language || "");
      setInterpreterId((prev) => (next.candidates.some((c) => c.id === prev) ? prev : next.candidates[0]?.id ?? ""));
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load(booking.id);
    })();
  }, [booking.id, load]);

  async function run(action: () => Promise<BookingInterpreterState>, success: string) {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setState(next);
      toast.success(success);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent className="max-w-lg" data-testid="booking-interpreter-dialog">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Languages className="h-4 w-4" aria-hidden="true" />
          Tercüman — {booking.bookingNumber}
        </DialogTitle>
        <DialogDescription>Tercüman ücretsizdir; ödeme ve randevu kurallarını etkilemez.</DialogDescription>
      </DialogHeader>

      {!state && !error ? (
        <div className="flex justify-center py-6">
          <Spinner className="h-5 w-5 text-primary" />
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          {error && <Alert variant="error">{error}</Alert>}
          {state?.request ? (
            <Alert variant="info">
              Hasta tercüman istedi: <strong>{state.request.languageName}</strong> ({state.request.language})
            </Alert>
          ) : (
            <p className="text-foreground/60">Hastanın tercüman talebi yok.</p>
          )}

          {state?.active && (
            <div className="space-y-2 rounded-lg border border-border p-3" data-testid="booking-interpreter-active">
              <p className="font-medium">
                {state.active.interpreterDisplayName} · {state.active.languageName}{" "}
                <Badge size="sm" tone="primary">{STATUS_LABELS[state.active.status] ?? state.active.status}</Badge>
              </p>
              <div className="flex gap-2">
                <Input aria-label="Kaldırma gerekçesi" placeholder="Gerekçe (opsiyonel)" value={reason} onChange={(e) => setReason(e.target.value)} />
                <Button
                  type="button"
                  variant="outline"
                  loading={busy}
                  onClick={() => void run(() => interpreterApi.unassignBookingInterpreter(state.bookingId, reason.trim() || undefined), "Atama kaldırıldı.")}
                >
                  Kaldır
                </Button>
              </div>
            </div>
          )}

          {state && (
            <div className="space-y-2">
              <p className="font-medium">{state.active ? "Değiştir" : "Ata"}</p>
              <div className="flex gap-2">
                <Input
                  aria-label="Görüşme dili (kod)"
                  placeholder="Dil kodu (ör. ar)"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value.trim().toLowerCase())}
                  className="max-w-32"
                />
                <Button type="button" variant="ghost" onClick={() => void load(booking.id, language)}>
                  Uygunları listele
                </Button>
              </div>
              {state.candidates.length === 0 ? (
                <p className="text-foreground/60">Bu dil ve saat için uygun tercüman yok (aktif, taahhütlü ve o saatte boş olmalı).</p>
              ) : (
                <div className="flex gap-2">
                  <Select aria-label="Tercüman" value={interpreterId} onChange={(e) => setInterpreterId(e.target.value)}>
                    {state.candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.displayName} ({c.languages.join(", ")}){c.twoFactorEnabled ? "" : " — 2FA kurulmadı"}
                      </option>
                    ))}
                  </Select>
                  <Button
                    type="button"
                    loading={busy}
                    disabled={!interpreterId || !language}
                    onClick={() => void run(() => interpreterApi.assignBookingInterpreter(state.bookingId, interpreterId, language), "Tercüman atandı; bildirimler gönderildi.")}
                  >
                    {state.active ? "Değiştir" : "Ata"}
                  </Button>
                </div>
              )}
            </div>
          )}

          {state && state.history.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground/60">Geçmiş</p>
              <ul className="space-y-0.5 text-xs text-foreground/70">
                {state.history.map((h) => (
                  <li key={h.id}>
                    {h.interpreterDisplayName} · {h.languageName} · {STATUS_LABELS[h.status] ?? h.status}
                    {h.removedReason && h.removedReason !== "replaced" ? ` (${h.removedReason})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </DialogContent>
  );
}
