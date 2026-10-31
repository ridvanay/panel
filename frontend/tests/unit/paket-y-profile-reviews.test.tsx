import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { siteDictionary as en } from "@/lib/i18n/site-dictionaries/en";
import { siteDictionary as tr } from "@/lib/i18n/site-dictionaries/tr";
import { siteDictionary as de } from "@/lib/i18n/site-dictionaries/de";
import { siteDictionary as es } from "@/lib/i18n/site-dictionaries/es";
import { siteDictionary as fr } from "@/lib/i18n/site-dictionaries/fr";
import { siteDictionary as ar } from "@/lib/i18n/site-dictionaries/ar";
import { siteDictionary as ru } from "@/lib/i18n/site-dictionaries/ru";
import { siteDictionary as ro } from "@/lib/i18n/site-dictionaries/ro";
import { siteDictionary as srLatn } from "@/lib/i18n/site-dictionaries/sr-latn";
import type {
  DoctorProfile,
  DoctorReviewsResponse,
  DoctorShowcase,
  DoctorShowcaseVideo,
  FeaturedReviewsResponse,
  ReviewItem,
  SubmitReviewRequest,
} from "@/lib/api/types";

/**
 * Paket Y — hekim profili bölümleri, video facade, yorumlar, yorum formu, anasayfa karuseli, JSON-LD kuralları,
 * sözlük eşitliği ve booking wizard `locale` alanı.
 */

vi.mock("@/context/locale-alternates-context", () => ({
  useActiveLocaleCode: () => "en",
  useLocalizePath: () => (path: string) => path,
  useLocaleCodes: () => ({ activeLocaleCode: "en", defaultLocaleCode: "en" }),
}));
vi.mock("@/lib/legal-pages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/legal-pages")>()),
  fetchLegalPagesClient: vi.fn(async () => []),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const createBookingMock = vi.fn();
vi.mock("@/lib/api/telehealth", () => ({
  getBooking: vi.fn(),
  createBooking: (...args: unknown[]) => createBookingMock(...args),
  cancelBooking: vi.fn(async () => undefined),
}));

import { VideoFacade } from "@/components/site/telehealth/video-facade";
import { DoctorProfileSections, resolveProfileSections } from "@/components/site/telehealth/doctor-profile-sections";
import { ReviewSummaryBlock } from "@/components/site/reviews/doctor-reviews-section";
import { ReviewCard } from "@/components/site/reviews/review-card";
import { ReviewForm, REVIEW_CONSENT_TEXT_VERSION, looksLikeContactInfo } from "@/components/site/reviews/review-form";
import { HomeReviewsCarousel } from "@/components/site/reviews/home-reviews-carousel";
import { HomeReviewsSection } from "@/components/site/reviews/home-reviews-section";
import { buildDoctorJsonLd } from "@/lib/doctor-json-ld";
import { buildDoctorFaqJsonLd } from "@/lib/doctor-faq-json-ld";
import { publicDoctorName } from "@/lib/doctor-display-name";
import { BookingWizard } from "@/components/site/telehealth/booking-wizard";
import { BookingSelectionProvider, useBookingSelection } from "@/components/site/telehealth/booking-selection-context";

vi.mock("@/lib/api/server-telehealth", () => ({ fetchFeaturedReviewsServer: vi.fn(async () => ({ summary: { count: 0, average: null, distribution: null }, items: [] })) }));

vi.mock("@/components/site/telehealth/availability-calendar", () => ({
  AvailabilityCalendar: () => {
    const { toggleSlot } = useBookingSelection();
    return (
      <button type="button" onClick={() => toggleSlot({ startsAt: "2026-11-05T10:00:00.000Z", endsAt: "2026-11-05T10:30:00.000Z", available: true } as never, "Europe/Istanbul")}>
        pick-slot
      </button>
    );
  },
}));
vi.mock("@/components/site/telehealth/booking-identity-step", async () => {
  const { forwardRef } = await import("react");
  return {
    BookingIdentityStep: forwardRef<HTMLFormElement, { onContinue: (i: never, n: string, e: string) => void }>(function Stub({ onContinue }, ref) {
      return (
        <form ref={ref}>
          <button type="button" onClick={() => onContinue({} as never, "Test Hasta", "hasta@example.com")}>
            submit-identity
          </button>
        </form>
      );
    }),
  };
});
vi.mock("@/components/site/telehealth/booking-intake-step", () => ({ BookingIntakeStep: () => <div>intake</div> }));
vi.mock("@/components/site/telehealth/booking-payment-step", () => ({ BookingPaymentStep: () => <div>payment</div> }));
vi.mock("@/components/site/telehealth/doctor-service-summary", () => ({
  DoctorServiceSummaryPanel: ({ onContinue }: { onContinue?: () => void }) => (
    <button type="button" onClick={onContinue}>
      continue-step
    </button>
  ),
}));

