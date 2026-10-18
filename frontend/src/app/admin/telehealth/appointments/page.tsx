"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, CalendarClock, Search, Trash2 } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import type { Appointment, AppointmentStatus } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeading } from "@/components/admin/page-heading";
import { RescheduleAppointmentDialog } from "@/components/admin/telehealth/reschedule-appointment-dialog";
import { CancelAppointmentDialog } from "@/components/admin/telehealth/cancel-appointment-dialog";
import { DeleteAppointmentDialog } from "@/components/admin/telehealth/delete-appointment-dialog";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { formatPriceFromCents } from "@/lib/format-price";
import { resolveDisplayedAppointmentStatus } from "@/components/site/telehealth/appointment-status-badge";
import { getJoinState } from "@/lib/telehealth-join-window";
import { useNow } from "@/hooks/use-now";

/**
 * `.claude/architect-scope-telehealth-template.md` §5.1/§8.4 — randevu listesi, hasta PII'si
 * içerir. Backend zaten `requireSiteRole(ADMIN, MANAGER)` ile 403 döner (EDITOR dahil); sidebar
 * item'ı bu role zaten görünmez (bkz. `sidebar.tsx`). Doğrudan URL ile gelen yetkisiz bir kullanıcı
 * burada `friendlyErrorMessage`'ın 403 mesajını görür.
 *
 * Görev (2026-09-15) — sayfa artık TAMAMEN salt-okunur DEĞİL: iptalin yanına "Tarih/Saat Değiştir"
 * (reschedule) aksiyonu eklendi (`PATCH .../reschedule`, YALNIZCA ADMIN — MANAGER dialog'u açabilir
 * ama kaydederken sunucudan 403 alır, `friendlyErrorMessage` ile forma yansır).
 */
/**
 * "Tarih/Saat Değiştir" butonunun GÖRÜNÜR olduğu durumlar — görev talimatı bağlayıcı: yalnızca
 * `SCHEDULED`/`IN_PROGRESS` (aktif/planlanmış). Mevcut "İptal Et" butonu (`status === "SCHEDULED"`)
 * İLE AYNI KAPSAM DEĞİLDİR — o davranış DEĞİŞTİRİLMEZ (görev talimatı yalnızca YANINA yeni bir
 * aksiyon eklenmesini istiyor, mevcut iptal mantığını genişletmeyi DEĞİL).
 */
const RESCHEDULABLE_STATUSES: AppointmentStatus[] = ["SCHEDULED", "IN_PROGRESS"];
/** Kalıcı silme yalnızca bu durumlarda sunulur; asıl uygunluk kararı sunucudadır (deletion-check). */
const DELETABLE_STATUSES: AppointmentStatus[] = ["CANCELLED", "COMPLETED"];
const STATUS_LABELS: Record<AppointmentStatus, string> = {
  PENDING_PAYMENT: "Ödeme Bekliyor",
  SCHEDULED: "Planlandı",
  IN_PROGRESS: "Devam Ediyor",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal Edildi",
  NO_SHOW: "Gelmedi",
};

/** Paket A2 — `IN_PROGRESS` ama katılım penceresi kapanmış (otomatik kapatma henüz çalışmamış). */
const ENDED_LABEL = "Sona erdi";

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
  const now = useNow();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AppointmentStatus | "">("");
  const [search, setSearch] = useState("");
  const [pendingCancel, setPendingCancel] = useState<Appointment | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Appointment | null>(null);
  const [pendingReschedule, setPendingReschedule] = useState<Appointment | null>(null);

  // 2026-10-18 (Paket B4) — test olarak arşivlenmiş booking'lerin randevuları varsayılan olarak gizli.
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async (status?: AppointmentStatus, search?: string) => {
    try {
      const page = await telehealthApi.listAdminAppointments({
        status: status || undefined,
        search: search || undefined,
        includeArchived: showArchived,
        limit: 100,
      });
      setAppointments(page.items);
      setError(null);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, [showArchived]);

  useEffect(() => {
    const handle = setTimeout(() => void load(status || undefined, search), 250);
    return () => clearTimeout(handle);
  }, [load, status, search]);

  return (
    <div className="space-y-6">
      <PageHeading
        icon={CalendarClock}
        title="Randevular"
        description="Tüm doktorların randevuları — hasta PII'si içerir; planlanmış/devam eden randevular iptal edilebilir veya (yalnızca ADMIN) yeniden planlanabilir; ödemesiz test randevuları (yalnızca ADMIN) kalıcı silinebilir."
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
            <label className="flex items-center gap-2 text-sm text-foreground/70">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} aria-label="Arşivi göster" />
              Arşivi göster
            </label>
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
                        {resolveDisplayedAppointmentStatus(appointment.status, getJoinState({ appointments: [appointment] }, now) === "ended") === "ENDED" ? (
                          <Badge tone="neutral" size="sm">
                            {ENDED_LABEL}
                          </Badge>
                        ) : (
                          <Badge tone={STATUS_TONES[appointment.status]} size="sm">
                            {STATUS_LABELS[appointment.status]}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {RESCHEDULABLE_STATUSES.includes(appointment.status) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setPendingReschedule(appointment)}
                              aria-label={`"${appointment.patientName}" için randevu tarihini/saatini değiştir`}
                            >
                              <CalendarClock className="h-3.5 w-3.5" />
                              Tarih/Saat Değiştir
                            </Button>
                          )}
                          {appointment.status === "SCHEDULED" && (
                            <Button variant="ghost" size="sm" onClick={() => setPendingCancel(appointment)}>
                              İptal Et
                            </Button>
                          )}
                          {DELETABLE_STATUSES.includes(appointment.status) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              onClick={() => setPendingDelete(appointment)}
                              aria-label={`"${appointment.patientName}" randevusunu kalıcı olarak sil`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Sil
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </motion.div>
          )}
        </>
      )}

      <CancelAppointmentDialog
        key={`cancel-${pendingCancel?.id ?? "closed"}`}
        open={pendingCancel !== null}
        onOpenChange={(open) => {
          if (!open) setPendingCancel(null);
        }}
        appointment={pendingCancel}
        onCancelled={() => load(status || undefined, search)}
      />

      <DeleteAppointmentDialog
        key={`delete-${pendingDelete?.id ?? "closed"}`}
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        appointment={pendingDelete}
        onDeleted={() => load(status || undefined, search)}
      />

      <RescheduleAppointmentDialog
        open={pendingReschedule !== null}
        onOpenChange={(open) => {
          if (!open) setPendingReschedule(null);
        }}
        appointment={pendingReschedule}
        onRescheduled={() => load(status || undefined, search)}
      />
    </div>
  );
}
