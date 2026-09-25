import Link from "next/link";
import { AlertTriangle, ArrowRight, Lock } from "lucide-react";
import { SafeImage } from "@/components/site/safe-image";
import { Eyebrow } from "@/components/site/about/eyebrow";
import { aboutContainerClass } from "@/components/site/about/about-buttons";
import { ABOUT_ICONS } from "@/components/site/about/about-icons";
import { AboutDoctors } from "@/components/site/about/about-doctors";
import { SpecialtyCardsGrid } from "@/components/site/blocks/specialty-cards-block";
import type { BlockSiteContext } from "@/components/site/blocks/index";
import { buttonVariants } from "@/components/ui/button";
import { fetchDoctorsServer, fetchSpecialtiesServer, fetchTelehealthThemeServer } from "@/lib/api/server-telehealth";
import { isModuleEnabledServer } from "@/lib/api/server-modules";
import { getSiteDictionary, formatSiteString } from "@/lib/i18n/site-dictionaries";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";
import { resolveAboutHref, selectAboutDoctors, type AboutIconKey } from "@/lib/about-page";
import { resolveEmergencyNotice } from "@/lib/emergency-notice";
import { buildDefaultHomeContent, HOME_HOW_ANCHOR, resolveHomeContent, type HomePageContent } from "@/lib/home-page";
import { cn } from "@/lib/utils";
import { toOptimizableMediaUrl } from "@/lib/env";

/**
 * Hero görseli için yer tutucu — görsel yüklenene kadar kutu primary'nin çok açık tonunda durur.
 * Kutu `aspect-ratio` ile SABİT oranlıdır (CLS yok); next/image `placeholder` olarak 1×1 SVG verilir.
 */
const HERO_PLACEHOLDER =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiNlNmYwZWUiLz48L3N2Zz4=";

/** `react-hooks/static-components` yanlış-pozitifinden kaçınma deseni (bkz. icon-box-block.tsx). */
function iconGlyph(key: AboutIconKey, className: string) {
  const Icon = ABOUT_ICONS[key];
  return <Icon className={className} aria-hidden="true" />;
}

