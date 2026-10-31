"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Building2, Play, Stethoscope } from "lucide-react";
import type { DoctorProfile, DoctorShowcaseMedia, ReviewItem } from "@/lib/api/types";
import type { ReviewsStrings } from "@/lib/i18n/site-dictionaries/en/reviews";
import type { TelehealthStrings } from "@/lib/i18n/site-dictionaries";
import { formatSiteString } from "@/lib/i18n/site-dictionaries";
import { Badge } from "@/components/ui/badge";
import { ReviewCard } from "@/components/site/reviews/review-card";
import { selectProfileTab } from "@/components/site/telehealth/doctor-section-nav";
import { localThumbnail } from "@/components/site/telehealth/video-facade";
import { toPublicMediaUrl } from "@/lib/env";

const MEDIA_PREVIEW_COUNT = 4;
const REVIEW_PREVIEW_COUNT = 2;
/** Yaklaşık 6 satır (leading-7 = 1.75rem). */
const COLLAPSED_CLASS = "max-h-[10.5rem] overflow-hidden";

function TabLink({ tabId, label, ariaLabel }: { tabId: string; label: string; ariaLabel: string }) {
  return (
    <a
      href={`#${tabId}`}
      aria-label={ariaLabel}
      onClick={(event) => {
        event.preventDefault();
        selectProfileTab(tabId);
      }}
      className="text-sm font-semibold text-[var(--site-primary)] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label}
    </a>
  );
}

function PreviewBlock({ title, link, children }: { title: string; link: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground/50">{title}</h3>
        {link}
      </div>
      {children}
    </div>
  );
}

/** Biyografi ~6 satır; "Devamını oku" yerinde açar. Metin kapalıyken de HTML'dedir (yalnızca kırpılır). */
function ExpandableBio({ doctor, dict }: { doctor: DoctorProfile; dict: TelehealthStrings }) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(() => (doctor.bio?.length ?? 0) + (doctor.aboutHtml?.length ?? 0) > 420);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && el.clientHeight > 0 && !expanded) setOverflowing(el.scrollHeight > el.clientHeight + 2);
  }, [doctor.bio, doctor.aboutHtml, expanded]);

  if (!doctor.bio?.trim() && !doctor.aboutHtml) return null;

  return (
    <div>
      <div className={!expanded && overflowing ? "relative" : undefined}>
        <div ref={ref} id="doctor-bio" className={`space-y-4 ${!expanded && overflowing ? COLLAPSED_CLASS : ""}`}>
          {doctor.bio?.trim() && <p className="whitespace-pre-line text-base leading-7 text-foreground/80">{doctor.bio}</p>}
          {doctor.aboutHtml && (
            // `aboutHtml` `lib/html-sanitize.ts`'ten GEÇMİŞ, GÜVENİLİR HTML'dir; yeniden sanitize EDİLMEZ.
            <div
              className="max-w-prose space-y-3 text-sm leading-7 text-foreground/80 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground [&_ol]:list-decimal [&_ol]:ps-5 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:ps-5"
              dangerouslySetInnerHTML={{ __html: doctor.aboutHtml }}
            />
          )}
        </div>
        {!expanded && overflowing && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background to-transparent" />}
      </div>
      {overflowing && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="doctor-bio"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-sm font-semibold text-[var(--site-primary)] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? dict.overviewReadLess : dict.overviewReadMore}
        </button>
      )}
    </div>
  );
}

interface DoctorOverviewPanelProps {
  doctor: DoctorProfile;
  media: DoctorShowcaseMedia[];
  latestReviews: ReviewItem[];
  dict: ReviewsStrings;
  telehealthDict: TelehealthStrings;
  supportSlot?: ReactNode;
}

/**
 * Paket AE — Genel bakış: kırpılmış biyografi, öne çıkan uzmanlık çipleri, 3-4 medya önizlemesi ve son 2 yorum.
 * "Tümünü gör" bağlantıları ilgili sekmeye geçer (hash güncellenir).
 */
export function DoctorOverviewPanel({ doctor, media, latestReviews, dict, telehealthDict, supportSlot }: DoctorOverviewPanelProps) {
  const hospital = doctor.hospitalName?.trim();
  const chips = [doctor.specialty?.name, ...(doctor.additionalSpecialties ?? []).map((s) => s.name), doctor.subSpecialty?.trim()].filter(
    (name, index, all): name is string => Boolean(name) && all.indexOf(name) === index,
  );
  const previewMedia = media.slice(0, MEDIA_PREVIEW_COUNT);
  const previewReviews = latestReviews.slice(0, REVIEW_PREVIEW_COUNT);

  return (
    <div className="space-y-6">
      <ExpandableBio doctor={doctor} dict={telehealthDict} />

      {(chips.length > 0 || hospital) && (
        <div className="space-y-3">
          {chips.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-foreground/50">{telehealthDict.overviewFeaturedExpertise}</h3>
              <ul className="flex flex-wrap gap-2">
                {chips.map((name, index) => (
                  <li key={name}>
                    <Badge tone="primary" size="lg" className="gap-1.5">
                      {index === 0 && <Stethoscope className="h-4 w-4" aria-hidden="true" />}
                      {name}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hospital && (
            <p className="flex items-center gap-2 text-sm text-foreground/80">
              <Building2 className="h-4 w-4 shrink-0 text-foreground/50" aria-hidden="true" />
              <span className="sr-only">{dict.overviewHospital}: </span>
              {hospital}
            </p>
          )}
        </div>
      )}

      {supportSlot}

      {previewMedia.length > 0 && (
        <PreviewBlock
          title={dict.sectionMedia}
          link={<TabLink tabId="media" label={telehealthDict.overviewViewAll} ariaLabel={formatSiteString(telehealthDict.overviewViewAllAria, { section: dict.sectionMedia })} />}
        >
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {previewMedia.map((item) => {
              const src = item.kind === "photo" ? toPublicMediaUrl(item.url) : localThumbnail(item.thumbnailUrl);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-label={item.alt}
                    onClick={() => selectProfileTab("media")}
                    className="group relative block aspect-[4/3] w-full overflow-hidden rounded-[var(--site-radius)] border border-border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element -- küçük önizleme; medya kütüphanesi adresi
                      <img src={src} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                    ) : (
                      <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-[var(--site-secondary)] to-black" />
                    )}
                    {item.kind === "video" && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/25" aria-hidden="true">
                        <Play className="h-6 w-6 fill-white text-white rtl:-scale-x-100" />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </PreviewBlock>
      )}

      {previewReviews.length > 0 && (
        <PreviewBlock
          title={telehealthDict.overviewLatestReviews}
          link={<TabLink tabId="reviews" label={telehealthDict.overviewViewAll} ariaLabel={formatSiteString(telehealthDict.overviewViewAllAria, { section: dict.sectionReviews })} />}
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {previewReviews.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </div>
        </PreviewBlock>
      )}
    </div>
  );
}
