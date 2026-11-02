"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarX2, DoorClosed, LogIn, LogOut, ShieldAlert } from "lucide-react";
import { getMeeting, requestHostToken, type Meeting } from "@/lib/api/meetings";
import { ApiClientError } from "@/lib/api/error";
import type { MeetingTokenResponse } from "@/lib/api/types";
import { useAuthOptional } from "@/context/auth-context";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { isDoctorHostname, isSubdomainModeEnabled, toDoctorOrigin } from "@/lib/doctor-host";
import { localeDirection } from "@/lib/i18n/locale-direction";
import { useActiveLocaleCode } from "@/context/locale-alternates-context";
import { fmt, useMeetingErrorMessage, useMeetingStrings } from "@/lib/i18n/use-meeting-strings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PrejoinDeviceCheck, type PrejoinCheckHandle } from "@/components/site/telehealth/room/prejoin-device-check";
import { MeetingNotice, MeetingRoom, type MeetingExitReason } from "./meeting-room";
import { MeetingParticipantsPanel } from "./meeting-participants-panel";
import { formatCountdown, formatMeetingClock, isInJoinWindow, MEETING_JOIN_LEAD_MS } from "./meeting-time";

type Stage = "loading" | "signin" | "notfound" | "error" | "prejoin" | "room" | "left" | "ended" | "removed";

/**
 * AI İş 3 — geriye uyumlu, isteğe bağlı kaynak: hizmet masası koordinatörü aynı ev sahibi odasını kendi uçlarıyla kullanır
 * (`/coordinator/consultations/:id/host-token`). Verilmezse AG davranışı (`GET /meetings/:id`, `POST /meetings/:id/host-token`) aynen sürer.
 */
export interface HostRoomSource {
  loadMeeting: () => Promise<Meeting>;
  requestToken: () => Promise<MeetingTokenResponse>;
  /** Ayrılınca / "geri" bağlantısında dönülecek panel yolu. */
  backHref: string;
  /** `false`: misafir kabul/çıkarma paneli gösterilmez (hizmet görüşmesinde hasta koordinatör girince otomatik alınır). Varsayılan `true`. */
  showParticipantsPanel?: boolean;
}

/**
 * Paket AG İş 3 — ev sahibi odası (`/{lang}/meet/{meetingId}`, oturum gerekli). Ön ekran: toplantı başlığı + cihaz testi +
 * "Katıl" (pencere dışındaysa geri sayım). Odadayken yanında katılımcılar paneli. ADMIN rolü başkasının toplantısına ev sahibi
 * olarak giremez (sunucu 404 döner → "bulunamadı"). Ayrılınca panel listesine (doktor: doktor portalı) dönülür.
 */
