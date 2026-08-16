import type { OutboundWebhookStatus, WebhookDeliveryErrorCode, WebhookDeliveryStatus } from "@/lib/api/types";

export const WEBHOOK_STATUS_LABELS: Record<OutboundWebhookStatus, string> = {
  ACTIVE: "Aktif",
  PAUSED: "Duraklatıldı",
  DISABLED: "Otomatik devre dışı",
};

export const WEBHOOK_STATUS_TONES: Record<OutboundWebhookStatus, "success" | "warning" | "danger"> = {
  ACTIVE: "success",
  PAUSED: "warning",
  DISABLED: "danger",
};

export const WEBHOOK_DELIVERY_STATUS_LABELS: Record<WebhookDeliveryStatus, string> = {
  PENDING: "Bekliyor",
  SENDING: "Gönderiliyor",
  RETRYING: "Yeniden deneniyor",
  SUCCEEDED: "Başarılı",
  FAILED: "Başarısız",
};

export const WEBHOOK_DELIVERY_STATUS_TONES: Record<WebhookDeliveryStatus, "neutral" | "primary" | "warning" | "success" | "danger"> = {
  PENDING: "neutral",
  SENDING: "primary",
  RETRYING: "warning",
  SUCCEEDED: "success",
  FAILED: "danger",
};

export const WEBHOOK_DELIVERY_ERROR_LABELS: Record<WebhookDeliveryErrorCode, string> = {
  timeout: "Zaman aşımı",
  dns_failure: "DNS çözümleme hatası",
  connection_refused: "Bağlantı reddedildi",
  tls_error: "TLS hatası",
  redirect_not_followed: "Yönlendirme takip edilmedi",
  ssrf_blocked: "Güvenlik: hedef adres reddedildi",
  http_error: "HTTP hatası",
  unknown: "Bilinmeyen hata",
};
