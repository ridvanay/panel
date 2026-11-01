"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "@livekit/components-styles";
import { LiveKitRoom, RoomAudioRenderer, useConnectionState, useRoomContext } from "@livekit/components-react";
import { ConnectionState, RoomEvent, type DisconnectReason } from "livekit-client";
import { AlertTriangle, Loader2, LogIn, Settings2, ShieldAlert, Wifi, WifiOff } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { listPublicModules } from "@/lib/api/modules";
import { isDoctorHostname, isSubdomainModeEnabled, toDoctorOrigin } from "@/lib/doctor-host";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { useAuthOptional } from "@/context/auth-context";
import { useActiveLocaleCode, useLocalizePath } from "@/context/locale-alternates-context";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import { localeDirection } from "@/lib/i18n/locale-direction";
import { fmt, useConsultationStrings } from "@/lib/i18n/use-consultation-strings";
import type { Appointment, ConsultationRecording, MeetingTokenResponse, RecordingSignalPayload } from "@/lib/api/types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RecordingConsentDialog } from "@/components/site/telehealth/recording-consent-dialog";
import { QaListenerNotice } from "@/components/site/telehealth/qa-listener-notice";
// Paket AA — tercüman katılımı (ayrı dosyalar; bu dosyada yalnızca bağlantı noktaları).
import { InterpreterPreJoinNotice } from "@/components/site/interpreter/interpreter-prejoin-notice";
import { RecordingIndicator } from "@/components/site/telehealth/recording-indicator";
import { RecordingControls } from "@/components/site/telehealth/recording-controls";
import { cn } from "@/lib/utils";
import { ParticipantLabelProvider } from "@/components/site/telehealth/room/label-context";
import type { ConsultationStrings } from "@/lib/i18n/site-dictionaries/en/consultation";
import type { LabelContext } from "@/components/site/telehealth/room/participant-label";
import { ConnectionLayers, ConnectionStateReporter } from "@/components/site/telehealth/room/connection-layers";
import { useAppReconnect, type AppReconnect } from "@/components/site/telehealth/room/use-app-reconnect";
import { disconnectKind } from "@/components/site/telehealth/room/disconnect-kind";
import { isCounterpart } from "@/components/site/telehealth/room/participant-kind";
import { ConsultationStage } from "@/components/site/telehealth/room/stage";
import { RoomControlBar } from "@/components/site/telehealth/room/control-bar";
import { RoomUiProvider } from "@/components/site/telehealth/room/room-ui-context";
import { SessionTimer, EndingSoonNotice } from "@/components/site/telehealth/room/session-timer";
import { DeviceBootstrap } from "@/components/site/telehealth/room/device-bootstrap";
import { PrejoinDeviceCheck, type PrejoinCheckHandle } from "@/components/site/telehealth/room/prejoin-device-check";
import { buildCaptureOptions, loadPrefs } from "@/components/site/telehealth/room/device-prefs";
import { classifyConnectionError, classifyMediaFailure, failureMessage, warnRaw } from "@/components/site/telehealth/room/connection-errors";

/**
 * `.claude/architect-scope-telehealth-template.md` §4.4/§4.5 + `.claude/design-notes-telehealth.md`
 * §5-§7 — LiveKit konsültasyon odası. GERÇEK `@livekit/components-react`/`livekit-client` SDK'sı
 * kullanılır; sahte/mock video, taklit "bağlanıyor" animasyonu veya döngüye alınmış örnek video
 * KESİNLİKLE YAZILMAZ ([DTI] §8.2 + mimari §4.4 madde 1). Token'ı bu bileşen ÜRETMEZ, yalnızca
 * `POST /appointments/{id}/meeting-token` ucundan alır (integration-agent'ın sahası).
 *
 * Acil durum uyarı şeridi (`EmergencyNoticeStrip`) `consultation/layout.tsx`'te zaten render
 * edilir — burada TEKRARLANMAZ (§9.1 tek yerden kapatılamaz şerit ilkesi).
 */

const JOIN_WINDOW_AFTER_MS = 15 * 60_000;
const NEAR_THRESHOLD_MS = 15 * 60_000;

interface JoinState {
  remainingMs: number;
  isNear: boolean;
  isJoinable: boolean;
  isExpired: boolean;
}

/**
 * Bug-fix turu (2026-09-15, frontend-agent) — backend `POST .../meeting-token` ARTIK rol ayrımı
 * YAPMADAN çalışıyor: booking'e bağlı bir randevu için TEK şart `paymentStatus === "PAID"`
 * (zaman penceresi backend'de TAMAMEN kalktı, hem doktor hem hasta için). Bu sayfaya
 * (`/consultation/:id`) booking `PENDING_PAYMENT` durumundayken HİÇ ULAŞILAMAZ —
 * `assertAppointmentAccess` bunu backend'de zaten reddeder — yani `appointment.status`
 * `PENDING_PAYMENT` DEĞİLSE randevu ZATEN ödenmiş/onaylanmış demektir. Dolayısıyla bu hook'un
 * kendi 5dk/15dk client-side penceresinin ARTIK KORUYUCU bir işlevi YOK; `isJoinable`/`isExpired`
 * HER ZAMAN sırasıyla `true`/`false` döner (buton her zaman aktif). `remainingMs`/`isNear`
 * (geri sayım GÖRSELİ, salt bilgilendirme) DEĞİŞMEDEN hesaplanmaya devam eder.
 */
