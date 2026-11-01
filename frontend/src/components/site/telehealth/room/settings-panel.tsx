"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { useConsultationStrings } from "@/lib/i18n/use-consultation-strings";
import { cn } from "@/lib/utils";
import { loadPrefs, supportsSetSinkId } from "./device-prefs";
import { useDeviceActions, useDeviceList, type DeviceKind, type DeviceOption } from "./use-devices";

function DeviceSelect({
  kind,
  label,
  fallbackLabel,
  devices,
  value,
  onChange,
}: {
  kind: DeviceKind;
  label: string;
  fallbackLabel: string;
  devices: DeviceOption[];
  value: string;
  onChange: (kind: DeviceKind, deviceId: string) => void;
}) {
  const { t } = useConsultationStrings();
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-white/70">
        {label}
      </label>
      <select
        id={id}
        data-testid={`device-select-${kind}`}
        value={value}
        disabled={devices.length === 0}
        onChange={(e) => e.target.value && onChange(kind, e.target.value)}
        className="min-h-11 w-full rounded-[var(--site-radius)] border border-white/20 bg-white/10 px-3 text-sm text-white focus-visible:outline-2 focus-visible:outline-white disabled:opacity-60"
      >
        {devices.length === 0 && <option value="">{t.settingsNoDevice}</option>}
        {devices.length > 0 && !devices.some((d) => d.deviceId === value) && <option value="">{t.settingsDeviceDefault}</option>}
        {devices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId} className="text-black">
            {d.label || `${fallbackLabel} ${i + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
}

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[var(--site-radius)] px-1 text-start text-sm text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
    >
      <span>{label}</span>
      <span aria-hidden="true" className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-300", checked ? "bg-emerald-500" : "bg-white/30")}>
        <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all duration-300", checked ? "end-0.5" : "start-0.5")} />
      </span>
    </button>
  );
}

/**
 * Ayarlar (⚙): kamera / mikrofon / hoparlör seçimi ve ses işleme anahtarları. Cihaz değişimi `room.switchActiveDevice`,
 * anahtarlar mikrofon izinde `restartTrack` ile uygulanır; yayın kapatılıp açılmaz, Room/bağlantı seçeneklerine dokunulmaz.
 * Hoparlör seçimi yalnızca `setSinkId` destekleyen tarayıcılarda gösterilir.
 */
export function SettingsPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useConsultationStrings();
  const cameras = useDeviceList("videoinput");
  const microphones = useDeviceList("audioinput");
  const speakers = useDeviceList("audiooutput");
  const { selectDevice, activeDevice, applyAudioProcessing } = useDeviceActions();
  const [prefs] = useState(loadPrefs);
  const [selected, setSelected] = useState<Record<DeviceKind, string>>(() => ({
    videoinput: activeDevice("videoinput") ?? prefs.videoinput ?? "",
    audioinput: activeDevice("audioinput") ?? prefs.audioinput ?? "",
    audiooutput: activeDevice("audiooutput") ?? prefs.audiooutput ?? "",
  }));
  const [processing, setProcessing] = useState({
    noiseSuppression: prefs.noiseSuppression,
    echoCancellation: prefs.echoCancellation,
    autoGainControl: prefs.autoGainControl,
  });
  const [error, setError] = useState(false);
  const canPickSpeaker = supportsSetSinkId();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  async function handleDevice(kind: DeviceKind, deviceId: string) {
    const previous = selected[kind];
    setSelected((prev) => ({ ...prev, [kind]: deviceId }));
    setError(false);
    const ok = await selectDevice(kind, deviceId);
    if (!ok) {
      setSelected((prev) => ({ ...prev, [kind]: previous }));
      setError(true);
    }
  }

  async function handleProcessing(key: keyof typeof processing, value: boolean) {
    const previous = processing;
    const next = { ...processing, [key]: value };
    setProcessing(next);
    setError(false);
    const ok = await applyAudioProcessing(next);
    if (!ok) {
      setProcessing(previous);
      setError(true);
    }
  }

  return (
    <div
      id={id}
      role="dialog"
      aria-label={t.settingsTitle}
      data-testid="settings-panel"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className="absolute inset-x-3 bottom-[5.5rem] z-30 mx-auto max-h-[calc(100%-7rem)] w-auto max-w-sm overflow-y-auto rounded-[var(--site-radius)] bg-black/85 p-4 text-white shadow-2xl backdrop-blur-md lg:bottom-28"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t.settingsTitle}</h2>
        <button
          ref={closeRef}
          type="button"
          aria-label={t.settingsClose}
          title={t.settingsClose}
          onClick={onClose}
          className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="space-y-3">
        <DeviceSelect kind="videoinput" label={t.settingsCamera} fallbackLabel={t.settingsCamera} devices={cameras} value={selected.videoinput} onChange={(k, v) => void handleDevice(k, v)} />
        <DeviceSelect kind="audioinput" label={t.settingsMicrophone} fallbackLabel={t.settingsMicrophone} devices={microphones} value={selected.audioinput} onChange={(k, v) => void handleDevice(k, v)} />
        {canPickSpeaker && (
          <DeviceSelect kind="audiooutput" label={t.settingsSpeaker} fallbackLabel={t.settingsSpeaker} devices={speakers} value={selected.audiooutput} onChange={(k, v) => void handleDevice(k, v)} />
        )}

        <fieldset className="space-y-1 border-t border-white/15 pt-3">
          <legend className="mb-1 text-xs font-medium text-white/70">{t.settingsAudioProcessing}</legend>
          <SwitchRow label={t.settingsNoiseSuppression} checked={processing.noiseSuppression} onChange={(v) => void handleProcessing("noiseSuppression", v)} />
          <SwitchRow label={t.settingsEchoCancellation} checked={processing.echoCancellation} onChange={(v) => void handleProcessing("echoCancellation", v)} />
          <SwitchRow label={t.settingsAutoGain} checked={processing.autoGainControl} onChange={(v) => void handleProcessing("autoGainControl", v)} />
        </fieldset>

        {error && (
          <p role="alert" data-testid="settings-error" className="text-xs text-red-300">
            {t.settingsApplyError}
          </p>
        )}
      </div>
    </div>
  );
}
