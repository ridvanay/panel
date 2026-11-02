"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Link2, UserMinus, Users } from "lucide-react";
import {
  listMeetingGuests,
  regenerateGuestLink,
  removeMeetingGuest,
  updateMeeting,
  type Meeting,
  type MeetingGuestRow,
} from "@/lib/api/meetings";
import { fmt, useMeetingErrorMessage, useMeetingStrings } from "@/lib/i18n/use-meeting-strings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { MeetingLinkCard } from "@/components/meetings/meeting-link-card";

const POLL_MS = 5_000;
const HIDDEN_POLL_MS = 15_000;

/** Bekleyen (token almamış) ve odadaki (kabul edilmiş, çıkarılmamış) misafirler. */
export function splitGuests(rows: readonly MeetingGuestRow[]): { waiting: MeetingGuestRow[]; inRoom: MeetingGuestRow[] } {
  return {
    waiting: rows.filter((g) => g.waiting && !g.removedAt),
    inRoom: rows.filter((g) => !g.waiting && g.admittedAt && !g.removedAt),
  };
}

/**
 * Paket AG İş 3 — ev sahibinin yan paneli: bekleyen misafirler (ad + bekleme süresi), odadakiler ve "Çıkar"; "Misafirleri
 * doğrudan al" anahtarı; yeni misafir bağlantısı (eskisini geçersiz kılar, uyarıyla). Kabul/ret lobisi YOKTUR (S8):
 * misafir ev sahibi gelince otomatik girer, ev sahibi yalnızca çıkarabilir. Misafir adları düz metin olarak render edilir.
 */
