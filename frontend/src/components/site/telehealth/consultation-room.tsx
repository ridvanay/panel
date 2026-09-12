"use client";

import { useCallback, useEffect, useState, type ComponentType } from "react";
import "@livekit/components-styles";
import {
  DisconnectButton,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useConnectionState,
  useParticipants,
  useTrackToggle,
  useTracks,
} from "@livekit/components-react";
import { ConnectionState, Track } from "livekit-client";
import {
  AlertTriangle,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  Settings2,
  Video,
  VideoOff,
  Wifi,
  WifiOff,
  type LucideProps,
} from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { Appointment, MeetingTokenResponse } from "@/lib/api/types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

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

const JOIN_WINDOW_BEFORE_MS = 5 * 60_000;
const JOIN_WINDOW_AFTER_MS = 15 * 60_000;
const NEAR_THRESHOLD_MS = 15 * 60_000;

const dateTimeFormatter = new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeStyle: "short" });

interface JoinState {
  remainingMs: number;
  isNear: boolean;
  isJoinable: boolean;
  isExpired: boolean;
}

function useJoinState(appointment: Appointment): JoinState {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const start = new Date(appointment.startsAt).getTime();
  const end = new Date(appointment.endsAt).getTime();
  const joinOpensAt = start - JOIN_WINDOW_BEFORE_MS;
  const joinClosesAt = end + JOIN_WINDOW_AFTER_MS;
  const remainingMs = start - now;

  return {
    remainingMs,
    isNear: remainingMs <= NEAR_THRESHOLD_MS && now <= joinClosesAt,
    isJoinable: now >= joinOpensAt && now <= joinClosesAt,
    isExpired: now > joinClosesAt,
  };
}

function formatCountdownDigits(ms: number): { minutes: string; seconds: string } {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return { minutes: String(minutes).padStart(2, "0"), seconds: String(seconds).padStart(2, "0") };
}

/** `.claude/design-notes-telehealth.md` §7 — "uzak" kademe, cümle içinde, `Inter`. */
function formatFarCountdownSentence(ms: number): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `Randevunuza ${hours} saat ${minutes} dakika kaldı.`;
  return `Randevunuza ${minutes} dakika kaldı.`;
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
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--site-radius)] border border-warning/30 bg-warning/5 p-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-warning/15">
        <Settings2 className="h-5 w-5 text-warning" aria-hidden="true" />
      </span>
      <h3 className="font-semibold text-foreground">Görüntülü Görüşme Yapılandırılmamış</h3>
      <p className="max-w-sm text-sm text-foreground/60">
        Görüntülü görüşme altyapısı (LiveKit) bu kurulumda yapılandırılmamış. Yönetici{" "}
        <code className="rounded bg-warning/10 px-1 py-0.5 text-xs">LIVEKIT_URL</code>,{" "}
        <code className="rounded bg-warning/10 px-1 py-0.5 text-xs">LIVEKIT_API_KEY</code> ve{" "}
        <code className="rounded bg-warning/10 px-1 py-0.5 text-xs">LIVEKIT_API_SECRET</code> değerlerini
        tanımladıktan sonra görüşme başlatılabilir.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry} loading={retrying}>
        Tekrar Dene
      </Button>
    </div>
  );
}

/** §6.1 — bekleme odası: nötr/sakin, `primary` tint + `Loader2` + `animate-ping`. */
function WaitingRoomPanel() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--site-radius)] border border-primary/20 bg-primary/5 p-8 text-center">
      <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" aria-hidden="true" />
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
      </span>
      <h3 className="font-semibold text-foreground">Bekleme Odası</h3>
      <p className="max-w-xs text-sm text-foreground/60">Karşı taraf bağlandığında görüşme otomatik olarak başlayacak.</p>
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
}

/**
 * Video başlamadan önceki alan: uzak/yakın geri sayım, "Görüşmeye Katıl" butonu, hata durumu ve
 * "yapılandırılmamış" paneli — §6.2'nin "iki durum ASLA aynı anda görünmez" kuralı burada
 * `notConfigured` kontrolüyle korunur (bekleme odası kavramı LiveKit bağlanmadan ANLAMSIZDIR).
 */
