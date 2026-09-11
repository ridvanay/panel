"use client";

import { useState } from "react";
import type { DoctorProfile } from "@/lib/api/types";
import { SafeImage } from "@/components/site/safe-image";
import { cn } from "@/lib/utils";

/**
 * Bug fix (qa-agent tespiti, 2026-09-11) — `doctor-card.tsx` VE `doctor-profile-hero.tsx` daha
 * önce avatarı bilinçli olarak düz `<img src={doctor.avatarMedia.url}>` ile render ediyordu.
 * Sunucu tarafı (`server-telehealth.ts::toInternalMediaUrl`) Docker ağında `http://localhost:4000`
 * host'unu `http://backend:4000`'e çevirir — bu SUNUCU-taraflı `next/image` fetch'i için doğrudur,
 * ama TARAYICI bu host'u çözemez; düz `<img>` bu URL'i doğrudan tarayıcıya verdiğinden görsel asla
 * yüklenmiyordu (`onError` YOKTU) ve tarayıcı kırık görselin `alt` metnini ham metin olarak
 * bırakıyordu. `SafeImage` (`components/site/safe-image.tsx`) — host `isOptimizableImageUrl` ile
 * izinli listedeyse (`NEXT_PUBLIC_INTERNAL_MEDIA_URL` bu listede, bkz. `lib/image-hosts.ts`)
 * `next/image` kullanır: tarayıcı DAİMA aynı-origin `/_next/image?url=...` isteği atar, ham `url`'i
 * yalnızca Next sunucusu (Docker ağını çözebilen taraf) fetch eder — host çözümleme sorunu ortadan
 * kalkar. `onError` ile de gerçek bir yükleme HATASI (404/bozuk dosya gibi) durumunda ham `alt`
 * metnine değil, mevcut monogram fallback'e düşülür — kullanıcıya ASLA ham metin gösterilmez.
 *
 * `onError` bir olay işleyicisi (fonksiyon) olduğundan bu state'i tutan modül `"use client"`
 * OLMAK ZORUNDADIR — ama bunu kullanan `doctor-card.tsx`/`doctor-profile-hero.tsx` Server Component
 * olarak KALIR (bu bileşeni bir çocuk olarak render ederler, kendileri hiçbir closure/event
 * handler'ı BU bileşene prop olarak GEÇMEZ — RSC sınırı ihlal edilmez).
 */

export function initialsFromFullName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

interface DoctorAvatarMediaProps {
  doctor: DoctorProfile;
  /** Dış kapsayıcının boyutu+şekli (`h-*`, `w-*`, `rounded-*`) — çağıran belirler (`doctor-card.tsx`
   * dairesel `rounded-full`, `doctor-profile-hero.tsx` yumuşak kare `rounded-[var(--site-radius)]`,
   * §2/§2.1.2 — YENİ bir şekil İCAT EDİLMEZ, mevcut ikisi BİREBİR korunur). */
  sizeClassName: string;
  /** Monogram fallback'in yazı boyutu (`text-lg`/`text-2xl`/`text-3xl sm:text-4xl` — çağırana göre değişir). */
  textClassName: string;
  /** `next/image`'in `sizes` attr'ı — görsel her zaman `sizeClassName`'deki sabit kutuya `fill` ile oturur. */
  sizes?: string;
  priority?: boolean;
}

export function DoctorAvatarMedia({ doctor, sizeClassName, textClassName, sizes, priority }: DoctorAvatarMediaProps) {
  // Gerçek bir yükleme hatası (404/bozuk dosya) olursa `avatarMedia` var olsa da monogram fallback'e
  // düş — ham `alt` metni ASLA kullanıcıya görünmez (bkz. yukarıdaki dosya-başı yorumu).
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(doctor.avatarMedia) && !failed;

  return (
    <div className={cn("relative shrink-0 overflow-hidden", sizeClassName)}>
      {showImage ? (
        <SafeImage
          src={doctor.avatarMedia!.url}
          alt={doctor.avatarMedia!.altText ?? ""}
          fill
          sizes={sizes ?? "144px"}
          priority={priority}
          onError={() => setFailed(true)}
          className="border border-border object-cover"
        />
      ) : (
        <div
          className={cn(
            "flex h-full w-full select-none items-center justify-center bg-gradient-to-br from-[#0F766E] to-[#0369A1] font-semibold text-white",
            textClassName
          )}
          aria-hidden="true"
        >
          {initialsFromFullName(doctor.fullName)}
        </div>
      )}
    </div>
  );
}