export function MeetingParticipantsPanel({
  meeting,
  onMeetingChange,
}: {
  meeting: Pick<Meeting, "id" | "title" | "startsAt" | "autoAdmitGuests">;
  onMeetingChange: (patch: Partial<Meeting>) => void;
}) {
  const { t } = useMeetingStrings();
  const errorMessage = useMeetingErrorMessage();
  const [rows, setRows] = useState<MeetingGuestRow[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [pendingRegen, setPendingRegen] = useState(false);
  const [regenLoading, setRegenLoading] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const meetingId = meeting.id;
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await listMeetingGuests(meetingId);
      if (!mountedRef.current) return;
      setRows(next);
      setNow(Date.now());
      setError(null);
    } catch (err) {
      if (mountedRef.current) setError(errorMessage(err));
    }
  }, [meetingId, errorMessage]);

  useEffect(() => {
    mountedRef.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const schedule = () => {
      if (stopped) return;
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      timer = setTimeout(() => {
        void refresh().finally(schedule);
      }, hidden ? HIDDEN_POLL_MS : POLL_MS);
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ilk yükleme + yoklama (dış sistemle eşitleme)
    void refresh().finally(schedule);
    return () => {
      stopped = true;
      mountedRef.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);

  async function remove(guest: MeetingGuestRow) {
    try {
      await removeMeetingGuest(meetingId, guest.id);
      setStatus(fmt(t.guestRemovedToast, { name: guest.displayName }));
      void refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function toggleAutoAdmit(value: boolean) {
    onMeetingChange({ autoAdmitGuests: value });
    try {
      await updateMeeting(meetingId, { autoAdmitGuests: value });
    } catch (err) {
      onMeetingChange({ autoAdmitGuests: !value });
      setError(errorMessage(err));
    }
  }

  async function confirmRegen() {
    setRegenLoading(true);
    try {
      const res = await regenerateGuestLink(meetingId);
      setLink(res.guestLink);
      setPendingRegen(false);
    } catch (err) {
      setError(errorMessage(err));
      setPendingRegen(false);
    } finally {
      setRegenLoading(false);
    }
  }

  const { waiting, inRoom } = splitGuests(rows);

  return (
    <aside aria-labelledby="meeting-panel-title" className="space-y-4 rounded-[var(--site-radius)] border border-border bg-surface p-4" data-testid="meeting-participants-panel">
      <h2 id="meeting-panel-title" className="flex items-center gap-2 text-base font-semibold text-foreground">
        <Users className="h-4 w-4" aria-hidden="true" />
        {t.panelTitle}
      </h2>

      {error && <Alert variant="error">{error}</Alert>}
      <p role="status" aria-live="polite" className="sr-only" data-testid="meeting-panel-status">
        {status}
      </p>

      <section aria-labelledby="meeting-waiting-title" className="space-y-2">
        <h3 id="meeting-waiting-title" className="text-sm font-medium text-foreground">
          {fmt(t.panelWaitingHeading, { count: waiting.length })}
        </h3>
        {waiting.length === 0 ? (
          <p className="text-xs text-foreground/60">{t.panelWaitingNone}</p>
        ) : (
          <ul className="space-y-1.5" data-testid="meeting-waiting-list">
            {waiting.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-sm">
                <span className="min-w-0">
                  <bdi className="block truncate font-medium text-foreground">{g.displayName}</bdi>
                  <span className="text-xs text-foreground/60">
                    {fmt(t.waitedFor, { minutes: Math.max(0, Math.floor((now - new Date(g.createdAt).getTime()) / 60_000)) })}
                  </span>
                </span>
                <Button type="button" size="xs" variant="destructive" aria-label={fmt(t.removeGuestAria, { name: g.displayName })} onClick={() => void remove(g)}>
                  <UserMinus aria-hidden="true" />
                  {t.removeGuest}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="meeting-inroom-title" className="space-y-2">
        <h3 id="meeting-inroom-title" className="text-sm font-medium text-foreground">
          {t.panelInRoomHeading}
        </h3>
        {inRoom.length === 0 && waiting.length === 0 ? (
          <p className="text-xs text-foreground/60">{t.panelNoGuests}</p>
        ) : (
          <ul className="space-y-1.5" data-testid="meeting-inroom-list">
            {inRoom.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-sm">
                <bdi className="min-w-0 truncate font-medium text-foreground">{g.displayName}</bdi>
                <Button type="button" size="xs" variant="destructive" aria-label={fmt(t.removeGuestAria, { name: g.displayName })} onClick={() => void remove(g)}>
                  <UserMinus aria-hidden="true" />
                  {t.removeGuest}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex items-start gap-3 border-t border-border pt-3">
        <Switch id="meeting-panel-auto-admit" checked={meeting.autoAdmitGuests} onCheckedChange={(v) => void toggleAutoAdmit(v)} aria-describedby="meeting-panel-auto-admit-hint" />
        <div className="space-y-0.5">
          <label htmlFor="meeting-panel-auto-admit" className="cursor-pointer text-sm font-medium text-foreground">
            {t.fieldAutoAdmit}
          </label>
          <p id="meeting-panel-auto-admit-hint" className="text-xs text-foreground/60">
            {t.autoAdmitHint}
          </p>
        </div>
      </div>

      <Button type="button" variant="outline" size="sm" onClick={() => setPendingRegen(true)} data-testid="meeting-panel-new-link">
        <Link2 aria-hidden="true" />
        {t.actionNewLink}
      </Button>

      <ConfirmDialog
        open={pendingRegen}
        onOpenChange={setPendingRegen}
        title={t.regenTitle}
        description={t.regenBody}
        confirmText={t.regenConfirm}
        cancelText={t.dialogCancel}
        tone="warning"
        loading={regenLoading}
        onConfirm={() => void confirmRegen()}
      />
      <Dialog open={link !== null} onOpenChange={(open) => { if (!open) setLink(null); }}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto sm:max-w-lg">
          <DialogHeader className="sr-only">
            <DialogTitle>{t.linkCardTitleRegenerated}</DialogTitle>
            <DialogDescription>{t.linkOnceWarning}</DialogDescription>
          </DialogHeader>
          {link && <MeetingLinkCard meeting={meeting} link={link} heading="regenerated" onDone={() => setLink(null)} />}
        </DialogContent>
      </Dialog>
    </aside>
  );
}
