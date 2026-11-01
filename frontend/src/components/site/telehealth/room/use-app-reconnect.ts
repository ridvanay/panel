"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { classifyConnectionError, isTerminalFailure, warnRaw, type ConnectionFailureKind } from "./connection-errors";

/**
 * Paket AF (İş 4) — UYGULAMA düzeyi yeniden bağlanma durum makinesi. SDK'nın kendi yeniden bağlanması (ICE restart /
 * resume, ~45-50 sn) BUNUN ALTINDADIR ve değişmez; SDK pes edip `Disconnected` verdiğinde bu devreye girer.
 *
 *   idle ──(kopma: CLIENT_INITIATED / DUPLICATE_IDENTITY dışı)──▶ waiting(n) ──(2 s / 5 s / 10 s)──▶ fetching(n)
 *   fetching(n) ──(token alındı)──▶ çağıran yeni <LiveKitRoom key={token}> kurar ──(Connected)──▶ idle
 *   fetching(n) ──(token hatası / bağlanamama)──▶ waiting(n+1) … n = 3 tükenince ▶ failed(neden)
 *   token 401/403/404/409 ──▶ failed(neden)  (yeniden denemek işe yaramaz)
 *   *  ──(DUPLICATE_IDENTITY)──▶ duplicate   (kendiliğinden deneme YOK; "Burada devam et")
 *   failed ──("Yeniden bağlan": sayaç sıfırlanır, beklemesiz)──▶ fetching(1)
 *   Connected 60 sn KESİNTİSİZ sürerse deneme sayacı sıfırlanır (hak yenilenir).
 *
 * Token ucunun hız sınırı 10/dk: en fazla 3 ardışık deneme + artan bekleme bunun çok altında kalır.
 */
export const RECONNECT_DELAYS_MS = [2_000, 5_000, 10_000] as const;
export const MAX_RECONNECT_ATTEMPTS = RECONNECT_DELAYS_MS.length;
export const STABLE_CONNECTION_MS = 60_000;

/** `DisconnectReason`'ın bu akış için anlamlı üç kümesi (eşleme `disconnect-kind.ts`'te; SDK enum'una burada bağımlı kalınmaz). */
export type DisconnectKind = "client" | "duplicate" | "other";

export type ReconnectPhase =
  | { status: "idle" }
  | { status: "waiting"; attempt: number }
  | { status: "fetching"; attempt: number }
  | { status: "failed"; kind: ConnectionFailureKind }
  | { status: "duplicate" };

export interface UseAppReconnectOptions<T> {
  /** Yeni katılım token'ı iste (hasta/doktor: `requestMeetingToken`; tercüman: `requestInterpreterToken`). */
  fetchToken: () => Promise<T>;
  /** Taze token geldi — çağıran `<LiveKitRoom key={token}>`'u yeniden kurar. */
  onToken: (token: T) => void;
  /** Bu ayrılış nedeniyle KENDİLİĞİNDEN yeniden bağlanılmaz (ör. tercümanın odadan çıkarılması). */
  isTerminalReason?: (reason: number | undefined) => boolean;
  /** "Başarısız" ekranına düşüldüğünde bir kez (ör. tercümanın ayrılış kaydı). */
  onGiveUp?: () => void;
}

/** `user-left`: kullanıcı kendi ayrıldı; `recovering`: kurtarma/ekran durumu devraldı; `terminal`: çağıran kendi akışını yürütsün. */
export type DisconnectOutcome = "user-left" | "recovering" | "terminal";

export interface AppReconnect {
  phase: ReconnectPhase;
  isRecovering: boolean;
  /** `LiveKitRoom.onDisconnected(reason)`; `kind` = `disconnectKind(reason)`. */
  handleDisconnected: (kind: DisconnectKind, reason?: number) => DisconnectOutcome;
  /**
   * `LiveKitRoom.onError` (bağlantı kurulamadı). Kurtarma sürerken `true` döner (işlendi: sonraki deneme planlandı ya da
   * zaten planlı); `false` → bu bir İLK KATILIM hatası, çağıran kendi ekranına dönsün.
   */
  handleConnectFailure: (err: unknown) => boolean;
  /** `useConnectionState()`: Connected → 60 sn hak yenileme zamanlayıcısı; başka durum → iptal. */
  handleConnectionState: (connected: boolean) => void;
  retry: () => void;
  takeOver: () => void;
  reset: () => void;
}

