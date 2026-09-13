"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import * as telehealthApi from "@/lib/api/telehealth";
import type { AdminUser, DoctorProfile } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

interface LinkDoctorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: AdminUser | null;
  /** Bağlama başarılı olduktan SONRA çağrılır — sayfa listesini yeniden yükler. */
  onLinked: () => void | Promise<void>;
}

/**
 * `/admin/users` — bir hesabı boş (`userId: null`) bir `DoctorProfile`'a bağlar. Bağlama/çözme
 * SADECE burada yapılır (bkz. `/admin/telehealth/doctors/[doctorId]` sayfasındaki salt-okunur
 * "Bağlantıyı /admin/users üzerinden yönetin" notu) — backend `PATCH
 * /admin/telehealth/doctors/{id}` gövdesinde `userId` alanı VARSA (null dahil) yalnızca
 * `SiteRole=ADMIN` kabul eder (MANAGER `403` alır); bu sayfa zaten ADMIN-only olduğu için
 * sorun çıkarmaz.
 */
export function LinkDoctorDialog({ open, onOpenChange, user, onLinked }: LinkDoctorDialogProps) {
  const [doctors, setDoctors] = useState<DoctorProfile[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Boş doktor listesi — dialog her açıldığında sıfırdan çekilir (`booking-documents-dialog.tsx`
  // İLE AYNI `cancelled` bayraklı desen, "setState senkron çağrılamaz" lint kuralını ihlal etmez).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!open) return;
      if (!cancelled) {
        setLoadError(null);
        setLinkError(null);
        setDoctors(null);
        setSelectedDoctorId("");
      }
      try {
        const page = await telehealthApi.listAdminDoctors({ limit: 100 });
        const unlinked = page.items.filter((doctor) => doctor.userId === null);
        if (!cancelled) {
          setDoctors(unlinked);
          if (unlinked.length > 0) setSelectedDoctorId(unlinked[0].id);
        }
      } catch (err) {
        if (!cancelled) setLoadError(friendlyErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function handleConfirm() {
    if (!user || !selectedDoctorId) return;
    setLinking(true);
    setLinkError(null);
    try {
      await telehealthApi.updateDoctor(selectedDoctorId, { userId: user.id });
      await onLinked();
      toast.success(`"${user.name}" bir doktor profiline bağlandı.`);
      onOpenChange(false);
    } catch (err) {
      setLinkError(friendlyErrorMessage(err));
    } finally {
      setLinking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Doktor profiline bağla</DialogTitle>
          <DialogDescription>
            {user ? `"${user.name}" kullanıcısını boş (hesapsız) bir doktor profiline bağlayın.` : undefined}
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <Alert variant="error">{loadError}</Alert>
        ) : doctors === null ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-5 w-5 text-primary" />
          </div>
        ) : doctors.length === 0 ? (
          <Alert variant="info">Bağlanacak boş doktor profili yok.</Alert>
        ) : (
          <Field id="link-doctor-select" label="Doktor profili" required>
            {(inputProps) => (
              <Select {...inputProps} value={selectedDoctorId} onChange={(e) => setSelectedDoctorId(e.target.value)}>
                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.title} {doctor.fullName}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        {linkError && <Alert variant="error">{linkError}</Alert>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            type="button"
            disabled={!doctors || doctors.length === 0 || !selectedDoctorId}
            loading={linking}
            onClick={() => void handleConfirm()}
          >
            Bağla
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
