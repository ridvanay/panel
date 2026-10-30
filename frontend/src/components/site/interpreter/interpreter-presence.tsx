"use client";

import { useEffect, useRef, useState } from "react";
import { ParticipantTile, useParticipants, useTracks } from "@livekit/components-react";
import { Track } from "livekit-client";
import { Languages, UserX } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { fmt, usePortalStrings } from "@/lib/i18n/use-portal-strings";
import { removeAppointmentInterpreter } from "@/lib/api/interpreter";
import { interpreterLanguageOf, isInterpreterParticipant, languageNativeName } from "@/components/site/interpreter/interpreter-participant";

/**
 * Paket AA — hasta/doktor görüşme odasında tercüman (yalnızca `consultation-room.tsx`'e bağlanır, o
 * dosyanın akışını değiştirmez):
 *  - Tercüman 3. kutu olarak görünür ("Tercüman · dil" etiketiyle); spotlight karşı taraf kalır.
 *  - Katıldı/ayrıldı bildirimi hasta ve doktora bir kez gösterilir (birkaç saniye).
 *  - Doktor "Görüşmeden çıkar" ile (onay penceresiyle) tercümanı çıkarabilir; sunucu atamayı
 *    `REMOVED` yapar, tercümanı odadan atar ve audit'e yazar.
 */
export function InterpreterPresence({ appointmentId, isDoctor }: { appointmentId: string; isDoctor: boolean }) {
  const { t } = usePortalStrings();
  const participants = useParticipants();
  const interpreter = participants.find((p) => !p.isLocal && isInterpreterParticipant(p)) ?? null;
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }]);
  const interpreterTrack = interpreter ? tracks.find((tr) => tr.participant.identity === interpreter.identity) : undefined;
  const language = interpreter ? interpreterLanguageOf(interpreter) : null;
  const tileLabel = fmt(t.interpreter.tileLabel, { language: language ? languageNativeName(language) : "" }).replace(/\s·\s$/, "");

  // Katıldı/ayrıldı bildirimi — yalnızca durum değişince, bir kez.
  const present = interpreter !== null;
  const previous = useRef<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (previous.current !== null && previous.current !== present) {
      setNotice(present ? t.interpreter.joinedNotice : t.interpreter.leftNotice);
      const timer = window.setTimeout(() => setNotice(null), 6000);
      previous.current = present;
      return () => window.clearTimeout(timer);
    }
    previous.current = present;
  }, [present, t.interpreter.joinedNotice, t.interpreter.leftNotice]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function handleRemove() {
    setRemoving(true);
    setRemoveError(null);
    try {
      await removeAppointmentInterpreter(appointmentId);
      setConfirmOpen(false);
    } catch {
      setRemoveError(t.interpreter.removeFailed);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <>
      {/* Canlı bölge her zaman DOM'da; ekran okuyucu yalnızca metin değişince duyurur. */}
      <div role="status" aria-live="polite" className="pointer-events-none absolute inset-x-3 top-14 z-20 flex justify-center">
        {notice && (
          <div data-testid="interpreter-notice" className="flex items-center gap-2 rounded-[var(--site-radius)] bg-black/70 px-3 py-1.5 text-sm text-white shadow">
            <Languages className="h-4 w-4 shrink-0" aria-hidden="true" />
            {notice}
          </div>
        )}
      </div>

      {interpreter && (
        // Mobil: yerel kamera kartının altında (sağ üst); masaüstü: yerel kamera kartının üstünde (sağ alt).
        <div
          data-testid="interpreter-tile"
          className="absolute right-3 top-[8.75rem] z-10 h-24 w-32 overflow-hidden rounded-[var(--site-radius)] border border-white/20 shadow-lg lg:bottom-40 lg:right-6 lg:top-auto lg:h-28 lg:w-40"
        >
          {interpreterTrack && <ParticipantTile trackRef={interpreterTrack} className="h-full w-full" />}
          <span className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white">
            <bdi>{tileLabel}</bdi>
          </span>
          {isDoctor && (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              aria-label={t.interpreter.removeButton}
              title={t.interpreter.removeButton}
              data-testid="interpreter-remove"
              className="absolute end-1 top-1 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-red-600 focus-visible:outline-2 focus-visible:outline-white"
            >
              <UserX className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {isDoctor && (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={(open) => {
            setConfirmOpen(open);
            if (!open) setRemoveError(null);
          }}
          title={t.interpreter.removeConfirmTitle}
          description={removeError ?? t.interpreter.removeConfirmDescription}
          confirmText={t.interpreter.removeConfirm}
          cancelText={t.interpreter.cancel}
          destructive
          loading={removing}
          onConfirm={() => void handleRemove()}
        />
      )}
    </>
  );
}
