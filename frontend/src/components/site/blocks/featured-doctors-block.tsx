import Link from "next/link";
import { cn } from "@/lib/utils";
import { fetchAllDoctorsServer } from "@/lib/api/server-telehealth";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import type { DoctorProfile } from "@/lib/api/types";
import { DoctorAvatarMedia } from "@/components/site/telehealth/doctor-avatar";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import type {
  BlockChrome,
  FeaturedDoctorsBlock,
  FeaturedDoctorsColumns,
  FeaturedDoctorsImageShape,
  FeaturedDoctorsLocaleContent,
} from "@/lib/page-builder/types";
import { featuredDoctorsMax } from "@/lib/page-builder/types";
import type { BlockSiteContext } from "./index";
import { FeaturedDoctorsCarousel } from "./featured-doctors-carousel";
import { publicDoctorName } from "@/lib/doctor-display-name";

/** Mobil 1, tablet (sm) 2 SABİT; masaüstü (lg) blok ayarından. Tailwind tam sınıf adları (JIT). */
const DESKTOP_COLUMNS_CLASS: Record<FeaturedDoctorsColumns, string> = {
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
};

/** `oval`: dikey portre üzerinde %50 köşe = elips (bugünkü elle yapılmış kartların görünümü). */
const SHAPE_CLASS: Record<FeaturedDoctorsImageShape, string> = {
  circle: "aspect-square rounded-full",
  oval: "aspect-[4/5] rounded-[50%]",
  square: "aspect-square rounded-[var(--site-radius)]",
};

const EMPTY_CONTENT: FeaturedDoctorsLocaleContent = { title: "", subtitle: "", buttonLabel: "" };

/** Dil kopyası yoksa EN (kanonik dil), o da yoksa varsayılan dilin metni; o da yoksa boş (Paket O). */
export function resolveFeaturedDoctorsContent(block: FeaturedDoctorsBlock, siteContext?: BlockSiteContext): FeaturedDoctorsLocaleContent {
  const content = block.data.content ?? {};
  if (siteContext) return content[siteContext.lang] ?? content.en ?? content[siteContext.defaultLocaleCode] ?? EMPTY_CONTENT;
  return Object.values(content)[0] ?? EMPTY_CONTENT;
}

/**
 * Seçilen id'leri, seçim sırasıyla aktif doktor listesine eşler. Public `/doctors` yalnızca aktif
 * doktorları döndürdüğü için pasif/silinmiş bir doktorun id'si burada kendiliğinden düşer.
 */
export function pickFeaturedDoctors(doctors: DoctorProfile[], doctorIds: readonly string[]): DoctorProfile[] {
  const byId = new Map(doctors.map((doctor) => [doctor.id, doctor]));
  return doctorIds.flatMap((id) => {
    const doctor = byId.get(id);
    return doctor && doctor.isActive ? [doctor] : [];
  });
}

/**
 * Paket D — `source: "all"`: public `/doctors` yanıtı zaten aktif + arşivsiz doktorları `seq` sırasıyla
 * döndürür; filtre burada da tekrarlanır (savunma). Seçili kaynakta en fazla `featuredDoctorsMax(layout)`.
 */
export function resolveFeaturedDoctors(doctors: DoctorProfile[], data: FeaturedDoctorsBlock["data"]): DoctorProfile[] {
  if (data.source === "all") return doctors.filter((doctor) => doctor.isActive && !doctor.archivedAt);
  return pickFeaturedDoctors(doctors, (data.doctorIds ?? []).slice(0, featuredDoctorsMax(data.layout)));
}

/**
 * Paket P (İş 3) — piramit yerleşimi: kurucu (gösterilen listede varsa) üstte, diğerleri altında.
 * "Tüm doktorlar" kaynağında diğerleri kadro katmanı → `order` sırasıyla; seçili kaynakta seçim sırası
 * korunur. Kurucu listede yoksa `null` → blok ızgara gibi davranır.
 */
export function splitFounderPyramid(
  doctors: DoctorProfile[],
  source: FeaturedDoctorsBlock["data"]["source"]
): { founder: DoctorProfile; others: DoctorProfile[] } | null {
  const founder = doctors.find((doctor) => doctor.isFounder);
  if (!founder) return null;
  const others = doctors.filter((doctor) => doctor.id !== founder.id);
  if (source === "all") others.sort((a, b) => (a.rosterTier ?? 99) - (b.rosterTier ?? 99) || a.order - b.order);
  return { founder, others };
}

