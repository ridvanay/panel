/**
 * `.claude/architect-scope-order-management-pro.md` §7.2 + `.claude/design-notes-order-management-pro.md`
 * §5.3 — `GET /admin/orders/{orderId}/activity`'nin dönebileceği `action` değerleri için TEK Türkçe
 * etiket sözlüğü (CLAUDE.md "ortak terminoloji" kuralı — durum etiketleri `order-status.ts`'te,
 * aktivite etiketleri burada, ikinci bir sözlük İCAT EDİLMEZ).
 *
 * Backend kaynağı: `logAudit(app, { action: "order.*", ... })` çağrıları
 * (`backend/src/modules/orders/orders.routes.ts`). Bilinmeyen bir `action` gelirse ham değer
 * fallback olarak basılır (savunmacı — backend'e ileride eklenecek bir aksiyon UI'ı kırmaz).
 */
export const ORDER_ACTIVITY_LABELS: Record<string, string> = {
  "order.status_change": "Durum değiştirildi",
  "order.update": "Sipariş güncellendi",
  "order.refund": "İade işlendi",
  "order.cancel_email": "İptal e-postası",
};

/**
 * `order.update` aktivitesinin `metadata.fields` dizisindeki alan adları için Türkçe etiket —
 * `.claude/architect-scope-order-management-pro.md` §5.3 `logAudit` metadata'sıyla BİREBİR aynı
 * alan adları. Bilinmeyen anahtar ham haliyle basılır.
 */
export const ORDER_UPDATE_FIELD_LABELS: Record<string, string> = {
  customerEmail: "E-posta",
  customerName: "Müşteri Adı",
  shippingAddress: "Teslimat Adresi",
  billing: "Fatura Bilgisi",
  adminNotes: "Dahili Not",
};
