"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiClientError } from "@/lib/api/error";
import { getServiceConsultationSlots, type ServiceConsultationConfig } from "@/lib/api/service-consultations";
import type { AvailabilitySlot } from "@/lib/api/types";
import { addDaysToDateKey } from "@/lib/doctor-schedule";
import { formatDayKey } from "@/lib/telehealth-format";

export type ServiceSlotsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "unavailable" }
  | { status: "ready"; slots: AvailabilitySlot[] };

/**
 * Masa diliminde bugünden itibaren en fazla 30 gün ileriye ait uygun slotları yükler (`GET /service-consultations/slots`).
 * `SERVICE_NOT_BOOKABLE` → `unavailable`; başka hata → `error` (yeniden dene). `refresh()` yüklemeyi baştan başlatır
 * (örn. `SLOT_TAKEN` sonrası takvimi tazelemek için).
 */
export function useServiceSlots(config: Pick<ServiceConsultationConfig, "timeZone" | "horizonDays">): { state: ServiceSlotsState; refresh: () => void } {
  const [state, setState] = useState<ServiceSlotsState>({ status: "loading" });
  const { timeZone, horizonDays } = config;

  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const from = formatDayKey(new Date().toISOString(), timeZone);
    const to = addDaysToDateKey(from, Math.min(Math.max(horizonDays, 1), 30));
    getServiceConsultationSlots(from, to).then(
      (slots) => {
        if (!cancelled) setState({ status: "ready", slots });
      },
      (err: unknown) => {
        if (!cancelled) setState(err instanceof ApiClientError && err.code === "SERVICE_NOT_BOOKABLE" ? { status: "unavailable" } : { status: "error" });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [timeZone, horizonDays, nonce]);

  const refresh = useCallback(() => {
    setState({ status: "loading" });
    setNonce((n) => n + 1);
  }, []);

  return { state, refresh };
}
