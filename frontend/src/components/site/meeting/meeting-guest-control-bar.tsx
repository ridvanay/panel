"use client";

import { useId, useState, type ComponentType } from "react";
import { useRoomContext, useTrackToggle } from "@livekit/components-react";
import { Track } from "livekit-client";
import { Mic, MicOff, PhoneOff, RefreshCcw, Settings, Video, VideoOff, type LucideProps } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConsultationStrings } from "@/lib/i18n/use-consultation-strings";
import { useMeetingStrings } from "@/lib/i18n/use-meeting-strings";
import { SettingsPanel } from "@/components/site/telehealth/room/settings-panel";
import { useCameraFlip } from "@/components/site/telehealth/room/use-camera-flip";

function BarButton({
  label,
  onClick,
  Icon,
  pressed,
  off,
  disabled,
  expanded,
  controls,
  testId,
}: {
  label: string;
  onClick: () => void;
  Icon: ComponentType<LucideProps>;
  pressed?: boolean;
  off?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  controls?: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-controls={controls}
      disabled={disabled}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "flex h-11 w-11 items-center justify-center rounded-full transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60 lg:h-12 lg:w-12",
        off ? "bg-white/90 text-black hover:bg-white" : "bg-white/15 text-white hover:bg-white/25"
      )}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}

/**
 * Paket AG İş 3 — misafir kontrol çubuğu: mikrofon, kamera, (birden çok kamera varsa) çevir, cihaz ayarları, ayrıl.
 * EKRAN PAYLAŞIMI YOK (grant da sunucuda reddeder; düğmenin yokluğu yalnızca kullanılabilirlik içindir). `control-bar.tsx`
 * değişmediği için ev sahibi `RoomControlBar`'ı, misafir bu hafif çubuğu kullanır (Paket AA `interpreter-room.tsx` emsali).
 */
export function MeetingGuestControlBar() {
  const { t: ct } = useConsultationStrings();
  const { t } = useMeetingStrings();
  const room = useRoomContext();
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const camera = useTrackToggle({ source: Track.Source.Camera });
  const { canFlip, flip, busy } = useCameraFlip();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const panelId = useId();

  return (
    <>
      {settingsOpen && <SettingsPanel id={panelId} onClose={() => setSettingsOpen(false)} />}
      <div
        role="toolbar"
        aria-label={ct.controlsLabel}
        data-testid="guest-control-bar"
        className="absolute inset-x-0 bottom-3 z-20 flex flex-nowrap items-center justify-center gap-2 px-2 lg:bottom-6 lg:gap-3"
      >
        <div className="flex flex-nowrap items-center justify-center gap-1 rounded-full bg-black/70 px-2 py-1.5 backdrop-blur-md sm:gap-1.5 lg:gap-2 lg:px-3 lg:py-2">
          <BarButton
            label={mic.enabled ? ct.micMute : ct.micUnmute}
            pressed={mic.enabled}
            off={!mic.enabled}
            disabled={mic.pending}
            onClick={() => void mic.toggle()}
            Icon={mic.enabled ? Mic : MicOff}
            testId="guest-bar-mic"
          />
          <BarButton
            label={camera.enabled ? ct.cameraOff : ct.cameraOn}
            pressed={camera.enabled}
            off={!camera.enabled}
            disabled={camera.pending}
            onClick={() => void camera.toggle()}
            Icon={camera.enabled ? Video : VideoOff}
            testId="guest-bar-camera"
          />
          {canFlip && <BarButton label={ct.flipCamera} disabled={busy} onClick={() => void flip()} Icon={RefreshCcw} testId="guest-bar-flip" />}
          <BarButton
            label={ct.settingsOpen}
            expanded={settingsOpen}
            controls={settingsOpen ? panelId : undefined}
            onClick={() => setSettingsOpen((open) => !open)}
            Icon={Settings}
            testId="guest-bar-settings"
          />
        </div>
        <button
          type="button"
          aria-label={t.leaveAria}
          title={t.leaveAria}
          data-testid="guest-bar-leave"
          // Ayrılış `LiveKitRoom.onDisconnected(CLIENT_INITIATED)` üzerinden tek noktadan işlenir.
          onClick={() => void room.disconnect()}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-danger text-white transition-colors hover:bg-danger/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white lg:h-14 lg:w-14"
        >
          <PhoneOff className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">{t.leave}</span>
        </button>
      </div>
    </>
  );
}