function useJoinState(appointment: Appointment): JoinState {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const start = new Date(appointment.startsAt).getTime();
  const end = new Date(appointment.endsAt).getTime();
  const joinClosesAt = end + JOIN_WINDOW_AFTER_MS;
  const remainingMs = start - now;

  return {
    remainingMs,
    isNear: remainingMs <= NEAR_THRESHOLD_MS && now <= joinClosesAt,
    isJoinable: true,
    isExpired: false,
  };
}

function formatCountdownDigits(ms: number): { minutes: string; seconds: string } {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return { minutes: String(minutes).padStart(2, "0"), seconds: String(seconds).padStart(2, "0") };
}

/** `.claude/design-notes-telehealth.md` §7 — "uzak" kademe, cümle içinde, `Inter`. */
function formatFarCountdownSentence(ms: number, t: ConsultationStrings): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return fmt(t.countdownHoursMinutes, { hours, minutes });
  return fmt(t.countdownMinutes, { minutes });
}

/**
 * Bug-fix turu (2026-09-21, kullanıcı talebi) — ön doğrulama katmanı (gatekeeper): `?t=` misafir
 * token'ı YOK ve oturum kesin olarak `"unauthenticated"` (henüz `"loading"` DEĞİL) iken artık
 * `GET /appointments/{id}` HİÇ ÇAĞRILMAZ (zaten `404` döneceği KESİN — backend'in IDOR-güvenli
 * tasarımı gereği randevu var/yok ayrımı YAPILMAZ, bkz. `telehealth.routes.ts::assertAppointmentAccess`
 * dosya başı yorumu). Bunun yerine bu temiz "Erişim Doğrulama" ekranı gösterilir — eskiden bu
 * durumda `getAppointment` çağrılır, `404` alınır, ekrana ham "Randevu bulunamadı." metni +
 * anlamsız bir "Tekrar Dene" butonu düşerdi (kullanıcı raporundaki "beklenmedik hata" izlenimi
 * BUNDAN kaynaklanıyordu — teknik olarak React Error Boundary DEĞİL, ama kullanıcıya sunulan tek
 * seçenek "tekrar dene" olduğu için aynı şekilde çıkmaz bir yol gibi görünüyordu).
 *
 * `/login?next=...` — `patient-booking-detail-panel.tsx`'teki AYNI kurulu desen (`resolvePostLoginPath`
 * güvenli/dahili `next` yolunu doğrular, YENİ bir yönlendirme mekanizması İCAT EDİLMEDİ).
 */
