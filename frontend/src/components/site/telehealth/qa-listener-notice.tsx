"use client";

import { useParticipants } from "@livekit/components-react";
import { Headphones } from "lucide-react";

/**
 * Paket C (2026-10-18) — ADMIN kalite kontrol dinleyicisinin hasta ve doktor ekranında AÇIKÇA
 * bildirilmesi. Dinleyici token'ını backend üretir (`lib/livekit.ts::createQaListenerToken`):
 * kimlik `qa-listener-<userId>`, metadata `{"role":"qa_listener"}`. İkisi de sunucu imzalıdır ve
 * katılımcı tarafından değiştirilemez (`canUpdateOwnMetadata: false`); biri bile eşleşirse
 * uyarı gösterilir.
 */

export const QA_LISTENER_IDENTITY_PREFIX = "qa-listener-";
export const QA_LISTENER_DISPLAY_NAME = "WM Health – Kalite Kontrol";
export const QA_LISTENER_NOTICE_TEXT = "Kalite kontrol amacıyla yetkili bir WM Health personeli bu görüşmeyi dinliyor.";

export function isQaListenerParticipant(participant: { identity: string; metadata?: string }): boolean {
  if (participant.identity.startsWith(QA_LISTENER_IDENTITY_PREFIX)) return true;
  if (!participant.metadata) return false;
  try {
    const parsed = JSON.parse(participant.metadata) as { role?: unknown };
    return parsed?.role === "qa_listener";
  } catch {
    return false;
  }
}

/** Kalıcı uyarı — kapatma düğmesi YOK; dinleyici odadan ayrılınca kendiliğinden kalkar. Kontrol çubuğunun
 * hemen üstünde durur (üstteki bağlantı rozeti, kayıt göstergesi ve mobil kamera önizlemesiyle çakışmaz). */
export function QaListenerBanner() {
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-20 z-20 flex justify-center lg:bottom-24">
      <div
        role="status"
        aria-live="polite"
        className="flex max-w-xl items-start gap-2 rounded-[var(--site-radius)] border border-warning/60 bg-warning px-4 py-2.5 text-sm font-medium text-warning-foreground shadow-lg"
      >
        <Headphones className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          {QA_LISTENER_NOTICE_TEXT}
          <span className="block text-xs font-normal">Katılımcı: {QA_LISTENER_DISPLAY_NAME}</span>
        </span>
      </div>
    </div>
  );
}

/** `<LiveKitRoom>` içinde render edilir; dinleyici yoksa hiçbir şey çizmez. */
export function QaListenerNotice() {
  const participants = useParticipants();
  return participants.some((p) => !p.isLocal && isQaListenerParticipant(p)) ? <QaListenerBanner /> : null;
}
