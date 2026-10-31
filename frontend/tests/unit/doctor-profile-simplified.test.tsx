import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { siteDictionary as en } from "@/lib/i18n/site-dictionaries/en";
import { siteDictionary as tr } from "@/lib/i18n/site-dictionaries/tr";
import type { DoctorProfile, DoctorPublication, DoctorReviewsResponse, DoctorShowcase, DoctorShowcaseVideo, DoctorSocialLink, ReviewItem } from "@/lib/api/types";

vi.mock("@/context/locale-alternates-context", () => ({
  useActiveLocaleCode: () => "en",
  useLocalizePath: () => (path: string) => path,
  useLocaleCodes: () => ({ activeLocaleCode: "en", defaultLocaleCode: "en" }),
}));
vi.mock("@/components/site/reviews/doctor-reviews-section", () => ({ DoctorReviewsSection: () => <div>full-reviews-list</div> }));

import { DoctorProfileSections } from "@/components/site/telehealth/doctor-profile-sections";
import { DoctorKeyFacts } from "@/components/site/telehealth/doctor-key-facts";
import { DoctorPublicationsExplorer } from "@/components/site/telehealth/doctor-publications-explorer";
import { DoctorMediaGallery } from "@/components/site/telehealth/doctor-media-gallery";
import { DoctorSocialLinks, dedupeSocialLinks } from "@/components/site/telehealth/doctor-social-links";
import { DoctorBookingPanel } from "@/components/site/telehealth/doctor-booking-panel";
import { buildDoctorJsonLd } from "@/lib/doctor-json-ld";