/** `bio`'nun ilk cümlesi (kurucu kartındaki kısa tanıtım); en fazla ~220 karakter. */
export function firstSentence(text: string | null | undefined, max = 220): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const match = clean.match(/^(.+?[.!?])(\s|$)/);
  const sentence = match ? match[1]! : clean;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

/** Kart alt satırı: `subSpecialty` doluysa o, değilse birincil uzmanlığın adı. */
export function featuredDoctorSpecialtyText(doctor: DoctorProfile): string {
  return doctor.subSpecialty?.trim() || doctor.specialty?.name || "";
}

/**
 * Öne Çıkan Doktorlar (Paket A3, Paket D). Gösterilecek doktor yoksa hiçbir şey render edilmez.
 * Kartın tamamı tek bir bağlantıdır (`/doctors/<slug>`), erişilebilir adı doktorun ünvan + adıdır.
 */
export async function FeaturedDoctorsBlockView({
  block,
  chrome,
  siteContext,
}: {
  block: FeaturedDoctorsBlock;
  chrome: BlockChrome;
  siteContext?: BlockSiteContext;
}) {
  const { data } = block;
  if (data.source !== "all" && (data.doctorIds ?? []).length === 0) return null;
  const doctors = resolveFeaturedDoctors(await fetchAllDoctorsServer(10, siteContext?.lang), data);
  if (doctors.length === 0) return null;

  const { title, subtitle, buttonLabel } = resolveFeaturedDoctorsContent(block, siteContext);
  const localizedHref = (path: string) => (siteContext ? withLocalePrefix(path, siteContext.lang, siteContext.defaultLocaleCode) : path);
  const dict = await getSiteDictionary(siteContext?.lang ?? "tr");
  // Paket O — boş bırakılan düğme metni sabit TR/EN yerine site sözlüğünden (6 dil).
  const allButtonLabel = buttonLabel || dict.about.viewAllDoctorsCta;
  const shape = data.imageShape ?? "oval";
  const renderCard = (doctor: DoctorProfile) => <FeaturedDoctorCard doctor={doctor} href={localizedHref(`/physicians/${doctor.slug}`)} shape={shape} />;
  const pyramid = data.layout === "pyramid" ? splitFounderPyramid(doctors, data.source) : null;

  return (
    <section className={cn("featured-doctors", chrome === "page" && "px-4 py-16 sm:px-6")}>
      <div className="mx-auto w-full max-w-7xl">
        {(title || subtitle) && (
          <div className="mx-auto mb-10 max-w-2xl text-center">
            {title && <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{title}</h2>}
            {subtitle && <p className="mt-3 text-base leading-relaxed text-foreground/70">{subtitle}</p>}
          </div>
        )}
        {data.layout === "carousel" ? (
          <FeaturedDoctorsCarousel
            autoplay={data.autoplay === true}
            labels={{
              region: title || dict.telehealth.featuredDoctorsCarouselLabel,
              previous: dict.telehealth.featuredDoctorsPrevious,
              next: dict.telehealth.featuredDoctorsNext,
              goToPage: dict.telehealth.featuredDoctorsGoToPage,
              pause: dict.telehealth.featuredDoctorsPause,
              play: dict.telehealth.featuredDoctorsPlay,
            }}
            items={doctors.map((doctor) => ({ key: doctor.id, node: renderCard(doctor) }))}
          />
        ) : pyramid ? (
          // Paket P — piramit: kurucu üstte ortada (mobilde tam genişlik), ince ayraç, diğerleri altında
          // ortalanmış sıralar (masaüstü 3/4, mobil 2 sütun; son sıra da ortalanır). RTL'de flex aynalanır.
          <div className="flex flex-col items-center" data-testid="featured-doctors-pyramid">
            <div className="w-full sm:max-w-md">
              <FounderCard
                doctor={pyramid.founder}
                href={localizedHref(`/physicians/${pyramid.founder.slug}`)}
                badge={dict.telehealth.founderBadge}
              />
            </div>
            {pyramid.others.length > 0 && (
              <>
                <span aria-hidden="true" className="my-3 h-10 w-px bg-border" data-testid="pyramid-connector" />
                <ul className="flex w-full flex-wrap justify-center gap-6">
                  {pyramid.others.map((doctor) => (
                    <li
                      key={doctor.id}
                      className={cn("flex min-w-0 w-[calc(50%-12px)]", data.columns === 3 ? "lg:w-[calc(33.333%-16px)]" : "lg:w-[calc(25%-18px)]")}
                    >
                      {renderCard(doctor)}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : (
          <ul className={cn("grid grid-cols-1 gap-6 sm:grid-cols-2", DESKTOP_COLUMNS_CLASS[data.columns] ?? DESKTOP_COLUMNS_CLASS[4])}>
            {doctors.map((doctor) => (
              <li key={doctor.id} className="flex min-w-0">
                {renderCard(doctor)}
              </li>
            ))}
          </ul>
        )}
        {data.showAllButton && (
          <div className="mt-10 flex justify-center">
            <Link
              href={localizedHref("/physicians")}
              className="inline-flex items-center justify-center rounded-[var(--site-radius)] border border-[var(--site-primary)] px-6 py-2.5 text-sm font-semibold text-[var(--site-primary)] transition-colors hover:bg-[var(--site-primary)] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]"
            >
              {allButtonLabel}
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Paket P (İş 3) — kurucu kartı: daha büyük oval görsel, "Kurucu" rozeti (6 dil), unvan ve ad,
 * uzmanlıklar ve `bio`'nun ilk cümlesi. Sade; organizasyon şeması değil.
 */
function FounderCard({ doctor, href, badge }: { doctor: DoctorProfile; href: string; badge: string }) {
  const displayName = `${doctor.title} ${publicDoctorName(doctor)}`.trim();
  const specialties = [doctor.specialty?.name, ...(doctor.additionalSpecialties ?? []).map((s) => s.name)].filter(Boolean).join(" · ");
  const intro = firstSentence(doctor.bio);
  return (
    <Link
      href={href}
      aria-label={`${badge}: ${displayName}`}
      data-testid="featured-founder-card"
      className="group flex w-full flex-col items-center rounded-[var(--site-radius)] px-4 py-6 text-center transition-shadow duration-300 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)]"
    >
      <span className={cn("relative block w-full max-w-[260px] overflow-hidden bg-muted", SHAPE_CLASS.oval)}>
        <span className="block h-full w-full [&_img]:object-top">
          <DoctorAvatarMedia doctor={doctor} sizeClassName="h-full w-full" textClassName="text-5xl" sizes="260px" />
        </span>
      </span>
      <span className="mt-4 inline-flex items-center rounded-full bg-[var(--site-primary)]/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--site-primary)]">
        {badge}
      </span>
      <span className="mt-3 text-xl font-semibold leading-7 text-foreground group-hover:text-[var(--site-primary)]">{displayName}</span>
      {specialties && <span className="mt-1 text-sm text-foreground/65">{specialties}</span>}
      {intro && <span className="mt-3 max-w-prose text-sm leading-6 text-foreground/75">{intro}</span>}
    </Link>
  );
}

/**
 * Paket D — tüm kartlar AYNI DOM ve tipografi: isim/uzmanlık en fazla 2 satır (`line-clamp-2`) ve
 * sabit iki satırlık `min-h` ile tek satırlık metinler de aynı yeri kaplar, alt satırlar hizalı başlar.
 */
function FeaturedDoctorCard({ doctor, href, shape }: { doctor: DoctorProfile; href: string; shape: FeaturedDoctorsImageShape }) {
  const displayName = `${doctor.title} ${publicDoctorName(doctor)}`.trim();
  const specialtyText = featuredDoctorSpecialtyText(doctor);

  return (
    <Link
      href={href}
      aria-label={displayName}
      className="group flex h-full w-full flex-col items-center rounded-[var(--site-radius)] px-4 py-6 text-center transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <span className={cn("relative block w-full max-w-[220px] overflow-hidden bg-muted", SHAPE_CLASS[shape] ?? SHAPE_CLASS.oval)}>
        {/* Hover'da fotoğraf hafifçe yakınlaşır; `DoctorAvatarMedia` Docker iç medya host'unu ve fotoğrafsız monogramı yönetir.
            Sabit oran + `object-cover`; `[&_img]:object-top` yüzü kadrajda tutar. */}
        <span className="block h-full w-full transition-transform duration-500 [&_img]:object-top group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100">
          <DoctorAvatarMedia doctor={doctor} sizeClassName="h-full w-full" textClassName="text-4xl" sizes="220px" />
        </span>
      </span>
      <span
        title={displayName}
        className="featured-doctor-name mt-5 line-clamp-2 min-h-14 w-full text-lg font-semibold leading-7 text-foreground transition-colors group-hover:text-[var(--site-primary)]"
      >
        {displayName}
      </span>
      <span title={specialtyText || undefined} className="featured-doctor-specialty mt-1 line-clamp-2 min-h-10 w-full text-sm leading-5 text-foreground/65">
        {specialtyText}
      </span>
    </Link>
  );
}
