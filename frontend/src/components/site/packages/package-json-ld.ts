import { toPublicMediaUrl } from "@/lib/env";
import { safeJsonLdString } from "@/lib/page-builder/structured-data";
import type { PackageDetailData } from "@/lib/api/types";

/** Open Graph / JSON-LD görseli: JPEG uyumluluk kopyası varsa o, yoksa asıl görsel; tarayıcıya giden genel adrese çevrilir. */
export function packageSocialImage(pkg: Pick<PackageDetailData, "cover">): string | null {
  if (!pkg.cover) return null;
  return toPublicMediaUrl(pkg.cover.compatUrl || pkg.cover.url);
}

/**
 * Paket X — `MedicalProcedure` JSON-LD. `offers` YALNIZCA API `price` doluysa (yönetici `showPrice` açtıysa) eklenir;
 * fiyat yokken hiçbir fiyat alanı yazılmaz.
 */
export function buildPackageJsonLd(pkg: PackageDetailData, canonicalUrl: string): string {
  const image = packageSocialImage(pkg);
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "MedicalProcedure",
    name: pkg.title,
    description: pkg.summary,
    url: canonicalUrl,
    inLanguage: pkg.contentLocale,
    ...(image ? { image } : {}),
    ...(pkg.price
      ? {
          offers: {
            "@type": "Offer",
            url: canonicalUrl,
            priceCurrency: pkg.price.currency,
            price: String(pkg.price.from),
          },
        }
      : {}),
  };
  return safeJsonLdString(data);
}
