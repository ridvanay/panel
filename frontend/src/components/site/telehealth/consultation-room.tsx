"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "@livekit/components-styles";
import {
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useConnectionState,
  useParticipants,
  useRoomContext,
  useTrackToggle,
  useTracks,
} from "@livekit/components-react";
import { ConnectionState, DisconnectReason, MediaDeviceFailure, RoomEvent, Track } from "livekit-client";
import {
  AlertTriangle,
  Loader2,
  LogIn,
  Maximize,
  Mic,
  MicOff,
  Minimize,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  Settings2,
  ShieldAlert,
  Video,
  VideoOff,
  Wifi,
  WifiOff,
  type LucideProps,
} from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import { listPublicModules } from "@/lib/api/modules";
import { isDoctorHostname, isSubdomainModeEnabled, toDoctorOrigin } from "@/lib/doctor-host";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { useAuthOptional } from "@/context/auth-context";
import { useActiveLocaleCode, useLocalizePath } from "@/context/locale-alternates-context";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import type { Appointment, ConsultationRecording, MeetingTokenResponse, RecordingSignalPayload } from "@/lib/api/types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RecordingConsentDialog } from "@/components/site/telehealth/recording-consent-dialog";
import { RecordingIndicator } from "@/components/site/telehealth/recording-indicator";
import { RecordingControls } from "@/components/site/telehealth/recording-controls";
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
function formatFarCountdownSentence(ms: number): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `Randevunuza ${hours} saat ${minutes} dakika kaldı.`;
  return `Randevunuza ${minutes} dakika kaldı.`;
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
  return (
    <Alert variant="warning">
      <div className="space-y-3">
        <span className="flex items-center gap-2 font-medium">
          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          Erişim Doğrulama Gerekli
        </span>
        <p className="text-sm text-foreground/70">
          Bu görüşme sayfasına ulaşmak için hesabınıza giriş yapmalı ya da randevu onay e-postanızdaki
          bağlantıyı kullanmalısınız. Bağlantınız yoksa veya çalışmıyorsa, e-postanızdaki onay mesajını ya
          da randevularım sayfasını kontrol edin.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(`/consultation/${appointmentId}`)}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <LogIn className="h-4 w-4" aria-hidden="true" />
          Giriş Yap
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
        "flex h-11 w-11 items-center justify-center rounded-full transition-colors duration-150 disabled:opacity-60 lg:h-12 lg:w-12",
        enabled ? "bg-white/15 text-white hover:bg-white/25" : "bg-white/90 text-black"
      )}
    >
      {enabled ? <OnIcon className="h-5 w-5" aria-hidden="true" /> : <OffIcon className="h-5 w-5" aria-hidden="true" />}
    </button>
  );
}

/**
 * §5 — video üzerine bindirilen yüzen kontrol çubuğu (bu projedeki TEK sistemik "cam" istisnası).
 * `LiveKitRoom` içeriğinde (RoomContext) render edilir. `stageRef` video sahnesini (tüm sayfayı
 * DEĞİL) tam ekrana almak için `ConsultationVideoRoom`'daki `<LiveKitRoom>` kök `div`'ine bağlıdır.
 */
