"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { AlertCircle, CalendarClock, Headphones, History, Search, Trash2 } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import type { Appointment, AppointmentStatus, QaListenerTokenResponse } from "@/lib/api/types";
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
import { QaListenerJoinDialog } from "@/components/admin/telehealth/qa-listener-join-dialog";
import { QaListenerHistoryDialog } from "@/components/admin/telehealth/qa-listener-history-dialog";
import { QaListenerSessionPanel } from "@/components/admin/telehealth/qa-listener-session-panel";
import { useAuth } from "@/context/auth-context";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { formatPriceFromCents } from "@/lib/format-price";
import { resolveDisplayedAppointmentStatus } from "@/components/site/telehealth/appointment-status-badge";
import { getJoinState } from "@/lib/telehealth-join-window";
import { useNow } from "@/hooks/use-now";
import { TURKEY_TIME_ZONE, cityLabel, gmtLabel, isSameClockAsTurkey } from "@/lib/dual-time";

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

// Paket P — admin listesi Türkiye saatini AÇIKÇA gösterir (tarayıcının dilimi değil) + hastanın saati.
const dateFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: TURKEY_TIME_ZONE });

function PatientLocalTime({ iso, timeZone }: { iso: string; timeZone: string | null | undefined }) {
  if (!timeZone || isSameClockAsTurkey(iso, timeZone)) return null;
  const time = new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone }).format(new Date(iso));
  return (
    <p className="text-xs text-foreground/50" data-testid="admin-patient-time">
      Hasta: {cityLabel(timeZone)} {time} ({gmtLabel(iso, timeZone)})
    </p>
  );
}

export default function AdminTelehealthAppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const now = useNow();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AppointmentStatus | "">("");
  const [search, setSearch] = useState("");
  const [pendingCancel, setPendingCancel] = useState<Appointment | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Appointment | null>(null);
  const [pendingReschedule, setPendingReschedule] = useState<Appointment | null>(null);

  // Paket C — kalite kontrol dinleyicisi: YALNIZCA 2FA'sı etkin ADMIN (sunucu da ayrıca zorlar).
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const canListen = isAdmin && user?.twoFactorEnabled === true;
  const [pendingListen, setPendingListen] = useState<Appointment | null>(null);
  const [historyFor, setHistoryFor] = useState<Appointment | null>(null);
  const [listenerSession, setListenerSession] = useState<{ appointment: Appointment; session: QaListenerTokenResponse } | null>(null);

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

      {isAdmin && !canListen && (
        <Alert variant="info">
          Görüşmelere kalite kontrol dinleyicisi olarak katılmak için hesabınızda iki adımlı doğrulama (2FA) etkin olmalı.{" "}
          <Link href="/admin/settings/security" className="font-medium underline">
            2FA ayarları
          </Link>
        </Alert>
      )}

      {listenerSession && (
        <QaListenerSessionPanel
          key={listenerSession.session.sessionId}
          appointment={listenerSession.appointment}
          session={listenerSession.session}
          onEnded={() => setListenerSession(null)}
        />
      )}

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
                      <TableCell className="text-sm text-foreground/70">
                        {dateFormatter.format(new Date(appointment.startsAt))} TSİ
                        <PatientLocalTime iso={appointment.startsAt} timeZone={appointment.patientTimeZone} />
                      </TableCell>
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
                          {isAdmin && appointment.status === "IN_PROGRESS" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!canListen || listenerSession !== null}
                              title={!canListen ? "2FA etkin olmalı" : undefined}
                              onClick={() => setPendingListen(appointment)}
                              aria-label={`"${appointment.patientName}" görüşmesine dinleyici olarak katıl`}
                            >
                              <Headphones className="h-3.5 w-3.5" />
                              Dinleyici olarak katıl
                            </Button>
                          )}
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setHistoryFor(appointment)}
                              aria-label={`"${appointment.patientName}" görüşmesinin dinleyici geçmişi`}
                            >
                              <History className="h-3.5 w-3.5" />
                              Dinleyici geçmişi
                            </Button>
                          )}
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

      <QaListenerJoinDialog
        key={`listen-${pendingListen?.id ?? "closed"}`}
        open={pendingListen !== null}
        onOpenChange={(open) => {
          if (!open) setPendingListen(null);
        }}
        appointment={pendingListen}
        onJoined={(appointment, session) => setListenerSession({ appointment, session })}
      />

      <QaListenerHistoryDialog
        key={`history-${historyFor?.id ?? "closed"}`}
        open={historyFor !== null}
        onOpenChange={(open) => {
          if (!open) setHistoryFor(null);
        }}
        appointment={historyFor}
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
