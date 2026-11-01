"use client";

import { useCallback, useEffect, useId, useRef, useState, type ComponentType, type ReactNode, type RefObject } from "react";
import { useTrackToggle } from "@livekit/components-react";
import { Track } from "livekit-client";
import {
  Grid2x2,
  Maximize,
  Mic,
  MicOff,
  Minimize,
  PhoneOff,
  PictureInPicture2,
  RefreshCcw,
  ScreenShare,
  ScreenShareOff,
  Settings,
  UserRound,
  Video,
  VideoOff,
  type LucideProps,
} from "lucide-react";
import { useConsultationStrings } from "@/lib/i18n/use-consultation-strings";
import { cn } from "@/lib/utils";
import { SettingsPanel } from "./settings-panel";
import { useCameraFlip } from "./use-camera-flip";
import { useRoomUi } from "./room-ui-context";

export const IDLE_FADE_MS = 3_000;

/** Klavye kısayolu bir metin alanındayken çalışmaz. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
}

/**
 * 3 sn hareketsizlikte `faded` olur; fare/dokunma/klavye etkinliğinde geri gelir. `hold` (odak içeride, ayarlar açık)
 * iken soluklaşmaz.
 */
export function useIdleFade(hold: boolean, delayMs: number = IDLE_FADE_MS): boolean {
  const [faded, setFaded] = useState(false);
  const holdRef = useRef(hold);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!holdRef.current) setFaded(true);
    }, delayMs);
  }, [delayMs]);

  useEffect(() => {
    holdRef.current = hold;
    // Tutma bırakıldığında (odak çıktı / ayarlar kapandı) yeniden saymaya başla; bu sırada çubuk görünür kalır.
    if (!hold) schedule();
  }, [hold, schedule]);

  useEffect(() => {
    const onActivity = () => {
      setFaded(false);
      schedule();
    };
    const events = ["pointermove", "pointerdown", "touchstart", "keydown"] as const;
    for (const name of events) document.addEventListener(name, onActivity, { passive: true });
    schedule();
    return () => {
      for (const name of events) document.removeEventListener(name, onActivity);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [schedule]);

  return faded && !hold;
}

interface BarButtonProps {
  label: string;
  shortcut?: string;
  onClick: () => void;
  /** Aç/kapa düğmeleri: açık (etkin) durum. `undefined` → aria-pressed yok. */
  pressed?: boolean;
  disabled?: boolean;
  /** Kapalı/uyarı görünümü (örn. mikrofon kapalı). */
  off?: boolean;
  expanded?: boolean;
  controls?: string;
  testId?: string;
  Icon: ComponentType<LucideProps>;
  children?: ReactNode;
}

/** 44 px'ten küçük olmayan düğme + hover/odakta görünen erişilebilir tooltip (tam ekranda da görünsün diye portalsız). */
function BarButton({ label, shortcut, onClick, pressed, disabled, off, expanded, controls, testId, Icon }: BarButtonProps) {
  const { t, fmt } = useConsultationStrings();
  const tipId = useId();
  const tooltip = shortcut ? fmt(t.shortcutLabel, { label, key: shortcut }) : label;
  return (
    <div className="group/tip relative">
      <button
        type="button"
        aria-label={label}
        aria-describedby={tipId}
        aria-keyshortcuts={shortcut}
        aria-pressed={pressed}
        aria-expanded={expanded}
        aria-controls={controls}
        data-testid={testId}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-full transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60 lg:h-12 lg:w-12",
          off ? "bg-white/90 text-black hover:bg-white" : "bg-white/15 text-white hover:bg-white/25"
        )}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </button>
      <span
        id={tipId}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background opacity-0 shadow transition-opacity duration-150 group-focus-within/tip:opacity-100 group-hover/tip:opacity-100"
      >
        {tooltip}
      </span>
    </div>
  );
}

