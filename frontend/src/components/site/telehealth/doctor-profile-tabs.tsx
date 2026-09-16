import { Award, ExternalLink, FileQuestion, GraduationCap, Briefcase, Stethoscope, Trophy, Users } from "lucide-react";
import type { DoctorCvEntry, DoctorCvEntryKind, DoctorProfile, DoctorPublication, DoctorPublicationKind } from "@/lib/api/types";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TelehealthStrings } from "@/lib/i18n/site-dictionaries";

/**
 * `.claude/design-notes-doctor-portfolio-console.md` §1.3/§1.4 — "Doktor Hakkında" / "Özgeçmiş" /
 * "Bilimsel Yayınlar" sekmeleri. `Tabs variant="line"` — içerik-gezinme semantiği ([DPI] §6 madde
 * 5 — sekmeler TEK URL'de kalır, `value` state'i istemcide tutulur).
 */

/**
 * Grid görevi (2026-09-14) — ui-designer turu. "Koyu kurumsal aktif tab çizgisi" talebi:
 * `components/ui/tabs.tsx`'in PAYLAŞILAN `variant="line"` taban stili (admin panelde de
 * kullanılıyor — global DOSYA değiştirilmedi) `text-primary`/`bg-primary/15` soft pill kullanıyor;
 * BURADA yalnızca bu sayfaya özel `className` override'ıyla (twMerge son sınıfı kazanır) aktif
 * sekme rengi `var(--site-secondary)` (koyu lacivert, hero bandıyla AYNI token) alt çizgisine +
 * metin rengine taşındı — teal `primary` yalnızca CTA/rozetlerde kalır, sekme vurgusu daha "koyu
 * kurumsal" hissetsin diye site'nin İKİNCİL markası kullanıldı (YENİ token İCAT EDİLMEDİ).
 * `data-active:scale-100` taban bileşenin hafif "zoom" efektini bu düz-çizgi tasarımda iptal eder.
 */
const TAB_TRIGGER_CLASS =
  "rounded-none px-3 py-2.5 text-sm font-semibold data-active:scale-100 data-active:rounded-none data-active:bg-transparent data-active:text-[var(--site-secondary)] data-active:after:bg-[var(--site-secondary)] group-data-horizontal/tabs:after:h-1 dark:data-active:bg-transparent dark:data-active:text-[var(--site-secondary)] sm:px-4";

function emptyStateText(dict: TelehealthStrings, tab: "about" | "cv" | "publications" | "expertise"): string {
  const map: Record<"about" | "cv" | "publications" | "expertise", string> = {
    about: dict.aboutEmpty,
    cv: dict.cvEmpty,
    publications: dict.publicationsEmpty,
    expertise: dict.expertiseEmpty,
  };
  return map[tab];
}

function EmptyTabState({ dict, tab }: { dict: TelehealthStrings; tab: "about" | "cv" | "publications" | "expertise" }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--site-radius)] border border-border bg-muted/30 p-8 text-center">
      <FileQuestion className="h-6 w-6 text-foreground/30" aria-hidden="true" />
      <p className="text-sm text-foreground/50">{emptyStateText(dict, tab)}</p>
    </div>
  );
}

const CV_KIND_ICON: Record<DoctorCvEntryKind, typeof GraduationCap> = {
  EDUCATION: GraduationCap,
  EXPERIENCE: Briefcase,
  CERTIFICATE: Award,
  MEMBERSHIP: Users,
  AWARD: Trophy,
};

function CvTimeline({ entries, dict }: { entries: DoctorCvEntry[]; dict: TelehealthStrings }) {
  if (entries.length === 0) return <EmptyTabState dict={dict} tab="cv" />;

  return (
    <ol className="relative space-y-8 border-l border-border pl-8">
      {entries.map((entry, idx) => {
        const KindIcon = CV_KIND_ICON[entry.kind];
        return (
          <li key={idx} className="relative">
            <span className="absolute -left-[calc(2rem+1px)] flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-foreground/60">
              <KindIcon className="h-4 w-4" aria-hidden="true" />
            </span>
            <p className="text-xs font-semibold uppercase tracking-wider text-foreground/50">
              {entry.startYear} — {entry.endYear ?? dict.cvOngoing}
            </p>
            <h3 className="mt-1 text-base font-semibold text-foreground">{entry.title}</h3>
            <p className="text-sm text-foreground/70">
              {entry.organization}
              {entry.location ? ` · ${entry.location}` : ""}
            </p>
            {entry.description && <p className="mt-2 text-sm leading-7 text-foreground/80">{entry.description}</p>}
          </li>
        );
      })}
    </ol>
  );
}

