import { redirectVisitorToRequest } from "@/lib/request-redirect";

/**
 * Paket AH — /checkout/success ziyaretçiye kapalı: sepet, ödeme ve ödeme sonuç sayfaları talep formuna (`/request`) kalıcı
 * yönlenir. Ödeme backend'i ve webhook'lar silinmedi; yalnızca ziyaretçi akışından erişim kalktı.
 */
export default async function ClosedVisitorPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  await redirectVisitorToRequest(lang);
}
