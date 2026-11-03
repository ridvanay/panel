"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertCircle, CalendarCheck, Eye, RefreshCw, ShieldAlert, Video } from "lucide-react";
import { PageHeading } from "@/components/admin/page-heading";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/context/auth-context";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import {
  getCoordinatorConsultation,
  getCoordinatorConsultationMessage,
  listCoordinatorConsultations,
  type CoordinatorConsultation,
  type CoordinatorConsultationDetail,
} from "@/lib/api/service-desk-admin";
import {
  CHANNEL_LABELS,
  DESK_TIME_ZONE,
  STATUS_LABELS,
  STATUS_TONES,
  formatDateTimeIn,
  formatMinutesTr,
  isJoinWindowOpen,
  languageName,
  minutesUntilJoinOpens,
} from "./service-desk-format";

/** Hesap güvenliği (2FA) sayfası - talep mesajını görmek için iki adımlı doğrulama gerekir. */
export const TWO_FACTOR_SETTINGS_HREF = "/admin/settings/security";

/** Pencere açıksa "Görüşmeye katıl" bağlantısı, değilse "X dk sonra açılır" pasif düğmesi. */
export function JoinButton({ consultation, nowMs }: { consultation: Pick<CoordinatorConsultation, "id" | "startsAt" | "endsAt" | "status" | "consultationNumber">; nowMs: number }) {
  if (consultation.status !== "SCHEDULED") return null;
  if (isJoinWindowOpen(consultation.startsAt, consultation.endsAt, nowMs)) {
    return (
      <Link
        href={`/admin/my-consultations/${encodeURIComponent(consultation.id)}/room`}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-all duration-300 hover:bg-primary-hover"
      >
        <Video className="h-4 w-4" aria-hidden="true" />
        Görüşmeye katıl
        <span className="sr-only"> — {consultation.consultationNumber}</span>
      </Link>
    );
  }
  if (nowMs >= new Date(consultation.endsAt).getTime()) return null;
  const minutes = minutesUntilJoinOpens(consultation.startsAt, nowMs);
  return (
    <Button type="button" size="sm" variant="outline" disabled aria-label={`${consultation.consultationNumber} görüşmesi ${formatMinutesTr(minutes)} sonra açılır`}>
      {formatMinutesTr(minutes)} sonra açılır
    </Button>
  );
}