function makeDoctor(overrides: Partial<DoctorProfile> = {}): DoctorProfile {
  return {
    id: "d1",
    userId: null,
    specialtyId: null,
    specialty: null,
    title: "Dr.",
    subSpecialty: null,
    fullName: "Elif Aydemir",
    slug: "dr-elif",
    bio: "Short bio.",
    aboutHtml: null,
    practiceStartYear: null,
    experienceYears: null,
    cvEntries: [],
    publications: [],
    socialLinks: [],
    languages: [],
    timeZone: "Europe/Istanbul",
    sessionDurationMin: 30,
    sessionPriceCents: null,
    currency: "TRY",
    avatarMediaId: null,
    avatarMedia: null,
    isVerified: false,
    verifiedAt: null,
    isActive: true,
    order: 0,
    availability: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as DoctorProfile;
}
function makeReview(id: string, publishedAt: string): ReviewItem {
  return {
    id,
    authorDisplay: "M. K.",
    displayMode: "initials",
    country: "DE",
    language: "en",
    rating: 5,
    title: `Title ${id}`,
    body: `Body text ${id}`,
    translation: null,
    verified: false,
    publishedAt,
    doctorReply: null,
  };
}
function makeVideo(overrides: Partial<DoctorShowcaseVideo> = {}): DoctorShowcaseVideo {
  return {
    id: "v1",
    kind: "video",
    category: "interview",
    title: "Interview",
    description: null,
    alt: "alt",
    videoProvider: "upload",
    videoId: null,
    thumbnailUrl: "https://api.example.com/uploads/p.jpg",
    embedUrl: null,
    videoUrl: "https://api.example.com/uploads/v.mp4",
    captionsUrl: null,
    captionsLang: null,
    ...overrides,
  };
}
const reviewsData = (items: ReviewItem[]): DoctorReviewsResponse => ({
  summary: { count: items.length, average: 4.8, distribution: null },
  languages: [],
  page: 1,
  pageSize: 10,
  total: items.length,
  items,
});
const baseProps = { lang: "en", telehealthDict: en.telehealth, commonDict: en.common, support: null, dict: en.reviews };

function fullSetup() {
  const doctor = makeDoctor({
    bio: "Bio text visible in HTML.",
    faq: [{ question: "FAQ question?", answer: "FAQ answer text" }],
    cvEntries: [{ kind: "EDUCATION", title: "Medical School Entry", organization: "Uni", location: null, startYear: 2000, endYear: 2006, description: null, url: null } as never],
    publications: [{ kind: "OTHER", title: "Unique Publication Title", authors: null, venue: "J", year: 2020, doi: null, url: null } as never],
  });
  const showcase: DoctorShowcase = {
    procedures: [{ id: "p1", title: "Knee replacement", description: "proc desc", duration: null, anesthesia: null, hospitalStay: null, recovery: null, relatedCareTopicIds: [] }],
    media: [makeVideo()],
  };
  const reviews = reviewsData([makeReview("a", "2026-10-01T00:00:00Z"), makeReview("b", "2026-10-03T00:00:00Z"), makeReview("c", "2026-10-02T00:00:00Z")]);
  return { doctor, showcase, reviews };
}

describe("profil sekmeleri", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("aynı anda tek panel görünür, tüm panel metinleri HTML'de bulunur", () => {
    const { doctor, showcase, reviews } = fullSetup();
    render(<DoctorProfileSections {...baseProps} doctor={doctor} showcase={showcase} reviews={reviews} />);
    expect(screen.getByTestId("doctor-tabs")).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      en.reviews.sectionOverview,
      en.reviews.sectionTreatments,
      en.reviews.sectionMedia,
      en.reviews.sectionExperience,
      en.reviews.sectionReviews,
      en.reviews.sectionFaq,
    ]);
    const visible = document.querySelectorAll('[role="tabpanel"]:not([hidden])');
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe("overview");
    for (const text of ["Bio text visible in HTML.", "Knee replacement", "Medical School Entry", "Unique Publication Title", "FAQ answer text", "full-reviews-list"]) {
      expect(document.body.textContent).toContain(text);
    }
  });

  it("hash ile açılış: #reviews doğrudan Yorumlar sekmesini açar", () => {
    window.history.replaceState(null, "", "/#reviews");
    const { doctor, showcase, reviews } = fullSetup();
    render(<DoctorProfileSections {...baseProps} doctor={doctor} showcase={showcase} reviews={reviews} />);
    expect(screen.getByRole("tab", { name: en.reviews.sectionReviews })).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById("reviews")).not.toHaveAttribute("hidden");
    expect(document.getElementById("overview")).toHaveAttribute("hidden");
  });

  it("tıklayınca hash güncellenir; popstate ile geri dönülür", async () => {
    const { doctor, showcase, reviews } = fullSetup();
    render(<DoctorProfileSections {...baseProps} doctor={doctor} showcase={showcase} reviews={reviews} />);
    await userEvent.click(screen.getByRole("tab", { name: en.reviews.sectionFaq }));
    expect(window.location.hash).toBe("#faq");
    expect(document.getElementById("faq")).not.toHaveAttribute("hidden");
    act(() => {
      window.history.replaceState(null, "", "/#treatments");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByRole("tab", { name: en.reviews.sectionTreatments })).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById("faq")).toHaveAttribute("hidden");
  });

  it("ok tuşları sekmeler arasında gezer (LTR'de sağ ok sonraki)", () => {
    const { doctor, showcase, reviews } = fullSetup();
    render(<DoctorProfileSections {...baseProps} doctor={doctor} showcase={showcase} reviews={reviews} />);
    const first = screen.getByRole("tab", { name: en.reviews.sectionOverview });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: en.reviews.sectionTreatments })).toHaveAttribute("aria-selected", "true");
  });

  it("boş sekmeler gizlenir (yorum/medya/SSS yok: yalnızca Genel bakış, sekme çubuğu yok)", () => {
    render(<DoctorProfileSections {...baseProps} doctor={makeDoctor()} showcase={{ procedures: [], media: [] }} reviews={null} />);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(document.getElementById("reviews")).toBeNull();
    expect(document.getElementById("overview")).not.toBeNull();
  });

  it("Genel bakışta son 2 yorum önizlenir; 'Tümünü gör' Yorumlar sekmesine geçer", async () => {
    const { doctor, showcase, reviews } = fullSetup();
    render(<DoctorProfileSections {...baseProps} doctor={doctor} showcase={showcase} reviews={reviews} />);
    const overview = document.getElementById("overview")!;
    expect(within(overview).getByText("Body text b")).toBeInTheDocument();
    expect(within(overview).getByText("Body text c")).toBeInTheDocument();
    expect(within(overview).queryByText("Body text a")).not.toBeInTheDocument();
    await userEvent.click(within(overview).getByRole("link", { name: /View all: Patient Reviews/ }));
    expect(screen.getByRole("tab", { name: en.reviews.sectionReviews })).toHaveAttribute("aria-selected", "true");
    expect(window.location.hash).toBe("#reviews");
  });

  it("uzun biyografi kırpılır ve 'Read more' yerinde açar", async () => {
    const doctor = makeDoctor({ bio: "word ".repeat(120) });
    render(<DoctorProfileSections {...baseProps} doctor={doctor} showcase={{ procedures: [], media: [] }} reviews={null} />);
    const btn = screen.getByRole("button", { name: en.telehealth.overviewReadMore });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(btn);
    expect(screen.getByRole("button", { name: en.telehealth.overviewReadLess })).toHaveAttribute("aria-expanded", "true");
  });
});

