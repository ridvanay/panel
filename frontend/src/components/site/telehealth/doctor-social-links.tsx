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

/** Bilinen sosyal ağ alan adları — "website" olarak girilen bu adresler ilgili platform sayılır. */
const KNOWN_SOCIAL_HOSTS: { platform: DoctorSocialLinkPlatform; hosts: string[] }[] = [
  { platform: "instagram", hosts: ["instagram.com", "instagr.am"] },
  { platform: "facebook", hosts: ["facebook.com", "fb.com", "fb.me"] },
  { platform: "youtube", hosts: ["youtube.com", "youtu.be"] },
  { platform: "linkedin", hosts: ["linkedin.com"] },
  { platform: "x", hosts: ["x.com", "twitter.com"] },
  { platform: "tiktok", hosts: ["tiktok.com"] },
];

function parseHost(raw: string): { host: string; path: string } | null {
  try {
    const url = new URL(raw.trim());
    return { host: url.hostname.toLowerCase().replace(/^(www|m|mobile)\./, ""), path: url.pathname.replace(/\/+$/, "").toLowerCase() };
  } catch {
    return null;
  }
}

/** Bir bağlantının etkin platformu: "website" ama alan adı bilinen bir sosyal ağsa o platform. */
export function effectiveSocialPlatform(link: DoctorSocialLink): DoctorSocialLinkPlatform {
  if (link.platform !== "website") return link.platform;
  const parsed = parseHost(link.url);
  if (!parsed) return "website";
  const match = KNOWN_SOCIAL_HOSTS.find((entry) => entry.hosts.some((h) => parsed.host === h || parsed.host.endsWith(`.${h}`)));
  return match?.platform ?? "website";
}

function normalizedUrlKey(raw: string): string {
  const parsed = parseHost(raw);
  return parsed ? `${parsed.host}${parsed.path}` : raw.trim().toLowerCase();
}

/** Etiket sonundaki dil etiketi: "Instagram (TR)" -> "tr". */
function labelLanguageTag(label: string | undefined): string | null {
  const match = label?.match(/\(\s*([A-Za-z]{2,3}(?:-[A-Za-z]+)?)\s*\)\s*$/);
  return match ? match[1].toLowerCase().split("-")[0] : null;
}

/**
 * Görüntüleme için tekilleştirme: (1) tamamen aynı (normalize) adresler tekilleştirilir; (2) bir sosyal platformdan
 * (bilinen sosyal alan adı "website" olarak girilse de o platform sayılır) TEK bağlantı gösterilir. Aynı platformda
 * farklı adresler varsa ziyaretçi diline uyan etiket ("(TR)"/"(EN)") seçilir: site dili `tr` ise TR, değilse EN;
 * eşleşme yoksa ilki. Gerçek web siteleri adrese göre tekilleştirilir. Boş adresler atlanır.
 */
export function dedupeSocialLinks(links: DoctorSocialLink[], lang = "en"): DoctorSocialLink[] {
  const seenUrls = new Set<string>();
  const byPlatform = new Map<string, DoctorSocialLink[]>();
  const order: string[] = [];
  for (const link of links) {
    if (!link.url?.trim()) continue;
    const platform = effectiveSocialPlatform(link);
    const urlKey = `${platform}|${normalizedUrlKey(link.url)}`;
    if (seenUrls.has(urlKey)) continue;
    seenUrls.add(urlKey);
    const groupKey = platform === "website" ? urlKey : platform;
    if (!byPlatform.has(groupKey)) {
      byPlatform.set(groupKey, []);
      order.push(groupKey);
    }
    byPlatform.get(groupKey)!.push(platform === link.platform ? link : { ...link, platform });
  }
  const wanted = lang.toLowerCase().split("-")[0] === "tr" ? "tr" : "en";
  return order.map((key) => {
    const group = byPlatform.get(key)!;
    return group.find((l) => labelLanguageTag(l.label) === wanted) ?? group[0];
  });
}

export function DoctorSocialLinks({ links: rawLinks, ariaLabel, lang = "en" }: { links: DoctorSocialLink[]; ariaLabel: string; lang?: string }) {
  const links = dedupeSocialLinks(rawLinks, lang);
  if (links.length === 0) return null;

  return (
    <ul className="flex flex-wrap items-center justify-center gap-2" aria-label={ariaLabel}>
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