const t = en.reviews;

function makeDoctor(overrides: Partial<DoctorProfile> = {}): DoctorProfile {
  return {
    id: "doctor-1",
    userId: null,
    specialtyId: null,
    specialty: null,
    title: "Dr.",
    subSpecialty: null,
    fullName: "Elif Aydemir",
    slug: "dr-elif-aydemir",
    bio: "Kısa biyografi.",
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

function makeReview(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: "r1",
    authorDisplay: "M. K.",
    displayMode: "initials",
    country: "DE",
    language: "en",
    rating: 5,
    title: "Great care",
    body: "Everything was explained clearly and I felt safe throughout.",
    translation: null,
    verified: false,
    publishedAt: "2026-10-01T10:00:00.000Z",
    doctorReply: null,
    ...overrides,
  };
}

const EMPTY_SHOWCASE: DoctorShowcase = { procedures: [], media: [] };

function makeVideo(overrides: Partial<DoctorShowcaseVideo> = {}): DoctorShowcaseVideo {
  return {
    id: "v1",
    kind: "video",
    category: "interview",
    title: "Interview",
    description: null,
    alt: "Interview with the physician",
    videoProvider: "youtube",
    videoId: "dQw4w9WgXcQ",
    // Paket Y (kullanıcı kararı) — kendi sunucumuzdaki kopya.
    thumbnailUrl: "https://api.example.com/uploads/video-thumb-youtube-dQw4w9WgXcQ.jpg",
    embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    ...overrides,
  };
}

describe("video facade", () => {
  it("oynat'a basmadan youtube / ytimg / vimeo alanlarına HİÇBİR referans yok (istek gitmez); basınca iframe gelir", async () => {
    const { container } = render(<VideoFacade video={makeVideo()} />);
    expect(container.querySelector("iframe")).toBeNull();
    // DOM'daki hiçbir nitelik (src/href/srcset/style/poster/data) üçüncü taraf video alanına işaret etmez → tarayıcı istek atmaz.
    const thirdPartyHosts = Array.from(container.querySelectorAll("*"))
      .flatMap((el) => Array.from(el.attributes).map((attr) => attr.value))
      .flatMap((value) => value.match(/https?:\/\/[^\s"')]+/g) ?? [])
      .map((url) => new URL(url).hostname)
      .filter((host) => /(youtube|youtube-nocookie|ytimg|vimeo|vimeocdn|vumbnail)\./i.test(host));
    expect(thirdPartyHosts).toEqual([]);
    // yalnızca yerel küçük resim kopyası
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://api.example.com/uploads/video-thumb-youtube-dQw4w9WgXcQ.jpg");
    expect(screen.getByText("When you press play, the video is loaded from YouTube.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Play video: Interview" }));
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toContain("youtube-nocookie.com");
    expect(iframe?.getAttribute("allow")).toBe("autoplay; encrypted-media; picture-in-picture");
    expect(iframe?.getAttribute("title")).toBe("Interview");
  });

  it("sunucu yanlışlıkla sağlayıcı küçük resmi döndürse bile kullanılmaz (yer tutucu)", () => {
    const { container } = render(<VideoFacade video={makeVideo({ thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" })} />);
    expect(container.querySelector("img")).toBeNull();
    expect(Array.from(container.querySelectorAll("*")).some((el) => Array.from(el.attributes).some((attr) => /ytimg/i.test(attr.value)))).toBe(false);
  });

  it("küçük resim yoksa yer tutucu gösterilir (img yok), iframe yine yok", () => {
    const { container } = render(<VideoFacade video={makeVideo({ thumbnailUrl: null, videoProvider: "vimeo", embedUrl: "https://player.vimeo.com/video/1?dnt=1" })} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByText("When you press play, the video is loaded from Vimeo.")).toBeInTheDocument();
  });
});

describe("profil bölümleri — boş bölümler gizli", () => {
  const baseProps = { lang: "en", telehealthDict: en.telehealth, commonDict: en.common, support: null, dict: en.reviews };

  it("yalnızca Overview varsa diğer bölümler ve çubuk öğeleri üretilmez", () => {
    const doctor = makeDoctor();
    expect(resolveProfileSections({ doctor, showcase: EMPTY_SHOWCASE, reviews: null, dict: en.reviews }).map((s) => s.id)).toEqual(["overview"]);
    render(<DoctorProfileSections {...baseProps} doctor={doctor} showcase={EMPTY_SHOWCASE} reviews={null} />);
    expect(screen.getByRole("heading", { name: t.sectionOverview })).toBeInTheDocument();
    for (const name of [t.sectionTreatments, t.sectionMedia, t.sectionExperience, t.sectionReviews, t.sectionFaq]) {
      expect(screen.queryByRole("heading", { name })).not.toBeInTheDocument();
    }
  });

  it("0 yorumlu yanıt Reviews bölümünü oluşturmaz; dolu veriler bölümleri açar", () => {
    const empty: DoctorReviewsResponse = { summary: { count: 0, average: null, distribution: null }, languages: [], page: 1, pageSize: 10, total: 0, items: [] };
    const doctor = makeDoctor({ faq: [{ question: "Q1?", answer: "A1" }], hospitalName: "City Hospital", languages: ["de"] });
    const showcase: DoctorShowcase = {
      procedures: [{ id: "p1", title: "Knee replacement", description: "d", duration: "2 h", anesthesia: null, hospitalStay: null, recovery: null, relatedCareTopicIds: [] }],
      media: [makeVideo()],
    };
    expect(resolveProfileSections({ doctor, showcase: EMPTY_SHOWCASE, reviews: empty, dict: en.reviews }).map((s) => s.id)).toEqual(["overview", "faq"]);
    render(<DoctorProfileSections {...baseProps} doctor={doctor} showcase={showcase} reviews={empty} />);
    expect(screen.getByRole("heading", { name: t.sectionTreatments })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: t.sectionMedia })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: t.sectionFaq })).toBeInTheDocument();
    expect(screen.getByText("City Hospital")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: t.sectionReviews })).not.toBeInTheDocument();
    // fiyat alanı yok
    expect(screen.queryByText(/price/i)).not.toBeInTheDocument();
  });
});

describe("yorum özeti", () => {
  it("average null iken ortalama ve dağılım gösterilmez", () => {
    render(<ReviewSummaryBlock summary={{ count: 2, average: null, distribution: null }} />);
    expect(screen.queryByTestId("review-summary")).not.toBeInTheDocument();
  });

  it("average doluysa ortalama ve dağılım çubukları gösterilir", () => {
    render(<ReviewSummaryBlock summary={{ count: 4, average: 4.5, distribution: { "1": 0, "2": 0, "3": 0, "4": 2, "5": 2 } }} />);
    expect(screen.getByTestId("review-summary")).toHaveTextContent("4.5");
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
  });
});

describe("JSON-LD", () => {
  it("hekim JSON-LD'sinde Review/AggregateRating yok; görünen ad kuralı (kurucu tam ad, diğerleri kısaltma) korunur", () => {
    const doctor = makeDoctor({ fullName: "Elif Zehra AYDEMİR", displayName: "E. Z. Aydemir" });
    const json = buildDoctorJsonLd(doctor, "https://example.com/physicians/x", "Elif Zehra Aydemir");
    expect(json).not.toMatch(/AggregateRating|"Review"|"review"/);
    expect(json).toContain("E. Z. Aydemir");
    expect(json).not.toContain("AYDEMİR");
    expect(publicDoctorName(doctor)).toBe("E. Z. Aydemir");
    expect(publicDoctorName(makeDoctor({ fullName: "Vahit Sofu", displayName: "Vahit Sofu", isFounder: true }))).toBe("Vahit Sofu");
  });

  it("FAQPage yalnızca SSS varsa üretilir ve Review/AggregateRating içermez", () => {
    expect(buildDoctorFaqJsonLd([])).toBeNull();
    expect(buildDoctorFaqJsonLd(undefined)).toBeNull();
    const json = buildDoctorFaqJsonLd([{ question: "Q?", answer: "A." }]);
    expect(json).toContain("FAQPage");
    expect(json).not.toMatch(/AggregateRating|"Review"/);
  });
});

describe("yorum metinleri yalnızca metin düğümü", () => {
  it("title/body/doctorReply/translation HTML olarak yorumlanmaz", async () => {
    const payload = '<b>bold</b><img src=x onerror="alert(1)">';
    const { container } = render(
      <ReviewCard review={makeReview({ title: payload, body: payload, doctorReply: payload, translation: { title: payload, body: payload } })} />,
    );
    expect(container.querySelector("b, img")).toBeNull();
    expect(container.textContent).toContain(payload);
    await userEvent.click(screen.getByRole("button", { name: t.showTranslation }));
    expect(container.querySelector("b, img")).toBeNull();
  });

  it("kaynakta dangerouslySetInnerHTML yalnızca yönetici HTML'i (aboutHtml) için kullanılır, yorum bileşenlerinde yok", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(__dirname, "../../src/components/site/reviews");
    for (const file of fs.readdirSync(dir)) {
      expect(fs.readFileSync(path.join(dir, file), "utf8")).not.toMatch(/dangerouslySetInnerHTMLs*=/);
    }
  });

  it("doğrulanmış hasta rozeti, anonim ad ve orijinal dil etiketi", () => {
    render(<ReviewCard review={makeReview({ verified: true, displayMode: "anonymous", authorDisplay: "X. Y.", language: "de" })} />);
    expect(screen.getByText(t.verifiedPatient)).toBeInTheDocument();
    expect(screen.getByText(t.anonymousPatient)).toBeInTheDocument();
    expect(screen.queryByText("X. Y.")).not.toBeInTheDocument();
    expect(screen.getByText(/Original language: German/)).toBeInTheDocument();
  });
});

