import Link from "next/link";
import { cn } from "@/lib/utils";
import { fetchSpecialtiesServer } from "@/lib/api/server-telehealth";
import { resolveIcon } from "@/lib/page-builder/icon-options";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import type { Specialty } from "@/lib/api/types";
import type { BlockChrome, SpecialtyCardsBlock, SpecialtyCardsColumns, SpecialtyCardsImageShape } from "@/lib/page-builder/types";
import type { BlockSiteContext } from "./index";

/** Mobil 2, tablet (md) 3 SABİT; masaüstü (lg) blok ayarından. Tailwind tam sınıf adları (JIT). */
const DESKTOP_COLUMNS_CLASS: Record<SpecialtyCardsColumns, string> = {
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  6: "lg:grid-cols-6",
};

const SHAPE_CLASS: Record<SpecialtyCardsImageShape, string> = {
  circle: "rounded-full",
  square: "rounded-none",
  rounded: "rounded-[calc(var(--site-radius)+0.25rem)]",
};

/** `icon-box-block.tsx`deki AYNI `react-hooks/static-components` yanlış-pozitifi kaçınma deseni. */
function iconGlyph(name: string, className: string) {
  const Icon = resolveIcon(name);
  return <Icon className={className} aria-hidden="true" />;
}

/** Dil kopyası yoksa varsayılan dilin başlığı; o da yoksa başlıksız. */
function resolveContent(block: SpecialtyCardsBlock, siteContext?: BlockSiteContext) {
  const content = block.data.content ?? {};
  if (siteContext) return content[siteContext.lang] ?? content[siteContext.defaultLocaleCode] ?? { title: "", subtitle: "" };
  return Object.values(content)[0] ?? { title: "", subtitle: "" };
}

/**
 * Uzmanlık Kartları — Uzmanlıklar modülünden aktif uzmanlıklar (modüldeki `order` sırasıyla,
 * `GET /specialties`). Modül kapalıysa/uzmanlık yoksa hiçbir şey render edilmez.
 *
 * Eşit kart yüksekliği: ızgara `auto-rows-fr` (tüm satırlar en uzun kart kadar) + ad için 2
 * satırlık, açıklama için 3 satırlık SABİT alan (`line-clamp` + `min-h`). Yazı boyutları sabittir
 * (ad 16px, açıklama 14px) — kart içeriğine göre değişmez. Kartın tamamı tek bir bağlantıdır;
 * erişilebilir adı uzmanlık adıdır (görsel dekoratif, `alt=""`).
 */
export async function SpecialtyCardsBlockView({
  block,
  chrome,
  siteContext,
}: {
  block: SpecialtyCardsBlock;
  chrome: BlockChrome;
  siteContext?: BlockSiteContext;
}) {
  const specialties = await fetchSpecialtiesServer();
  if (specialties.length === 0) return null;

  const { title, subtitle } = resolveContent(block, siteContext);

  return (
    <section className={cn("specialty-cards", chrome === "page" && "px-4 py-16 sm:px-6")}>
      <div className="mx-auto w-full max-w-7xl">
        {(title || subtitle) && (
          <div className="mx-auto mb-8 max-w-2xl text-center sm:mb-10">
            {title && <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{title}</h2>}
            {subtitle && <p className="mt-3 text-base leading-relaxed text-foreground/70">{subtitle}</p>}
          </div>
        )}
        <SpecialtyCardsGrid
          specialties={specialties}
          siteContext={siteContext}
          columns={block.data.columns}
          imageShape={block.data.imageShape}
          showDescription={block.data.showDescription}
        />
      </div>
    </section>
  );
}

/**
 * Kart ızgarası — Uzmanlık Kartları bloğu ve anasayfa şablonunun "Uzmanlıklar" bölümü ORTAK kullanır
 * (aynı kart, aynı eşit yükseklik kuralları). Mobil 2, tablet 3, masaüstü `columns`.
 */
export function SpecialtyCardsGrid({
  specialties,
  siteContext,
  columns,
  imageShape = "circle",
  showDescription = true,
  appearance = "block",
}: {
  specialties: Specialty[];
  siteContext?: BlockSiteContext;
  columns: SpecialtyCardsColumns;
  imageShape?: SpecialtyCardsImageShape;
  showDescription?: boolean;
  /**
   * `home`: anasayfa şablonu tasarımı — 20 px köşe, 80 px vurgu (accent) tonlu daire, 6 kolonda da
   * küçültülmez, daha geniş aralık. Varsayılan (`block`) Uzmanlık Kartları bloğunun görünümüdür.
   */
  appearance?: "block" | "home";
}) {
  const home = appearance === "home";
  return (
    <ul
      className={cn(
        "grid auto-rows-fr grid-cols-2 md:grid-cols-3",
        home ? "gap-3 sm:gap-5" : "gap-3 sm:gap-4",
        DESKTOP_COLUMNS_CLASS[columns] ?? DESKTOP_COLUMNS_CLASS[4]
      )}
    >
      {specialties.map((specialty) => (
        <li key={specialty.id} className="min-w-0">
          <SpecialtyCard
            specialty={specialty}
            href={
              siteContext
                ? withLocalePrefix(`/specialties/${specialty.slug}`, siteContext.lang, siteContext.defaultLocaleCode)
                : `/specialties/${specialty.slug}`
            }
            shape={imageShape}
            showDescription={showDescription}
            dense={columns === 6 && appearance !== "home"}
            home={appearance === "home"}
          />
        </li>
      ))}
    </ul>
  );
}

function SpecialtyCard({
  specialty,
  href,
  shape,
  showDescription,
  dense,
  home = false,
}: {
  specialty: Specialty;
  href: string;
  shape: SpecialtyCardsImageShape;
  showDescription: boolean;
  dense: boolean;
  home?: boolean;
}) {
  const mediaSize = home ? "size-16 sm:size-20" : dense ? "size-16 sm:size-20 lg:size-16" : "size-16 sm:size-20";

  return (
    <Link
      href={href}
      className={cn(
        "group flex h-full flex-col items-center border border-border bg-surface px-3 text-center transition-[border-color,box-shadow] duration-200 hover:border-primary/40 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-primary)] sm:px-4",
        home ? "rounded-[20px] py-6 sm:py-8" : "rounded-[var(--site-radius)] py-5 sm:py-6"
      )}
    >
      <span className={cn("relative flex shrink-0 items-center justify-center overflow-hidden", mediaSize, SHAPE_CLASS[shape])}>
        {specialty.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- ekip bloğuyla aynı: medya kütüphanesi URL'i, sabit boyut
          <img src={specialty.imageUrl} alt="" width={80} height={80} loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <span
            className={cn(
              "flex h-full w-full items-center justify-center",
              home
                ? "bg-[color-mix(in_oklch,var(--site-accent)_18%,var(--site-surface))] text-[var(--site-primary)]"
                : "bg-[color-mix(in_oklch,var(--site-primary)_10%,var(--site-surface))] text-[var(--site-primary)]"
            )}
          >
            {iconGlyph(specialty.icon, "size-7 sm:size-8")}
          </span>
        )}
      </span>
      <h3 title={specialty.name} className="mt-4 line-clamp-2 min-h-[2.75rem] text-base leading-[1.375rem] font-semibold text-foreground">
        {specialty.name}
      </h3>
      {showDescription && (
        <p className="mt-1.5 line-clamp-3 min-h-[3.75rem] text-sm leading-5 text-foreground/65">{specialty.description ?? ""}</p>
      )}
    </Link>
  );
}
