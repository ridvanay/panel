"use client";

import { useEffect, useState } from "react";
import { Languages } from "lucide-react";
import { usePortalStrings } from "@/lib/i18n/use-portal-strings";
import { getAppointmentInterpreter } from "@/lib/api/interpreter";
import type { AppointmentInterpreterInfo } from "@/lib/api/types";

/**
 * Paket AA — görüşme odasına girişte tek satır bilgi: "Bu görüşmeye bir tercüman katılıyor." (9 dil).
 * Atama yoksa hiçbir şey render edilmez; istek başarısız olursa da sessiz kalır (oda akışı etkilenmez).
 */
export function InterpreterPreJoinNotice({ appointmentId, accessToken }: { appointmentId: string; accessToken?: string }) {
  const { t } = usePortalStrings();
  const [info, setInfo] = useState<AppointmentInterpreterInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAppointmentInterpreter(appointmentId, accessToken)
      .then((result) => {
        if (!cancelled) setInfo(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [appointmentId, accessToken]);

  if (!info) return null;
  return (
    <p data-testid="interpreter-prejoin-notice" className="mt-2 flex items-center gap-2 text-sm text-foreground/80">
      <Languages className="h-4 w-4 shrink-0 text-[var(--site-primary)]" aria-hidden="true" />
      <span>
        {t.interpreter.preJoinNotice} (<bdi>{info.languageName}</bdi> · <bdi>{info.displayName}</bdi>)
      </span>
    </p>
  );
}