describe("yorum formu", () => {
  const LONG = "This is a sufficiently long and honest description of my experience with the care team.";

  async function fillValid(opts: { body?: string } = {}) {
    await userEvent.click(screen.getByRole("radio", { name: "4 out of 5" }));
    await userEvent.type(screen.getByLabelText(t.titleLabel), "Great experience");
    fireEvent.change(screen.getByLabelText(t.bodyLabel), { target: { value: opts.body ?? LONG } });
  }

  it("yayın onayı olmadan gönderilmez", async () => {
    const submit = vi.fn(async () => ({}));
    render(<ReviewForm submit={submit} />);
    await fillValid();
    await userEvent.click(screen.getByRole("button", { name: t.submit }));
    expect(await screen.findByText(t.errConsent)).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it("30 karakterden kısa metin reddedilir ve sayaç görünür", async () => {
    const submit = vi.fn(async () => ({}));
    render(<ReviewForm submit={submit} />);
    await fillValid({ body: "too short" });
    expect(screen.getByText("9 / 1500")).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/explicit consent/i));
    await userEvent.click(screen.getByRole("button", { name: t.submit }));
    expect(await screen.findByText("Your review must be between 30 and 1500 characters.")).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it("geçerli form: ülke seçilmezse alan gönderilmez, rıza metni sürümü gönderilir, teşekkür ekranı çıkar; tanı uyarısı görünür", async () => {
    const submit = vi.fn<(input: SubmitReviewRequest) => Promise<unknown>>(async () => ({ id: "x", status: "pending" }));
    render(<ReviewForm submit={submit} />);
    expect(screen.getByText(t.privacyWarning)).toBeInTheDocument();
    await fillValid();
    await userEvent.click(screen.getByLabelText(/explicit consent/i));
    await userEvent.click(screen.getByRole("button", { name: t.submit }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const payload = submit.mock.calls[0]![0];
    expect(payload).toMatchObject({ rating: 4, displayMode: "initials", publishConsent: true, consentTextVersion: REVIEW_CONSENT_TEXT_VERSION });
    expect(payload).not.toHaveProperty("country");
    expect(REVIEW_CONSENT_TEXT_VERSION).toBe("2026-11-review-v1");
    expect(await screen.findByText(t.thanksTitle)).toBeInTheDocument();
    expect(screen.getByText(t.thanksBody)).toBeInTheDocument();
  });

  it("ülke seçilirse ISO-2 kodu gönderilir", async () => {
    const submit = vi.fn<(input: SubmitReviewRequest) => Promise<unknown>>(async () => ({}));
    render(<ReviewForm submit={submit} />);
    await fillValid();
    await userEvent.selectOptions(screen.getByLabelText(t.countryLabel), "DE");
    await userEvent.click(screen.getByLabelText(/explicit consent/i));
    await userEvent.click(screen.getByRole("button", { name: t.submit }));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0]![0].country).toBe("DE");
  });

  it("e-posta/telefon/URL deseni yumuşak uyarı verir (ilk gönderimde durur, ikincisinde geçer)", async () => {
    const submit = vi.fn(async () => ({}));
    render(<ReviewForm submit={submit} />);
    await fillValid({ body: `${LONG} Write me at someone@example.com please.` });
    await userEvent.click(screen.getByLabelText(/explicit consent/i));
    await userEvent.click(screen.getByRole("button", { name: t.submit }));
    expect(await screen.findByText(t.contentWarning)).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: t.submit }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  });

  it("looksLikeContactInfo desenleri", () => {
    expect(looksLikeContactInfo("mail a@b.co")).toBe(true);
    expect(looksLikeContactInfo("see https://x.y/z")).toBe(true);
    expect(looksLikeContactInfo("call +49 170 1234567")).toBe(true);
    expect(looksLikeContactInfo("I was treated in 2024 for 3 weeks")).toBe(false);
  });
});

describe("anasayfa karuseli", () => {
  const featured = (over: Partial<FeaturedReviewsResponse> = {}): FeaturedReviewsResponse => ({
    summary: { count: 5, average: 4.6, distribution: { "1": 0, "2": 0, "3": 0, "4": 2, "5": 3 } },
    items: [{ ...makeReview(), doctor: { name: "Dr. E. Aydemir", slug: "dr-e-aydemir" } }],
    ...over,
  });

  it("items boşken ya da veri yokken hiçbir şey render edilmez", async () => {
    const a = render(<HomeReviewsCarousel data={featured({ items: [] })} lang="en" defaultLocaleCode="en" />);
    expect(a.container).toBeEmptyDOMElement();
    const b = render(<HomeReviewsCarousel data={null} lang="en" defaultLocaleCode="en" />);
    expect(b.container).toBeEmptyDOMElement();
    expect(await HomeReviewsSection({ lang: "en", defaultLocaleCode: "en" })).toBeNull();
  });

  it("average null ise ortalama ve sayı gizlenir, yalnızca kartlar kalır", () => {
    render(<HomeReviewsCarousel data={featured({ summary: { count: 2, average: null, distribution: null } })} lang="en" defaultLocaleCode="en" />);
    expect(screen.queryByTestId("home-reviews-summary")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: t.homeHeading })).toBeInTheDocument();
    expect(screen.getByText("Great care")).toBeInTheDocument();
  });

  it("average doluysa özet görünür", () => {
    render(<HomeReviewsCarousel data={featured()} lang="en" defaultLocaleCode="en" />);
    expect(screen.getByTestId("home-reviews-summary")).toHaveTextContent("4.6");
  });
});