function ConsultationItem({ item, nowMs, onDetails }: { item: CoordinatorConsultation; nowMs: number; onDetails: () => void }) {
  return (
    <li className="space-y-2 py-3" data-testid={`my-consultation-${item.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-foreground">
            {formatDateTimeIn(item.startsAt, DESK_TIME_ZONE)} <span className="text-xs font-normal text-foreground/60">(İstanbul)</span>
          </p>
          {item.patientTimeZone && item.patientTimeZone !== DESK_TIME_ZONE && (
            <p className="text-xs text-foreground/60">
              Hastanın saati: {formatDateTimeIn(item.startsAt, item.patientTimeZone)} ({item.patientTimeZone})
            </p>
          )}
          <p className="text-sm text-foreground">
            {item.serviceName} - <bdi>{item.patientName}</bdi>
          </p>
          <p className="text-xs text-foreground/60">
            Ülke: {item.country ?? "-"} - Dil: {languageName(item.contactLanguage)} - Tercüman: {item.needsInterpreter ? languageName(item.interpreterLanguage) : "Yok"} - Tercih edilen kanal:{" "}
            {item.preferredContactChannel ? (CHANNEL_LABELS[item.preferredContactChannel] ?? item.preferredContactChannel) : "-"}
          </p>
          <p className="text-xs text-foreground/60">{item.consultationNumber}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONES[item.status]}>{STATUS_LABELS[item.status]}</Badge>
          <Button type="button" size="sm" variant="outline" aria-label={`${item.consultationNumber} detayı`} onClick={onDetails}>
            Detay
          </Button>
          <JoinButton consultation={item} nowMs={nowMs} />
        </div>
      </div>
    </li>
  );
}

function Section({
  title,
  testId,
  items,
  error,
  nowMs,
  emptyText,
  onRetry,
  onDetails,
}: {
  title: string;
  testId: string;
  items: CoordinatorConsultation[] | null;
  error: string | null;
  nowMs: number;
  emptyText: string;
  onRetry: () => void;
  onDetails: (c: CoordinatorConsultation) => void;
}) {
  return (
    <Card className="space-y-2" data-testid={testId}>
      <h2 className="admin-h2">{title}</h2>
      {error && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center gap-3">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              Yeniden dene
            </Button>
          </span>
        </Alert>
      )}
      {items === null && !error && (
        <div className="space-y-2" role="status" aria-busy="true">
          <span className="sr-only">Yükleniyor</span>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}
      {items !== null && items.length === 0 && <EmptyState icon={CalendarCheck} title={emptyText} />}
      {items !== null && items.length > 0 && (
        <ul className="divide-y divide-border" aria-label={title}>
          {items.map((item) => (
            <ConsultationItem key={item.id} item={item} nowMs={nowMs} onDetails={() => onDetails(item)} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/** `/admin/my-consultations` - koordinatörün bugünkü ve yaklaşan görüşmeleri. */
export function MyConsultationsPanel() {
  const { user, status } = useAuth();
  const isCoordinator = user?.isServiceCoordinator === true;
  const [today, setToday] = useState<CoordinatorConsultation[] | null>(null);
  const [upcoming, setUpcoming] = useState<CoordinatorConsultation[] | null>(null);
  const [todayError, setTodayError] = useState<string | null>(null);
  const [upcomingError, setUpcomingError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [detailId, setDetailId] = useState<string | null>(null);

  const loadToday = useCallback(async () => {
    setTodayError(null);
    try {
      setToday(await listCoordinatorConsultations("today"));
    } catch (err) {
      setTodayError(friendlyErrorMessage(err));
    }
  }, []);
  const loadUpcoming = useCallback(async () => {
    setUpcomingError(null);
    try {
      setUpcoming(await listCoordinatorConsultations("upcoming"));
    } catch (err) {
      setUpcomingError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (!isCoordinator) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ilk yükleme
    void loadToday();
    void loadUpcoming();
  }, [isCoordinator, loadToday, loadUpcoming]);

  // Katılım penceresi ve "X dk sonra açılır" metni için 30 sn'de bir saat güncellenir.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (status === "loading" || !user) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }
  if (!isCoordinator) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Bu sayfa yalnızca hizmet masası koordinatörleri içindir"
        description="Hesabınız aktif bir koordinatör olarak atanmamış. Bir yönetici sizi Hizmet Masası > Koordinatörler sayfasından atayabilir."
      />
    );
  }

  // Bugünkü görüşmeler "Yaklaşan" listesinde tekrar gösterilmez.
  const todayIds = new Set((today ?? []).map((c) => c.id));
  const upcomingOnly = upcoming === null ? null : today === null ? upcoming : upcoming.filter((c) => !todayIds.has(c.id));
  const detailItem = [...(today ?? []), ...(upcoming ?? [])].find((c) => c.id === detailId) ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeading
        icon={CalendarCheck}
        title="Görüşmelerim"
        description="Size atanan online görüşmeler. Görüşmeye başlangıçtan 15 dakika önce katılabilirsiniz; hasta sizi odada bekler. Görüşmeler kaydedilmez."
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void loadToday();
              void loadUpcoming();
            }}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Yenile
          </Button>
        }
      />
      <Section title="Bugünkü görüşmelerim" testId="my-consultations-today" items={today} error={todayError} nowMs={nowMs} emptyText="Bugün için görüşmeniz yok" onRetry={() => void loadToday()} onDetails={(c) => setDetailId(c.id)} />
      <Section title="Yaklaşan görüşmeler" testId="my-consultations-upcoming" items={upcomingOnly} error={upcomingError} nowMs={nowMs} emptyText="Yaklaşan görüşmeniz yok" onRetry={() => void loadUpcoming()} onDetails={(c) => setDetailId(c.id)} />
      <ConsultationDetailDialog id={detailId} summary={detailItem} nowMs={nowMs} onClose={() => setDetailId(null)} />
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <dt className="text-foreground/60">{label}</dt>
      <dd className="col-span-2 min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}

type MessageState = { kind: "idle" } | { kind: "loading" } | { kind: "shown"; message: string | null } | { kind: "twoFactor" } | { kind: "error"; text: string };

/** Detay: iletişim bilgileri + "Talep mesajını göster" (2FA şartı; her görüntüleme sunucuda kayıt altına alınır). */
export function ConsultationDetailDialog({ id, summary, nowMs, onClose }: { id: string | null; summary: CoordinatorConsultation | null; nowMs: number; onClose: () => void }) {
  const [detail, setDetail] = useState<CoordinatorConsultationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<MessageState>({ kind: "idle" });

  useEffect(() => {
    if (!id) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- diyalog açılınca detayı yükle
    setDetail(null);
    setError(null);
    setMessage({ kind: "idle" });
    getCoordinatorConsultation(id)
      .then((d) => alive && setDetail(d))
      .catch((err) => alive && setError(friendlyErrorMessage(err)));
    return () => {
      alive = false;
    };
  }, [id]);

  async function showMessage() {
    if (!id) return;
    setMessage({ kind: "loading" });
    try {
      const res = await getCoordinatorConsultationMessage(id);
      setMessage({ kind: "shown", message: res.message });
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "TWO_FACTOR_REQUIRED") setMessage({ kind: "twoFactor" });
      else setMessage({ kind: "error", text: friendlyErrorMessage(err) });
    }
  }

  const view = detail ?? summary;

  return (
    <Dialog open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Görüşme detayı</DialogTitle>
          <DialogDescription>Hasta iletişim bilgileri yalnızca size atanmış görüşmelerde görünür; erişim kayıt altına alınır.</DialogDescription>
        </DialogHeader>
        {error && <Alert variant="error">{error}</Alert>}
        {!view && !error && (
          <div className="space-y-2" role="status" aria-busy="true">
            <span className="sr-only">Yükleniyor</span>
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        )}
        {view && (
          <dl className="space-y-2" data-testid="my-consultation-detail">
            <Row label="Numara">{view.consultationNumber}</Row>
            <Row label="Hizmet">{view.serviceName}</Row>
            <Row label="Saat (İstanbul)">{formatDateTimeIn(view.startsAt, DESK_TIME_ZONE)}</Row>
            <Row label="Hasta">
              <bdi>{view.patientName}</bdi>
            </Row>
            <Row label="E-posta">{detail ? <bdi>{detail.email}</bdi> : "..."}</Row>
            <Row label="Telefon">{detail ? (detail.phone ? <bdi>{detail.phone}</bdi> : "-") : "..."}</Row>
            <Row label="Ülke">{view.country ?? "-"}</Row>
            <Row label="Dil">{languageName(view.contactLanguage)}</Row>
            <Row label="Tercüman">{view.needsInterpreter ? languageName(view.interpreterLanguage) : "Yok"}</Row>
            <Row label="Tercih edilen kanal">{view.preferredContactChannel ? (CHANNEL_LABELS[view.preferredContactChannel] ?? view.preferredContactChannel) : "-"}</Row>
          </dl>
        )}
        {view?.hasMessage && (
          <div className="space-y-2 rounded-lg border border-border p-3" data-testid="my-consultation-message-box">
            {message.kind === "idle" && (
              <>
                <p className="text-xs text-foreground/60">Hastanın talep mesajı sağlık bilgisi içerebilir. Bu görüntüleme kayıt altına alınır.</p>
                <Button type="button" size="sm" variant="outline" onClick={() => void showMessage()}>
                  <Eye className="h-4 w-4" aria-hidden="true" />
                  Talep mesajını göster
                </Button>
              </>
            )}
            {message.kind === "loading" && (
              <p className="flex items-center gap-2 text-sm" role="status">
                <Spinner className="h-4 w-4" />
                Mesaj yükleniyor
              </p>
            )}
            {message.kind === "twoFactor" && (
              <Alert variant="warning">
                <span data-testid="my-consultation-2fa-required">
                  Mesajı görmek için iki adımlı doğrulamayı açın.{" "}
                  <Link href={TWO_FACTOR_SETTINGS_HREF} className="font-medium underline">
                    Hesap güvenliği ayarlarına git
                  </Link>
                </span>
              </Alert>
            )}
            {message.kind === "error" && (
              <Alert variant="error">
                <span className="flex flex-wrap items-center gap-3">
                  {message.text}
                  <Button type="button" size="sm" variant="outline" onClick={() => void showMessage()}>
                    Yeniden dene
                  </Button>
                </span>
              </Alert>
            )}
            {message.kind === "shown" && (
              <div className="space-y-2" data-testid="my-consultation-message">
                <p className="whitespace-pre-wrap break-words text-sm text-foreground">{message.message ?? "Hasta mesaj bırakmadı."}</p>
                <p className="text-xs text-foreground/60">Bu görüntüleme kayıt altına alınır.</p>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Kapat
          </Button>
          {view && <JoinButton consultation={view} nowMs={nowMs} />}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
