import Link from "next/link";
import type { DoctorProfile } from "@/lib/api/types";
import type { AboutStrings, TelehealthStrings } from "@/lib/i18n/site-dictionaries";
import { DoctorCard } from "@/components/site/telehealth/doctor-card";
import { Badge } from "@/components/ui/badge";
import { Eyebrow } from "./eyebrow";
import { aboutButtonClass, aboutContainerClass } from "./about-buttons";

interface AboutDoctorsProps {
  dict: AboutStrings;
  telehealthDict: TelehealthStrings;
  doctors: DoctorProfile[];
  founderId: string | null;
  doctorsHref: string;
  activeLocaleCode: string;
  defaultLocaleCode: string;
  intlLocale: string;
}

/**
 * Mevcut `DoctorCard` ile en fazla 3 doktor. Uzmanlık adı doğrudan veritabanından gelir (canlıda
 * admin panelinden çevrilmiş). Çağıran sayfa `doctors` boşsa bu bölümü HİÇ render etmez.
 */
export function AboutDoctors({
  dict,
  telehealthDict,
  doctors,
  founderId,
  doctorsHref,
  activeLocaleCode,
  defaultLocaleCode,
  intlLocale,
}: AboutDoctorsProps) {
  return (
    <section id="doctors" className="scroll-mt-24 bg-card" aria-labelledby="about-doctors-title">
      <div className={`${aboutContainerClass} grid gap-8 py-16 sm:grid-cols-[1fr_auto] sm:items-end lg:py-24`}>
        <div>
          <Eyebrow>{dict.doctorsEyebrow}</Eyebrow>
          <h2 id="about-doctors-title" className="about-serif mt-5 text-3xl leading-tight text-foreground sm:text-4xl">
            {dict.doctorsTitle}
          </h2>
        </div>

        {/* Mobilde kartların ALTINA iner (`order-last`), sm+ başlığın sağında durur. */}
        <div className="order-last sm:order-none">
          <Link href={doctorsHref} className={aboutButtonClass.outlinePrimary}>
            {dict.viewAllDoctorsCta}
          </Link>
        </div>

        <ul className="grid gap-6 sm:col-span-2 sm:grid-cols-2 lg:grid-cols-3">
          {doctors.map((doctor) => (
            <li key={doctor.id}>
              <DoctorCard
                doctor={doctor}
                activeLocaleCode={activeLocaleCode}
                defaultLocaleCode={defaultLocaleCode}
                intlLocale={intlLocale}
                dict={telehealthDict}
                badge={
                  doctor.id === founderId ? (
                    <Badge size="sm" className="bg-[var(--about-accent-tint)] font-semibold uppercase tracking-wider text-primary">
                      {dict.founderBadge}
                    </Badge>
                  ) : undefined
                }
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
