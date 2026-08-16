import type { WebhookEvent } from "@prisma/client";

/**
 * §10.13.10 — `GET /admin/settings/webhooks/events` bu statik registry'den beslenir (DB tablosu
 * DEĞİLDİR) — `lib/permissions-matrix.ts`/`lib/module-registry.ts` ile AYNI desen. Frontend olay
 * listesini/etiketlerini HARDCODE ETMEZ, buradan okur.
 */
export interface WebhookEventDefinition {
  event: WebhookEvent;
  label: string;
  description: string;
  /** `ORDER_*` → true. Arayüz bu bayrağa göre KVKK uyarısı gösterir (§10.13.10). */
  containsPii: boolean;
  /** `data` şemasının referans adı — yalnızca dokümantasyon amaçlı. */
  payloadSchema: string | null;
}

export const WEBHOOK_EVENT_REGISTRY: WebhookEventDefinition[] = [
  {
    event: "PING",
    label: "Test (ping)",
    description: "Yalnızca test gönderimi (POST .../test) ile üretilir, gerçek bir olay değildir.",
    containsPii: false,
    payloadSchema: null,
  },
  {
    event: "PAGE_PUBLISHED",
    label: "Sayfa yayınlandı",
    description: "Bir sayfa ilk kez PUBLISHED durumuna geçtiğinde tetiklenir.",
    containsPii: false,
    payloadSchema: "PublicPage",
  },
  {
    event: "BLOG_POST_PUBLISHED",
    label: "Blog yazısı yayınlandı",
    description: "Bir blog yazısı ilk kez PUBLISHED durumuna geçtiğinde tetiklenir.",
    containsPii: false,
    payloadSchema: "PublicBlogPost",
  },
  {
    event: "BLOG_POST_UPDATED",
    label: "Blog yazısı güncellendi",
    description: "Yayındaki bir blog yazısının içeriği değiştiğinde tetiklenir.",
    containsPii: false,
    payloadSchema: "PublicBlogPost",
  },
  {
    event: "PRODUCT_CREATED",
    label: "Ürün oluşturuldu",
    description: "Yeni bir ürün oluşturulduğunda tetiklenir.",
    containsPii: false,
    payloadSchema: "PublicProduct",
  },
  {
    event: "PRODUCT_UPDATED",
    label: "Ürün güncellendi",
    description: "Bir ürün güncellendiğinde tetiklenir.",
    containsPii: false,
    payloadSchema: "PublicProduct",
  },
  {
    event: "PRODUCT_DELETED",
    label: "Ürün silindi",
    description: "Bir ürün kalıcı olarak silindiğinde tetiklenir.",
    containsPii: false,
    payloadSchema: null,
  },
  {
    event: "PORTFOLIO_ITEM_PUBLISHED",
    label: "Portföy öğesi yayınlandı",
    description: "Bir portföy öğesi ilk kez PUBLISHED durumuna geçtiğinde tetiklenir.",
    containsPii: false,
    payloadSchema: "PublicPortfolioItem",
  },
  {
    event: "ORDER_CREATED",
    label: "Sipariş oluşturuldu",
    description: "Bir müşteri checkout oturumu başlattığında (PENDING sipariş) tetiklenir.",
    containsPii: true,
    payloadSchema: "WebhookOrderPayload",
  },
  {
    event: "ORDER_PAID",
    label: "Sipariş ödendi",
    description: "Bir siparişin ödemesi Stripe tarafından onaylandığında tetiklenir.",
    containsPii: true,
    payloadSchema: "WebhookOrderPayload",
  },
  {
    event: "ORDER_STATUS_CHANGED",
    label: "Sipariş durumu değişti",
    description: "Bir siparişin durumu (ör. FULFILLED, REFUNDED) değiştiğinde tetiklenir.",
    containsPii: true,
    payloadSchema: "WebhookOrderPayload",
  },
];

/** `events` gövdesinde gönderilebilecek abonelik değerleri — `PING` HARİÇ (gerçek bir olay değil, §10.13.10). */
export const SUBSCRIBABLE_WEBHOOK_EVENTS: WebhookEvent[] = WEBHOOK_EVENT_REGISTRY.filter((e) => e.event !== "PING").map(
  (e) => e.event
);

export function isEventPii(event: WebhookEvent): boolean {
  return WEBHOOK_EVENT_REGISTRY.find((e) => e.event === event)?.containsPii ?? false;
}