function ConsultationControlBar({
  isDoctor,
  stageRef,
}: {
  isDoctor: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
}) {
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const camera = useTrackToggle({ source: Track.Source.Camera });
  const screenShare = useTrackToggle({ source: Track.Source.ScreenShare });
  const room = useRoomContext();
  const router = useRouter();
  const localize = useLocalizePath();

  const [isFullscreen, setIsFullscreen] = useState(false);
  // SSR'da `document` YOKTUR — başlangıç değeri `false` (server ile hydration uyuşmazlığı
  // yaratmaz), mount sonrası gerçek tarayıcı desteğiyle güncellenir.
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    // `theme-toggle.tsx`'teki AYNI desen: tarayıcı özelliği tespiti sunucuda YAPILAMAZ, hydration
    // uyuşmazlığını önlemek için ilk client render'dan SONRA bir kez senkron işaretlenir.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFullscreenSupported(
      typeof document !== "undefined" &&
        document.fullscreenEnabled !== false &&
        typeof document.documentElement.requestFullscreen === "function"
    );
  }, []);

  // Kullanıcı ESC'ye basarak tam ekrandan çıkabilir — bu, bizim `toggleFullscreen`
  // çağrımızdan GEÇMEZ, o yüzden state'i `fullscreenchange` olayından senkronize ederiz.
  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === stageRef.current);
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [stageRef]);

  async function toggleFullscreen() {
    const el = stageRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      // Tarayıcı izni reddedebilir (ör. kullanıcı jesti dışında çağrı) — sessizce yok say.
    }
  }

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

  // Mobil/tablet (lg altı): düğmeler 44px, aralıklar daha dar — 360px'te bile TEK satıra sığar
  // (iki satıra kırılınca sahneyi ve önizlemeyi örtüyordu). Masaüstü (lg) değerleri değişmedi.
  return (
    <div className="absolute inset-x-0 bottom-3 flex flex-wrap items-center justify-center gap-2 px-2 lg:bottom-6 lg:gap-3 lg:px-4">
      <div className="flex items-center gap-1.5 rounded-full bg-black/70 px-2 py-1.5 backdrop-blur-md lg:gap-2 lg:px-3 lg:py-2">
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
        {fullscreenSupported && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={isFullscreen ? "Tam Ekrandan Çık" : "Tam Ekran"}
                  onClick={() => void toggleFullscreen()}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white transition-colors duration-150 hover:bg-white/25 lg:h-12 lg:w-12"
                />
              }
            >
              {isFullscreen ? (
                <Minimize className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Maximize className="h-5 w-5" aria-hidden="true" />
              )}
            </TooltipTrigger>
            <TooltipContent>{isFullscreen ? "Tam Ekrandan Çık" : "Tam Ekran"}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <button
        type="button"
        aria-label="Görüşmeyi sonlandır"
        onClick={() => setConfirmOpen(true)}
        className="ml-1 flex h-12 w-12 items-center justify-center rounded-full bg-danger text-white transition-colors hover:bg-danger/90 lg:ml-2 lg:h-14 lg:w-14"
      >
        <PhoneOff className="h-5 w-5" aria-hidden="true" />
      </button>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="danger"
        title="Görüşmeyi sonlandırmak istediğinize emin misiniz?"
        confirmText="Görüşmeyi Sonlandır"
        cancelText="Vazgeç"
        loading={disconnecting}
        onConfirm={() => void handleConfirmEndCall()}
      />
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
  // Bug-fix turu (2026-09-17, frontend-agent) — `onlySubscribed: false` karşı tarafın track'i
  // için YAYINLANMIŞ ama HENÜZ ABONE OLUNMAMIŞ (`publication.track` boş) bir referans
  // döndürebiliyordu; bu referans `ParticipantTile`'a geçince DOM'a bağlanacak gerçek bir
  // `MediaStreamTrack` olmadığı için ekran placeholder'da TAKILI kalıyordu — SDK'nın kendi
  // "publishing track"/"participant: doctor:..." logları GERÇEK olsa bile. Varsayılan
  // `onlySubscribed: true` ile `tracks` yalnızca GERÇEKTEN abone olunmuş (DOM'a bağlanabilir)
  // referansları döner; `withPlaceholder: true` karşı taraf HİÇ yayın yapmadığı durumda hâlâ
  // nötr bir avatar göstermeye devam eder (davranış AYNI, yalnızca "yayınlandı ama abone
  // olunmadı" ara durumu artık placeholder'a düşer, boş/donuk bir referansa değil).
  const tracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
    { source: Track.Source.ScreenShare, withPlaceholder: false },
  ]);
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
        // Mobil/tablet (lg altı): sağ üstte, kayıt göstergesinin (right-4 top-4) altında — alttaki kontrol
        // çubuğunu örtmez. Masaüstü (lg): eskisi gibi sağ altta, 160×112.
        <div className="absolute right-3 top-12 z-10 h-24 w-32 overflow-hidden rounded-[var(--site-radius)] border border-white/20 shadow-lg lg:bottom-6 lg:right-6 lg:top-auto lg:h-28 lg:w-40">
          <ParticipantTile trackRef={localCameraTrack} className="h-full w-full" />
        </div>
      )}
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
   * KADAR asılı kalırdı (eskiden `onError`/`onMediaDeviceFailure` HİÇ BAĞLANMAMIŞTI). Bu callback
   * her iki durumda da ön-katılım ekranına AÇIK bir hata mesajıyla döner.
   */
  onConnectionError: (message: string) => void;
  appointmentId: string;
  accessToken?: string;
  isDoctor: boolean;
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

