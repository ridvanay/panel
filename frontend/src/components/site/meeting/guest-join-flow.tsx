"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Ban, CalendarClock, DoorClosed, Hourglass, LogOut, ShieldCheck, Users } from "lucide-react";
import { ApiClientError } from "@/lib/api/error";
import { guestJoin, guestPreflight, type GuestJoinResponse, type GuestPreflight } from "@/lib/api/meetings";
import type { MeetingTokenResponse } from "@/lib/api/types";
import { useActiveLocaleCode } from "@/context/locale-alternates-context";
import { localeDirection } from "@/lib/i18n/locale-direction";
import { fmt, meetingErrorMessage, useMeetingStrings } from "@/lib/i18n/use-meeting-strings";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { PrejoinDeviceCheck, type PrejoinCheckHandle } from "@/components/site/telehealth/room/prejoin-device-check";
import { MeetingNotice, MeetingRoom, type MeetingExitReason } from "./meeting-room";
import { validateGuestName, type GuestNameProblem } from "./guest-name";
import { formatCountdown, formatMeetingClock, MEETING_JOIN_LEAD_MS } from "./meeting-time";

/** Misafir belirteci biçimi (sunucu: `^mg_[A-Za-z0-9_-]{43}$`). */
const TOKEN_PATTERN = /^mg_[A-Za-z0-9_-]{43}$/;

/** Sekme gizliyken yoklama aralığı (tasarım §8.4: 5 sn → 15 sn). */
const HIDDEN_POLL_MS = 15_000;
const DEFAULT_POLL_MS = 5_000;

/**
 * Adres çubuğundaki `#mg_…` parçasını okur ve geçmişten SİLER (belirteç URL'de, Referer'da ve geçmişte kalmaz).
 * Parça sunucuya zaten gitmez; belirteç yalnızca POST gövdesinde taşınır.
 */
export function takeTokenFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw) return null;
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  return raw;
}

type Stage =
  | { kind: "checking" }
  | { kind: "invalid" }
  | { kind: "error"; message: string }
  | { kind: "upcoming" }
  | { kind: "name"; message?: string }
  | { kind: "joining" }
  | { kind: "waiting"; pollMs: number }
  | { kind: "full" }
  | { kind: "room"; token: MeetingTokenResponse }
  | { kind: "ended" }
  | { kind: "removed" }
  | { kind: "left" };

function nameProblemMessage(problem: GuestNameProblem, t: ReturnType<typeof useMeetingStrings>["t"]): string {
  switch (problem) {
    case "tooShort":
      return t.nameErrShort;
    case "tooLong":
      return t.nameErrLong;
    case "reservedPrefix":
      return t.nameErrReserved;
    default:
      return t.nameErrChars;
  }
}

function opensAtFromError(err: ApiClientError): string | null {
  const raw = (err.details as Record<string, unknown> | undefined)?.opensAt;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : null;
}

function UpcomingScreen({ startsAt, onOpen, isServiceConsultation }: { startsAt: string; onOpen: () => void; isServiceConsultation: boolean }) {
  const { t, lang } = useMeetingStrings();
  const opensAt = new Date(startsAt).getTime() - MEETING_JOIN_LEAD_MS;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const open = !Number.isNaN(opensAt) && now >= opensAt;
  useEffect(() => {
    if (open) onOpen();
  }, [open, onOpen]);
  return (
    <MeetingNotice
      testId="guest-upcoming"
      icon={<CalendarClock className="h-9 w-9" />}
      title={fmt(t.guestUpcomingTitle, { time: formatMeetingClock(startsAt, lang) })}
      body={t.guestUpcomingBody}
      actions={
        <>
          {isServiceConsultation && (
            <div className="w-full space-y-1.5 text-xs text-foreground/70" data-testid="guest-purpose-notes-upcoming">
              <p className="text-sm font-semibold text-foreground" data-testid="guest-purpose-title-upcoming">
                {t.guestPurposeTitle}
              </p>
              <p>{t.guestPurposeIntermediary}</p>
              <p>{t.guestPurposeNotice}</p>
            </div>
          )}
          <p className="text-sm font-semibold tabular-nums text-foreground" aria-live="off" data-testid="guest-countdown">
            <span dir="ltr">{fmt(t.guestUpcomingOpensIn, { time: formatCountdown(opensAt - now) })}</span>
          </p>
        </>
      }
    />
  );
}

