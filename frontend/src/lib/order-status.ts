import type { OrderStatus } from "@/lib/api/types";

/**
 * Admin sipariş listesi/detayında VE storefront'ta (`/hesabim/siparislerim*`) ortak durum
 * etiketleri — CLAUDE.md "ortak terminoloji" kuralı gereği TEK sözlük, iki ayrı etiket seti
 * TUTULMAZ (bkz. `.claude/architect-scope-customer-portal.md` §6).
 */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "Ödeme Bekleniyor",
  PAID: "Hazırlanıyor",
  SHIPPED: "Kargoda",
  FULFILLED: "Teslim Edildi",
  FAILED: "Başarısız",
  CANCELLED: "İptal Edildi",
  EXPIRED: "Süresi Doldu",
  REFUNDED: "İade Edildi",
};

/**
 * `.claude/design-notes-customer-portal.md` §4 — `Badge` bileşeninin `Tone` union'ında `"info"`
 * YOKTUR; `SHIPPED` mevcut `"primary"` tonunu kullanır (yeni bir renk İCAT EDİLMEZ). `PAID`
 * tonu `success`→`warning` DEĞİŞTİ: "Hazırlanıyor" artık bitmiş bir eylem değil, sürüyor.
 */
export const ORDER_STATUS_TONE: Record<OrderStatus, "neutral" | "primary" | "success" | "danger" | "warning"> = {
  PENDING: "warning",
  PAID: "warning",
  SHIPPED: "primary",
  FULFILLED: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
  EXPIRED: "neutral",
  REFUNDED: "neutral",
};
