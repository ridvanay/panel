import { ApiClientError } from "@/lib/api/error";
import type { ConsultationStrings } from "@/lib/i18n/site-dictionaries/en/consultation";

/**
 * Paket AF — bağlantı/medya/token hatalarının NEDENE göre sınıflandırılması. SDK'nın ham `err.message`
 * metni ASLA ekrana verilmez; yalnızca `console.warn` ile yazılır (`warnRaw`). Ekranda sözlükteki çevrilmiş
 * mesaj gösterilir.
 */
export type ConnectionFailureKind =
  | "unreachable"
  | "permission"
  | "notJoinable"
  | "mediaPermission"
  | "mediaNotFound"
  | "mediaInUse"
  | "media"
  | "generic";

/** Yeniden denemenin işe yaramayacağı (yetki/süre) nedenler — hemen "başarısız" ekranına gidilir. */
export function isTerminalFailure(kind: ConnectionFailureKind): boolean {
  return kind === "permission" || kind === "notJoinable";
}

// `livekit-client` `ConnectionErrorReason` sayısal değerleri (enum import edilmez; sabit kalıbı testlerde mock'lanabilir kalsın).
const REASON_NOT_ALLOWED = 0;
const REASON_SERVER_UNREACHABLE = 1;
const REASON_TIMEOUT = 5;
const REASON_WEBSOCKET = 6;

/** Token ucundan ya da SDK'dan gelen bir hatanın nedeni. */
export function classifyConnectionError(err: unknown): ConnectionFailureKind {
  if (err instanceof ApiClientError) {
    if (err.status === 401 || err.status === 403 || err.status === 404) return "permission";
    if (err.status === 409 || err.status === 410) return "notJoinable";
    if (err.status === 0 || err.code === "NETWORK_ERROR" || err.status >= 500) return "unreachable";
    return "generic";
  }
  if (err && typeof err === "object") {
    const e = err as { name?: unknown; reason?: unknown; status?: unknown; message?: unknown };
    if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError" || e.name === "SecurityError") return "mediaPermission";
    if (e.name === "NotFoundError" || e.name === "OverconstrainedError") return "mediaNotFound";
    if (e.name === "NotReadableError" || e.name === "AbortError") return "mediaInUse";
    if (typeof e.reason === "number") {
      if (e.reason === REASON_NOT_ALLOWED) return e.status === 409 || e.status === 410 ? "notJoinable" : "permission";
      if (e.reason === REASON_SERVER_UNREACHABLE || e.reason === REASON_TIMEOUT || e.reason === REASON_WEBSOCKET) return "unreachable";
    }
    if (typeof e.message === "string" && /failed to fetch|network|websocket|timed? ?out|unreachable|could not establish/i.test(e.message)) {
      return "unreachable";
    }
  }
  return "generic";
}

/** `MediaDeviceFailure` enum DEĞERİ (`livekit-client`: "PermissionDenied" | "NotFound" | "DeviceInUse" | "Other"). */
export function classifyMediaFailure(failure?: string): ConnectionFailureKind {
  switch (failure) {
    case "PermissionDenied":
      return "mediaPermission";
    case "NotFound":
      return "mediaNotFound";
    case "DeviceInUse":
      return "mediaInUse";
    default:
      return "media";
  }
}

export function failureMessage(kind: ConnectionFailureKind, t: ConsultationStrings): string {
  switch (kind) {
    case "unreachable":
      return t.errServerUnreachable;
    case "permission":
      return t.errPermission;
    case "notJoinable":
      return t.errNotJoinable;
    case "mediaPermission":
      return t.errMediaPermission;
    case "mediaNotFound":
      return t.errMediaNotFound;
    case "mediaInUse":
      return t.errMediaInUse;
    case "media":
      return t.errMediaGeneric;
    default:
      return t.errGeneric;
  }
}

/** Ham hata metni YALNIZCA konsola yazılır (ekrana asla). */
export function warnRaw(context: string, err: unknown): void {
  console.warn(`[consultation] ${context}`, err);
}