/**
 * Paket AG İş 3 — misafir giriş akışı (`/{lang}/meet/join#mg_…`, oturum gerekmez). Belirteç URL parçasından okunup adres
 * çubuğundan silinir; uçlar YALNIZCA tarayıcıdan çağrılır (SSR ortak oran sınırı kovasına düşmesin). Geçersiz, süresi
 * dolmuş ve iptal edilmiş bağlantılar TEK tip "bağlantı geçersiz" ekranı gösterir (neden belirtilmez).
 */
export function GuestJoinFlow() {
  const { t, lang } = useMeetingStrings();
  const activeLang = useActiveLocaleCode();
  const dir = localeDirection(activeLang);
  const [stage, setStage] = useState<Stage>({ kind: "checking" });
  const [info, setInfo] = useState<GuestPreflight | null>(null);
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);

  // Belirteç ve oturum yalnızca bellekte (state'e/URL'ye yazılmaz). StrictMode'un çift efektinde parça ilkinde okunup silinir.
  const tokenRef = useRef<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const nameRef = useRef<string>("");
  const prejoinRef = useRef<PrejoinCheckHandle | null>(null);
  const startedRef = useRef(false);

  const runPreflight = useCallback(async () => {
    const token = tokenRef.current;
    if (!token || !TOKEN_PATTERN.test(token)) {
      setStage({ kind: "invalid" });
      return;
    }
    setStage({ kind: "checking" });
    try {
      const result = await guestPreflight(token);
      setInfo(result);
      setStage(result.phase === "upcoming" && Date.now() < new Date(result.startsAt).getTime() - MEETING_JOIN_LEAD_MS ? { kind: "upcoming" } : { kind: "name" });
    } catch (err) {
      if (err instanceof ApiClientError && (err.status === 404 || err.code === "MEETING_LINK_INVALID")) {
        setStage({ kind: "invalid" });
      } else {
        setStage({ kind: "error", message: meetingErrorMessage(err, t) });
      }
    }
  }, [t]);

  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      tokenRef.current = takeTokenFromLocation();
    }
    void runPreflight();
    // Yalnızca bağlandığında bir kez: dil değişimi preflight'ı yeniden çalıştırmasın.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** `join` yanıtını sahneye çevirir (ilk giriş, yoklama ve yeniden katılım için ortak). */
  const applyJoinResult = useCallback((res: GuestJoinResponse) => {
    sessionRef.current = res.guestSession;
    if (res.status === "waiting") {
      setStage({ kind: "waiting", pollMs: Math.max(1, res.pollAfterSec ?? 5) * 1000 });
      return;
    }
    prejoinRef.current?.stop();
    setStage({ kind: "room", token: { token: res.token, serverUrl: res.serverUrl, roomName: res.roomName, expiresAt: res.expiresAt } });
  }, []);

  /** `join` hatası → sahne. `polling` iken geçici hatalar (429/ağ) sahneyi bozmaz. */
  const applyJoinError = useCallback(
    (err: unknown, polling: boolean): boolean => {
      if (err instanceof ApiClientError) {
        if (err.status === 404 || err.code === "MEETING_LINK_INVALID") {
          prejoinRef.current?.stop();
          setStage({ kind: "invalid" });
          return true;
        }
        if (err.code === "MEETING_FULL") {
          prejoinRef.current?.stop();
          setStage({ kind: "full" });
          return true;
        }
        if (err.code === "MEETING_NOT_OPEN") {
          const opensAt = opensAtFromError(err);
          if (opensAt) setInfo((prev) => (prev ? { ...prev, startsAt: new Date(new Date(opensAt).getTime() + MEETING_JOIN_LEAD_MS).toISOString(), phase: "upcoming" } : prev));
          setStage({ kind: "upcoming" });
          return true;
        }
        if (polling && (err.status === 429 || err.status === 0 || err.status >= 500)) return false;
      } else if (polling) {
        return false;
      }
      setStage({ kind: "name", message: meetingErrorMessage(err, t) });
      return true;
    },
    [t]
  );

  const join = useCallback(
    async (withName: string | null) => {
      const token = tokenRef.current;
      if (!token) {
        setStage({ kind: "invalid" });
        return;
      }
      setStage({ kind: "joining" });
      try {
        const res = await guestJoin({
          t: token,
          ...(sessionRef.current ? { guestSession: sessionRef.current } : { name: withName ?? nameRef.current }),
        });
        applyJoinResult(res);
      } catch (err) {
        applyJoinError(err, false);
      }
    },
    [applyJoinResult, applyJoinError]
  );

  // Bekleme: ev sahibi gelene kadar 5 sn'de bir yoklar (sekme gizliyken 15 sn).
  const waitingPollMs = stage.kind === "waiting" ? stage.pollMs : null;
  useEffect(() => {
    if (waitingPollMs === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
      timer = setTimeout(() => void tick(), hidden ? Math.max(HIDDEN_POLL_MS, waitingPollMs) : waitingPollMs || DEFAULT_POLL_MS);
    };
    const tick = async () => {
      const token = tokenRef.current;
      if (!token || !sessionRef.current) return;
      try {
        const res = await guestJoin({ t: token, guestSession: sessionRef.current });
        if (cancelled) return;
        if (res.status === "waiting") schedule();
        else applyJoinResult(res);
      } catch (err) {
        if (cancelled) return;
        if (!applyJoinError(err, true)) schedule();
      }
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [waitingPollMs, applyJoinResult, applyJoinError]);

  const reconnectToken = useCallback(async (): Promise<MeetingTokenResponse> => {
    const token = tokenRef.current;
    const session = sessionRef.current;
    if (!token || !session) throw new ApiClientError(404, { code: "MEETING_LINK_INVALID", message: "invalid" });
    const res = await guestJoin({ t: token, guestSession: session });
    if (res.status === "ready") return { token: res.token, serverUrl: res.serverUrl, roomName: res.roomName, expiresAt: res.expiresAt };
    // Ev sahibi odada değilken yeniden bağlanma bekleme kapısına takılır → kurtarma "yeniden dene" ekranına düşer.
    throw new ApiClientError(409, { code: "MEETING_NOT_OPEN", message: "waiting" });
  }, []);

  function handleExit(reason: MeetingExitReason, detail?: string) {
    if (reason === "failed") setStage({ kind: "name", message: detail ?? t.errGeneric });
    else setStage({ kind: reason });
  }

  function submitName() {
    setTouched(true);
    const result = validateGuestName(name);
    if (!result.ok) return;
    nameRef.current = result.value;
    prejoinRef.current?.stop();
    void join(result.value);
  }

  const nameResult = validateGuestName(name);
  const nameError = touched && !nameResult.ok ? nameProblemMessage(nameResult.reason, t) : undefined;

  const isServiceConsultation = info?.purpose === "service_consultation";
  const showForm = stage.kind === "name" || stage.kind === "joining";
  const showWaiting = stage.kind === "waiting";

  let content: ReactNode;
  if (stage.kind === "checking") {
    content = (
      <div role="status" className="flex items-center justify-center gap-3 py-16 text-sm text-foreground/70" data-testid="guest-checking">
        <Spinner className="h-5 w-5" />
        {t.guestChecking}
      </div>
    );
  } else if (stage.kind === "invalid") {
    content = <MeetingNotice testId="guest-invalid" icon={<Ban className="h-9 w-9" />} title={t.guestInvalidTitle} body={t.guestInvalidBody} />;
  } else if (stage.kind === "error") {
    content = (
      <MeetingNotice
        testId="guest-error"
        icon={<Ban className="h-9 w-9" />}
        title={stage.message}
        actions={
          <Button type="button" variant="outline" onClick={() => void runPreflight()}>
            {t.retry}
          </Button>
        }
      />
    );
  } else if (stage.kind === "full") {
    content = <MeetingNotice testId="guest-full" icon={<Users className="h-9 w-9" />} title={t.guestFullTitle} body={t.guestFullBody} />;
  } else if (stage.kind === "ended") {
    content = <MeetingNotice testId="guest-ended" icon={<DoorClosed className="h-9 w-9" />} title={t.roomEndedTitle} body={t.roomEndedBody} />;
  } else if (stage.kind === "removed") {
    content = <MeetingNotice testId="guest-removed" icon={<LogOut className="h-9 w-9" />} title={t.roomRemovedTitle} body={t.roomRemovedBody} />;
  } else if (stage.kind === "left") {
    content = (
      <MeetingNotice
        testId="guest-left"
        icon={<LogOut className="h-9 w-9" />}
        title={t.roomLeftTitle}
        actions={
          <Button type="button" onClick={() => void join(null)}>
            {t.roomRejoin}
          </Button>
        }
      />
    );
  } else if (stage.kind === "upcoming" && info) {
    content = <UpcomingScreen startsAt={info.startsAt} onOpen={() => setStage({ kind: "name" })} isServiceConsultation={isServiceConsultation} />;
  } else if (stage.kind === "room" && info) {
    content = (
      <div dir="ltr">
        <MeetingRoom mode="guest" initialToken={stage.token} fetchToken={reconnectToken} endsAt={info.endsAt} onExit={handleExit} />
      </div>
    );
  } else if (showForm || showWaiting) {
    content = (
      <div className="mx-auto max-w-xl space-y-5">
        {showWaiting ? (
          <div role="status" className="space-y-3 rounded-[var(--site-radius)] border border-border bg-surface p-6 text-center" data-testid="guest-waiting">
            <Hourglass className="mx-auto h-9 w-9 text-foreground/50" aria-hidden="true" />
            <h1 className="font-heading text-lg font-semibold text-foreground">{isServiceConsultation ? t.guestPurposeWaitingTitle : t.guestWaitingTitle}</h1>
            <p className="text-sm text-foreground/70">{isServiceConsultation ? t.guestPurposeWaitingBody : t.guestWaitingBody}</p>
            {isServiceConsultation && (
              <p className="text-xs text-foreground/60" data-testid="guest-purpose-notice-waiting">
                {t.guestPurposeNotice}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                prejoinRef.current?.stop();
                setStage({ kind: "left" });
              }}
            >
              {t.guestWaitingLeave}
            </Button>
          </div>
        ) : (
          <form
            noValidate
            data-testid="guest-name-form"
            onSubmit={(e) => {
              e.preventDefault();
              submitName();
            }}
            className="space-y-4 rounded-[var(--site-radius)] border border-border bg-surface p-6"
          >
            <div className="space-y-1">
              <h1 className="font-heading text-xl font-semibold text-foreground">
                {isServiceConsultation ? t.guestPurposeTitle : <bdi>{info?.title ?? t.guestJoinTitle}</bdi>}
              </h1>
              {info?.hostName && <p className="text-sm text-foreground/70">{fmt(t.guestHostedBy, { host: info.hostName })}</p>}
            </div>
            {isServiceConsultation && (
              <div className="space-y-1.5 rounded-[var(--site-radius)] border border-border bg-background p-3 text-xs text-foreground/70" data-testid="guest-purpose-notes">
                <p>{t.guestPurposeIntermediary}</p>
                <p>{t.guestPurposeNotice}</p>
              </div>
            )}
            {stage.kind === "name" && stage.message && <Alert variant="error">{stage.message}</Alert>}
            <Field id="guest-name" label={t.guestNameLabel} hint={t.guestNameHint} error={nameError} required>
              {(inputProps) => (
                <Input
                  {...inputProps}
                  value={name}
                  maxLength={80}
                  autoComplete="name"
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setTouched(true)}
                />
              )}
            </Field>
            <p className="flex items-start gap-2 text-xs text-foreground/60" data-testid="guest-privacy">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {t.guestPrivacy}
            </p>
            <Button type="submit" loading={stage.kind === "joining"} className="w-full sm:w-auto" data-testid="guest-join">
              {t.guestJoinButton}
            </Button>
          </form>
        )}
        <div dir="ltr">
          <PrejoinDeviceCheck handleRef={prejoinRef} />
        </div>
      </div>
    );
  } else {
    content = null;
  }

  return (
    <div dir={dir} lang={activeLang} className="mx-auto max-w-5xl px-4 py-10 sm:px-6" data-lang={lang}>
      {content}
    </div>
  );
}