/**
 * Alt ortada kontrol çubuğu: mikrofon, kamera, kamerayı çevir (birden çok kamera varsa), ekran paylaş (mevcut davranış; hasta da
 * paylaşabilir — tarayıcı `getDisplayMedia` sunmuyorsa gizlenir), ayarlar, yerleşim, (varsa) resim içinde resim, tam ekran,
 * görüşmeden ayrıl. `M` mikrofon, `V` kamera kısayolu. Hareketsizlikte soluklaşır; odak içindeyken soluklaşmaz.
 */
export function RoomControlBar({ stageRef, onEndCall }: { stageRef: RefObject<HTMLDivElement | null>; onEndCall: () => void }) {
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const camera = useTrackToggle({ source: Track.Source.Camera });
  const screenShare = useTrackToggle({ source: Track.Source.ScreenShare });
  const { canFlip, flip, busy } = useCameraFlip();
  const ui = useRoomUi();
  const { t } = useConsultationStrings();
  const panelId = useId();
  const settingsButtonRef = useRef<HTMLDivElement | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const modalityRef = useRef<"keyboard" | "pointer">("pointer");
  useEffect(() => {
    const onKey = () => {
      modalityRef.current = "keyboard";
    };
    const onPointer = () => {
      modalityRef.current = "pointer";
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, []);
  const faded = useIdleFade(focusWithin || settingsOpen);

  // Tarayıcı özellik tespiti sunucuda yapılamaz → ilk client render'dan sonra bir kez (hidrasyon uyuşmazlığı olmasın diye).
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [shareSupported, setShareSupported] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [inBrowserPip, setInBrowserPip] = useState(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setFullscreenSupported(
      typeof document !== "undefined" && document.fullscreenEnabled !== false && typeof document.documentElement.requestFullscreen === "function"
    );
    setPipSupported(typeof document !== "undefined" && document.pictureInPictureEnabled === true);
    // `mediaDevices` hiç yoksa (güvensiz bağlam) eski davranış korunur; varsa ama `getDisplayMedia` yoksa (mobil) düğme gizlenir.
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    setShareSupported(!md || typeof md.getDisplayMedia === "function");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [stageRef]);

  useEffect(() => {
    const onEnter = () => setInBrowserPip(true);
    const onLeave = () => setInBrowserPip(false);
    document.addEventListener("enterpictureinpicture", onEnter, true);
    document.addEventListener("leavepictureinpicture", onLeave, true);
    return () => {
      document.removeEventListener("enterpictureinpicture", onEnter, true);
      document.removeEventListener("leavepictureinpicture", onLeave, true);
    };
  }, []);

  // Klavye kısayolları: M mikrofon, V kamera. Metin alanında / değiştirici tuşla çalışmaz; `code` kullanımı Arapça/Kiril
  // düzenlerinde de aynı fiziksel tuşu yakalar.
  const micToggle = mic.toggle;
  const cameraToggle = camera.toggle;
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTypingTarget(e.target)) return;
      const key = e.key?.toLowerCase();
      if (e.code === "KeyM" || key === "m") {
        e.preventDefault();
        void micToggle();
      } else if (e.code === "KeyV" || key === "v") {
        e.preventDefault();
        void cameraToggle();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [micToggle, cameraToggle]);

  async function toggleFullscreen() {
    const el = stageRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      // Tarayıcı izni reddedebilir (kullanıcı jesti dışında çağrı) — sessizce yok say.
    }
  }

  async function toggleBrowserPip() {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return;
      }
      const root = stageRef.current;
      const video =
        root?.querySelector<HTMLVideoElement>('[data-tile-role="main"]:not([data-local-camera]) video') ??
        root?.querySelector<HTMLVideoElement>('[data-tile-role]:not([data-local-camera]) video') ??
        root?.querySelector<HTMLVideoElement>("video");
      await video?.requestPictureInPicture();
    } catch {
      // Tarayıcı/video bu an PiP'e uygun değil — sessizce yok say.
    }
  }

  function closeSettings() {
    setSettingsOpen(false);
    settingsButtonRef.current?.querySelector("button")?.focus();
  }

  const layoutLabel = ui.layout === "speaker" ? t.layoutToGrid : t.layoutToSpeaker;

  return (
    <>
      {settingsOpen && <SettingsPanel id={panelId} onClose={closeSettings} />}
      <div
        role="toolbar"
        aria-label={t.controlsLabel}
        data-testid="control-bar"
        data-faded={faded ? "true" : "false"}
        onFocus={() => {
          // Fare tıklamasıyla kalan odak çubuğu sonsuza dek görünür tutmasın: yalnızca klavyeyle gelen odak tutar.
          if (modalityRef.current === "keyboard") setFocusWithin(true);
        }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false);
        }}
        className={cn(
          "absolute inset-x-0 bottom-3 z-20 flex flex-wrap items-center justify-center gap-2 px-2 transition-opacity duration-500 lg:bottom-6 lg:gap-3 lg:px-4",
          faded && "pointer-events-none opacity-25"
        )}
      >
        <div className="flex flex-wrap items-center justify-center gap-1 rounded-full bg-black/70 px-2 py-1.5 backdrop-blur-md sm:gap-1.5 lg:gap-2 lg:px-3 lg:py-2">
          <BarButton
            label={mic.enabled ? t.micMute : t.micUnmute}
            shortcut="M"
            pressed={mic.enabled}
            disabled={mic.pending}
            off={!mic.enabled}
            onClick={() => void mic.toggle()}
            Icon={mic.enabled ? Mic : MicOff}
            testId="bar-mic"
          />
          <BarButton
            label={camera.enabled ? t.cameraOff : t.cameraOn}
            shortcut="V"
            pressed={camera.enabled}
            disabled={camera.pending}
            off={!camera.enabled}
            onClick={() => void camera.toggle()}
            Icon={camera.enabled ? Video : VideoOff}
            testId="bar-camera"
          />
          {canFlip && <BarButton label={t.flipCamera} disabled={busy} onClick={() => void flip()} Icon={RefreshCcw} testId="bar-flip-camera" />}
          {shareSupported && (
            <BarButton
              label={screenShare.enabled ? t.shareStop : t.shareStart}
              pressed={screenShare.enabled}
              disabled={screenShare.pending}
              off={!screenShare.enabled}
              onClick={() => void screenShare.toggle()}
              Icon={screenShare.enabled ? ScreenShare : ScreenShareOff}
              testId="bar-share"
            />
          )}
          <div ref={settingsButtonRef}>
            <BarButton label={t.settingsOpen} expanded={settingsOpen} controls={settingsOpen ? panelId : undefined} onClick={() => setSettingsOpen((open) => !open)} Icon={Settings} testId="bar-settings" />
          </div>
          <BarButton label={layoutLabel} onClick={ui.toggleLayout} Icon={ui.layout === "speaker" ? Grid2x2 : UserRound} testId="bar-layout" />
          {pipSupported && <BarButton label={inBrowserPip ? t.pipExit : t.pipEnter} pressed={inBrowserPip} onClick={() => void toggleBrowserPip()} Icon={PictureInPicture2} testId="bar-pip" />}
          {fullscreenSupported && (
            <BarButton
              label={isFullscreen ? t.fullscreenExit : t.fullscreenEnter}
              onClick={() => void toggleFullscreen()}
              Icon={isFullscreen ? Minimize : Maximize}
              testId="bar-fullscreen"
            />
          )}
        </div>
        <div className="group/tip relative">
          <button
            type="button"
            aria-label={t.endCall}
            data-testid="bar-end-call"
            onClick={onEndCall}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-danger text-white transition-colors hover:bg-danger/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white lg:h-14 lg:w-14"
          >
            <PhoneOff className="h-5 w-5" aria-hidden="true" />
          </button>
          <span
            role="tooltip"
            className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background opacity-0 shadow transition-opacity duration-150 group-focus-within/tip:opacity-100 group-hover/tip:opacity-100"
          >
            {t.endCall}
          </span>
        </div>
      </div>
    </>
  );
}
