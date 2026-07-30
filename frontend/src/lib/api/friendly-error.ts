import { ApiClientError } from "./error";

/** Formlarda üst seviye hata mesajı olarak göstermek için: API hata mesajını, yoksa genel bir metni döner. */
export function friendlyErrorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  return "Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.";
}

/** VALIDATION_ERROR'daki `details` (alan adı -> mesaj listesi) zarfını form state'ine çevirir. */
export function fieldErrorsFrom(err: unknown): Record<string, string> {
  if (err instanceof ApiClientError && err.details) {
    const out: Record<string, string> = {};
    for (const [field, messages] of Object.entries(err.details)) {
      if (messages[0]) out[field] = messages[0];
    }
    return out;
  }
  return {};
}
