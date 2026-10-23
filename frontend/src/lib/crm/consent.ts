import { API_BASE_URL } from "@/lib/env";

/**
 * Paket N (2026-10-23) — çerez onayı (tarayıcı tarafı). Onay `localStorage`'da tutulur (zorunlu kategori:
 * yalnızca seçimin hatırlanması). Analitik/pazarlama VARSAYILAN KAPALI; sürüm değişirse eski onay geçersiz
 * sayılır ve bant yeniden görünür. Eski "gezinmeye devam ederek kabul" anahtarı geçerli onay DEĞİLDİR,
 * okunmaz ve ilk seçimde silinir.
 *
 * Sürüm backend `crm.settings.ts::CRM_CONSENT_VERSION` ile AYNI olmalı (test metin olarak karşılaştırır).
 */
export const CONSENT_VERSION = "2026-10-23";
export const CONSENT_STORAGE_KEY = "wm-consent";
/** Onay 12 ay geçerlidir; sonra bant yeniden gösterilir. */
export const CONSENT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const LEGACY_STORAGE_KEY = "cookie-consent-accepted";

/** Onay değişince (kaydet/geri al) yayılır — takip yükleyicisi dinler. */
export const CONSENT_CHANGED_EVENT = "wm-consent:changed";
/** Footer'daki "Çerez tercihleri" bağlantısı tercihler penceresini bu olayla açar. */
export const OPEN_CONSENT_PREFERENCES_EVENT = "wm-consent:open";

/** Takip modülünün tarayıcı anahtarları — analitik onayı geri alınınca silinir. */
export const TRACKER_STORAGE_KEYS = ["wmcrm_vid", "wmcrm_vid_at", "wmcrm_sid", "wmcrm_ref"] as const;
export const OPTOUT_STORAGE_KEY = "wmcrm_optout";
export const STAFF_STORAGE_KEY = "wmcrm_staff";

export type ConsentAction = "ACCEPT_ALL" | "REJECT_ALL" | "CUSTOM" | "WITHDRAW";

export interface ConsentState {
  v: string;
  /** Anonim onay kaydı kimliği (ispat kaydı için). */
  id: string;
  analytics: boolean;
  marketing: boolean;
  ts: number;
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // gizli pencere / engelli depolama — tercih bu oturumda hatırlanmaz
  }
}

function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // yok sayılır
  }
}

export function randomId(length = 22): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  return Array.from(bytes, (b) => alphabet[b & 63]).join("");
}

/** Geçerli (bu sürüme ait) onay; yoksa `null` → bant gösterilir. */
export function readConsent(): ConsentState | null {
  const raw = safeGet(CONSENT_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ConsentState>;
    if (parsed.v !== CONSENT_VERSION || typeof parsed.id !== "string") return null;
    if (typeof parsed.ts !== "number" || Date.now() - parsed.ts > CONSENT_MAX_AGE_MS) return null;
    return {
      v: parsed.v,
      id: parsed.id,
      analytics: parsed.analytics === true,
      // Pazarlama analitik olmadan anlamsızdır (gclid oturuma yazılır) — tek başına açık olamaz.
      marketing: parsed.analytics === true && parsed.marketing === true,
      ts: typeof parsed.ts === "number" ? parsed.ts : 0,
    };
  } catch {
    return null;
  }
}

export function hasAnalyticsConsent(): boolean {
  return readConsent()?.analytics === true;
}

/**
 * Seçimi kaydeder, onay kaydını sunucuya gönderir (reddetme dahil — hesap verebilirlik) ve olayı yayar.
 * Analitik kapandıysa takip anahtarları silinir; sunucu da o ziyaretçinin verisini siler.
 */
export function saveConsent(choice: { analytics: boolean; marketing: boolean }, action: ConsentAction, locale?: string): ConsentState {
  const previous = readConsent();
  const state: ConsentState = {
    v: CONSENT_VERSION,
    id: previous?.id ?? randomId(),
    analytics: choice.analytics,
    marketing: choice.analytics && choice.marketing,
    ts: Date.now(),
  };
  const visitorId = safeGet("wmcrm_vid");
  safeSet(CONSENT_STORAGE_KEY, JSON.stringify(state));
  safeRemove(LEGACY_STORAGE_KEY);
  if (!state.analytics) for (const key of TRACKER_STORAGE_KEYS) safeRemove(key);

  const body = JSON.stringify({
    cid: state.id,
    ...(visitorId ? { vid: visitorId } : {}),
    v: state.v,
    a: state.analytics,
    m: state.marketing,
    act: previous?.analytics && !state.analytics ? "WITHDRAW" : action,
    ...(locale ? { l: locale.slice(0, 10) } : {}),
  });
  try {
    void fetch(`${API_BASE_URL}/crm/consent`, {
      method: "POST",
      body,
      keepalive: true,
      credentials: "omit",
      headers: { "content-type": "text/plain;charset=UTF-8" },
    }).catch(() => {});
  } catch {
    // kayıt gönderilemezse seçim yine de geçerlidir
  }

  window.dispatchEvent(new CustomEvent(CONSENT_CHANGED_EVENT, { detail: state }));
  return state;
}

export function openConsentPreferences(): void {
  window.dispatchEvent(new CustomEvent(OPEN_CONSENT_PREFERENCES_EVENT));
}

/** `?crm_optout=1` → bu cihaz kalıcı olarak takip dışı; `?crm_optout=0` geri alır. */
export function applyOptOutFromUrl(search: string): void {
  const value = new URLSearchParams(search).get("crm_optout");
  if (value === "1") {
    safeSet(OPTOUT_STORAGE_KEY, "1");
    for (const key of TRACKER_STORAGE_KEYS) safeRemove(key);
  } else if (value === "0") {
    safeRemove(OPTOUT_STORAGE_KEY);
  }
}

export function isOptedOut(): boolean {
  return safeGet(OPTOUT_STORAGE_KEY) === "1";
}

/** Admin paneline personel olarak giriş yapılmış cihaz (admin kabuğu işaretler). */
export function isStaffDevice(): boolean {
  return safeGet(STAFF_STORAGE_KEY) === "1";
}

export function markStaffDevice(): void {
  safeSet(STAFF_STORAGE_KEY, "1");
}