function PreJoinStage({ joinState, requesting, joinError, notConfigured, onJoin }: PreJoinStageProps) {
  if (joinState.isExpired) {
    return (
      <div className="rounded-[var(--site-radius)] border border-border bg-surface p-6 text-center text-sm text-foreground/60 sm:p-10">
        Bu randevunun katılım penceresi kapanmıştır.
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
              Randevu saatiniz geldi.
            </p>
          )
        ) : (
          <p className="text-sm text-foreground/70">{formatFarCountdownSentence(joinState.remainingMs)}</p>
        )}

        {joinState.isJoinable && !notConfigured && (
          <Button type="button" onClick={onJoin} loading={requesting} className="mt-4 rounded-[var(--site-radius)]">
            Görüşmeye Katıl
          </Button>
        )}
      </div>

      {joinError && !notConfigured && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span>{joinError}</span>
            <Button type="button" variant="outline" size="sm" onClick={onJoin}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      )}

      {notConfigured && <LiveKitNotConfiguredPanel onRetry={onJoin} retrying={requesting} />}
    </div>
  );
}

function ToggleButton({
  enabled,
  pending,
  onClick,
  onLabel,
  offLabel,
  OnIcon,
  OffIcon,
}: {
  enabled: boolean;
  pending: boolean;
  onClick: () => void;
  onLabel: string;
  offLabel: string;
  OnIcon: ComponentType<LucideProps>;
  OffIcon: ComponentType<LucideProps>;
}) {
  return (
    <button
      type="button"
      aria-pressed={enabled}
      aria-label={enabled ? onLabel : offLabel}
      disabled={pending}
      onClick={onClick}
      className={cn(
        "flex h-12 w-12 items-center justify-center rounded-full transition-colors duration-150 disabled:opacity-60",
        enabled ? "bg-white/15 text-white hover:bg-white/25" : "bg-white/90 text-black"
      )}
    >
      {enabled ? <OnIcon className="h-5 w-5" aria-hidden="true" /> : <OffIcon className="h-5 w-5" aria-hidden="true" />}
    </button>
  );
}

/**
 * §5 — video üzerine bindirilen yüzen kontrol çubuğu (bu projedeki TEK sistemik "cam" istisnası).
 * `LiveKitRoom` içeriğinde (RoomContext) render edilir.
 */
function ConsultationControlBar() {
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const camera = useTrackToggle({ source: Track.Source.Camera });
  const screenShare = useTrackToggle({ source: Track.Source.ScreenShare });

  return (
    <div className="absolute inset-x-0 bottom-6 flex items-center justify-center gap-3">
      <div className="flex items-center gap-2 rounded-full bg-black/70 px-3 py-2 backdrop-blur-md">
        <ToggleButton
          enabled={mic.enabled}
          pending={mic.pending}
          onClick={() => void mic.toggle()}
          onLabel="Mikrofonu kapat"
          offLabel="Mikrofonu aç"
          OnIcon={Mic}
          OffIcon={MicOff}
        />
        <ToggleButton
          enabled={camera.enabled}
          pending={camera.pending}
          onClick={() => void camera.toggle()}
          onLabel="Kamerayı kapat"
          offLabel="Kamerayı aç"
          OnIcon={Video}
          OffIcon={VideoOff}
        />
        <ToggleButton
          enabled={screenShare.enabled}
          pending={screenShare.pending}
          onClick={() => void screenShare.toggle()}
          onLabel="Ekran paylaşımını durdur"
          offLabel="Ekranı paylaş"
          OnIcon={ScreenShare}
          OffIcon={ScreenShareOff}
        />
      </div>
      <DisconnectButton
        aria-label="Görüşmeden ayrıl"
        className="ml-2 flex h-14 w-14 items-center justify-center rounded-full bg-danger text-white transition-colors hover:bg-danger/90"
      >
        <PhoneOff className="h-5 w-5" aria-hidden="true" />
      </DisconnectButton>
    </div>
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

  const config = (() => {
    switch (state) {
      case ConnectionState.Connected:
        return { label: "Bağlandı", tone: "success" as const, Icon: Wifi, spin: false };
      case ConnectionState.Disconnected:
        return { label: "Bağlantı Kesildi", tone: "danger" as const, Icon: WifiOff, spin: false };
      case ConnectionState.Reconnecting:
      case ConnectionState.SignalReconnecting:
        return { label: "Yeniden Bağlanıyor…", tone: "warning" as const, Icon: Loader2, spin: true };
      case ConnectionState.Connecting:
      default:
        return { label: "Bağlanıyor…", tone: "warning" as const, Icon: Loader2, spin: true };
    }
  })();

  return (
    <div className="absolute left-4 top-4 z-10">
      <Badge tone={config.tone} solid size="sm" className="gap-1 shadow-sm">
        <config.Icon className={cn("h-3 w-3", config.spin && "animate-spin")} aria-hidden="true" />
        {config.label}
      </Badge>
    </div>
  );
}

/**
 * Video düzeni — spotlight + picture-in-picture: karşı tarafın track'i tam alanı kaplayan ana
 * görünüm, kendi kameramız sağ altta yüzen küçük bir kart (`ParticipantTile`'ın `trackRef` prop'u
 * ile, tasarım-notes §7'nin "kontrol çubuğu" ile AYNI yüzen-kart konvansiyonu). Karşı taraf YOKSA
 * `WaitingRoomPanel` tam ekran korunur, kendi kamera PIP'i yine görünür kalır (video-konferans
 * standardı — kullanıcı beklerken de kendi görüntüsünü görür). `RoomContext` içinde çalışır.
 */
function ConsultationStage() {
  const participants = useParticipants();
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );
  const hasRemoteParticipant = participants.some((p) => !p.isLocal);

  const remoteTrack =
    tracks.find((t) => !t.participant.isLocal && t.source === Track.Source.ScreenShare) ??
    tracks.find((t) => !t.participant.isLocal && t.source === Track.Source.Camera);
  const localCameraTrack = tracks.find((t) => t.participant.isLocal && t.source === Track.Source.Camera);

  return (
    <div className="relative h-full w-full">
      {hasRemoteParticipant && remoteTrack ? (
        <ParticipantTile trackRef={remoteTrack} className="h-full w-full" />
      ) : (
        <div className="flex h-full w-full items-center justify-center p-6">
          <WaitingRoomPanel />
        </div>
      )}

      {localCameraTrack && (
        <div className="absolute bottom-6 right-6 z-10 h-24 w-32 overflow-hidden rounded-[var(--site-radius)] border border-white/20 shadow-lg sm:h-28 sm:w-40">
          <ParticipantTile trackRef={localCameraTrack} className="h-full w-full" />
        </div>
      )}
    </div>
  );
}

