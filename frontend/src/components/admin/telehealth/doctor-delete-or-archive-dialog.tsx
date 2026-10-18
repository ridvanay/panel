"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Archive, Trash2 } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import type { DoctorDeletionCheck, DoctorProfile } from "@/lib/api/types";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface DoctorDeleteOrArchiveDialogProps {
  doctor: Pick<DoctorProfile, "id" | "title" | "fullName"> | null;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
  onArchived?: (doctor: DoctorProfile) => void;
}

/**
 * 2026-10-18 (Paket B2) — "Sil" penceresi. Önce `deletion-check` sorulur: randevu/booking geçmişi
 * yoksa kalıcı silme, varsa "Arşivle" sunulur (geçmiş kayıtlar bozulmaz, doktor her yerde gizlenir).
 * Gelecekte açık randevu varsa arşivleme de engellidir — nedeni gösterilir.
 */
export function DoctorDeleteOrArchiveDialog({ doctor, onOpenChange, onDeleted, onArchived }: DoctorDeleteOrArchiveDialogProps) {
  const [check, setCheck] = useState<DoctorDeletionCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = doctor !== null;

  useEffect(() => {
    if (!doctor) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- `support/templates` İLE AYNI desen: dialog her açılışta önceki doktorun kontrol sonucunu temizler
    setCheck(null);
    setError(null);
    telehealthApi
      .getDoctorDeletionCheck(doctor.id)
      .then((result) => {
        if (!cancelled) setCheck(result);
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [doctor]);

  function handleOpenChange(next: boolean) {
    if (!busy) onOpenChange(next);
  }

  async function handleDelete() {
    if (!doctor) return;
    setBusy(true);
    try {
      await telehealthApi.deleteDoctor(doctor.id);
      toast.success("Doktor kalıcı olarak silindi.");
      onOpenChange(false);
      onDeleted?.();
    } catch (err) {
      // Ön kontrolden sonra randevu oluşmuş olabilir — arşiv seçeneğine geç.
      if (err instanceof ApiClientError && err.code === "DOCTOR_HAS_HISTORY") {
        setCheck((prev) => (prev ? { ...prev, deletable: false } : prev));
      }
      setError(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleArchive() {
    if (!doctor) return;
    setBusy(true);
    try {
      const archived = await telehealthApi.archiveDoctor(doctor.id);
      toast.success("Doktor arşivlendi; site, arama ve sitemap'ten kaldırıldı.");
      onOpenChange(false);
      onArchived?.(archived);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const name = doctor ? `${doctor.title} ${doctor.fullName}`.trim() : "";
  const blockedByUpcoming = check !== null && !check.deletable && check.upcomingAppointmentCount > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{check && !check.deletable ? "Doktoru arşivle" : "Doktoru kalıcı sil"}</DialogTitle>
          <DialogDescription>{name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm text-foreground/70">
          {error && <Alert variant="error">{error}</Alert>}
          {check === null && !error ? (
            <div className="flex justify-center py-4">
              <Spinner className="h-5 w-5 text-primary" />
            </div>
          ) : check?.deletable ? (
            <p>Bu doktorun randevu geçmişi yok. Profil, müsaitlik ve uzmanlık bağlantılarıyla birlikte kalıcı olarak silinecek. Bu işlem geri alınamaz.</p>
          ) : check ? (
            <>
              <p>
                Bu doktorun randevu geçmişi olduğu için kalıcı olarak silinemez ({check.appointmentCount} randevu, {check.bookingCount} rezervasyon);
                arşivleyebilirsiniz.
              </p>
              <p>
                Arşivlenen doktor sitede, aramada, sitemap&apos;te ve uzmanlık sayaçlarında görünmez; yeni randevu alamaz. Geçmiş randevular, faturalar
                ve kayıtlar bozulmadan kalır. İstediğiniz zaman arşivden çıkarabilirsiniz.
              </p>
              {blockedByUpcoming && (
                <Alert variant="warning">
                  Gelecekte {check.upcomingAppointmentCount} açık randevu var. Arşivlemeden önce bu randevuları iptal edin ya da taşıyın.
                </Alert>
              )}
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={busy}>
            Vazgeç
          </Button>
          {check?.deletable ? (
            <Button type="button" variant="destructive" loading={busy} onClick={() => void handleDelete()}>
              <Trash2 className="h-4 w-4" />
              Kalıcı Sil
            </Button>
          ) : check ? (
            <Button type="button" variant="warning" loading={busy} disabled={blockedByUpcoming} onClick={() => void handleArchive()}>
              <Archive className="h-4 w-4" />
              Arşivle
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
