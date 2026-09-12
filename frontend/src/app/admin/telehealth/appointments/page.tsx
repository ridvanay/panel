"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { AlertCircle, CalendarClock, Search } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import type { Appointment, AppointmentStatus } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeading } from "@/components/admin/page-heading";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { formatPriceFromCents } from "@/lib/format-price";

/**
 * `.claude/architect-scope-telehealth-template.md` §5.1/§8.4 — SALT-OKUNUR randevu listesi
 * (yalnızca iptal aksiyonu), hasta PII'si içerir. Backend zaten `requireSiteRole(ADMIN, MANAGER)`
 * ile 403 döner (EDITOR dahil); sidebar item'ı bu role zaten görünmez (bkz. `sidebar.tsx`).
 * Doğrudan URL ile gelen yetkisiz bir kullanıcı burada `friendlyErrorMessage`'ın 403 mesajını görür.
 */
const STATUS_LABELS: Record<AppointmentStatus, string> = {
  PENDING_PAYMENT: "Ödeme Bekliyor",
  SCHEDULED: "Planlandı",
  IN_PROGRESS: "Devam Ediyor",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal Edildi",
  NO_SHOW: "Gelmedi",
};

const STATUS_TONES: Record<AppointmentStatus, "neutral" | "primary" | "success" | "danger" | "warning"> = {
  PENDING_PAYMENT: "neutral",
  SCHEDULED: "primary",
  IN_PROGRESS: "warning",
  COMPLETED: "success",
  CANCELLED: "neutral",
  NO_SHOW: "danger",
};

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" });

export default function AdminTelehealthAppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AppointmentStatus | "">("");
  const [search, setSearch] = useState("");
  const [pendingCancel, setPendingCancel] = useState<Appointment | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async (status?: AppointmentStatus, search?: string) => {
    try {
      const page = await telehealthApi.listAdminAppointments({ status: status || undefined, search: search || undefined, limit: 100 });
      setAppointments(page.items);
      setError(null);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => void load(status || undefined, search), 250);
    return () => clearTimeout(handle);
  }, [load, status, search]);

  async function handleCancel() {
    if (!pendingCancel) return;
    setCancelling(true);
    try {
      await telehealthApi.cancelAppointment(pendingCancel.id);
      toast.success("Randevu iptal edildi.");
      setPendingCancel(null);
      await load(status || undefined, search);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeading
        icon={CalendarClock}
        title="Randevular"
        description="Tüm doktorların randevuları — salt okunur, yalnızca iptal edilebilir."
      />

      {error && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load(status || undefined, search)}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      )}

      {appointments === null ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <InputGroup className="w-full sm:max-w-xs border-2 border-border bg-muted">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="Hasta adına veya e-postasına göre ara..."
                aria-label="Randevu ara"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </InputGroup>
            <Select aria-label="Durum filtresi" value={status} onChange={(e) => setStatus(e.target.value as AppointmentStatus | "")} className="w-auto">
              <option value="">Tüm durumlar</option>
              {(Object.keys(STATUS_LABELS) as AppointmentStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>

          {appointments.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="Henüz randevu yok"
              description="İlk gerçek randevu, hasta rezervasyon akışını tamamladığında burada görünecek."
            />
          ) : (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hasta</TableHead>
                    <TableHead>Doktor</TableHead>
                    <TableHead>Tarih</TableHead>
                    <TableHead>Ücret</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead className="text-right">İşlemler</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {appointments.map((appointment) => (
                    <TableRow key={appointment.id}>
                      <TableCell>
                        <span className="font-medium text-foreground">{appointment.patientName}</span>
                        <p className="text-xs text-foreground/50">{appointment.patientEmail}</p>
                      </TableCell>
                      <TableCell className="text-sm text-foreground/70">
                        {appointment.doctor.title} {appointment.doctor.fullName}
                      </TableCell>
                      <TableCell className="text-sm text-foreground/70">{dateFormatter.format(new Date(appointment.startsAt))}</TableCell>
                      <TableCell className="text-sm text-foreground/70">{formatPriceFromCents(appointment.priceCents, appointment.currency)}</TableCell>
                      <TableCell>
                        <Badge tone={STATUS_TONES[appointment.status]} size="sm">
                          {STATUS_LABELS[appointment.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {appointment.status === "SCHEDULED" && (
                          <Button variant="ghost" size="sm" onClick={() => setPendingCancel(appointment)}>
                            İptal Et
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </motion.div>
          )}
        </>
      )}

      <ConfirmDialog
        open={pendingCancel !== null}
        onOpenChange={(open) => {
          if (!open) setPendingCancel(null);
        }}
        title="Randevuyu iptal et"
        description={
          pendingCancel
            ? `"${pendingCancel.patientName}" için ${dateFormatter.format(new Date(pendingCancel.startsAt))} tarihli randevu iptal edilecek. Bu saat başka bir hastaya AÇILMAZ (slot kalıcı olarak kapalı kalır).`
            : undefined
        }
        confirmText="İptal Et"
        tone="warning"
        loading={cancelling}
        onConfirm={handleCancel}
      />
    </div>
  );
}
