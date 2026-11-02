import type { Prisma, PrismaClient } from "@prisma/client";
import type { PackageCategory, PackageText } from "../modules/packages/packages.shared";

/**
 * Paket X — 8 TASLAK sağlık paketi. Yalnızca EN metin, FİYAT YOK, `isActive=false`, `showPrice=false`.
 * Metinler nötr ve tanıtıcıdır (sonuç/başarı iddiası, rakam, "en iyi" gibi ifade yok); yönetici içeriği klinikle
 * doğrulayıp çevirileri ekledikten sonra aktifleştirir. Var olan slug'a dokunulmaz (idempotent).
 */
export const SEED_HEALTH_PACKAGES_CONFIRM_KEY = "seed-health-packages";

interface SeedPackage {
  slug: string;
  category: PackageCategory;
  en: PackageText;
}

const EVAL = "The final scope is planned with you after a medical evaluation.";

export const SEED_HEALTH_PACKAGES: SeedPackage[] = [
  {
    slug: "executive-check-up",
    category: "check-up",
    en: {
      title: "Executive Check-up",
      summary: `A general health check-up planned around your age, history and goals. ${EVAL}`,
      includes: ["Consultation at an authorized healthcare facility", "Laboratory tests selected by the treating physician", "Imaging if medically indicated", "Results review"],
      notIncluded: ["Flights and accommodation", "Treatments arising from the results"],
      duration: "Usually 1 day",
      idealFor: "Adults who want a structured overview of their health",
      faq: [],
    },
  },
  {
    slug: "womens-check-up",
    category: "women",
    en: {
      title: "Women's Check-up",
      summary: `A check-up focused on women's health, planned according to age and history. ${EVAL}`,
      includes: ["Consultation at an authorized healthcare facility", "Gynaecological examination if indicated", "Laboratory tests selected by the treating physician", "Results review"],
      notIncluded: ["Flights and accommodation", "Treatments arising from the results"],
      duration: "Usually 1 day",
      idealFor: "Women who want a routine health review",
      faq: [],
    },
  },
  {
    slug: "cardiac-check-up",
    category: "check-up",
    en: {
      title: "Cardiac Check-up",
      summary: `A heart-focused evaluation with tests chosen by a cardiologist. ${EVAL}`,
      includes: ["Cardiology consultation", "ECG", "Further cardiac tests if medically indicated", "Results review"],
      notIncluded: ["Flights and accommodation", "Procedures arising from the results"],
      duration: "Usually 1 day",
      idealFor: "Adults who want their heart health assessed",
      faq: [],
    },
  },
  {
    slug: "longevity-assessment",
    category: "longevity",
    en: {
      title: "Longevity Assessment",
      summary: `A preventive health assessment covering lifestyle and risk factors. ${EVAL}`,
      includes: ["Consultation at an authorized healthcare facility", "Laboratory tests selected by the treating physician", "Lifestyle discussion", "Results review"],
      notIncluded: ["Flights and accommodation", "Supplements or treatments"],
      duration: "Usually 1 day",
      idealFor: "Adults interested in prevention",
      faq: [],
    },
  },
  {
    slug: "dermal-filler-botox",
    category: "aesthetic",
    en: {
      title: "Dermal Filler & Botox",
      summary: `Aesthetic injections planned after an in-person assessment at an authorized healthcare facility. ${EVAL}`,
      includes: ["Assessment at an authorized healthcare facility", "Treatment plan discussion", "Procedure if suitable"],
      notIncluded: ["Flights and accommodation"],
      duration: "Usually 1 day",
      idealFor: "Adults considering non-surgical aesthetic treatment",
      faq: [],
    },
  },
  {
    slug: "therapeutic-massage",
    category: "wellness",
    en: {
      title: "Therapeutic Massage",
      summary: "Massage sessions planned according to your needs. Please discuss any health conditions with our coordinator or therapist in person.",
      includes: ["Pre-session questions", "Massage session(s)"],
      notIncluded: ["Flights and accommodation", "Medical treatment"],
      duration: "Sessions of 30–90 minutes",
      idealFor: "Adults looking for relaxation and wellbeing",
      faq: [],
    },
  },
  {
    slug: "dental-check-cleaning",
    category: "dental",
    en: {
      title: "Dental Check & Cleaning",
      summary: `A dental examination and professional cleaning. ${EVAL}`,
      includes: ["Dental examination", "Professional cleaning", "X-ray if indicated"],
      notIncluded: ["Flights and accommodation", "Further dental treatments"],
      duration: "Usually 1 visit",
      idealFor: "Adults due for a routine dental check",
      faq: [],
    },
  },
  {
    slug: "cancer-screening",
    category: "check-up",
    en: {
      title: "Cancer Screening",
      summary: `Screening tests chosen at an authorized healthcare facility according to age, sex and risk factors. Screening does not replace diagnosis. ${EVAL}`,
      includes: ["Consultation at an authorized healthcare facility", "Screening tests selected by the treating physician", "Results review"],
      notIncluded: ["Flights and accommodation", "Diagnosis or treatment arising from the results"],
      duration: "Usually 1–2 days",
      idealFor: "Adults due for age-appropriate screening",
      faq: [],
    },
  },
];

export interface SeedHealthPackagesPlan {
  toCreate: SeedPackage[];
  existing: string[];
}

export async function buildSeedHealthPackagesPlan(prisma: Pick<PrismaClient, "healthPackage">): Promise<SeedHealthPackagesPlan> {
  const found = new Set((await prisma.healthPackage.findMany({ where: { slug: { in: SEED_HEALTH_PACKAGES.map((p) => p.slug) } }, select: { slug: true } })).map((p) => p.slug));
  return { toCreate: SEED_HEALTH_PACKAGES.filter((p) => !found.has(p.slug)), existing: [...found] };
}

export async function applySeedHealthPackagesPlan(
  prisma: Pick<PrismaClient, "healthPackage" | "auditLog">,
  plan: SeedHealthPackagesPlan,
  opts: { confirm: string; operator: string }
): Promise<{ created: number }> {
  if (opts.confirm !== SEED_HEALTH_PACKAGES_CONFIRM_KEY) throw new Error(`--confirm=${SEED_HEALTH_PACKAGES_CONFIRM_KEY} gerekli.`);
  if (!opts.operator.trim()) throw new Error('--operator="Ad Soyad" gerekli.');
  let created = 0;
  for (const [i, p] of plan.toCreate.entries()) {
    await prisma.healthPackage.create({
      data: {
        slug: p.slug,
        category: p.category,
        translations: { en: p.en } as unknown as Prisma.InputJsonValue,
        priceFrom: null,
        showPrice: false,
        isActive: false,
        isFeatured: false,
        sortOrder: (i + 1) * 10,
      },
    });
    created++;
  }
  await prisma.auditLog.create({ data: { action: "package.seed", targetType: "HealthPackage", metadata: { operator: opts.operator.trim(), created, slugs: plan.toCreate.map((p) => p.slug) } } });
  return { created };
}
