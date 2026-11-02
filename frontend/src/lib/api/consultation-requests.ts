import { apiFetch } from "./client";
import { ApiClientError } from "./error";

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

/** Paket AJ — tercih edilen iletişim kanalı. */
export const PREFERRED_CONTACT_CHANNELS = ["email", "whatsapp", "phone"] as const;
export type PreferredContactChannel = (typeof PREFERRED_CONTACT_CHANNELS)[number];

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
  /** Paket AJ — opsiyonel; eski backend alanı tanımıyorsa gönderim alansız bir kez tekrarlanır. */
  preferredContactChannel?: PreferredContactChannel | null;
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

/**
 * Yanıt `201 { data: { requestNumber } }` (PII yok); numara gelmezse boş string döner (başarı yine gösterilir).
 * Eski backend `preferredContactChannel` alanını reddederse (400/422) form bozulmasın diye alan atılıp bir kez
 * yeniden denenir.
 */
export async function submitConsultationRequest(body: ConsultationRequestBody): Promise<ConsultationRequestResult> {
  const post = (payload: ConsultationRequestBody) =>
    apiFetch<ConsultationRequestResult | undefined>("/consultation-requests", { method: "POST", body: payload });
  try {
    const result = await post(body);
    return { requestNumber: result?.requestNumber ?? "" };
  } catch (err) {
    const rejectedChannel =
      body.preferredContactChannel != null &&
      err instanceof ApiClientError &&
      (err.status === 400 || err.status === 422) &&
      (Boolean(err.details && "preferredContactChannel" in err.details) || /preferredContactChannel/i.test(err.message));
    if (!rejectedChannel) throw err;
    const withoutChannel: ConsultationRequestBody = { ...body };
    delete withoutChannel.preferredContactChannel;
    const result = await post(withoutChannel);
    return { requestNumber: result?.requestNumber ?? "" };
  }
}