describe("önemli bilgiler şeridi", () => {
  const facts = (summary: DoctorReviewsResponse["summary"] | null) =>
    render(<DoctorKeyFacts doctor={makeDoctor({ experienceYears: 12, languages: ["tr"] })} dict={en.telehealth} languagesFullLabel="Turkish" procedureCount={3} reviewSummary={summary} />);

  it("3'ten az yorumda puan gösterilmez", () => {
    facts({ count: 2, average: null, distribution: null });
    const strip = screen.getByTestId("doctor-key-facts");
    expect(strip).not.toHaveTextContent(en.telehealth.keyFactsRating);
    expect(strip).toHaveTextContent("12 years");
  });
  it("3+ yorumda (average dolu) puan gösterilir", () => {
    facts({ count: 5, average: 4.6, distribution: null });
    expect(screen.getByTestId("doctor-key-facts")).toHaveTextContent("4.6 / 5 (5)");
  });
  it("count 3 altındaysa average dolu gelse bile gösterilmez", () => {
    facts({ count: 2, average: 5, distribution: null });
    expect(screen.getByTestId("doctor-key-facts")).not.toHaveTextContent(en.telehealth.keyFactsRating);
  });
});

describe("sosyal ikon tekilleştirme", () => {
  const ig = (url: string, label?: string): DoctorSocialLink => ({ platform: "instagram", url, label });
  it("aynı URL tekrarı (www/sondaki eğik çizgi/büyük harf/query) tek ikon olur", () => {
    expect(dedupeSocialLinks([ig("https://instagram.com/doc"), ig("https://www.Instagram.com/doc/?hl=tr")])).toHaveLength(1);
  });
  it("website olarak girilmiş instagram adresi instagram sayılır ve tekilleşir", () => {
    const out = dedupeSocialLinks([ig("https://instagram.com/doc"), { platform: "website", url: "https://www.instagram.com/doc" }]);
    expect(out).toHaveLength(1);
    expect(dedupeSocialLinks([{ platform: "website", url: "https://doc.com" }])[0].platform).toBe("website");
  });
  it("farklı iki Instagram hesabı: TR sayfasında TR, EN/AR sayfasında EN hesabı; tek ikon", () => {
    const links = [ig("https://instagram.com/doc_tr", "Instagram (TR)"), ig("https://instagram.com/doc_en", "Instagram (EN)")];
    expect(dedupeSocialLinks(links, "tr").map((l) => l.url)).toEqual(["https://instagram.com/doc_tr"]);
    expect(dedupeSocialLinks(links, "en").map((l) => l.url)).toEqual(["https://instagram.com/doc_en"]);
    expect(dedupeSocialLinks(links, "ar").map((l) => l.url)).toEqual(["https://instagram.com/doc_en"]);
    expect(dedupeSocialLinks([ig("https://instagram.com/a"), ig("https://instagram.com/b")], "de")[0].url).toBe("https://instagram.com/a");
    const { container } = render(<DoctorSocialLinks links={links} ariaLabel="x" lang="tr" />);
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });
});