function ConsultationAccessGate({ appointmentId }: { appointmentId: string }) {
  const { t } = useConsultationStrings();
  return (
    <Alert variant="warning">
      <div className="space-y-3">
        <span className="flex items-center gap-2 font-medium">
          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t.accessGateTitle}
        </span>
        <p className="text-sm text-foreground/70">{t.accessGateBody}</p>
        <Link
          href={`/login?next=${encodeURIComponent(`/consultation/${appointmentId}`)}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <LogIn className="h-4 w-4" aria-hidden="true" />
          {t.accessGateLogin}
        </Link>
      </div>
    </Alert>
  );
}

function ConsultationSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-20 w-full rounded-[var(--site-radius)]" />
      <Skeleton className="h-72 w-full rounded-[var(--site-radius)]" />
    </div>
  );
}

/** §6.2 — "yapılandırılmamış" durumu: dürüst durum ekranı, `--danger` DEĞİL `--warning`. */
function LiveKitNotConfiguredPanel({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  const { t } = useConsultationStrings();
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--site-radius)] border border-warning/30 bg-warning/5 p-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-warning/15">
        <Settings2 className="h-5 w-5 text-warning" aria-hidden="true" />
      </span>
      <h3 className="font-semibold text-foreground">{t.notConfiguredTitle}</h3>
      <p className="max-w-sm text-sm text-foreground/60">
        {t.notConfiguredBody}{" "}
        <code dir="ltr" className="rounded bg-warning/10 px-1 py-0.5 text-xs">LIVEKIT_URL</code>,{" "}
        <code dir="ltr" className="rounded bg-warning/10 px-1 py-0.5 text-xs">LIVEKIT_API_KEY</code>,{" "}
        <code dir="ltr" className="rounded bg-warning/10 px-1 py-0.5 text-xs">LIVEKIT_API_SECRET</code>
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry} loading={retrying}>
        {t.tryAgain}
      </Button>
    </div>
  );
}

/** §7 — geri sayım, "yakın" kademe: büyük, `tabular-nums`, açık pencerede `text-primary`. */
function CountdownDigits({ ms, active }: { ms: number; active: boolean }) {
  const { minutes, seconds } = formatCountdownDigits(ms);
  return (
    <span
      className={cn(
        "font-heading text-3xl font-bold tabular-nums tracking-tight sm:text-5xl",
        active ? "text-primary" : "text-foreground"
      )}
    >
      {minutes}
      <span className="text-foreground/30">:</span>
      {seconds}
    </span>
  );
}

interface PreJoinStageProps {
  joinState: JoinState;
  requesting: boolean;
  joinError: string | null;
  notConfigured: boolean;
  onJoin: () => void;
  /** Paket AF (Aşama 2): giriş öncesi cihaz testi önizlemesini katılımdan önce durdurmak için tutamak. */
  prejoinRef: RefObject<PrejoinCheckHandle | null>;
}

/**
 * Video başlamadan önceki alan: uzak/yakın geri sayım, "Görüşmeye Katıl" butonu, hata durumu ve
 * "yapılandırılmamış" paneli — §6.2'nin "iki durum ASLA aynı anda görünmez" kuralı burada
 * `notConfigured` kontrolüyle korunur (bekleme odası kavramı LiveKit bağlanmadan ANLAMSIZDIR).
 */
function PreJoinStage({ joinState, requesting, joinError, notConfigured, onJoin, prejoinRef }: PreJoinStageProps) {
  const { t } = useConsultationStrings();
  if (joinState.isExpired) {
    return (
      <div className="rounded-[var(--site-radius)] border border-border bg-surface p-6 text-center text-sm text-foreground/60 sm:p-10">
        {t.joinWindowClosed}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[var(--site-radius)] border border-border bg-surface p-6 text-center sm:p-10">
        {joinState.isNear ? (
          joinState.remainingMs > 0 ? (
            <CountdownDigits ms={joinState.remainingMs} active={joinState.isJoinable} />
          ) : (
            <p className={cn("text-lg font-semibold", joinState.isJoinable ? "text-primary" : "text-foreground")}>
              {t.appointmentTimeArrived}
            </p>
          )
        ) : (
          <p className="text-sm text-foreground/70">{formatFarCountdownSentence(joinState.remainingMs, t)}</p>
        )}

        {joinState.isJoinable && !notConfigured && (
          <Button type="button" onClick={onJoin} loading={requesting} className="mt-4 rounded-[var(--site-radius)]">
            {t.joinButton}
          </Button>
        )}
      </div>

      {joinState.isJoinable && !notConfigured && <PrejoinDeviceCheck handleRef={prejoinRef} />}

      {joinError && !notConfigured && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span>{joinError}</span>
            <Button type="button" variant="outline" size="sm" onClick={onJoin}>
              {t.tryAgain}
            </Button>
          </span>
        </Alert>
      )}

      {notConfigured && <LiveKitNotConfiguredPanel onRetry={onJoin} retrying={requesting} />}
    </div>
  );
}

/**
 * Kontrol çubuğu görünümü/kısayolları `room/control-bar.tsx`'te; bu sarmalayıcı yalnızca MEVCUT sonlandırma akışını
 * (onay penceresi → `room.disconnect()` → yönlendirme) korur. `stageRef` video sahnesini (tüm sayfayı DEĞİL) tam ekrana
 * almak için `ConsultationVideoRoom`'daki `<LiveKitRoom>` kök `div`'ine bağlıdır.
 */
function ConsultationControlBar({
  isDoctor,
  stageRef,
}: {
  isDoctor: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
}) {
  const room = useRoomContext();
  const router = useRouter();
  const localize = useLocalizePath();
  const { t } = useConsultationStrings();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  /**
   * `room.disconnect()` medya track'lerini durdurur ve `onDisconnected` (`handleDisconnected`,
   * `CLIENT_INITIATED` nedeniyle) tetiklenir; yönlendirme bunun ARDINDAN yapılır ki sayfa geçişiyle
   * yarış (race) oluşmasın.
   *
   * Bug-fix turu (2026-09-17, frontend-agent) — doktor dalı `login-form.tsx`'teki
   * `goToDestination`'daki KURULU desenle (§5.6) birebir uyumlu hâle getirildi: subdomain modu
   * AÇIKKEN VE şu an doktor host'unda DEĞİLKEN `/doctor` hedefine `router.push` ile GİDİLEMEZ
   * (Next'in client router'ı cross-origin'i garanti izlemez) — bu durumda
   * `window.location.assign(toDoctorOrigin("/doctor"))` ile TAM SAYFA cross-origin geçiş yapılır.
   * Subdomain modu kapalıyken veya zaten doktor host'undaysak normal client-side navigasyon
   * yeterlidir. Hasta dalı (`/patient/appointments`) subdomain kavramından bağımsızdır, DEĞİŞMEDİ.
   */
  async function handleConfirmEndCall() {
    setDisconnecting(true);
    try {
      await room.disconnect();
    } finally {
      setDisconnecting(false);
      setConfirmOpen(false);
      if (isDoctor) {
        if (isSubdomainModeEnabled() && !isDoctorHostname(window.location.hostname)) {
          window.location.assign(toDoctorOrigin("/doctor"));
        } else {
          router.push(localize("/doctor"));
        }
      } else {
        router.push(localize("/patient/appointments"));
      }
    }
  }

  return (
    <>
      <RoomControlBar stageRef={stageRef} onEndCall={() => setConfirmOpen(true)} />
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="danger"
        title={t.endCallConfirmTitle}
        confirmText={t.endCallConfirmAction}
        cancelText={t.endCallCancel}
        loading={disconnecting}
        onConfirm={() => void handleConfirmEndCall()}
      />
    </>
  );
}

/**
 * Bağlantı durumu rozeti — `payment-status-badge.tsx` (§12.4) paterniyle AYNI konvansiyon: her
 * durumda ikon + metin, mevcut `Badge` primitive'i + var olan tone tokenleri (`warning`/`success`/
 * `danger`). Video üzerine bindirildiği için kontrol çubuğuyla (§5) aynı "cam" istisnasını paylaşan
 * yarı saydam koyu zemin üstünde konumlandırılır; YENİ bir renk/font tokeni İCAT EDİLMEZ.
 */
function ConnectionStatusBadge() {
  const state = useConnectionState();
  const { t } = useConsultationStrings();

  const config = (() => {
    switch (state) {
      case ConnectionState.Connected:
        return { label: t.badgeConnected, tone: "success" as const, Icon: Wifi, spin: false };
      case ConnectionState.Disconnected:
        return { label: t.badgeDisconnected, tone: "danger" as const, Icon: WifiOff, spin: false };
      case ConnectionState.Reconnecting:
      case ConnectionState.SignalReconnecting:
        return { label: t.badgeReconnecting, tone: "warning" as const, Icon: Loader2, spin: true };
      case ConnectionState.Connecting:
      default:
        return { label: t.badgeConnecting, tone: "warning" as const, Icon: Loader2, spin: true };
    }
  })();

  return (
    <div className="absolute start-4 top-4 z-10">
      <Badge tone={config.tone} solid size="sm" className="gap-1 shadow-sm">
        <config.Icon className={cn("h-3 w-3", config.spin && "animate-spin")} aria-hidden="true" />
        {config.label}
      </Badge>
    </div>
  );
}

/**
 * Gelen `RecordingSignalPayload` mevcut yerel `recording` durumuyla birleştirilir. Sinyal
 * `startedAt`/`patientConsentDeniedAt` TAŞIMAZ (§ payload PII içermez, minimal alan seti) — bu iki
 * alan yalnızca REST yanıtlarından (kendi aksiyonumuz — `startRecording`/`stopRecording`/
 * `submitRecordingConsent`) veya mount/reconnect tazelemesinden (`getRecordingStatus`) gelir. Karşı
 * tarafın aksiyonuyla `RECORDING`'e/`CONSENT_DENIED`'e YENİ geçildiyse (yerelde henüz yoksa) doktor
 * tarafındaki süre sayacı/60sn kilidi çalışabilsin diye YAKLAŞIK bir zaman damgası atanır (sinyal
 * alım anı) — kesin değer bir sonraki mount/reconnect tazelemesinde düzelir; ekranda gösterilen
 * kozmetik bir sayaçtır, denetim kaydı/hukuki bir alan DEĞİLDİR.
 */
function mergeRecordingSignal(prev: ConsultationRecording | null, signal: RecordingSignalPayload): ConsultationRecording {
  const receivedAt = new Date().toISOString();
  const base: ConsultationRecording =
    prev && prev.id === signal.recordingId
      ? prev
      : {
          id: signal.recordingId,
          appointmentId: signal.appointmentId,
          status: signal.status,
          consentRequestedAt: receivedAt,
          consentExpiresAt: signal.consentExpiresAt ?? receivedAt,
          doctorConsentAt: null,
          patientConsentAt: null,
          patientConsentDeniedAt: null,
          startedAt: null,
          endedAt: null,
          durationSeconds: null,
          fileSizeBytes: null,
          downloadable: false,
          deletedAt: null,
          createdAt: receivedAt,
        };

  return {
    ...base,
    status: signal.status,
    consentExpiresAt: signal.consentExpiresAt ?? base.consentExpiresAt,
    startedAt: base.startedAt ?? (signal.status === "RECORDING" ? receivedAt : base.startedAt),
    patientConsentDeniedAt:
      signal.status === "CONSENT_DENIED" ? (base.patientConsentDeniedAt ?? receivedAt) : base.patientConsentDeniedAt,
  };
}

/**
 * F4 — `RoomContext` içinde (yani `<LiveKitRoom>` altında) çalışır, mevcut `room` nesnesine
 * `RoomEvent.DataReceived`/`RoomEvent.Reconnected` dinleyicisi ekler. Kendi başına render ETMEZ
 * (`null` döner) — yalnızca üst bileşene (`ConsultationRoomLoaded`) durum aktarır.
 */
function RecordingSignalBridge({
  appointmentId,
  accessToken,
  onSnapshot,
  onSignal,
}: {
  appointmentId: string;
  accessToken?: string;
  onSnapshot: (recording: ConsultationRecording | null) => void;
  onSignal: (payload: RecordingSignalPayload) => void;
}) {
  const room = useRoomContext();

  useEffect(() => {
    telehealthApi
      .getRecordingStatus(appointmentId, accessToken)
      .then(onSnapshot)
      .catch(() => {
        // Kayıt özelliği opsiyoneldir — çekilemezse mevcut görüşme SESSİZCE etkilenmeden devam eder.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- YALNIZCA mount'ta bir kez (F4: "sadece bu iki tetikleyicide tek seferlik çağrı", poll döngüsü KURULMAZ)
  }, []);

  useEffect(() => {
    function handleData(payload: Uint8Array, ...rest: unknown[]) {
      const topic = rest[2] as string | undefined;
      if (topic !== "telehealth.recording") return;
      try {
        const parsed = JSON.parse(new TextDecoder().decode(payload)) as RecordingSignalPayload;
        if (parsed.appointmentId !== appointmentId) return;
        onSignal(parsed);
      } catch {
        // Bozuk/ilgisiz payload — yok say.
      }
    }

    function handleReconnected() {
      telehealthApi.getRecordingStatus(appointmentId, accessToken).then(onSnapshot).catch(() => {});
    }

    room.on(RoomEvent.DataReceived, handleData);
    room.on(RoomEvent.Reconnected, handleReconnected);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
      room.off(RoomEvent.Reconnected, handleReconnected);
    };
  }, [room, appointmentId, accessToken, onSnapshot, onSignal]);

  return null;
}

interface ConsultationVideoRoomProps {
  meeting: MeetingTokenResponse;
  onLeave: (reason?: DisconnectReason) => void;
  /**
   * Bug-fix turu (2026-09-21, kullanıcı talebi) — `<LiveKitRoom>`'un `onDisconnected`'ı YALNIZCA
   * ÖNCE KURULMUŞ bir bağlantı koptuğunda tetiklenir; `room.connect()`'in KENDİSİ başarısız olursa
   * (ör. WS handshake reddi, ICE/TURN'e hiç ulaşılamaması — tam da nginx yanlış yapılandırılmışsa
   * OLACAK durum) `onDisconnected` HİÇ ÇAĞRILMAZ ve kullanıcı "Bağlanıyor…" rozetinde SONSUZA
   * KADAR asılı kalırdı (eskiden `onError`/`onMediaDeviceFailure` HİÇ BAĞLANMAMIŞTI).
   * Paket AF: hata nesnesi ÜST bileşene verilir; ekrana yalnızca çevrilmiş, nedene göre mesaj gider (ham metin yalnızca konsola).
   */
  onConnectionError: (err: unknown) => void;
  onMediaFailure: (failure?: string) => void;
  /** Paket AF — uygulama düzeyi yeniden bağlanma durumu (üst bileşende yaşar; oda yeniden kurulsa da korunur). */
  reconnect: AppReconnect;
  appointmentId: string;
  accessToken?: string;
  isDoctor: boolean;
  /** Paket AF (Aşama 2): randevu bitişi (mevcut randevu verisi) — bitişe 5 dk kala bilgi uyarısı için. */
  endsAt: string;
  /** `telehealth-recording` modülü açık mı — qa-agent bulgusu: kapalıyken doktor "Kaydı Başlat"
   *  butonunu GÖRMEMELİDİR (tıklarsa backend zaten 404 döner, ama UI baştan göstermemeli). */
  recordingModuleEnabled: boolean;
  recording: ConsultationRecording | null;
  consentDialogOpen: boolean;
  onRecordingSnapshot: (recording: ConsultationRecording | null) => void;
  onRecordingSignal: (payload: RecordingSignalPayload) => void;
  onConsentResolved: (recording: ConsultationRecording) => void;
  onConsentDismiss: () => void;
}

function ConsultationVideoRoom({
  meeting,
  onLeave,
  onConnectionError,
  onMediaFailure,
  reconnect,
  appointmentId,
  accessToken,
  isDoctor,
  endsAt,
  recordingModuleEnabled,
  recording,
  consentDialogOpen,
  onRecordingSnapshot,
  onRecordingSignal,
  onConsentResolved,
  onConsentDismiss,
}: ConsultationVideoRoomProps) {
  // Tam ekran hedefi: bu `<LiveKitRoom>`'un kök `div`'i (video sahnesi) — TÜM SAYFA DEĞİL.
  // `LiveKitRoomProps` `React.RefAttributes<HTMLDivElement>` genişletir, yani ref doğrudan
  // altındaki DOM düğümüne bağlanır (bkz. `@livekit/components-react` LiveKitRoom.d.ts).
  const stageRef = useRef<HTMLDivElement | null>(null);
  // Paket AF (Aşama 2): görüşme süresi sayacının başlangıcı oda token ile yeniden kurulsa da korunsun diye burada tutulur.
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // Kayıtlı cihaz/ses tercihleri YALNIZCA yakalama seçenekleri olarak (video/audio prop'u) uygulanır; Room `options` bu
  // tercihlerden etkilenmez. Kayıtlı bir şey yoksa AYNEN `true` (eski davranış). Token başına bir kez hesaplanır (kararlı referans).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- bilinçli: yeni token (yeniden kurulum) = tercihler yeniden okunur
  const capture = useMemo(() => buildCaptureOptions(loadPrefs()), [meeting.token]);

  return (
    <RoomUiProvider>
    <LiveKitRoom
      // Bug-fix turu (2026-09-18, frontend-agent) — `key`, token değiştiğinde (ilk katılım VE
      // aşağıdaki `handleDisconnected` otomatik yeniden bağlanması) React'in `<LiveKitRoom>`'u
      // TEMİZ bir şekilde unmount+remount etmesini GARANTİ EDER; kütüphanenin kendi iç prop-diff
      // mantığına güvenmek yerine (aynı bileşen örneğinde eski WebRTC/sinyal durumunun kalıntısı
      // KALMASIN diye).
      key={meeting.token}
      ref={stageRef}
      token={meeting.token}
      serverUrl={meeting.serverUrl}
      video={capture.video}
      audio={capture.audio}
      connect
      // Bug-fix turu (2026-09-21, kullanıcı talebi) — SDK varsayılanları `adaptiveStream: false`/
      // `dynacast: false`'tır (bkz. `livekit-client/src/room/defaults.ts`); bu proje bunları HİÇ
      // AÇMAMIŞTI. `adaptiveStream` görünmeyen/küçük video elemanları için abonelik kalitesini
      // otomatik düşürür, `dynacast` yayınlanan-ama-hiç-abone-olunmayan katmanları duraklatır —
      // İKİSİ de zayıf ağlarda bant genişliği/CPU baskısını azaltarak bağlantı istikrarını
      // İYİLEŞTİRİR (kesin çözüm sunucu/altyapı tarafında olsa da, istemci tarafında ÜCRETSİZ bir
      // kazanç). `reconnectPolicy` zaten `RoomOptions` varsayılanında `DefaultReconnectPolicy`
      // (10 deneme, ~47sn'ye kadar artan gecikme) — burada TEKRAR YAZILMADI, override GEREKSİZ.
      options={{ adaptiveStream: true, dynacast: true }}
      // Bug-fix turu (2026-09-21, kullanıcı talebi) — `onDisconnected` YALNIZCA ÖNCE KURULMUŞ bir
      // bağlantı koptuğunda tetiklenir; `room.connect()`'in KENDİSİ (ilk WS/ICE handshake)
      // başarısız olursa NE `onDisconnected` NE DE herhangi bir yerel state güncellenirdi —
      // kullanıcı "Bağlanıyor…" rozetinde SONSUZA KADAR asılı kalırdı (raporlanan asıl semptom).
      // `onError`/`onMediaDeviceFailure` artık BAĞLANMIŞ, ikisi de `onConnectionError` üzerinden
      // ön-katılım ekranına AÇIK bir hata mesajıyla döner.
      onError={onConnectionError}
      onMediaDeviceFailure={onMediaFailure}
      onDisconnected={onLeave}
      // Telefon yatayken (kısa ekran) sahne görünür alanı doldurur; dikeyde 3:4, geniş ekranda 16:9.
      className="relative aspect-[3/4] max-h-[calc(100dvh-2rem)] w-full overflow-hidden rounded-[var(--site-radius)] bg-[#0F172A] sm:aspect-video lg:max-h-none [@media(orientation:landscape)_and_(max-height:520px)]:aspect-auto [@media(orientation:landscape)_and_(max-height:520px)]:h-[calc(100dvh-1rem)] [@media(orientation:landscape)_and_(max-height:520px)]:max-h-none"
    >
      <RoomAudioRenderer />
      <RecordingSignalBridge
        appointmentId={appointmentId}
        accessToken={accessToken}
        onSnapshot={onRecordingSnapshot}
        onSignal={onRecordingSignal}
      />
      <ConnectionStateReporter reconnect={reconnect} />
      <DeviceBootstrap />
      <ConnectionStatusBadge />
      <QaListenerNotice />
      <SessionTimer startedAt={startedAt} onStart={setStartedAt} />
      <div className="absolute end-4 top-4 z-10">
        <RecordingIndicator status={recording?.status} />
      </div>
      {/* Tercüman kutusu/bildirimi (InterpreterPresence) sahnenin içinde, yerleşim sistemine bağlı çizilir. */}
      <ConsultationStage appointmentId={appointmentId} isDoctor={isDoctor} />
      <ConsultationControlBar isDoctor={isDoctor} stageRef={stageRef} />
      <ConnectionLayers reconnect={reconnect} isCounterpart={isCounterpart} topSlot={<EndingSoonNotice endsAt={endsAt} />} />

      {isDoctor && recordingModuleEnabled && (
        <div className="absolute start-3 top-12 z-10 lg:bottom-6 lg:start-4 lg:top-auto">
          <RecordingControls appointmentId={appointmentId} recording={recording} onUpdate={onRecordingSnapshot} />
        </div>
      )}

      {!isDoctor && recording && recording.status === "PENDING_CONSENT" && (
        <RecordingConsentDialog
          open={consentDialogOpen}
          appointmentId={appointmentId}
          accessToken={accessToken}
          consentExpiresAt={recording.consentExpiresAt}
          onResolved={onConsentResolved}
          onDismiss={onConsentDismiss}
        />
      )}
    </LiveKitRoom>
    </RoomUiProvider>
  );
}

function ConsultationRoomLoaded({ appointment, accessToken }: { appointment: Appointment; accessToken?: string }) {
  // F4 — bu görüşmenin doktoru mu izliyor? `SiteRole.DOCTOR` YOKTUR, `User.doctorProfileId`
  // ilişkisinden TÜRETİLİR (bkz. `lib/api/types.ts::User`). Oturumsuz misafir hasta (`accessToken`
  // ile) için `user` zaten `null` olur — `isDoctor` doğal olarak `false` kalır. Kayıt (recording)
  // kontrollerinin gösterimi için HALA gerekli (bkz. `isDoctor && recordingModuleEnabled` altta) —
  // `useJoinState`in artık buna ihtiyacı YOK (bkz. o hook'un dosya başı yorumu).
  const auth = useAuthOptional();
  const isDoctor = auth?.user?.doctorProfileId != null && auth.user.doctorProfileId === appointment.doctorId;
  // Görev (2026-09-16) — takvim/randevu gün-ay-saat biçimlendirmesi denetimi: sabit modül-seviyesi
  // `"tr-TR"` yerine aktif site diline bağlı biçimlendirici.
  const { t, lang } = useConsultationStrings();
  const intlLocale = contentLocaleToIntl(lang);
  const dateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(intlLocale, { dateStyle: "long", timeStyle: "short" }), [intlLocale]);

  const joinState = useJoinState(appointment);
  const [meeting, setMeeting] = useState<MeetingTokenResponse | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  // Paket AF (Aşama 2): giriş öncesi cihaz testi önizlemesi katılımdan önce durdurulur (tek kameralı telefonlarda cihaz serbest kalsın).
  const prejoinRef = useRef<PrejoinCheckHandle | null>(null);

  // qa-agent bulgusu — `RecordingControls` daha önce modül durumunu hiç kontrol etmiyordu,
  // `telehealth-recording` KAPALIYKEN (her yeni kurulumun varsayılanı) bile doktora "Kaydı
  // Başlat" butonunu gösteriyordu. Bu sayfa `(site)` ağacında `ModulesProvider` OLMADAN render
  // edildiği için `useModules()` KULLANILAMAZ — `login/page.tsx`'in doktor yönlendirmesinde
  // kullandığı AYNI hafif `listPublicModules()` REST çağrısı burada da kullanılır.
  const [recordingModuleEnabled, setRecordingModuleEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!isDoctor) return;
    listPublicModules()
      .then((modules) => {
        if (!cancelled) setRecordingModuleEnabled(modules.some((m) => m.key === "telehealth-recording" && m.enabled));
      })
      .catch(() => {
        if (!cancelled) setRecordingModuleEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isDoctor]);

  // F4 — F1/F2/F3'ün paylaştığı kayıt durumu; `RecordingSignalBridge` (mount/reconnect tazelemesi
  // + `RoomEvent.DataReceived`) VE F1/F3'ün kendi REST aksiyonları (start/stop/consent) BURAYA yazar.
  const [recording, setRecording] = useState<ConsultationRecording | null>(null);
  // Hasta rıza modalını manuel kapattığında (X/escape/dışına tıklama) AYNI rıza talebi için tekrar
  // AÇILMAZ (TTL kendiliğinden dolar) — bir SONRAKİ talepte (yeni `recordingId`) yeniden açılabilir.
  const [dismissedConsentId, setDismissedConsentId] = useState<string | null>(null);

  const handleRecordingSnapshot = useCallback((next: ConsultationRecording | null) => {
    setRecording(next);
  }, []);

  const handleRecordingSignal = useCallback((payload: RecordingSignalPayload) => {
    setRecording((prev) => mergeRecordingSignal(prev, payload));
  }, []);

  const consentDialogOpen = !isDoctor && recording?.status === "PENDING_CONSENT" && dismissedConsentId !== recording.id;

  /**
   * Paket AF (İş 4) — uygulama düzeyi yeniden bağlanma (`room/use-app-reconnect.ts`): eski "katılım başına tek sessiz
   * deneme" (`autoReconnectedRef`) yerine ardışık en fazla 3 deneme (2/5/10 sn artan bekleme); bağlantı 60 sn kesintisiz
   * kalırsa hak yenilenir; tükenince çevrilmiş mesaj + "Yeniden bağlan"; DUPLICATE_IDENTITY'de kendiliğinden deneme YOK.
   * Taze token `setMeeting` ile gelir, `<LiveKitRoom key={meeting.token}>` temiz bir remount yapar (mevcut desen).
   */
  const reconnect = useAppReconnect<MeetingTokenResponse>({
    fetchToken: () => telehealthApi.requestMeetingToken(appointment.id, accessToken),
    onToken: setMeeting,
  });
  const resetReconnect = reconnect.reset;

  async function handleJoin() {
    prejoinRef.current?.stop();
    resetReconnect();
    setRequesting(true);
    setJoinError(null);
    try {
      const token = await telehealthApi.requestMeetingToken(appointment.id, accessToken);
      setMeeting(token);
      setNotConfigured(false);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 503) {
        setNotConfigured(true);
      } else {
        warnRaw("meeting-token request failed", err);
        setJoinError(failureMessage(classifyConnectionError(err), t));
      }
    } finally {
      setRequesting(false);
    }
  }

  /**
   * `RoomEvent.Disconnected`: kullanıcı kendi ayrıldıysa (`CLIENT_INITIATED`) ön-katılım ekranına dönülür; DİĞER TÜM
   * nedenlerde (SDK'nın kendi yeniden bağlanması tükendi) `reconnect` devralır ve ekranda DAİMA bir durum katmanı
   * (yeniden bağlanılıyor / başarısız / sekme çakışması) vardır — mesajsız ön-katılım ekranına DÜŞÜLMEZ.
   */
  function handleDisconnected(reason?: DisconnectReason) {
    const outcome = reconnect.handleDisconnected(disconnectKind(reason), reason as number | undefined);
    if (outcome === "user-left") setMeeting(null);
  }

  /**
   * Bug-fix turu (2026-09-21, kullanıcı talebi) — `ConsultationVideoRoom`'un `onError`'ından gelir: `room.connect()`'in
   * İLK denemesi hiç kurulamadan başarısız olduğunda `onDisconnected` TETİKLENMEZ; bu callback OLMADAN kullanıcı
   * "Bağlanıyor…" rozetinde sonsuza dek asılı kalırdı. Paket AF: kurtarma sürüyorsa bu bir başarısız deneme sayılır;
   * ilk katılımsa ön-katılım ekranına, NEDENE göre çevrilmiş mesajla dönülür (SDK'nın ham metni yalnızca konsola).
   */
  function handleConnectionError(err: unknown) {
    warnRaw("LiveKitRoom onError", err);
    if (reconnect.handleConnectFailure(err)) return;
    resetReconnect();
    setJoinError(failureMessage(classifyConnectionError(err), t));
    setMeeting(null);
  }

  function handleMediaFailure(failure?: string) {
    warnRaw("LiveKitRoom onMediaDeviceFailure", failure);
    resetReconnect();
    setJoinError(failureMessage(classifyMediaFailure(failure), t));
    setMeeting(null);
  }

  // Paket AF (İş 1) — video kutusu ad etiketi bağlamı: ad ve hasta adı randevu verisinden, izleyici rolüne göre
  // (hasta adı token'da YOK). Tercüman ekranı için bkz. `interpreter-room.tsx`.
  const labelContext = useMemo<LabelContext>(
    () => ({
      viewer: isDoctor ? "doctor" : "patient",
      patientName: appointment.patientName,
      doctorName: appointment.doctor ? `${appointment.doctor.title ?? ""} ${appointment.doctor.displayName ?? appointment.doctor.fullName ?? ""}`.trim() : null,
      t,
      fmt,
    }),
    [isDoctor, appointment.patientName, appointment.doctor, t]
  );

  return (
    <div className="space-y-6">
      <div className="rounded-[var(--site-radius)] border border-border bg-surface p-5">
        <h1 className="font-heading text-2xl font-semibold text-foreground sm:text-3xl">
          {fmt(t.roomTitle, { doctor: appointment.doctor ? `${appointment.doctor.title ?? ""} ${appointment.doctor.fullName ?? ""}`.trim() : t.roleDoctor })}
        </h1>
        <p className="mt-1 text-sm text-foreground/60">
          {appointment.startsAt ? dateTimeFormatter.format(new Date(appointment.startsAt)) : "—"} · {appointment.patientName ?? t.rolePatient}
        </p>
        <InterpreterPreJoinNotice appointmentId={appointment.id} accessToken={accessToken} />
      </div>

      {meeting ? (
        <ParticipantLabelProvider value={labelContext}>
          <ConsultationVideoRoom
            meeting={meeting}
            onLeave={handleDisconnected}
            onConnectionError={handleConnectionError}
            onMediaFailure={handleMediaFailure}
            reconnect={reconnect}
            appointmentId={appointment.id}
            accessToken={accessToken}
            isDoctor={isDoctor}
            endsAt={appointment.endsAt}
            recordingModuleEnabled={recordingModuleEnabled}
            recording={recording}
            consentDialogOpen={consentDialogOpen}
            onRecordingSnapshot={handleRecordingSnapshot}
            onRecordingSignal={handleRecordingSignal}
            onConsentResolved={handleRecordingSnapshot}
            onConsentDismiss={() => recording && setDismissedConsentId(recording.id)}
          />
        </ParticipantLabelProvider>
      ) : (
        <PreJoinStage
          joinState={joinState}
          requesting={requesting}
          joinError={joinError}
          notConfigured={notConfigured}
          onJoin={() => void handleJoin()}
          prejoinRef={prejoinRef}
        />
      )}
    </div>
  );
}

export function ConsultationRoom({ appointmentId, accessToken }: { appointmentId: string; accessToken?: string }) {
  const lang = useActiveLocaleCode();
  return (
    <div dir={localeDirection(lang)}>
      <ConsultationRoomContent appointmentId={appointmentId} accessToken={accessToken} />
    </div>
  );
}

function ConsultationRoomContent({ appointmentId, accessToken }: { appointmentId: string; accessToken?: string }) {
  const { t } = useConsultationStrings();
  const [appointment, setAppointment] = useState<Appointment | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * **architect (2026-09-15, `.claude/architect-scope-doctor-subdomain.md` §5.6.1 turu):** bu fetch
   * eskiden mount'ta KOŞULSUZ atılıyordu. Access token YALNIZCA bellekte tutulur
   * (`lib/api/token-store.ts`) — TAM SAYFA yüklemesinde (doktorun doktor host'undan ana site
   * origin'ine cross-origin gelişi DAHİL, §5.6 notu) oturum ancak refresh çerezinden `AuthProvider`
   * tarafından YENİDEN kurulur. `status === "loading"` iken atılan istek ANONİM gider,
   * `GET /appointments/{id}` 404 döner ve bileşen "Randevu bulunamadı." hatasında KİLİTLENİRDİ
   * (kullanıcı "Tekrar Dene"ye basana kadar; e2e'de birebir gözlendi). Bu yüzden oturum
   * ÇÖZÜLENE kadar (`loading` dışına çıkana kadar) beklenir.
   *
   * Misafir hasta (magic-link `?t=`) BEKLEMEZ: `accessToken` varsa yetki o token'dan gelir,
   * oturumun durumu ilgisizdir — eski davranış (anında fetch) AYNEN korunur.
   */
  const auth = useAuthOptional();
  const waitingForSession = !accessToken && auth?.status === "loading";
  // Ön doğrulama katmanı — ne misafir token'ı (`?t=`) NE DE bir oturum varsa, `GET
  // /appointments/{id}`'nin `404` döneceği ZATEN KESİNDİR (bkz. `ConsultationAccessGate` dosya
  // başı yorumu) — bu durumda istek hiç ATILMAZ, kullanıcıya doğrudan "Erişim Doğrulama" ekranı
  // gösterilir. Oturum durumu HENÜZ çözülmemişse (`"loading"`) bu dal TETİKLENMEZ, `waitingForSession`
  // önce devreye girer.
  const noAccessSignal = !accessToken && auth?.status === "unauthenticated";

  const loadAppointment = useCallback(async () => {
    setAppointment(undefined);
    setLoadError(null);
    try {
      const result = await telehealthApi.getAppointment(appointmentId, accessToken);
      setAppointment(result);
    } catch (err) {
      setAppointment(null);
      setLoadError(friendlyErrorMessage(err));
    }
  }, [appointmentId, accessToken]);

  useEffect(() => {
    if (waitingForSession || noAccessSignal) return;
    (async () => {
      await loadAppointment();
    })();
  }, [loadAppointment, waitingForSession, noAccessSignal]);

  if (waitingForSession) {
    return <ConsultationSkeleton />;
  }

  if (noAccessSignal) {
    return <ConsultationAccessGate appointmentId={appointmentId} />;
  }

  if (appointment === undefined) {
    return <ConsultationSkeleton />;
  }

  if (appointment === null) {
    return (
      <Alert variant="error">
        <span className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {loadError ?? t.appointmentNotFound}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadAppointment()}>
            {t.tryAgain}
          </Button>
        </span>
      </Alert>
    );
  }

  return <ConsultationRoomLoaded appointment={appointment} accessToken={accessToken} />;
}
