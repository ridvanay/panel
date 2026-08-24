"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as usersApi from "@/lib/api/users";
import { useAuth } from "@/context/auth-context";

interface WishlistContextValue {
  /** İlk fetch tamamlanana kadar `true` — kart/detaydaki kalp ikonu bu sürede "boş" gösterir. */
  loading: boolean;
  isFavorited: (productId: string) => boolean;
  /**
   * Favori durumunu tersine çevirir (`POST`/`DELETE /users/me/wishlist*`) — optimistic günceller,
   * istek başarısız olursa state GERİ ALINIR ve hata çağırana fırlatılır (`FavoriteButton` toast
   * gösterir).
   */
  toggle: (productId: string) => Promise<void>;
}

const WishlistContext = createContext<WishlistContextValue | null>(null);

/**
 * SADECE public site layout'una, `products` modülü açıkken eklenir (`CartProvider` ile AYNI
 * desen, bkz. `(site)/layout.tsx`). Görev notu — "ürün listesi sayfasında TEK bir wishlist
 * fetch'i yap, sonuçları tüm kartlara dağıt": bu Provider tüm `(site)` ağacında TEK bir kez
 * mount edilir (liste/detay/öne çıkan ürünler bloğu aynı context'i paylaşır), N+1 fetch OLMAZ.
 */
export function WishlistProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [productIds, setProductIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (status !== "authenticated") {
      // Çıkış yapıldığında/oturum düşünce önceki kullanıcının favori id'lerini HEMEN temizler —
      // `accent-context.tsx`'teki AYNI onaylı istisna (senkron dal, ardından bir ağ isteği YOK).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProductIds(new Set());
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const items = await usersApi.getMyWishlist();
        if (!cancelled) setProductIds(new Set(items.map((item) => item.productId)));
      } catch {
        // Sessizce yut — `CartProvider.refetch` ile AYNI ilke: kalp ikonları "favori değil"
        // gösterir, sayfa tek bir uç yüzünden kilitlenmez.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  const toggle = useCallback(
    async (productId: string) => {
      const wasFavorited = productIds.has(productId);
      setProductIds((prev) => {
        const next = new Set(prev);
        if (wasFavorited) next.delete(productId);
        else next.add(productId);
        return next;
      });
      try {
        if (wasFavorited) await usersApi.removeFromMyWishlist(productId);
        else await usersApi.addToMyWishlist(productId);
      } catch (err) {
        // Başarısız istek — optimistic güncellemeyi geri al, çağırana (FavoriteButton) fırlat.
        setProductIds((prev) => {
          const next = new Set(prev);
          if (wasFavorited) next.add(productId);
          else next.delete(productId);
          return next;
        });
        throw err;
      }
    },
    [productIds]
  );

  const isFavorited = useCallback((productId: string) => productIds.has(productId), [productIds]);

  const value = useMemo<WishlistContextValue>(() => ({ loading, isFavorited, toggle }), [loading, isFavorited, toggle]);

  return <WishlistContext value={value}>{children}</WishlistContext>;
}

/**
 * `useAuthOptional`/`useCartOptional` ile AYNI desen — Provider yoksa (admin canlı önizleme,
 * unit testler) hata FIRLATMAZ, `null` döner; çağıran taraf "favori bilgisi yok" gibi davranır.
 */
export function useWishlistOptional(): WishlistContextValue | null {
  return useContext(WishlistContext);
}
