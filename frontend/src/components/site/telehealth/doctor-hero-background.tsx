import type { ReactNode } from "react";
import Image from "next/image";
import { SafeImage } from "@/components/site/safe-image";
import type { DoctorHeroSettings } from "@/lib/api/types";

/** Paket M — admin görsel seçmediğinde kullanılan, projede üretilmiş telifsiz SVG (`public/images`). */
export const DOCTOR_HERO_DEFAULT_IMAGE = "/images/doctor-hero-default.svg";
export const DOCTOR_HERO_DEFAULT_OVERLAY = 55;

/** Görsel yüklenirken marka renkleriyle bulanık geçiş (küçük satır içi SVG — ağ isteği yok). */
const BLUR_DATA_URL =
  "data:image/svg+xml;base64," +
  "PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCA0IDMnPjxkZWZzPjxsaW5lYXJHcmFkaWVudCBpZD0nZycgeDE9JzAnIHkxPScwJyB4Mj0nMScgeTI9JzEnPjxzdG9wIG9mZnNldD0nMCcgc3RvcC1jb2xvcj0nIzI5NTFBMCcvPjxzdG9wIG9mZnNldD0nMScgc3RvcC1jb2xvcj0nIzRhYjllMScvPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjxyZWN0IHdpZHRoPSc0JyBoZWlnaHQ9JzMnIGZpbGw9J3VybCgjZyknLz48L3N2Zz4=";

/**
 * Paket M (2026-10-23) — doktor profil başlığı (`/doctors/[slug]`) arka planı. Admin görseli
 * (yalnızca medya kütüphanesinden, `GET /telehealth/theme` → `doctorHero.imageUrl`) yoksa varsayılan
 * SVG. Görsel `object-cover`, üzerine koyu katman (`overlayOpacity`, 0–80) gelir; metin beyaz kalır.
 * Yükseklik ve yerleşim çocuk içerikten gelir (bugünkü padding'ler değişmedi). Dekoratif (`alt=""`).
 */
export function DoctorHeroBackground({ hero, children }: { hero?: DoctorHeroSettings | null; children: ReactNode }) {
  const src = hero?.imageUrl || DOCTOR_HERO_DEFAULT_IMAGE;
  const isSvg = src.toLowerCase().split("?")[0]!.endsWith(".svg");
  const overlay = hero?.overlayOpacity ?? DOCTOR_HERO_DEFAULT_OVERLAY;

  const imageProps = {
    "aria-hidden": true,
    fill: true,
    priority: true,
    sizes: "100vw",
    unoptimized: isSvg,
    ...(isSvg ? {} : { placeholder: "blur" as const, blurDataURL: BLUR_DATA_URL }),
    className: "-z-20 object-cover",
    "data-testid": "doctor-hero-image",
  };

  return (
    <div className="relative isolate w-full overflow-hidden bg-[var(--site-secondary)]" data-testid="doctor-hero">
      {/* Varsayılan SVG kendi `public/` dosyamız → doğrudan next/image; admin görseli (medya host'u)
          SafeImage'in host allowlist denetiminden geçer (izinli değilse düz `<img>`). */}
      {src === DOCTOR_HERO_DEFAULT_IMAGE ? <Image src={src} alt="" {...imageProps} /> : <SafeImage src={src} alt="" {...imageProps} />}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-black" style={{ opacity: overlay / 100 }} data-testid="doctor-hero-overlay" />
      {/* Açık görsellerde de okunaklılık için ince metin gölgesi (overlay düşük seçilse bile). */}
      <div className="[text-shadow:0_1px_2px_rgb(0_0_0/0.35)]">{children}</div>
    </div>
  );
}