/** Tasarım ölçüleri (design/home-*.png): bölüm dikey boşluğu mobil 64 px, masaüstü 112 px. */
const SECTION_Y = "py-16 lg:py-28";
const H2_CLASS = "about-serif mt-5 text-[32px] leading-[1.15] text-foreground sm:text-4xl lg:text-[44px]";
const DESKTOP_GRID_COLS: Record<number, string> = { 1: "lg:grid-cols-1", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4" };
/** Vurgu (accent) rengin açık tonu — ikon kutuları (tasarımdaki açık mavi). */
const ACCENT_TINT = "bg-[color-mix(in_oklch,var(--site-accent)_18%,var(--site-surface))]";

const pill = "h-[52px] rounded-full px-7 text-base font-semibold";
const homeButton = {
  primary: cn(buttonVariants({ variant: "default" }), pill, "gap-2"),
  /** Beyaz zemin, ince kenarlık, koyu metin (tasarımdaki "How it works"). */
  secondary: cn(buttonVariants({ variant: "outline" }), pill, "border-border bg-surface text-foreground hover:bg-surface hover:border-primary/50"),
  onPrimarySolid: cn(buttonVariants({ variant: "default" }), pill, "h-14 bg-primary-foreground text-primary hover:bg-primary-foreground/90"),
  onPrimaryOutline: cn(
    buttonVariants({ variant: "outline" }),
    pill,
    "h-14 border-primary-foreground/60 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
  ),
};

/**
 * "Anasayfa" şablonu (`home-page` bloğu) — Hakkımızda/İletişim ile aynı görsel dil: Newsreader
 * başlıklar (`.about-serif`), `--site-accent` çizgili eyebrow, `--site-*` renkleri. Bölüm sırası
 * sabit; her bölüm admin'den gizlenebilir. Metinler: aktif dilin bloğu, boş alan → sözlük.
 * Uzmanlıklar/doktorlar modülden gelir (modül kapalıysa o bölümler görünmez). Ölçüler
 * `design/home-desktop.png`, `design/home-mobile.png` tasarımlarına göredir.
 */
export async function HomePageView({ data, siteContext }: { data: unknown; siteContext?: BlockSiteContext }) {
  const lang = siteContext?.lang ?? "en";
  const defaultLocaleCode = siteContext?.defaultLocaleCode ?? lang;
  const dict = await getSiteDictionary(lang);
  const content = resolveHomeContent(data, buildDefaultHomeContent(dict.home));
  const href = (value: string) => resolveAboutHref(value, lang, defaultLocaleCode);

  const telehealthEnabled = await isModuleEnabledServer("telehealth");
  const [specialties, allDoctors, telehealthSettings] = telehealthEnabled
    ? await Promise.all([
        content.specialties.enabled ? fetchSpecialtiesServer() : Promise.resolve([]),
        content.doctors.enabled ? fetchDoctorsServer({}) : Promise.resolve([]),
        fetchTelehealthThemeServer(),
      ])
    : [[], [], null];

  const { doctors } = selectAboutDoctors(allDoctors, null, content.doctors.count);
  const showHow = content.how.enabled && content.how.steps.length > 0;
  const emergencySummary = resolveEmergencyNotice(telehealthSettings, lang, dict.telehealth).summary;
  // "#how" çapası gizli bir bölüme işaret ediyorsa ölü link render edilmez.
  const heroSecondaryHref =
    content.hero.secondaryCta.href === HOME_HOW_ANCHOR && !showHow ? null : href(content.hero.secondaryCta.href);
  const specialtiesHref = href("/specialties");

  return (
    // Newsreader font sınıfı (`aboutSerif.variable`) bu bileşende DEĞİL, sayfayı render eden rotada
    // (`(site)/page.tsx`, `(site)/[slug]/page.tsx`) yalnızca şablon sayfalarında eklenir — blok
    // render zinciri (admin önizleme dahil) font modülünü içe aktarmaz.
    <div className="home-page">
      {content.hero.enabled && (
        <HomeHero hero={content.hero} primaryHref={href(content.hero.primaryCta.href)} secondaryHref={heroSecondaryHref} />
      )}
      {content.trust.enabled && content.trust.items.length > 0 && <TrustStrip items={content.trust.items} />}
      {content.specialties.enabled && specialties.length > 0 && (
        <section className="bg-background" aria-labelledby="home-specialties-title">
          <div className={cn(aboutContainerClass, SECTION_Y)}>
            <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
              <div className="max-w-2xl">
                <Eyebrow>{content.specialties.eyebrow}</Eyebrow>
                <h2 id="home-specialties-title" className={H2_CLASS}>
                  {content.specialties.title}
                </h2>
              </div>
              {/* Masaüstünde başlığın sağında; mobilde ızgaranın ALTINDA ortalı (aşağıdaki kopya). */}
              <ViewAllLink href={specialtiesHref} label={content.specialties.viewAllLabel} className="hidden sm:inline-flex" />
            </div>
            <div className="mt-10 lg:mt-12">
              <SpecialtyCardsGrid
                specialties={specialties}
                siteContext={siteContext}
                columns={content.specialties.columns}
                showDescription={false}
                appearance="home"
              />
            </div>
            <div className="mt-8 flex justify-center sm:hidden">
              <ViewAllLink href={specialtiesHref} label={content.specialties.viewAllLabel} />
            </div>
          </div>
        </section>
      )}
      {showHow && <HowItWorks how={content.how} stepLabel={dict.home.stepLabel} />}
      {content.doctors.enabled && doctors.length > 0 && (
        <AboutDoctors
          section={{ ...content.doctors, founderDoctorId: null, founderLabel: "" }}
          telehealthDict={dict.telehealth}
          doctors={doctors}
          founderId={null}
          doctorsHref={href("/doctors")}
          activeLocaleCode={lang}
          defaultLocaleCode={defaultLocaleCode}
          intlLocale={contentLocaleToIntl(lang)}
          variant="home"
        />
      )}
      {content.closing.enabled && (
        <HomeClosing
          closing={content.closing}
          primaryHref={href(content.closing.primaryCta.href)}
          secondaryHref={href(content.closing.secondaryCta.href)}
          emergencySummary={emergencySummary}
        />
      )}
    </div>
  );
}

function ViewAllLink({ href, label, className }: { href: string; label: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn("inline-flex min-h-11 items-center gap-2 text-[15px] font-semibold text-primary underline-offset-4 hover:underline", className)}
    >
      {label}
      <ArrowRight className="size-4" aria-hidden="true" />
    </Link>
  );
}

