import { Award, ExternalLink, FileQuestion, GraduationCap, Briefcase, Trophy, Users } from "lucide-react";
import type { DoctorCvEntry, DoctorCvEntryKind, DoctorProfile, DoctorPublication, DoctorPublicationKind } from "@/lib/api/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * `.claude/design-notes-doctor-portfolio-console.md` §1.3/§1.4 — "Doktor Hakkında" / "Özgeçmiş" /
 * "Bilimsel Yayınlar" sekmeleri. `Tabs variant="line"` — içerik-gezinme semantiği ([DPI] §6 madde
 * 5 — sekmeler TEK URL'de kalır, `value` state'i istemcide tutulur).
 */

const EMPTY_STATE_TEXT: Record<"about" | "cv" | "publications", string> = {
  about: "Bu doktor için henüz biyografi bilgisi paylaşılmamış.",
  cv: "Bu doktor için henüz özgeçmiş bilgisi paylaşılmamış.",
  publications: "Bu doktor için henüz bilimsel yayın paylaşılmamış.",
};

function EmptyTabState({ tab }: { tab: "about" | "cv" | "publications" }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--site-radius)] border border-border bg-muted/30 p-8 text-center">
      <FileQuestion className="h-6 w-6 text-foreground/30" aria-hidden="true" />
      <p className="text-sm text-foreground/50">{EMPTY_STATE_TEXT[tab]}</p>
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

function CvTimeline({ entries }: { entries: DoctorCvEntry[] }) {
  if (entries.length === 0) return <EmptyTabState tab="cv" />;

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
              {entry.startYear} — {entry.endYear ?? "Devam ediyor"}
            </p>
            <h3 className="mt-1 text-base font-semibold text-foreground">{entry.title}</h3>
            <p className="text-sm text-foreground/70">
              {entry.organization}
              {entry.location ? ` · ${entry.location}` : ""}
            </p>
            {entry.description && <p className="mt-2 text-sm leading-6 text-foreground/80">{entry.description}</p>}
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

const PUBLICATION_GROUP_LABEL: Record<DoctorPublicationKind, string> = {
  INTERNATIONAL_ARTICLE: "Uluslararası Makaleler",
  NATIONAL_ARTICLE: "Ulusal Makaleler",
  PROCEEDING: "Bildiriler",
  BOOK_CHAPTER: "Kitap Bölümleri",
  OTHER: "Diğer Yayınlar",
};

function PublicationsList({ publications }: { publications: DoctorPublication[] }) {
  if (publications.length === 0) return <EmptyTabState tab="publications" />;

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
            {PUBLICATION_GROUP_LABEL[g]}
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
                      Kaynağa Git
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

export function DoctorProfileTabs({ doctor }: { doctor: DoctorProfile }) {
  return (
    <Tabs defaultValue="about">
      <TabsList variant="line" className="border-b border-border">
        <TabsTrigger value="about">Doktor Hakkında</TabsTrigger>
        <TabsTrigger value="cv">Özgeçmiş</TabsTrigger>
        <TabsTrigger value="publications">Bilimsel Yayınlar</TabsTrigger>
      </TabsList>

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
        <CvTimeline entries={doctor.cvEntries} />
      </TabsContent>

      <TabsContent value="publications" className="mt-6">
        <PublicationsList publications={doctor.publications} />
      </TabsContent>
    </Tabs>
  );
}
