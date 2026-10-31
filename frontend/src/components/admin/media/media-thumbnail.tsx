"use client";

import { useState } from "react";
import { FileText, Film, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

/** Paket AE — kütüphanede artık `video/mp4` ve `text/vtt` kayıtları da olabilir; `<img>` yalnızca görseller içindir. */
export function isImageMimeType(mimeType: string | null | undefined): boolean {
  return !mimeType || mimeType.startsWith("image/");
}

export function mediaTypeLabel(mimeType: string): string {
  if (mimeType === "video/mp4") return "Video · MP4";
  if (mimeType === "text/vtt") return "Altyazı · VTT";
  if (mimeType === "application/pdf") return "Döküman · PDF";
  return (mimeType.split("/")[1] ?? mimeType).toUpperCase();
}

/** Görsel olmayan medya (video/altyazı/PDF) için `<img>` yerine simge + tür etiketi. */
export function MediaFileTile({ mimeType, className, iconClassName }: { mimeType: string; className?: string; iconClassName?: string }) {
  const Icon = mimeType.startsWith("video/") ? Film : FileText;
  const label = mediaTypeLabel(mimeType);
  return (
    <div
      role="img"
      aria-label={label}
      data-testid="media-file-tile"
      className={cn("flex flex-col items-center justify-center gap-1 bg-surface-muted text-foreground/50", className)}
    >
      <Icon className={cn("h-6 w-6 shrink-0", iconClassName)} aria-hidden="true" />
      <span className="px-1 text-center text-[10px] leading-tight">{label}</span>
    </div>
  );
}

interface MediaThumbnailProps {
  src: string;
  /** Verilirse ve görsel değilse `<img>` yerine simge + etiket gösterilir. */
  mimeType?: string;
  alt: string;
  /** `<img>`'in kendi sınıfı (boyut/kenarlık/`object-fit`). */
  className?: string;
  /**
   * Yükleme hatası placeholder'ının sınıfı. Belirtilmezse `className` kullanılır — bu, sabit
   * boyutlu çağıranlarda (ör. `h-10 w-10`, `h-full w-full`) yeterlidir. `object-contain` +
   * yalnızca `max-h-*` ile SOMUT bir yükseklik TANIMLAMAYAN çağıranlarda (ör.
   * `media-preview-dialog.tsx`) placeholder div'i içeriği olmadan 0 yüksekliğe düşer — bu
   * durumda çağıran burada somut bir `h-*` İÇEREN ayrı bir sınıf VERMELİDİR.
   */
  fallbackClassName?: string;
  iconClassName?: string;
}

interface MediaThumbnailFallbackProps {
  alt: string;
  className?: string;
  iconClassName?: string;
}

/**
 * `MediaThumbnail`'in başarısız-yükleme placeholder'ı — ayrı export edilmesinin nedeni: medya
 * kütüphanesi grid görünümü (`admin/media/page.tsx`) kendi ham `<img onLoad>` blur-up efektini
 * (yükleme sırasında `opacity-0 blur-sm` → yüklenince kaldırma) KORUMAK zorunda; bu efekt
 * `MediaThumbnail`'in kendi `onError`→state akışıyla doğrudan uyumlu değil (state swap ile img
 * DOM'dan kalkar, blur-up geçişi anlamsızlaşır). O yüzden o dosya kendi `onError` state'ini
 * (`dominantColors` ile aynı `Record<mediaId, boolean>` deseninde) yönetir ama AYNI görsel
 * deseni burada tekrar yazmak yerine bu alt-parçayı import edip kullanır.
 */
export function MediaThumbnailFallback({ alt, className, iconClassName }: MediaThumbnailFallbackProps) {
  return (
    <div
      role="img"
      aria-label={alt || "Görsel yüklenemedi"}
      className={cn("flex items-center justify-center bg-surface-muted text-foreground/30", className)}
    >
      <ImageOff className={cn("h-6 w-6", iconClassName)} aria-hidden="true" />
    </div>
  );
}

/**
 * Admin medya kütüphanesindeki TÜM görsel önizlemeleri (form alanı seçimi, kütüphane grid'i,
 * liste tablosu küçük resmi, büyük önizleme dialog'u) için TEK fallback deseni.
 *
 * Neden `SafeImage`/`next/image` DEĞİL, düz `<img>` + `onError` state: `SafeImage`
 * (`components/site/safe-image.tsx`) `doctor-avatar.tsx`'teki host-çözümleme sorununu (Docker
 * ağında sunucu-taraflı `toInternalMediaUrl` dönüşümünün TARAYICI için çözülememesi) hedefler —
 * bu bileşenler İSE `mediaApi` ile TARAYICIDAN doğrudan çekilen `Media.url`'i kullanır (zaten
 * `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_MEDIA_URL` host'unda, `toInternalMediaUrl` hiç devreye
 * girmez) — yani SafeImage'ın çözdüğü host sorunu burada YOK. Buradaki gerçek kök neden: bu 4
 * yerde `onError` HİÇ yoktu, silinmiş/bozuk bir medya kırık resim ikonu olarak sızıyordu.
 * `next/image` bu 4 yerde ayrıca UYUMSUZ: (a) `media-preview-dialog.tsx` `object-contain` +
 * `max-h-[65vh]` ile intrinsic en-boy oranına göre SERBEST genişlik/yükseklik kullanır — bu,
 * `next/image`'in ZORUNLU `width+height` (veya `fill`, ki o da sabit kutu ister) modeliyle
 * uyuşmaz; `Media.width`/`height` de bazı türlerde (ör. SVG) `null` olabilir. (b) diğer 3 yerin
 * `fill` ile çalışması için her çağıranın etrafına `relative` sarmalayıcı EKLEMEK gerekirdi —
 * bu görev kapsamında gereksiz bir yeniden-yapılandırma. Bu yüzden mevcut düz `<img>` KORUNUR,
 * yalnızca `onError` + fallback state eklenir (aynı `doctor-avatar.tsx`'teki desenin özü: gerçek
 * bir yükleme hatasında ham/kırık görsel yerine kontrollü bir placeholder'a düş).
 */
export function MediaThumbnail({ src, mimeType, alt, className, fallbackClassName, iconClassName }: MediaThumbnailProps) {
  const [failed, setFailed] = useState(false);

  if (mimeType && !isImageMimeType(mimeType)) {
    return <MediaFileTile mimeType={mimeType} className={fallbackClassName ?? className} iconClassName={iconClassName} />;
  }

  if (failed) {
    return (
      <MediaThumbnailFallback alt={alt} className={fallbackClassName ?? className} iconClassName={iconClassName} />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- yüklenen medyanın host'u çalışma zamanında env'e göre değişir (S3/CDN/self-host) ve bu 4 önizleme next/image'in zorunlu width+height/fill kutu modeliyle uyuşmuyor (bkz. dosya-başı yorum); onError→placeholder fallback'i ile birlikte düz img bilinçli tercih edildi
    <img src={src} alt={alt} className={className} loading="lazy" onError={() => setFailed(true)} />
  );
}