/** İnsan-okunur Türkçe karşılıklar — `livekit-client`'ın `MediaDeviceFailure` enum'u. */
function mediaDeviceFailureMessage(failure?: MediaDeviceFailure): string {
  switch (failure) {
    case MediaDeviceFailure.PermissionDenied:
      return "Kamera/mikrofon izni reddedildi. Tarayıcı adres çubuğundaki site izinlerinden kamera/mikrofona erişime izin verip tekrar deneyin.";
    case MediaDeviceFailure.NotFound:
      return "Kamera veya mikrofon bulunamadı. Cihazınızın bağlı olduğundan emin olup tekrar deneyin.";
    case MediaDeviceFailure.DeviceInUse:
      return "Kamera veya mikrofon başka bir uygulama tarafından kullanılıyor. Diğer uygulamayı kapatıp tekrar deneyin.";
    default:
      return "Kamera/mikrofon erişiminde bir sorun oluştu. Lütfen tekrar deneyin.";
  }
}

function ConsultationVideoRoom({
  meeting,
  onLeave,
  onConnectionError,
  appointmentId,
  accessToken,
  isDoctor,
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

  return (
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
      video
      audio
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
      onError={(err) => onConnectionError(err.message || "Görüşmeye bağlanılamadı. Bağlantınızı kontrol edip tekrar deneyin.")}
      onMediaDeviceFailure={(failure) => onConnectionError(mediaDeviceFailureMessage(failure))}
      onDisconnected={onLeave}
      className="relative aspect-[3/4] max-h-[calc(100dvh-2rem)] w-full overflow-hidden rounded-[var(--site-radius)] bg-[#0F172A] sm:aspect-video lg:max-h-none"
    >
      <RoomAudioRenderer />
      <RecordingSignalBridge
        appointmentId={appointmentId}
        accessToken={accessToken}
        onSnapshot={onRecordingSnapshot}
        onSignal={onRecordingSignal}
      />
      <ConnectionStatusBadge />
      <div className="absolute right-4 top-4 z-10">
        <RecordingIndicator status={recording?.status} />
      </div>
      <ConsultationStage />
      <ConsultationControlBar isDoctor={isDoctor} stageRef={stageRef} />

      {isDoctor && recordingModuleEnabled && (
        <div className="absolute left-3 top-12 z-10 lg:bottom-6 lg:left-4 lg:top-auto">
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
  const intlLocale = contentLocaleToIntl(useActiveLocaleCode());
  const dateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(intlLocale, { dateStyle: "long", timeStyle: "short" }), [intlLocale]);

  const joinState = useJoinState(appointment);
  const [meeting, setMeeting] = useState<MeetingTokenResponse | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

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

  // Bug-fix turu (2026-09-18, frontend-agent) — bir manuel katılım başına EN FAZLA bir kez
  // otomatik yeniden bağlanma dener (bkz. `handleDisconnected`); `handleJoin` her ÇAĞRILDIĞINDA
  // sıfırlanır. Sonsuz yeniden-bağlanma döngüsünü (ör. kalıcı olarak bozuk bir ağda tekrar tekrar
  // `meeting-token` çağırıp hız sınırına çarpmak) ÖNLER — `useState` DEĞİL `useRef`: bu bayracın
  // değişmesi kendi başına bir yeniden render'ı TETİKLEMEMELİ.
  const autoReconnectedRef = useRef(false);

  async function handleJoin() {
    autoReconnectedRef.current = false;
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

  /**
   * Bug-fix turu (2026-09-18, frontend-agent) — ESKİDEN her `RoomEvent.Disconnected` doğrudan
   * `setMeeting(null)` ile kullanıcıyı ön-katılım ekranına atıyordu; bu, kullanıcının KENDİ
   * isteğiyle ayrılması (`DisconnectReason.CLIENT_INITIATED`, "Görüşmeden ayrıl" butonu) İLE
   * geçici bir ağ/sinyal kopması (`SIGNAL_CLOSE`/`JOIN_FAILURE`/`STATE_MISMATCH` vb. — LiveKit'in
   * KENDİ dahili yeniden bağlanma denemeleri TÜKENDİĞİNDE gelir, bkz. `@livekit/components-react`
   * `onDisconnected` tipi) arasında AYRIM YAPMIYORDU. Şimdi yalnızca istemci-kaynaklı ayrılışta
   * hemen ön-katılım ekranına dönülür; DİĞER TÜM nedenlerde taze bir `meeting-token` alınıp
   * (`<LiveKitRoom key={meeting.token}>` sayesinde TEMİZ bir remount ile) tek seferlik SESSİZ bir
   * yeniden bağlanma denenir — yalnızca BU da başarısız olursa kullanıcı ön-katılım ekranına, açık
   * bir hata mesajıyla döner. Hastanın "sürekli odadan atılması" şikayetinin karşılığı budur.
   */
  async function handleDisconnected(reason?: DisconnectReason) {
    if (reason !== DisconnectReason.CLIENT_INITIATED && !autoReconnectedRef.current) {
      autoReconnectedRef.current = true;
      try {
        const token = await telehealthApi.requestMeetingToken(appointment.id, accessToken);
        setMeeting(token);
        return;
      } catch {
        setJoinError("Görüşme bağlantısı beklenmedik şekilde kesildi. Lütfen tekrar katılın.");
      }
    }
    setMeeting(null);
  }

  /**
   * Bug-fix turu (2026-09-21, kullanıcı talebi) — `ConsultationVideoRoom`'un `onError`/
   * `onMediaDeviceFailure`'ından gelir (bkz. o bileşendeki yorum): `room.connect()`'in İLK
   * denemesi hiç kurulamadan başarısız olduğunda `handleDisconnected` TETİKLENMEZ (henüz
   * bağlıyken kopma değil, hiç BAĞLANAMAMA) — bu callback OLMADAN kullanıcı "Bağlanıyor…"
   * rozetinde sonsuza dek asılı kalırdı. `autoReconnectedRef` de sıfırlanır ki bir SONRAKİ
   * `handleJoin` tekrar bir otomatik yeniden bağlanma HAKKI kazansın.
   */
  function handleConnectionError(message: string) {
    autoReconnectedRef.current = false;
    setJoinError(message);
    setMeeting(null);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[var(--site-radius)] border border-border bg-surface p-5">
        <h1 className="font-heading text-2xl font-semibold text-foreground sm:text-3xl">
          {appointment.doctor ? `${appointment.doctor.title ?? ""} ${appointment.doctor.fullName ?? ""}`.trim() : "Doktor"} ile Görüşme
        </h1>
        <p className="mt-1 text-sm text-foreground/60">
          {appointment.startsAt ? dateTimeFormatter.format(new Date(appointment.startsAt)) : "—"} · {appointment.patientName ?? "Hasta"}
        </p>
      </div>

      {meeting ? (
        <ConsultationVideoRoom
          meeting={meeting}
          onLeave={(reason) => void handleDisconnected(reason)}
          onConnectionError={handleConnectionError}
          appointmentId={appointment.id}
          accessToken={accessToken}
          isDoctor={isDoctor}
          recordingModuleEnabled={recordingModuleEnabled}
          recording={recording}
          consentDialogOpen={consentDialogOpen}
          onRecordingSnapshot={handleRecordingSnapshot}
          onRecordingSignal={handleRecordingSignal}
          onConsentResolved={handleRecordingSnapshot}
          onConsentDismiss={() => recording && setDismissedConsentId(recording.id)}
        />
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
