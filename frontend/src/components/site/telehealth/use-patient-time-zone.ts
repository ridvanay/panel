"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuthOptional } from "@/context/auth-context";
import * as usersApi from "@/lib/api/users";
import { getGeoHint, type GeoHint } from "@/lib/api/geo";
import { PATIENT_TIME_ZONE_STORAGE_KEY, browserTimeZone, isValidTimeZone } from "@/lib/dual-time";
import { countryForTimeZone, isAmbiguousTimeZone } from "@/lib/country-display";

/**
 * Paket R — hastanın görüntüleme dilimi. Öncelik:
 *   bu sayfada az önce yapılan seçim → giriş yapmış hastanın profili → bu tarayıcıda saklı seçim →
 *   tarayıcı dilimi (UTC/Etc/* değilse) → IP önerisi (`/geo/hint`) → (çağıran: doktor/Türkiye).
 * IP yalnızca ÖNERİDİR: tarayıcının ülkesi IP ülkesinden farklıysa `suggestion` döner, otomatik
 * değişiklik yapılmaz. Tarayıcı dilimi belirsizse (UTC/Etc/*) IP dilimi varsayılan olur (`source: "ip"`).
 * Mount öncesi (SSR) `timeZone` `undefined` — hidrasyon güvenli.
 */
export type PatientTimeZoneSource = "session" | "profile" | "stored" | "browser" | "ip";

export interface PatientTimeZoneState {
  timeZone: string | undefined;
  source: PatientTimeZoneSource | undefined;
  /** Tarayıcının bildirdiği dilim (belirsiz olsa da). */
  browserTimeZone: string | undefined;
  ipHint: GeoHint | null;
  /** Tarayıcı ülkesi ≠ IP ülkesi: "Konumunuz Almanya görünüyor…" önerisi. */
  suggestion: { timeZone: string; countryCode: string } | null;
  setPatientTimeZone: (timeZone: string) => void;
  /** "Hayır, şimdiki kalsın" — mevcut dilim saklanır, öneri bir daha gösterilmez. */
  keepCurrentTimeZone: () => void;
}

function readStored(): string | undefined {
  try {
    const value = window.localStorage.getItem(PATIENT_TIME_ZONE_STORAGE_KEY);
    return isValidTimeZone(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function usePatientTimeZoneState({ suggest = true }: { suggest?: boolean } = {}): PatientTimeZoneState {
  const auth = useAuthOptional();
  const user = auth?.user ?? null;
  const profileTimeZone = isValidTimeZone(user?.timeZone) ? user?.timeZone ?? undefined : undefined;
  const [client, setClient] = useState<{ mounted: boolean; browser?: string; stored?: string }>({ mounted: false });
  const [sessionChoice, setSessionChoice] = useState<string | undefined>(undefined);
  const [ipHint, setIpHint] = useState<GeoHint | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tarayıcı dilimi/localStorage yalnızca istemcide okunur (hidrasyon güvenli)
    setClient({ mounted: true, browser: browserTimeZone(), stored: readStored() });
  }, []);

  // IP önerisi yalnızca gerekiyorsa sorulur: profil/saklı seçim yoksa (öneri için) ya da tarayıcı dilimi belirsizse.
  const browserAmbiguous = client.mounted && isAmbiguousTimeZone(client.browser);
  const needsHint = client.mounted && !sessionChoice && ((suggest && !profileTimeZone && !client.stored) || browserAmbiguous);
  useEffect(() => {
    if (!needsHint) return;
    let cancelled = false;
    void getGeoHint().then((hint) => {
      if (!cancelled) setIpHint(hint);
    });
    return () => {
      cancelled = true;
    };
  }, [needsHint]);

  const ipTimeZone = ipHint?.timeZone && isValidTimeZone(ipHint.timeZone) ? ipHint.timeZone : undefined;
  let timeZone: string | undefined;
  let source: PatientTimeZoneSource | undefined;
  if (sessionChoice) [timeZone, source] = [sessionChoice, "session"];
  else if (profileTimeZone) [timeZone, source] = [profileTimeZone, "profile"];
  else if (client.stored) [timeZone, source] = [client.stored, "stored"];
  else if (client.browser && !browserAmbiguous) [timeZone, source] = [client.browser, "browser"];
  else if (ipTimeZone) [timeZone, source] = [ipTimeZone, "ip"];
  else if (client.browser) [timeZone, source] = [client.browser, "browser"];

  const browserCountry = countryForTimeZone(client.browser ?? null);
  const suggestion =
    suggest && source === "browser" && !browserAmbiguous && ipHint?.countryCode && ipTimeZone && browserCountry && browserCountry !== ipHint.countryCode
      ? { timeZone: ipTimeZone, countryCode: ipHint.countryCode }
      : null;

  const setPatientTimeZone = useCallback(
    (next: string) => {
      if (!isValidTimeZone(next)) return;
      setSessionChoice(next);
      try {
        window.localStorage.setItem(PATIENT_TIME_ZONE_STORAGE_KEY, next);
      } catch {
        // Gizli pencere / engelli depolama — seçim bu sayfada yine geçerli.
      }
      if (user && user.timeZone !== next) {
        // En iyi çaba: profil kaydı başarısız olsa da seçim tarayıcıda geçerli kalır.
        usersApi.updateMe({ timeZone: next }).catch(() => undefined);
      }
    },
    [user]
  );

  const keepCurrentTimeZone = useCallback(() => {
    if (timeZone) setPatientTimeZone(timeZone);
  }, [timeZone, setPatientTimeZone]);

  return { timeZone, source, browserTimeZone: client.browser, ipHint, suggestion, setPatientTimeZone, keepCurrentTimeZone };
}
