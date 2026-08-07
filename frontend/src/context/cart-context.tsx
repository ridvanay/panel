"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as cartApi from "@/lib/api/cart";
import type { Cart } from "@/lib/api/types";

interface CartContextValue {
  cart: Cart | null;
  loading: boolean;
  /** Sepetteki tüm satırların adet toplamı — header rozeti bunu kullanır. */
  itemCount: number;
  addItem: (productId: string, quantity: number) => Promise<void>;
  updateItem: (itemId: string, quantity: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  refetch: () => Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

/** SADECE public site layout'una eklenir (bkz. `(site)/layout.tsx`) — admin layout'a DEĞİL. */
export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const nextCart = await cartApi.getCart();
      setCart(nextCart);
    } catch {
      // Sessizce yut — sepet ikonu 0 adetle devam eder, tüm public site tek uç yüzünden
      // kilitlenmesin (bkz. modules-context.tsx AYNI patern).
      setCart(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refetch();
    })();
  }, [refetch]);

  // Ekleme/güncelleme/kaldırma hataları BİLEREK yutulmuyor — çağıran taraf (sepete ekle butonu,
  // sepet sayfası) 409 (stok yetersiz vb.) gibi durumları kullanıcıya göstermelidir.
  const addItem = useCallback(async (productId: string, quantity: number) => {
    const nextCart = await cartApi.addCartItem({ productId, quantity });
    setCart(nextCart);
  }, []);

  const updateItem = useCallback(async (itemId: string, quantity: number) => {
    const nextCart = await cartApi.updateCartItem(itemId, { quantity });
    setCart(nextCart);
  }, []);

  const removeItem = useCallback(async (itemId: string) => {
    const nextCart = await cartApi.removeCartItem(itemId);
    setCart(nextCart);
  }, []);

  const itemCount = useMemo(() => cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0, [cart]);

  const value: CartContextValue = { cart, loading, itemCount, addItem, updateItem, removeItem, refetch };

  return <CartContext value={value}>{children}</CartContext>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart, <CartProvider> içinde kullanılmalıdır.");
  return ctx;
}

/**
 * `useCart`'ın aksine sağlayıcı yoksa hata FIRLATMAZ, `null` döner — `SiteHeader` gibi
 * `CartProvider` DIŞINDA da render edilebilen paylaşılan bileşenler için (örn.
 * `admin/navigation/page.tsx`'teki canlı önizleme, admin layout'unda `CartProvider` KASTEN yok).
 */
export function useCartOptional(): CartContextValue | null {
  return useContext(CartContext);
}
