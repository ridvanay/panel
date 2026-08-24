import { redirectIfModuleDisabledServer } from "@/lib/api/server-modules";
import { WishlistClient } from "./wishlist-client";

/**
 * §customer-portal §4.1/§4.3 — `products` modülü kapalıyken `/hesabim/profil`'e yönlendirilir
 * (bkz. `siparislerim/page.tsx` üst notu — AYNI kural).
 */
export default async function MyWishlistPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  await redirectIfModuleDisabledServer(lang, "products");

  return <WishlistClient />;
}