function ConsultationVideoRoom({ meeting, onLeave }: { meeting: MeetingTokenResponse; onLeave: () => void }) {
  return (
    <LiveKitRoom
      token={meeting.token}
      serverUrl={meeting.serverUrl}
      video
      audio
      connect
      onDisconnected={onLeave}
      className="relative aspect-video w-full overflow-hidden rounded-[var(--site-radius)] bg-[#0F172A]"
    >
      <RoomAudioRenderer />
      <ConnectionStatusBadge />
      <ConsultationStage />
      <ConsultationControlBar />
    </LiveKitRoom>
  );
}

function ConsultationRoomLoaded({ appointment, accessToken }: { appointment: Appointment; accessToken?: string }) {
  const joinState = useJoinState(appointment);
  const [meeting, setMeeting] = useState<MeetingTokenResponse | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  async function handleJoin() {
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
        setJoinError(friendlyErrorMessage(err));
      }
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[var(--site-radius)] border border-border bg-surface p-5">
        <h1 className="font-heading text-2xl font-semibold text-foreground sm:text-3xl">
          {appointment.doctor.title} {appointment.doctor.fullName} ile Görüşme
        </h1>
        <p className="mt-1 text-sm text-foreground/60">
          {dateTimeFormatter.format(new Date(appointment.startsAt))} · {appointment.patientName}
        </p>
      </div>

      {meeting ? (
        <ConsultationVideoRoom meeting={meeting} onLeave={() => setMeeting(null)} />
      ) : (
        <PreJoinStage
          joinState={joinState}
          requesting={requesting}
          joinError={joinError}
          notConfigured={notConfigured}
          onJoin={() => void handleJoin()}
        />
      )}
    </div>
  );
}

export function ConsultationRoom({ appointmentId, accessToken }: { appointmentId: string; accessToken?: string }) {
  const [appointment, setAppointment] = useState<Appointment | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);

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
    (async () => {
      await loadAppointment();
    })();
  }, [loadAppointment]);

  if (appointment === undefined) {
    return <ConsultationSkeleton />;
  }

  if (appointment === null) {
    return (
      <Alert variant="error">
        <span className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {loadError ?? "Bu randevu bulunamadı ya da katılım bağlantınız geçersiz."}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadAppointment()}>
            Tekrar Dene
          </Button>
        </span>
      </Alert>
    );
  }

  return <ConsultationRoomLoaded appointment={appointment} accessToken={accessToken} />;
}
