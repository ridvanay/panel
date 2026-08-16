import type { ApiKeyScope, ApiKeyStatus } from "@/lib/api/types";

export const API_KEY_SCOPE_LABELS: Record<ApiKeyScope, string> = {
  READ: "Salt okunur",
  READ_WRITE: "Okuma + Yazma",
};

export const API_KEY_SCOPE_DESCRIPTIONS: Record<ApiKeyScope, string> = {
  READ: "Yalnızca genel API'den (/api/v1/public/*) veri okuyabilir.",
  READ_WRITE:
    "v1'de okuma anahtarından FARKLI bir davranış üretmez (genel API'de henüz yazma ucu yok) — ileride eklenecek yazma uçları için şimdiden ayrılmıştır.",
};

export const API_KEY_STATUS_LABELS: Record<ApiKeyStatus, string> = {
  ACTIVE: "Aktif",
  REVOKED: "İptal edildi",
};

export const API_KEY_STATUS_TONES: Record<ApiKeyStatus, "success" | "danger"> = {
  ACTIVE: "success",
  REVOKED: "danger",
};
