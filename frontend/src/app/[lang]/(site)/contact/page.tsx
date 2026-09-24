import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, Mail, MapPin, MessageCircle, Phone, ExternalLink } from "lucide-react";
import { fetchContactPageServer } from "@/lib/api/server-contact";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { fetchSpecialtiesServer, fetchTelehealthThemeServer } from "@/lib/api/server-telehealth";
import { isModuleEnabledServer } from "@/lib/api/server-modules";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { resolveEmergencyNotice } from "@/lib/emergency-notice";
import { EmergencyNoticeCard } from "@/components/site/telehealth/emergency-notice";
import { ContactPageForm } from "@/components/site/contact/contact-page-form";
import { Eyebrow } from "@/components/site/about/eyebrow";
import { aboutSerif } from "@/components/site/about/about-fonts";
import { aboutContainerClass } from "@/components/site/about/about-buttons";
import type { ContactPageLocale } from "@/lib/api/types";
import { cn } from "@/lib/utils";

type PageProps = { params: Promise<{ lang: string }> };

function contactLocale(lang: string): ContactPageLocale {
  return lang === "tr" ? "tr" : "en";
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang } = await params;
  const [page, dict] = await Promise.all([fetchContactPageServer(contactLocale(lang)), getSiteDictionary(lang)]);
  if (!page) return {};
  return {
    title: page.content.title || dict.contact.metaTitle,
    description: page.content.intro || dict.contact.metaDescription,
  };
}

