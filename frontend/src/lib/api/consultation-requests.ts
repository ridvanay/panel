import { apiFetch } from "./client";

/** Paket AH — talep formu iletişim dilleri (8 dil). `tr` ziyaretçiye kapalıdır. */
export const CONTACT_LANGUAGES = ["en", "de", "ar", "ru", "fr", "es", "ro", "sr-latn"] as const;
export type ContactLanguage = (typeof CONTACT_LANGUAGES)[number];

/** Dil seçicide gösterilen yerel adlar (dilin kendi yazılışı — çeviri gerektirmez). */
export const CONTACT_LANGUAGE_NATIVE_NAMES: Record<ContactLanguage, string> = {
  en: "English",
  de: "Deutsch",
  ar: "العربية",
  ru: "Русский",
  fr: "Français",
  es: "Español",
  ro: "Română",
  "sr-latn": "Srpski",
};

/** `POST /consultation-requests` gövdesi (AH-KONTRAT "Talep formu"). */
export interface ConsultationRequestBody {
  serviceSlug: string | null;
  packageSlug: string | null;
  preferredFrom: string | null;
  preferredTo: string | null;
  country: string;
  contactLanguage: ContactLanguage;
  needsInterpreter: boolean;
  fullName: string;
  email: string;
  phone: string | null;
  message: string | null;
  contactConsent: boolean;
  healthDataConsent: boolean;
  locale: string;
  /** Honeypot — insanlar doldurmaz. */
  website: string;
  /** Mevcut rıza altyapısının sürüm alanı varsa. */
  consentTextVersion?: string;
}

export interface ConsultationRequestResult {
  requestNumber: string;
}

/** Yanıt `201 { data: { requestNumber } }` (PII yok); numara gelmezse boş string döner (başarı yine gösterilir). */
export async function submitConsultationRequest(body: ConsultationRequestBody): Promise<ConsultationRequestResult> {
  const result = await apiFetch<ConsultationRequestResult | undefined>("/consultation-requests", { method: "POST", body });
  return { requestNumber: result?.requestNumber ?? "" };
}
