import type { OrderStatus } from "@/lib/api/types";

/** Admin sipariş listesi/detayında ortak durum etiketleri — bkz. görev notu: PAID/FULFILLED yeşil,
 *  FAILED/CANCELLED/EXPIRED kırmızı/gri, PENDING sarı. */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "Beklemede",
  PAID: "Ödendi",
  FAILED: "Başarısız",
  CANCELLED: "İptal Edildi",
  EXPIRED: "Süresi Doldu",
  REFUNDED: "İade Edildi",
  FULFILLED: "Tamamlandı",
};

export const ORDER_STATUS_TONE: Record<OrderStatus, "neutral" | "success" | "danger" | "warning"> = {
  PENDING: "warning",
  PAID: "success",
  FULFILLED: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
  EXPIRED: "neutral",
  REFUNDED: "neutral",
};