/** Adres → harita bağlantısı: admin'in Google Haritalar bağlantısı, yoksa adres araması. */
function mapsHref(mapUrl: string, address: string): string | null {
  if (mapUrl) return mapUrl;
  if (address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  return null;
}

const CARD_CLASS = "rounded-[24px] border border-border bg-surface p-6 sm:p-7";

/**
 * `/contact` — içerik admin → İletişim → "İletişim sayfası"ndan (dil başına); boş alanlar sözlük
 * varsayılanına düşer ya da (iletişim kanalları) hiç gösterilmez. Başlık stili Hakkımızda ile aynı
 * (Newsreader, `.about-serif`); renkler `--site-*` token'larından (`.contact-page`, globals.css).
 * Masaüstü 7/12 form + 5/12 bilgi kartları; mobilde tek kolon: başlık → Ara/WhatsApp → form → kartlar.
 */
export default async function ContactPage({ params }: PageProps) {
  const { lang } = await params;
  const locale = contactLocale(lang);
  const [page, dict, locales, telehealthEnabled] = await Promise.all([
    fetchContactPageServer(locale),
    getSiteDictionary(lang),
    fetchLocalesServer(),
    isModuleEnabledServer("telehealth"),
  ]);
  if (!page) notFound();

  const [specialties, telehealthSettings] = telehealthEnabled
    ? await Promise.all([fetchSpecialtiesServer(), fetchTelehealthThemeServer()])
    : [[], null];

  const t = dict.contact;
  const content = page.content;
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const homeHref = withLocalePrefix("/", lang, defaultLocaleCode);
  const privacyHref = page.privacyPage
    ? withLocalePrefix(`/${page.privacyPage.localizedSlugs[lang] ?? page.privacyPage.slug}`, lang, defaultLocaleCode)
    : null;
  const telHref = content.phone ? `tel:${content.phone.replace(/[^\d+]/g, "")}` : null;
  const whatsappHref = page.whatsappDigits ? `https://wa.me/${page.whatsappDigits}` : null;
  const addressMapHref = mapsHref(page.mapUrl, content.address);
  const emergency = telehealthEnabled ? resolveEmergencyNotice(telehealthSettings, lang, dict.telehealth) : null;
  const hours = content.hours.filter((row) => row.label || row.value);

  const detailRows = [
    telHref && { icon: Phone, label: t.phoneRowLabel, value: content.phone, href: telHref, external: false },
    whatsappHref && { icon: MessageCircle, label: t.whatsappRowLabel, value: content.whatsapp, href: whatsappHref, external: true },
    content.email && { icon: Mail, label: t.emailRowLabel, value: content.email, href: `mailto:${content.email}`, external: false },
    content.address && { icon: MapPin, label: t.addressRowLabel, value: content.address, href: addressMapHref, external: true },
  ].filter(Boolean) as { icon: typeof Phone; label: string; value: string; href: string | null; external: boolean }[];

  return (
    <div className={cn("contact-page", aboutSerif.variable)}>
      <section className="bg-background">
        <div className={cn(aboutContainerClass, "pt-8 pb-16 sm:pt-10 lg:pb-24")}>
          <nav aria-label="Breadcrumb" className="text-sm text-[var(--about-muted-text)]">
            <ol className="flex items-center gap-2">
              <li>
                <Link href={homeHref} className="inline-flex min-h-11 items-center hover:text-foreground hover:underline">
                  {dict.common.home}
                </Link>
              </li>
              <li aria-hidden="true">/</li>
              <li aria-current="page" className="font-medium text-foreground">
                {t.breadcrumbCurrent}
              </li>
            </ol>
          </nav>

          <header className="mt-6 max-w-3xl lg:mt-10">
            <Eyebrow>{t.eyebrow}</Eyebrow>
            <h1 className="about-serif mt-5 text-4xl leading-[1.1] tracking-tight text-foreground sm:text-5xl lg:text-[56px]">
              {content.title || t.title}
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-[var(--about-body-text)] sm:text-lg">{content.intro || t.intro}</p>

            {(telHref || whatsappHref) && (
              <div className="mt-6 flex gap-3 lg:hidden">
                {telHref && (
                  <a
                    href={telHref}
                    className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-primary px-5 text-base font-semibold text-primary-foreground"
                  >
                    <Phone className="size-5" aria-hidden="true" />
                    {t.callButton}
                  </a>
                )}
                {whatsappHref && (
                  <a
                    href={whatsappHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full border border-primary px-5 text-base font-semibold text-primary"
                  >
                    <MessageCircle className="size-5" aria-hidden="true" />
                    {t.whatsappButton}
                  </a>
                )}
              </div>
            )}
          </header>

          <div className="mt-10 grid gap-6 lg:mt-12 lg:grid-cols-12 lg:gap-8">
            <div className={cn(CARD_CLASS, "relative lg:col-span-7 lg:self-start lg:p-9")}>
              <h2 className="text-2xl font-semibold text-foreground">{t.formTitle}</h2>
              <p className="mt-1.5 text-sm text-[var(--about-muted-text)]">{t.requiredNote}</p>
              <div className="mt-6">
                <ContactPageForm
                  dict={t}
                  locale={locale}
                  displayLocale={lang}
                  consent={page.consent}
                  privacyHref={privacyHref}
                  treatments={specialties.map((s) => ({ slug: s.slug, name: s.name }))}
                  treatmentNotSure={page.treatmentNotSure}
                  responseTime={content.responseTime || t.responseTimeDefault}
                  defaultPhoneCountry={locale === "tr" ? "TR" : ""}
                />
              </div>
            </div>

            <aside className="space-y-6 lg:col-span-5">
              {detailRows.length > 0 && (
                <section className={CARD_CLASS} aria-labelledby="contact-details-title">
                  <h2 id="contact-details-title" className="text-lg font-semibold text-foreground">
                    {t.contactDetailsTitle}
                  </h2>
                  <ul className="mt-5 space-y-4">
                    {detailRows.map((row) => {
                      const Icon = row.icon;
                      return (
                        <li key={row.label} className="flex items-start gap-4">
                          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--about-accent-tint)] text-primary">
                            <Icon className="size-5" aria-hidden="true" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--about-muted-text)]">{row.label}</p>
                            {row.href ? (
                              <a
                                href={row.href}
                                {...(row.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                                className="inline-flex min-h-11 items-center break-words text-base font-medium text-foreground underline-offset-4 hover:text-primary hover:underline"
                              >
                                {row.value}
                              </a>
                            ) : (
                              <p className="text-base font-medium text-foreground">{row.value}</p>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {hours.length > 0 && (
                <section className={CARD_CLASS} aria-labelledby="contact-hours-title">
                  <h2 id="contact-hours-title" className="flex items-center gap-2 text-lg font-semibold text-foreground">
                    <Clock className="size-5 text-primary" aria-hidden="true" />
                    {t.hoursTitle}
                  </h2>
                  <dl className="mt-4 divide-y divide-border">
                    {hours.map((row, index) => (
                      <div key={`${row.label}-${index}`} className="flex items-baseline justify-between gap-4 py-2.5 text-base">
                        <dt className="text-[var(--about-body-text)]">{row.label}</dt>
                        <dd className="text-right font-medium text-foreground">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}

              {emergency && <EmergencyNoticeCard text={emergency.summary} />}

              {addressMapHref && (
                <section className={cn(CARD_CLASS, "overflow-hidden p-0 sm:p-0")} aria-labelledby="contact-map-title">
                  <h2 id="contact-map-title" className="sr-only">
                    {t.mapTitle}
                  </h2>
                  {page.mapImageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- medya kütüphanesi URL'i; üçüncü taraf harita/iframe YOK
                    <img src={page.mapImageUrl} alt={t.mapImageAlt} loading="lazy" className="aspect-[16/10] w-full object-cover" />
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-3 p-5">
                    {content.address && <p className="min-w-0 text-sm text-[var(--about-body-text)]">{content.address}</p>}
                    <a
                      href={addressMapHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary px-4 text-sm font-semibold text-primary hover:bg-primary hover:text-primary-foreground"
                    >
                      {t.openInMaps}
                      <ExternalLink className="size-4" aria-hidden="true" />
                    </a>
                  </div>
                </section>
              )}
            </aside>
          </div>
        </div>
      </section>
    </div>
  );
}
