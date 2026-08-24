"use client";

import { useState, type MouseEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Heart } from "lucide-react";
import { useAuthOptional } from "@/context/auth-context";
import { useWishlistOptional } from "@/context/wishlist-context";
import { Button } from "@/components/ui/button";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { cn } from "@/lib/utils";

interface FavoriteButtonProps {
  productId: string;
  className?: string;
}

/**
 * Ürün kartı/detay sayfasındaki favori (kalp) toggle butonu. `design-notes-customer-portal.md`
 * §5 yalnızca `/hesabim/favorilerim` LİSTESİ için "kalp değil Trash2" kararı verir — bu bileşen
 * ayrı bir yüzeydir (ürün kartı/detayında EKLEME/ÇIKARMA, orada yalnızca ÇIKARMA), bu yüzden
 * dolu/boş durumlu KALP ikonu kullanır.
 *
 * Rol kısıtı YOKTUR: `.claude/architect-scope-customer-portal.md` §10.21.7 gereği wishlist
 * API'sinde `role === "CUSTOMER"` koşulu KULLANILMAZ (kimlik doğrulanmış 5 rolün hepsi
 * favori ekleyebilir/çıkarabilir — `HesabimShell`/`SiteHeader`'daki favori sekmesi/ikonuyla AYNI
 * ilke). Yalnızca `status !== "authenticated"` durumunda `/login?next=` yönlendirmesi yapılır.
 */
export function FavoriteButton({ productId, className }: FavoriteButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const auth = useAuthOptional();
  const wishlist = useWishlistOptional();
  const [pending, setPending] = useState(false);

  const authenticated = auth?.status === "authenticated";
  const favorited = authenticated && wishlist ? wishlist.isFavorited(productId) : false;

  async function handleToggle() {
    if (!wishlist) return;
    setPending(true);
    const wasFavorited = favorited;
    try {
      await wishlist.toggle(productId);
      toast.success(wasFavorited ? "Ürün favorilerden çıkarıldı." : "Ürün favorilere eklendi.");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setPending(false);
    }
  }

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    // Kart tıklaması ürün sayfasına giden bir `<Link>` içindeyse (bkz. `product-card.tsx`)
    // bu buton Link'in İÇİNDE DEĞİL bir kardeş olarak konumlanır (a11y — iç içe interaktif öğe
    // OLMAZ) ama olası bir üst `<Link>`/form davranışını yine de bastırmak güvenli bir varsayım.
    event.preventDefault();
    event.stopPropagation();
    if (!authenticated) {
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    void handleToggle();
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      loading={pending}
      aria-label={favorited ? "Favorilerden çıkar" : "Favorilere ekle"}
      aria-pressed={authenticated ? favorited : undefined}
      onClick={handleClick}
      className={cn(
        favorited ? "text-danger hover:bg-danger/10" : "text-foreground/60 hover:text-foreground",
        className
      )}
    >
      <Heart className={cn("h-4 w-4", favorited && "fill-current")} />
    </Button>
  );
}
