"use client";

import { useCallback } from "react";
import { useActiveLocaleCode } from "@/context/locale-alternates-context";
import { ApiClientError } from "@/lib/api/error";
import { meetingStrings as enMeeting, type MeetingStrings } from "./site-dictionaries/en/meeting";
import { meetingStrings as trMeeting } from "./site-dictionaries/tr/meeting";
import { meetingStrings as esMeeting } from "./site-dictionaries/es/meeting";
import { meetingStrings as deMeeting } from "./site-dictionaries/de/meeting";
import { meetingStrings as arMeeting } from "./site-dictionaries/ar/meeting";
import { meetingStrings as ruMeeting } from "./site-dictionaries/ru/meeting";
import { meetingStrings as roMeeting } from "./site-dictionaries/ro/meeting";
import { meetingStrings as frMeeting } from "./site-dictionaries/fr/meeting";
import { meetingStrings as srLatnMeeting } from "./site-dictionaries/sr-latn/meeting";

/** `{param}` yer tutucularını doldurur (diğer sözlük kancalarıyla aynı semantik). */
export function fmt(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
}

/** Paket AG İş 3 — harici toplantı metinleri (client); `use-contact-cta-strings.ts` ile aynı desen. */
export const MEETING_DICTIONARIES: Record<string, MeetingStrings> = {
  en: enMeeting,
  tr: trMeeting,
  es: esMeeting,
  de: deMeeting,
  ar: arMeeting,
  ru: ruMeeting,
  ro: roMeeting,
  fr: frMeeting,
  "sr-latn": srLatnMeeting,
};

/** Bağlam yoksa (admin paneli) etkin dil "tr" döner → yönetim ekranları Türkçe. Bilinmeyen dil İngilizceye düşer. */
export function useMeetingStrings(): { t: MeetingStrings; fmt: typeof fmt; lang: string } {
  const lang = useActiveLocaleCode();
  return { t: MEETING_DICTIONARIES[lang] ?? enMeeting, fmt, lang };
}

/** API hatası → çevrilmiş kısa mesaj (ham sunucu metni ekrana verilmez). */
export function meetingErrorMessage(err: unknown, t: MeetingStrings): string {
  if (!(err instanceof ApiClientError)) return t.errGeneric;
  const code = err.code as string;
  switch (code) {
    case "MEETING_HOST_FORBIDDEN":
    case "FORBIDDEN":
      return t.errForbidden;
    case "MEETING_NOT_FOUND":
    case "NOT_FOUND":
      return t.errNotFound;
    case "MEETING_NOT_EDITABLE":
      return t.errNotEditable;
    case "MEETING_LIMIT_REACHED":
      return t.errLimit;
    case "MEETING_NOT_OPEN":
      return t.errNotOpen;
    case "MEETING_HOST_NOT_ELIGIBLE":
      return t.errNotEligible;
    case "LIVEKIT_NOT_CONFIGURED":
      return t.errUnavailable;
    case "RATE_LIMITED":
      return t.errRate;
    case "NETWORK_ERROR":
      return t.errNetwork;
    case "VALIDATION_ERROR":
      return t.errValidation;
    default:
      return err.status === 503 ? t.errUnavailable : t.errGeneric;
  }
}

export function useMeetingErrorMessage(): (err: unknown) => string {
  const { t } = useMeetingStrings();
  return useCallback((err: unknown) => meetingErrorMessage(err, t), [t]);
}