export function HostMeetingRoom({ meetingId, source }: { meetingId: string; source?: HostRoomSource }) {
  const { t } = useMeetingStrings();
  const errorMessage = useMeetingErrorMessage();
  const auth = useAuthOptional();
  const router = useRouter();
  const localize = useLocalizePath();
  const lang = useActiveLocaleCode();
  const [stage, setStage] = useState<Stage>("loading");
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [token, setToken] = useState<MeetingTokenResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const prejoinRef = useRef<PrejoinCheckHandle | null>(null);
  const sourceRef = useRef<HostRoomSource | undefined>(source);
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  const status = auth?.status ?? "loading";
  const isDoctor = auth?.user?.doctorProfileId != null;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const loadMeeting = useCallback(async () => {
    setStage("loading");
    try {
      const m = await (sourceRef.current?.loadMeeting() ?? getMeeting(meetingId));
      setMeeting(m);
      setStage(m.phase === "cancelled" || m.status === "CANCELLED" ? "ended" : m.phase === "ended" ? "ended" : "prejoin");
    } catch (err) {
      if (err instanceof ApiClientError && (err.status === 404 || err.code === "MEETING_NOT_FOUND" || err.status === 403)) setStage("notfound");
      else {
        setMessage(errorMessage(err));
        setStage("error");
      }
    }
  }, [meetingId, errorMessage]);

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- oturum durumu çözülünce ekran seçimi
      setStage("signin");
      return;
    }
    void loadMeeting();
  }, [status, loadMeeting]);

  async function join() {
    prejoinRef.current?.stop();
    setJoining(true);
    setMessage(null);
    try {
      setToken(await (sourceRef.current?.requestToken() ?? requestHostToken(meetingId)));
      setStage("room");
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "MEETING_NOT_OPEN") void loadMeeting();
      setMessage(errorMessage(err));
    } finally {
      setJoining(false);
    }
  }

  const fetchToken = useCallback(() => sourceRef.current?.requestToken() ?? requestHostToken(meetingId), [meetingId]);

  function backToList() {
    if (source) {
      router.push(source.backHref);
      return;
    }
    const path = isDoctor ? "/doctor/meetings" : "/admin/meetings";
    if (isDoctor && isSubdomainModeEnabled() && !isDoctorHostname(window.location.hostname)) {
      window.location.assign(toDoctorOrigin(localize(path)));
      return;
    }
    router.push(isDoctor ? localize(path) : path);
  }

  function handleExit(reason: MeetingExitReason, detail?: string) {
    setToken(null);
    if (reason === "left") {
      // Ayrılınca panel listesine dön; kısa bir "ayrıldınız" ekranı yerine doğrudan liste.
      backToList();
      return;
    }
    if (reason === "failed") {
      setMessage(detail ?? t.errGeneric);
      setStage("prejoin");
      return;
    }
    setStage(reason);
  }

  const listHref = source ? source.backHref : isDoctor ? localize("/doctor/meetings") : "/admin/meetings";
  const backAction = (
    <Link href={listHref} className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted">
      {t.hostRoomBack}
    </Link>
  );

  let content: ReactNode;
  if (stage === "loading") {
    content = (
      <div className="space-y-4" role="status" aria-busy="true" data-testid="host-room-loading">
        <span className="sr-only">{t.hostRoomLoading}</span>
        <Skeleton className="h-16 w-full rounded-[var(--site-radius)]" />
        <Skeleton className="h-72 w-full rounded-[var(--site-radius)]" />
      </div>
    );
  } else if (stage === "signin") {
    content = (
      <MeetingNotice
        testId="host-room-signin"
        icon={<ShieldAlert className="h-9 w-9" />}
        title={t.hostRoomSignIn}
        actions={
          <Link
            href={`/login?next=${encodeURIComponent(source ? source.backHref : `/meet/${meetingId}`)}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            <LogIn className="h-4 w-4" aria-hidden="true" />
            {t.hostRoomSignInAction}
          </Link>
        }
      />
    );
  } else if (stage === "notfound") {
    content = <MeetingNotice testId="host-room-notfound" icon={<CalendarX2 className="h-9 w-9" />} title={t.hostRoomNotFound} actions={backAction} />;
  } else if (stage === "error") {
    content = (
      <MeetingNotice
        testId="host-room-error"
        icon={<CalendarX2 className="h-9 w-9" />}
        title={message ?? t.errGeneric}
        actions={
          <Button type="button" variant="outline" onClick={() => void loadMeeting()}>
            {t.retry}
          </Button>
        }
      />
    );
  } else if (stage === "ended") {
    content = (
      <MeetingNotice
        testId="host-room-ended"
        icon={<DoorClosed className="h-9 w-9" />}
        title={meeting?.status === "CANCELLED" || meeting?.phase === "cancelled" ? t.hostRoomCancelled : t.hostRoomEnded}
        actions={backAction}
      />
    );
  } else if (stage === "removed") {
    content = <MeetingNotice testId="host-room-removed" icon={<LogOut className="h-9 w-9" />} title={t.roomRemovedTitle} body={t.roomRemovedBody} actions={backAction} />;
  } else if (stage === "room" && token && meeting) {
    content = (
      <div className={source?.showParticipantsPanel === false ? "grid gap-4" : "grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]"} data-testid="host-room">
        <div dir="ltr">
          <MeetingRoom mode="host" initialToken={token} fetchToken={fetchToken} endsAt={meeting.endsAt} onExit={handleExit} />
        </div>
        {source?.showParticipantsPanel === false ? null : (
          <MeetingParticipantsPanel meeting={meeting} onMeetingChange={(patch) => setMeeting((prev) => (prev ? { ...prev, ...patch } : prev))} />
        )}
      </div>
    );
  } else if (meeting) {
    const startsMs = new Date(meeting.startsAt).getTime();
    const opensAt = startsMs - MEETING_JOIN_LEAD_MS;
    const open = isInJoinWindow(meeting.startsAt, meeting.endsAt, now);
    content = (
      <div className="mx-auto max-w-xl space-y-5" data-testid="host-room-prejoin">
        <div className="space-y-3 rounded-[var(--site-radius)] border border-border bg-surface p-6 text-center">
          <h1 className="font-heading text-xl font-semibold text-foreground">
            <bdi>{meeting.title}</bdi>
          </h1>
          {message && <Alert variant="error">{message}</Alert>}
          {!open && now < opensAt && (
            <div className="space-y-1" data-testid="host-room-countdown">
              <p className="text-sm text-foreground/70">{fmt(t.hostRoomOpensAt, { time: formatMeetingClock(new Date(opensAt).toISOString(), lang) })}</p>
              <p className="text-lg font-semibold tabular-nums text-foreground">
                <span dir="ltr">{formatCountdown(opensAt - now)}</span>
              </p>
            </div>
          )}
          <Button type="button" onClick={() => void join()} loading={joining} disabled={!open} data-testid="host-room-join">
            {t.hostRoomJoin}
          </Button>
        </div>
        {open && (
          <div dir="ltr">
            <PrejoinDeviceCheck handleRef={prejoinRef} />
          </div>
        )}
        <div className="text-center">{backAction}</div>
      </div>
    );
  } else {
    content = null;
  }

  return (
    <div dir={localeDirection(lang)} className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {content}
    </div>
  );
}
