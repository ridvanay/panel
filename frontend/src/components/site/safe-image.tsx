import Image, { type ImageProps } from "next/image";
import { isOptimizableImageUrl } from "@/lib/image-hosts";
import { cn } from "@/lib/utils";

type SafeImageProps = Omit<ImageProps, "src" | "alt"> & { src: string; alt: string };

/**
 * `next/image` sarmalayıcısı — `.claude/architect-scope-products-catalog.md` §6.1 "çözümlenemezse
 * unoptimized yerine mevcut `<img>` davranışına düş" kuralının component-seviyesi karşılığı.
 * `next.config.ts`'teki `remotePatterns` yalnızca `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_MEDIA_URL`
 * host'larını tanır; bu iki değişkenin DIŞINDA bir host'tan gelen medya (ör. farklı bir S3/CDN)
 * `next/image`'e verilirse ÇALIŞMA ZAMANINDA hata fırlatır — bu yüzden her görsel için host
 * `isOptimizableImageUrl` ile ÖNCE doğrulanır, eşleşmiyorsa düz `<img>`'e düşülür. Sunucu
 * bileşenlerinde de kullanılabilir (tarayıcı API'si GEREKMEZ), bu turda YALNIZCA ürün kartı ve
 * PDP galerisi bunu kullanır (§6.1 kapsam sınırı).
 */
export function SafeImage({ src, alt, className, style, fill, onError, ...rest }: SafeImageProps) {
  if (!isOptimizableImageUrl(src)) {
    // `fill` next/image'e özgüdür — düz `<img>`de AYNI "kapsayıcıyı doldur" görünümü `absolute
    // inset-0 h-full w-full` ile taklit edilir (kapsayıcı zaten `relative` — bkz. çağıranlar).
    // `onError` de `fill` gibi AYRIYETEN destructure edilip İKİ dalda da iletilir — aksi halde
    // host allowlist dışındayken (bu dal) çağıranın kırık-görsel/placeholder mantığı (bkz.
    // `product-card-media.tsx`) sessizce düşer, kullanıcı native kırık resim ikonu görür.
    return (
      // eslint-disable-next-line @next/next/no-img-element -- host next.config.ts remotePatterns dışında, next/image ÇALIŞMA ZAMANINDA hata fırlatırdı
      <img
        src={src}
        alt={alt}
        className={cn(fill && "absolute inset-0 h-full w-full", className)}
        style={style}
        loading={rest.priority ? "eager" : "lazy"}
        onError={onError}
      />
    );
  }
  return <Image src={src} alt={alt} className={className} style={style} fill={fill} onError={onError} {...rest} />;
}
