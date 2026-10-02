import { Briefcase, Globe, X } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { FacebookIcon, InstagramIcon, TiktokIcon, YoutubeIcon } from "@/components/icons/brand-icons";
import type { DoctorSocialLink, DoctorSocialLinkPlatform } from "@/lib/api/types";

/**
 * [DPI] §1.1 — `DoctorProfile.socialLinks` sunumu, `doctors/[slug]/page.tsx` → `DoctorProfileHero`
 * tarafından doktor FOTOĞRAFININ ALTINDA render edilir. Dizi boşsa (`socialLinks.length === 0`)
 * bu bileşen HİÇ render EDİLMEZ (çağıran taraf da aynı kontrolü yapar, savunma amaçlı burada da).
 *
 * Marka ikonu seçimi — bu projede kurulu `lucide-react` sürümü (bkz. `package.json`) marka/logo
 * ikonları TAŞIMAZ (yalnızca jenerik çizim ikonları). `instagram`/`facebook`/`youtube`/`tiktok` için
 * GERÇEK marka ikonları `@/components/icons/brand-icons` içinden kullanılıyor (code-quality-agent
 * kararı: YENİ bir npm bağımlılığı EKLENMEDEN, Simple Icons'un CC0 path verisi elle taşındı — bkz.
 * o dosyadaki lisans/kaynak notu). `x`→lucide `X` (zaten gerçek marka şekli), `website`→lucide
 * `Globe` (jenerik, sorun yok). `linkedin`→lucide `Briefcase` (JENERİK, BİLİNÇLİ OLARAK KALDI):
 * Simple Icons projesi LinkedIn'in resmi ikonunu Aralık 2024'te depodan kaldırdı ("Removed LinkedIn
 * #11380") — gerekçesi teyit edilemediğinden bu marka başka bir kaynaktan taklit edilerek
 * eklenmedi; bu belirsiz durum architect/security-agent'a yönlendirilmelidir, code-quality-agent
 * kendi başına bir marka/telif kararı vermez. `label` alanı DOLUYSA erişilebilir isim olarak ONA
 * öncelik verilir.
 */
const PLATFORM_ICON: Record<DoctorSocialLinkPlatform, ComponentType<SVGProps<SVGSVGElement>>> = {
  instagram: InstagramIcon,
  facebook: FacebookIcon,
  youtube: YoutubeIcon,
  linkedin: Briefcase,
  x: X,
  tiktok: TiktokIcon,
  website: Globe,
};

const PLATFORM_LABEL: Record<DoctorSocialLinkPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  x: "X",
  tiktok: "TikTok",
  website: "Website",
};

export function DoctorSocialLinks({ links }: { links: DoctorSocialLink[] }) {
  if (links.length === 0) return null;

  return (
    <ul className="flex flex-wrap items-center justify-center gap-2" aria-label="Sosyal medya ve web bağlantıları">
      {links.map((link, index) => {
        const Icon = PLATFORM_ICON[link.platform];
        const accessibleLabel = link.label?.trim() || PLATFORM_LABEL[link.platform];
        return (
          <li key={`${link.platform}-${index}`}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={accessibleLabel}
              title={accessibleLabel}
              className="group relative isolate inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-white/20 bg-white/10 text-white/80 transition-all duration-300 hover:border-transparent hover:text-white focus-visible:border-transparent focus-visible:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-accent)] focus-visible:ring-offset-2"
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 z-0 opacity-0 transition-opacity duration-300 [background-image:linear-gradient(135deg,var(--site-primary),var(--site-accent))] group-hover:opacity-100 group-focus-visible:opacity-100"
              />
              <Icon className="relative z-10 h-4 w-4" aria-hidden="true" />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
