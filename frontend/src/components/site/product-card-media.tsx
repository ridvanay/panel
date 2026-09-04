"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SafeImage } from "@/components/site/safe-image";
import { FavoriteButton } from "@/components/site/favorite-button";
import { AddToCartButton } from "@/components/site/add-to-cart-button";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ProductCardMediaColor {
  value: string;
  swatchHex: string | null;
  /** Bu renge karşılık gelen varyasyonun görseli — yoksa `null` (önizleme yapılmaz). */
  mediaUrl: string | null;
}

interface ProductCardMediaProps {
  href: string;
  productId: string;
  title: string;
  coverUrl: string | null;
  coverAlt: string;
  /** `images[0]` — kart hover'ındaki İKİNCİ görsel (bkz. `ProductListItem.images` sözleşmesi). */
  secondaryUrl: string | null;
  secondaryAlt: string;
  badges: ReactNode;
  hasVariants: boolean;
  soldOut: boolean;
  stockQuantity: number;
  colors: ProductCardMediaColor[];
  sizes: string;
  priority?: boolean;
  mediaClassName?: string;
  /** Izgara varsayılanı `true` — liste görünümünde (§3.5) favori sağ üstte DEĞİL, başlık satırında görünür. */
  showFavoriteOverlay?: boolean;
  /** Izgara varsayılanı `true` — liste görünümünde hızlı-ekle çubuğu KAYAN DEĞİL, satırda doğrudan görünür bir buton olur (bkz. `product-card.tsx`). */
  showQuickAddOverlay?: boolean;
  /**
   * Başlık/açıklama bloğu — ÇAĞIRAN (sunucu) bileşenden ham JSX olarak geçirilir ve YİNE
   * sunucuda render edilmiş kalır (RSC "server ağacını client'a children olarak ver" deseni).
   * Yalnızca BU dosyanın kendi JSX'i istemci paketine dahil olur — kartın TAMAMI `"use client"`
   * OLMAZ (`.claude/design-notes-products-catalog.md` §3.4 performans notu).
   */
  children: ReactNode;
}

/**
 * Kartın TEK istemci "adası": hover'da ikincil görsel geçişi (§3.1) + renk noktası önizlemesi
 * (§3.4, `<Link>`'in KARDEŞİ — bir `<a>` içine interaktif `<button>` gömmek geçersiz iç içe
 * etkileşim üretir, `favorite-button.tsx` ile AYNI a11y ilkesi) + rozet istifi/favori/hızlı-ekle
 * çubuğu (§3.2/§3.3) hepsi burada. Görsel bağlantısı (`<Link>`) yalnızca görseli SARAR — favori/
 * hızlı-ekle butonları Link'in İÇİNDE DEĞİL, aynı `relative` çerçeve içinde mutlak konumlu
 * KARDEŞLERDİR (aksi halde buton-içinde-buton geçersiz iç içe etkileşim üretirdi).
 */
export function ProductCardMedia({
  href,
  productId,
  title,
  coverUrl,
  coverAlt,
  secondaryUrl,
  secondaryAlt,
  badges,
  hasVariants,
  soldOut,
  stockQuantity,
  colors,
  sizes,
  priority,
  mediaClassName,
  showFavoriteOverlay = true,
  showQuickAddOverlay = true,
  children,
}: ProductCardMediaProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const activeUrl = previewUrl ?? coverUrl;
  const showHoverSwap = previewUrl === null && Boolean(secondaryUrl);
  const visibleColors = colors.slice(0, 5);
  const overflowCount = colors.length - visibleColors.length;

  return (
    <>
      <div className={cn("group/media relative aspect-square w-full overflow-hidden bg-surface-muted", mediaClassName)}>
        <Link href={href} aria-label={title} className="absolute inset-0 z-0 block">
          {activeUrl ? (
            <SafeImage
              src={activeUrl}
              alt={coverAlt}
              fill
              sizes={sizes}
              priority={priority}
              className={cn("object-cover transition-opacity duration-300 ease-out", showHoverSwap && "group-hover/media:opacity-0")}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-foreground/30">
              <span className="text-xs">Görsel yok</span>
            </div>
          )}
          {showHoverSwap && secondaryUrl && (
            <SafeImage
              src={secondaryUrl}
              alt={secondaryAlt}
              fill
              sizes={sizes}
              className="absolute inset-0 object-cover opacity-0 transition-opacity duration-300 ease-out group-hover/media:opacity-100"
            />
          )}
        </Link>

        {badges}

        {showFavoriteOverlay && (
          <FavoriteButton
            productId={productId}
            className="absolute left-2 top-2 z-10 bg-surface/90 shadow-sm backdrop-blur-sm hover:bg-surface"
          />
        )}

        {showQuickAddOverlay && !soldOut && (
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 z-10 border-t border-border bg-surface/95 p-2 backdrop-blur-sm transition-transform duration-200 ease-out",
              "lg:translate-y-full lg:group-hover/media:translate-y-0"
            )}
          >
            {hasVariants ? (
              <Link href={href} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full rounded-[var(--site-radius)]")}>
                Seçenekleri Gör <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <AddToCartButton productId={productId} stockQuantity={stockQuantity} size="sm" className="w-full rounded-[var(--site-radius)]" />
            )}
          </div>
        )}
      </div>

      {children}

      {visibleColors.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          {visibleColors.map((color) => (
            <button
              key={color.value}
              type="button"
              aria-label={`${color.value} rengini önizle`}
              onMouseEnter={() => setPreviewUrl(color.mediaUrl)}
              onFocus={() => setPreviewUrl(color.mediaUrl)}
              onMouseLeave={() => setPreviewUrl(null)}
              onBlur={() => setPreviewUrl(null)}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setPreviewUrl(color.mediaUrl);
              }}
              className={cn(
                "h-4 w-4 shrink-0 rounded-full border transition-transform duration-150",
                previewUrl !== null && previewUrl === color.mediaUrl
                  ? "border-transparent ring-2 ring-primary ring-offset-1 ring-offset-surface"
                  : "border-border hover:scale-110"
              )}
              style={{ backgroundColor: color.swatchHex ?? undefined }}
            />
          ))}
          {overflowCount > 0 && (
            <span className="grid h-4 w-4 place-items-center rounded-full bg-surface-muted text-[10px] font-medium text-foreground/60">
              +{overflowCount}
            </span>
          )}
        </div>
      )}
    </>
  );
}