/** §1.4.3 — sabit grup SIRASI (doktorun veri sırasından BAĞIMSIZ, akademik gelenekteki önem sırası). */
const PUBLICATION_GROUP_ORDER: DoctorPublicationKind[] = [
  "INTERNATIONAL_ARTICLE",
  "NATIONAL_ARTICLE",
  "PROCEEDING",
  "BOOK_CHAPTER",
  "OTHER",
];

function publicationGroupLabel(dict: TelehealthStrings, kind: DoctorPublicationKind): string {
  const map: Record<DoctorPublicationKind, string> = {
    INTERNATIONAL_ARTICLE: dict.publicationInternational,
    NATIONAL_ARTICLE: dict.publicationNational,
    PROCEEDING: dict.publicationProceeding,
    BOOK_CHAPTER: dict.publicationBookChapter,
    OTHER: dict.publicationOther,
  };
  return map[kind];
}

function PublicationsList({ publications, dict }: { publications: DoctorPublication[]; dict: TelehealthStrings }) {
  if (publications.length === 0) return <EmptyTabState dict={dict} tab="publications" />;

  const grouped = new Map<DoctorPublicationKind, DoctorPublication[]>();
  for (const pub of publications) {
    const list = grouped.get(pub.kind) ?? [];
    list.push(pub);
    grouped.set(pub.kind, list);
  }

  return (
    <section className="space-y-8">
      {PUBLICATION_GROUP_ORDER.filter((g) => (grouped.get(g)?.length ?? 0) > 0).map((g) => (
        <div key={g}>
          <p className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-foreground/50 first:mt-0">
            {publicationGroupLabel(dict, g)}
          </p>
          <ul>
            {grouped.get(g)!.map((pub, idx) => {
              const href = pub.doi ? `https://doi.org/${pub.doi}` : pub.url;
              return (
                <li key={idx} className="border-b border-border/60 py-3 last:border-0">
                  <p className="text-sm font-medium text-foreground">{pub.title}</p>
                  <p className="mt-1 text-xs text-foreground/60">
                    {pub.authors ? `${pub.authors} · ` : ""}
                    {pub.venue} · {pub.year}
                  </p>
                  {href && (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      {dict.viewSource}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

/**
 * Grid görevi (2026-09-14) Görev 3 — "Uzmanlık Alanları" sekmesi, YENİ bir backend alanı/uç
 * İSTEMEDEN, TAMAMEN VAR OLAN alanlardan türetilir: `doctor.specialty?.name` (ana uzmanlık) +
 * `doctor.subSpecialty` (varsa) belirgin bir başlık/rozet olarak, ve `doctor.cvEntries`'in
 * `CERTIFICATE`/`MEMBERSHIP`/`AWARD` türündeki girdileri "Sertifikalar & Üyelikler" alt başlığı
 * altında SADE bir liste olarak (`CvTimeline`'ın dikey zaman çizelgesi BİREBİR TEKRARLANMAZ —
 * burası kronoloji değil, kategorize bir özet; ui-designer SONRA görsel inceltme yapacak).
 */
const EXPERTISE_CV_KINDS: DoctorCvEntryKind[] = ["CERTIFICATE", "MEMBERSHIP", "AWARD"];

function ExpertisePanel({ doctor, dict }: { doctor: DoctorProfile; dict: TelehealthStrings }) {
  const expertiseEntries = doctor.cvEntries.filter((entry) => EXPERTISE_CV_KINDS.includes(entry.kind));
  const hasSpecialty = Boolean(doctor.specialty?.name) || Boolean(doctor.subSpecialty);

  if (!hasSpecialty && expertiseEntries.length === 0) {
    return <EmptyTabState dict={dict} tab="expertise" />;
  }

  return (
    <div className="space-y-8">
      {hasSpecialty && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground/50">{dict.expertiseAreaLabel}</p>
          <div className="flex flex-wrap items-center gap-2">
            {doctor.specialty?.name && (
              <Badge tone="primary" size="lg" className="gap-1.5">
                <Stethoscope className="h-4 w-4" aria-hidden="true" />
                {doctor.specialty.name}
              </Badge>
            )}
            {doctor.subSpecialty && <span className="text-sm text-foreground/70">{doctor.subSpecialty}</span>}
          </div>
        </div>
      )}

      {expertiseEntries.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground/50">{dict.certificationsLabel}</p>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {expertiseEntries.map((entry, idx) => {
              const KindIcon = CV_KIND_ICON[entry.kind];
              return (
                <li key={idx} className="flex items-start gap-3 rounded-[var(--site-radius)] border border-border bg-surface p-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted/50 text-foreground/60">
                    <KindIcon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{entry.title}</p>
                    <p className="text-xs text-foreground/60">
                      {entry.organization} · {entry.startYear}
                      {entry.endYear ? `–${entry.endYear}` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * `.claude/architect-scope-i18n.md` §14.5 madde 9 — `dict.telehealth` sunucu ebeveyninden
 * (`doctors/[slug]/page.tsx`) prop olarak geçirilir. `async` YAPILMAZ — `doctor-profile-hero.tsx`'teki
 * AYNI gerekçe (qa-agent bulgusu: `@testing-library/react`/jsdom `async` Server Component'i
 * render EDEMEZ, §14.3'ün prop-drilling alternatifi tercih edilir).
 */
export function DoctorProfileTabs({ doctor, dict }: { doctor: DoctorProfile; dict: TelehealthStrings }) {
  return (
    <Tabs defaultValue="about">
      {/*
       * Grid görevi (2026-09-14) — qa-agent regresyon takibi. 4. sekme ("Uzmanlık Alanları")
       * eklenmesiyle `TabsList`'in (paylaşılan `components/ui/tabs.tsx`, `w-fit whitespace-nowrap`
       * taban stili — DOKUNULMADI) toplam genişliği mobil viewport'ta (375px) sayfayı yatay
       * kaydırılabilir hale getiriyordu. Çözüm: SADECE bu sayfaya özel `overflow-x-auto` sarmalayıcı
       * — taşma artık bu şeridin KENDİ İÇİNDE scroll olur, `document.body.scrollWidth` etkilenmez.
       * `-mx-4 px-4 sm:mx-0 sm:px-0` — mobilde kart iç boşluğuna taşan "edge-to-edge" scroll şeridi.
       */}
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <TabsList variant="line" className="border-b border-border">
          <TabsTrigger value="about" className={TAB_TRIGGER_CLASS}>
            {dict.tabAbout}
          </TabsTrigger>
          <TabsTrigger value="cv" className={TAB_TRIGGER_CLASS}>
            {dict.tabCv}
          </TabsTrigger>
          <TabsTrigger value="publications" className={TAB_TRIGGER_CLASS}>
            {dict.tabPublications}
          </TabsTrigger>
          <TabsTrigger value="expertise" className={TAB_TRIGGER_CLASS}>
            {dict.tabExpertise}
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="about" className="mt-6">
        <div className="space-y-8">
          <p className="whitespace-pre-line text-base leading-7 text-foreground/80">{doctor.bio}</p>

          {doctor.aboutHtml && (
            // [DPI] §1.2 — `aboutHtml` `lib/html-sanitize.ts`'ten GEÇMİŞ, GÜVENİLİR HTML'dir; okuma
            // yolunda yeniden sanitize EDİLMEZ. Projede `@tailwindcss/typography` KURULU DEĞİL —
            // design-notes §1.4.1'in "kurulu değilse" alternatifi izlenir: manuel seçicilerle düz
            // metin ritmi (İKİNCİ bir link/başlık rengi İCAT EDİLMEZ, `text-primary`/`text-foreground` kullanılır).
            <div
              className="max-w-prose space-y-3 text-sm leading-7 text-foreground/80 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:pl-5"
              dangerouslySetInnerHTML={{ __html: doctor.aboutHtml }}
            />
          )}
        </div>
      </TabsContent>

      <TabsContent value="cv" className="mt-6">
        <CvTimeline entries={doctor.cvEntries} dict={dict} />
      </TabsContent>

      <TabsContent value="publications" className="mt-6">
        <PublicationsList publications={doctor.publications} dict={dict} />
      </TabsContent>

      <TabsContent value="expertise" className="mt-6">
        <ExpertisePanel doctor={doctor} dict={dict} />
      </TabsContent>
    </Tabs>
  );
}