export function useAppReconnect<T>(options: UseAppReconnectOptions<T>): AppReconnect {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const [phase, setPhaseState] = useState<ReconnectPhase>({ status: "idle" });
  const phaseRef = useRef<ReconnectPhase>({ status: "idle" });
  const attemptsRef = useRef(0);
  const delayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Token isteği uçuşta mı. */
  const tokenPendingRef = useRef(false);
  /** Her yeni plan/istek/sıfırlama/unmount'ta artar — eski zamanlayıcı ve isteklerin sonucu yok sayılır. */
  const epochRef = useRef(0);
  const mountedRef = useRef(true);
  const scheduleNextRef = useRef<(kind: ConnectionFailureKind) => void>(() => {});

  const setPhase = useCallback((next: ReconnectPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const clearDelay = useCallback(() => {
    if (delayTimerRef.current) clearTimeout(delayTimerRef.current);
    delayTimerRef.current = null;
  }, []);
  const clearStable = useCallback(() => {
    if (stableTimerRef.current) clearTimeout(stableTimerRef.current);
    stableTimerRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      epochRef.current += 1;
      clearDelay();
      clearStable();
    };
  }, [clearDelay, clearStable]);

  const giveUp = useCallback(
    (kind: ConnectionFailureKind) => {
      clearDelay();
      clearStable();
      tokenPendingRef.current = false;
      setPhase({ status: "failed", kind });
      optionsRef.current.onGiveUp?.();
    },
    [clearDelay, clearStable, setPhase]
  );

  const runFetch = useCallback(
    (attempt: number) => {
      const epoch = ++epochRef.current;
      tokenPendingRef.current = true;
      setPhase({ status: "fetching", attempt });
      optionsRef.current
        .fetchToken()
        .then((token) => {
          if (!mountedRef.current || epoch !== epochRef.current) return;
          tokenPendingRef.current = false;
          optionsRef.current.onToken(token);
        })
        .catch((err: unknown) => {
          if (!mountedRef.current || epoch !== epochRef.current) return;
          tokenPendingRef.current = false;
          warnRaw("reconnect token request failed", err);
          const kind = classifyConnectionError(err);
          if (isTerminalFailure(kind)) giveUp(kind);
          else scheduleNextRef.current(kind);
        });
    },
    [giveUp, setPhase]
  );

  const scheduleNext = useCallback(
    (lastKind: ConnectionFailureKind) => {
      clearDelay();
      clearStable();
      if (attemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
        giveUp(lastKind === "generic" ? "unreachable" : lastKind);
        return;
      }
      const attempt = ++attemptsRef.current;
      setPhase({ status: "waiting", attempt });
      const epoch = ++epochRef.current;
      delayTimerRef.current = setTimeout(() => {
        delayTimerRef.current = null;
        if (!mountedRef.current || epoch !== epochRef.current) return;
        runFetch(attempt);
      }, RECONNECT_DELAYS_MS[attempt - 1]);
    },
    [clearDelay, clearStable, giveUp, runFetch, setPhase]
  );
  useEffect(() => {
    scheduleNextRef.current = scheduleNext;
  }, [scheduleNext]);

  const handleDisconnected = useCallback(
    (kind: DisconnectKind, reason?: number): DisconnectOutcome => {
      const current = phaseRef.current;
      if (kind === "client") {
        // Kurtarma sürerken gelen istemci kaynaklı kapanış (eski odanın söküm olayı) kullanıcının ayrılışı DEĞİLDİR.
        return current.status === "idle" ? "user-left" : "recovering";
      }
      if (kind === "duplicate") {
        clearDelay();
        clearStable();
        tokenPendingRef.current = false;
        epochRef.current += 1;
        setPhase({ status: "duplicate" });
        return "recovering";
      }
      if (optionsRef.current.isTerminalReason?.(reason)) return "terminal";
      // Aynı kopmanın çift olayı: zaten bekleme/istek/son durumdaysak yeniden planlanmaz.
      if (current.status === "waiting" || current.status === "failed" || current.status === "duplicate" || tokenPendingRef.current) {
        return "recovering";
      }
      scheduleNext("unreachable");
      return "recovering";
    },
    [clearDelay, clearStable, scheduleNext, setPhase]
  );

  const handleConnectFailure = useCallback(
    (err: unknown): boolean => {
      const current = phaseRef.current;
      if (current.status === "idle") return false;
      if (current.status === "fetching" && !tokenPendingRef.current) {
        warnRaw("reconnect connect failed", err);
        scheduleNext(classifyConnectionError(err));
      }
      return true;
    },
    [scheduleNext]
  );

  const handleConnectionState = useCallback(
    (connected: boolean) => {
      if (!connected) {
        clearStable();
        return;
      }
      clearDelay();
      if (phaseRef.current.status !== "idle") setPhase({ status: "idle" });
      if (!stableTimerRef.current) {
        stableTimerRef.current = setTimeout(() => {
          stableTimerRef.current = null;
          attemptsRef.current = 0;
        }, STABLE_CONNECTION_MS);
      }
    },
    [clearDelay, clearStable, setPhase]
  );

  const retry = useCallback(() => {
    clearDelay();
    clearStable();
    attemptsRef.current = 1;
    runFetch(1);
  }, [clearDelay, clearStable, runFetch]);

  const takeOver = useCallback(() => {
    clearDelay();
    clearStable();
    runFetch(0);
  }, [clearDelay, clearStable, runFetch]);

  const reset = useCallback(() => {
    clearDelay();
    clearStable();
    epochRef.current += 1;
    tokenPendingRef.current = false;
    attemptsRef.current = 0;
    setPhase({ status: "idle" });
  }, [clearDelay, clearStable, setPhase]);

  return useMemo(
    () => ({
      phase,
      isRecovering: phase.status !== "idle",
      handleDisconnected,
      handleConnectFailure,
      handleConnectionState,
      retry,
      takeOver,
      reset,
    }),
    [phase, handleDisconnected, handleConnectFailure, handleConnectionState, retry, takeOver, reset]
  );
}