function HomeHero({
  hero,
  primaryHref,
  secondaryHref,
}: {
  hero: HomePageContent["hero"];
  primaryHref: string;
  secondaryHref: string | null;
}) {
  return (
    <section className="border-b border-border bg-background" aria-labelledby="home-hero-title">
      <div
        className={cn(
          aboutContainerClass,
          "grid items-center gap-8 pt-10 pb-12 sm:pt-14 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-16 lg:pt-20 lg:pb-24"
        )}
      >
        <div>
          <Eyebrow>{hero.eyebrow}</Eyebrow>
          <h1
            id="home-hero-title"
            className="about-serif mt-5 text-[40px] leading-[1.12] tracking-tight text-foreground sm:text-5xl lg:mt-6 lg:text-[64px] lg:leading-[1.06]"
          >
            {hero.title}
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-[var(--about-body-text)] lg:mt-8 lg:text-lg">{hero.body}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:mt-10 lg:gap-4">
            <Link href={primaryHref} className={cn(homeButton.primary, "w-full sm:w-auto")}>
              {hero.primaryCta.label}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            {secondaryHref && (
              <Link href={secondaryHref} className={cn(homeButton.secondary, "w-full sm:w-auto")}>
                {hero.secondaryCta.label}
              </Link>
            )}
          </div>
        </div>

        {/* Görsel kutusu SABİT oranlı (mobil 7:6, masaüstü ~1:1) — görsel geç yüklense de düzen kaymaz. */}
        <div className="relative">
          <div className="relative aspect-[7/6] overflow-hidden rounded-[24px] bg-[color-mix(in_oklch,var(--site-primary)_9%,var(--site-surface))] lg:aspect-[536/540] lg:rounded-[28px]">
            {hero.imageUrl ? (
              <SafeImage
                src={toOptimizableMediaUrl(hero.imageUrl)}
                alt={hero.imageAlt}
                fill
                priority
                fetchPriority="high"
                sizes="(min-width: 1280px) 540px, (min-width: 1024px) 45vw, 100vw"
                placeholder={HERO_PLACEHOLDER}
                className="object-cover"
              />
            ) : (
              <div aria-hidden="true" className="h-full w-full bg-[radial-gradient(circle_at_30%_20%,color-mix(in_oklch,var(--site-accent)_16%,transparent),transparent_60%)]" />
            )}
          </div>
          {(hero.cardTitle || hero.cardText) && (
            // Masaüstünde kart görselin sol kenarından TAŞAR (tasarım); mobilde görselin içinde.
            <div className="absolute right-3.5 bottom-3.5 left-3.5 flex items-center gap-3 rounded-2xl bg-surface p-4 shadow-[0_16px_40px_-12px_rgba(15,23,42,0.22)] lg:right-auto lg:bottom-10 lg:-left-8 lg:w-auto lg:min-w-[278px] lg:max-w-[360px] lg:px-5">
              <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl text-primary", ACCENT_TINT)}>
                <Lock className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold leading-snug text-foreground">{hero.cardTitle}</p>
                {hero.cardText && <p className="text-[13px] text-[var(--about-muted-text)]">{hero.cardText}</p>}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Beyaz bant, üst/alt ince çizgi; maddeler kartsız (ikon kutusu + başlık + metin). */
function TrustStrip({ items }: { items: HomePageContent["trust"]["items"] }) {
  return (
    <section className="border-b border-border bg-surface" aria-label={items.map((item) => item.title).join(", ")}>
      <div className={cn(aboutContainerClass, "py-8 lg:py-10")}>
        <ul className={cn("grid gap-6 sm:grid-cols-2 lg:gap-16", DESKTOP_GRID_COLS[items.length])}>
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-4">
              <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-xl text-primary lg:size-[52px]", ACCENT_TINT)}>
                {iconGlyph(item.icon, "size-5")}
              </span>
              <div className="min-w-0">
                <p className="text-[17px] font-semibold text-foreground">{item.title}</p>
                {item.text && <p className="mt-1 text-[15px] leading-relaxed text-[var(--about-body-text)]">{item.text}</p>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * Masaüstü: ortalı başlık, adımlar yan yana (dolu primary daire, "STEP n", başlık, metin), daireler
 * arasında kesikli çizgi. Mobil: başlık sola hizalı, adımlar satır (daire solda, metin sağda).
 */
function HowItWorks({ how, stepLabel }: { how: HomePageContent["how"]; stepLabel: string }) {
  return (
    <section id="how" className="scroll-mt-24 bg-surface" aria-labelledby="home-how-title">
      <div className={cn(aboutContainerClass, SECTION_Y)}>
        <div className="max-w-2xl lg:mx-auto lg:text-center">
          <Eyebrow className="lg:hidden">{how.eyebrow}</Eyebrow>
          <Eyebrow align="center" className="hidden lg:flex">
            {how.eyebrow}
          </Eyebrow>
          <h2 id="home-how-title" className={H2_CLASS}>
            {how.title}
          </h2>
        </div>
        <ol className={cn("mt-10 grid gap-8 lg:mt-16 lg:gap-8", DESKTOP_GRID_COLS[how.steps.length])}>
          {how.steps.map((step, index) => (
            <li
              key={step.id}
              className={cn(
                "relative flex items-start gap-4 lg:flex-col lg:items-center lg:gap-0 lg:text-center",
                // Masaüstünde daireler arası kesikli bağlantı çizgisi (son adım hariç) — dekoratif.
                index < how.steps.length - 1 &&
                  "lg:after:pointer-events-none lg:after:absolute lg:after:top-8 lg:after:left-[calc(50%+2.5rem)] lg:after:w-[calc(100%-5rem+2rem)] lg:after:border-t-2 lg:after:border-dashed lg:after:border-border lg:after:content-['']"
              )}
            >
              <span className="flex size-[52px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground lg:size-16">
                {iconGlyph(step.icon, "size-5 lg:size-6")}
              </span>
              <div className="min-w-0 lg:mt-5">
                <p className="text-[13px] font-bold tracking-[0.12em] text-primary uppercase">
                  {formatSiteString(stepLabel, { number: index + 1 })}
                </p>
                <h3 className="mt-1 text-lg font-semibold text-foreground lg:mt-3 lg:text-xl">{step.title}</h3>
                {step.text && (
                  <p className="mt-1.5 text-[15px] leading-relaxed text-[var(--about-body-text)] lg:mx-auto lg:mt-3 lg:max-w-xs lg:text-base">
                    {step.text}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function HomeClosing({
  closing,
  primaryHref,
  secondaryHref,
  emergencySummary,
}: {
  closing: HomePageContent["closing"];
  primaryHref: string;
  secondaryHref: string;
  emergencySummary: string;
}) {
  return (
    <section className="bg-primary text-primary-foreground" aria-labelledby="home-closing-title">
      <div className={cn(aboutContainerClass, "flex flex-col items-start py-20 lg:items-center lg:py-28 lg:text-center")}>
        <span className="h-1 w-12 rounded-full bg-[var(--about-accent)]" aria-hidden="true" />
        <h2 id="home-closing-title" className="about-serif mt-6 text-[36px] leading-[1.12] sm:text-4xl lg:text-5xl">
          {closing.title}
        </h2>
        <div className="mt-8 flex w-full flex-col gap-4 sm:w-auto sm:flex-row sm:flex-wrap lg:justify-center">
          <Link href={primaryHref} className={cn(homeButton.onPrimarySolid, "w-full sm:w-auto")}>
            {closing.primaryCta.label}
          </Link>
          <Link href={secondaryHref} className={cn(homeButton.onPrimaryOutline, "w-full sm:w-auto")}>
            {closing.secondaryCta.label}
          </Link>
        </div>
        {/* TeleHealth acil durum uyarısının ÖZET metni — admin şerit anahtarından bağımsız, her zaman. */}
        <p role="note" className="mt-8 flex max-w-2xl items-start gap-2 text-sm font-medium leading-relaxed text-primary-foreground/90 lg:justify-center lg:text-[15px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{emergencySummary}</span>
        </p>
      </div>
    </section>
  );
}