describe("sözlük eşitliği (reviews)", () => {
  const keys = (o: object) => Object.keys(o).sort();
  it.each(Object.entries({ tr, de, es, fr, ar, ru, ro, "sr-latn": srLatn }))("%s: reviews anahtarları EN ile aynı, boş yok, yer tutucular aynı", (_code, dict) => {
    expect(keys(dict.reviews)).toEqual(keys(en.reviews));
    for (const [k, v] of Object.entries(dict.reviews)) {
      expect(v.trim(), k).not.toBe("");
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
      expect(ph(v), k).toBe(ph((en.reviews as Record<string, string>)[k]!));
    }
  });
});

describe("BookingWizard — locale gönderimi", () => {
  beforeEach(() => {
    createBookingMock.mockReset();
    createBookingMock.mockResolvedValue({
      bookingId: "b1",
      accessToken: "tok",
      bookingNumber: "BKG-1",
      slotCount: 1,
      totalCents: 0,
      currency: "TRY",
      appointments: [],
      paymentStatus: "PENDING",
    });
  });

  it("POST /appointments/bookings gövdesine aktif site dili `locale` olarak eklenir", async () => {
    const doctor = makeDoctor();
    render(
      <BookingSelectionProvider doctorTimeZone={doctor.timeZone}>
        <BookingWizard
          doctor={doctor}
          doctorSlug={doctor.slug}
          doctorTimeZone={doctor.timeZone}
          lang="de"
          defaultLocaleCode="tr"
          initialSlots={[]}
          kvkkPage={null}
        />
      </BookingSelectionProvider>,
    );
    await userEvent.click(await screen.findByText("pick-slot"));
    await userEvent.click(screen.getByText("continue-step"));
    await userEvent.click(await screen.findByText("submit-identity"));
    await waitFor(() => expect(createBookingMock).toHaveBeenCalledTimes(1));
    expect(createBookingMock.mock.calls[0]![0]).toMatchObject({ doctorSlug: doctor.slug, locale: "de" });
  });
});