describe("yayın gruplama", () => {
  const pubs = [
    ...Array.from({ length: 7 }, (_, i) => ({ kind: "INTERNATIONAL_ARTICLE", title: `Intl paper ${i}`, authors: "Doe J", venue: "Lancet", year: 2015 + i, doi: null, url: null })),
    { kind: "BOOK_CHAPTER", title: "Chapter about hearts", authors: null, venue: "Book", year: 2010, doi: null, url: null },
  ] as DoctorPublication[];

  it("her grupta ilk 5 görünür, 'Show all (N)' tümünü açar; gizlenenler DOM'da kalır", async () => {
    render(<DoctorPublicationsExplorer publications={pubs} dict={en.telehealth} />);
    const group = screen.getByTestId("publications-group-INTERNATIONAL_ARTICLE");
    expect(group.querySelectorAll("li")).toHaveLength(7);
    expect(group.querySelectorAll("li[hidden]")).toHaveLength(2);
    expect(screen.getByTestId("publications-group-BOOK_CHAPTER")).toBeInTheDocument();
    await userEvent.click(within(group).getByRole("button", { name: "Show all (7)" }));
    expect(group.querySelectorAll("li[hidden]")).toHaveLength(0);
  });
  it("yıl filtresi ve arama sonuçları daraltır", () => {
    render(<DoctorPublicationsExplorer publications={pubs} dict={en.telehealth} />);
    const group = screen.getByTestId("publications-group-INTERNATIONAL_ARTICLE");
    fireEvent.change(screen.getByLabelText(en.telehealth.pubYearLabel), { target: { value: "2016" } });
    expect(group.querySelectorAll("li:not([hidden])")).toHaveLength(1);
    expect(screen.getByTestId("publications-group-BOOK_CHAPTER")).toHaveAttribute("hidden");
    fireEvent.change(screen.getByLabelText(en.telehealth.pubYearLabel), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(en.telehealth.pubSearchLabel), { target: { value: "hearts" } });
    expect(group).toHaveAttribute("hidden");
    expect(screen.getByTestId("publications-group-BOOK_CHAPTER")).not.toHaveAttribute("hidden");
    fireEvent.change(screen.getByLabelText(en.telehealth.pubSearchLabel), { target: { value: "zzzz" } });
    expect(screen.getByText(en.telehealth.pubNoResults)).toBeInTheDocument();
  });
});

describe("yüklenen video", () => {
  it("modal açılmadan <video> yok; açılınca preload=none, poster, controls, track; altyazıyla crossOrigin", async () => {
    render(<DoctorMediaGallery media={[makeVideo({ captionsUrl: "https://api.example.com/uploads/c.vtt", captionsLang: "tr" })]} telehealthDict={en.telehealth} />);
    expect(document.querySelector("video")).toBeNull();
    expect(screen.queryByTestId("doctor-video-modal")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Play video: Interview" }));
    expect(screen.getByTestId("doctor-video-modal")).toBeInTheDocument();
    const video = document.querySelector("video")!;
    expect(video.getAttribute("preload")).toBe("none");
    expect(video.getAttribute("poster")).toBe("https://api.example.com/uploads/p.jpg");
    expect(video.hasAttribute("controls")).toBe(true);
    expect(video.getAttribute("crossorigin")).toBe("anonymous");
    expect(video.querySelector('track[kind="captions"]')?.getAttribute("srclang")).toBe("tr");
  });
  it("altyazı yoksa crossOrigin ve track yok", async () => {
    render(<DoctorMediaGallery media={[makeVideo()]} telehealthDict={en.telehealth} />);
    await userEvent.click(screen.getByRole("button", { name: "Play video: Interview" }));
    const video = document.querySelector("video")!;
    expect(video.hasAttribute("crossorigin")).toBe(false);
    expect(video.querySelector("track")).toBeNull();
  });
});

describe("randevu alanı", () => {
  it("varsayılan kapalı (içerik DOM'da, hidden); #randevu bağlantısı tıklanınca açılır", async () => {
    window.history.replaceState(null, "", "/");
    render(
      <>
        <a href="#randevu">cta</a>
        <DoctorBookingPanel doctorSlug="x" title="T" openLabel="Open" hideLabel="Hide" hint="h">
          <div>wizard-content</div>
        </DoctorBookingPanel>
      </>,
    );
    expect(document.getElementById("randevu-icerik")).toHaveAttribute("hidden");
    expect(document.body.textContent).toContain("wizard-content");
    await userEvent.click(screen.getByText("cta"));
    expect(document.getElementById("randevu-icerik")).not.toHaveAttribute("hidden");
    window.history.replaceState(null, "", "/");
  });
});

describe("JSON-LD ve sözlük", () => {
  it("sameAs ham sosyal bağlantıları değiştirmeden verir (görüntü tekilleştirmesi JSON-LD'yi etkilemez)", () => {
    const json = buildDoctorJsonLd(
      makeDoctor({ socialLinks: [{ platform: "instagram", url: "https://instagram.com/a" }, { platform: "instagram", url: "https://instagram.com/b" }] }),
      "https://x/y",
      "Elif",
    );
    expect(json).toContain("https://instagram.com/a");
    expect(json).toContain("https://instagram.com/b");
  });
  it("TR yeni anahtarlar mevcut", () => {
    expect(tr.telehealth.keyFactsTitle).toBe("Önemli bilgiler");
  });
});
