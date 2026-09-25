import Link from "next/link";
import type { DoctorProfile } from "@/lib/api/types";
import type { AboutPageContent } from "@/lib/about-page";
import type { TelehealthStrings } from "@/lib/i18n/site-dictionaries";
import { DoctorCard } from "@/components/site/telehealth/doctor-card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Eyebrow } from "./eyebrow";
import { aboutButtonClass, aboutContainerClass } from "./about-buttons";

interface AboutDoctorsProps {
  section: AboutPageContent["doctors"];
  telehealthDict: TelehealthStrings;
  doctors: DoctorProfile[];
  founderId: string | null;
  doctorsHref: string;
  activeLocaleCode: string;
  defaultLocaleCode: string;
  intlLocale: string;
  /**
   * `home`: anasayfa şablonu — sayfa zemini tonu, daha geniş dikey boşluk, 44 px başlık, mobilde
   * tam genişlik buton. Varsayılan `about` görünümü DEĞİŞMEZ.
   */
  variant?: "about" | "home";
}

/**
 * Mevcut `DoctorCard` ile admin'in seçtiği sayıda (1–6) doktor. Uzmanlık adı doğrudan
 * veritabanından gelir. Çağıran sayfa bölüm kapalıysa veya `doctors` boşsa bunu HİÇ render etmez.
 */
export function AboutDoctors({
  section,
  telehealthDict,
  doctors,
  founderId,
  doctorsHref,
  activeLocaleCode,
  defaultLocaleCode,
  intlLocale,
  variant = "about",
}: AboutDoctorsProps) {
  const home = variant === "home";
  return (
    <section id="doctors" className={cn("scroll-mt-24", home ? "bg-background" : "bg-card")} aria-labelledby="about-doctors-title">
      <div className={cn(aboutContainerClass, "grid gap-8 sm:grid-cols-[1fr_auto] sm:items-end", home ? "py-16 lg:gap-y-12 lg:py-28" : "py-16 lg:py-24")}>
        <div>
          <Eyebrow>{section.eyebrow}</Eyebrow>
          <h2
            id="about-doctors-title"
            className={cn("about-serif mt-5 leading-tight text-foreground", home ? "text-[32px] sm:text-4xl lg:text-[44px]" : "text-3xl sm:text-4xl")}
          >
            {section.title}
          </h2>
        </div>

        {/* Mobilde kartların ALTINA iner (`order-last`), sm+ başlığın sağında durur. */}
        <div className="order-last sm:order-none">
          <Link href={doctorsHref} className={cn(aboutButtonClass.outlinePrimary, home && "w-full sm:w-auto")}>
            {section.ctaLabel}
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
                      {section.founderLabel}
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
