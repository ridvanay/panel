import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { siteDictionary as en } from "@/lib/i18n/site-dictionaries/en";
import { siteDictionary as ar } from "@/lib/i18n/site-dictionaries/ar";
import type { FeaturedReviewItem } from "@/lib/api/types";
import type { FeaturedReviewsData, ReviewsListResponse } from "@/lib/review-types";

/**
 * Paket AE İş 3 — anasayfa "What our patients say" ızgarası, kart (5 satır kırpma + modal), özet şeridi ve
 * `/reviews` sayfa bileşenleri (filtre → query, sayfalama, RTL).
 */

const state = vi.hoisted(() => ({ lang: "en" }));
vi.mock("@/context/locale-alternates-context", () => ({
  useActiveLocaleCode: () => state.lang,
  useLocalizePath: () => (path: string) => path,
  useLocaleCodes: () => ({ activeLocaleCode: state.lang, defaultLocaleCode: "en" }),
}));
vi.mock("@/lib/api/server-telehealth", () => ({ fetchFeaturedReviewsServer: vi.fn(async () => null) }));

import { HomeReviewsCarousel } from "@/components/site/reviews/home-reviews-carousel";
import { ReviewGridCard } from "@/components/site/reviews/review-grid-card";
import { ReviewsSummaryStrip } from "@/components/site/reviews/reviews-summary-strip";
import { ReviewsPageView } from "@/components/site/reviews/reviews-page-view";
import { parseReviewsQuery, reviewsQueryString } from "@/lib/review-query";
import { countryFlag, reviewInitials } from "@/lib/review-flags";

const t = en.reviews;
const LONG_BODY = "The whole stay was organised perfectly and every question was answered patiently. ".repeat(6);

function makeItem(over: Partial<FeaturedReviewItem> = {}): FeaturedReviewItem {
  return {
    id: "r1",
    authorDisplay: "Maria K.",
    displayMode: "first_initial",
    country: "DE",
    language: "en",
    rating: 5,
    title: "Great care",
    body: "Short and sweet.",
    translation: null,
    verified: true,
    publishedAt: "2026-10-01T10:00:00.000Z",
    doctorReply: null,
    doctor: { name: "Dr. E. Aydemir", slug: "elif-aydemir-4" },
    ...over,
  };
}

function featured(over: Partial<FeaturedReviewsData> = {}): FeaturedReviewsData {
  return {
    summary: { count: 26, average: 5, distribution: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 26 } },
    countries: { codes: ["DE", "TR", "GB", "FR", "NL", "SA"], more: 3 },
    items: [makeItem({ id: "a" }), makeItem({ id: "b" }), makeItem({ id: "c" })],
    ...over,
  };
}

describe("anasayfa karuseli", () => {
  it("3/2/1 kartlık sayfa genişlikleri, snap izi ve eşit yükseklik sınıfları", () => {
    state.lang = "en";
    render(<HomeReviewsCarousel data={featured()} lang="en" defaultLocaleCode="en" />);
    const section = screen.getByTestId("home-reviews");
    expect(within(section).getByRole("region", { name: t.homeCarouselAria })).toBeInTheDocument();
    const track = screen.getByTestId("reviews-track");
    for (const cls of ["flex", "overflow-x-auto", "snap-x", "snap-mandatory", "items-stretch"]) expect(track.className).toContain(cls);
    for (const li of within(track).getAllByRole("listitem")) {
      // `h-full` (yüzde) yüksekliği belirsiz flex satırında esnemeyi bozar; li esneyen bir flex kapsayıcıdır, kart h-full.
      expect(li.className).toContain("flex");
      expect(li.className).toContain("w-full");
      expect(li.className).toContain("md:w-[calc((100%-1rem)/2)]");
      expect(li.className).toContain("lg:w-[calc((100%-2rem)/3)]");
      expect(li.className).toContain("snap-start");
    }
    const cards = screen.getAllByTestId("review-card");
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card.className).toContain("h-full");
      expect(card.className).toContain("flex-col");
    }
  });

  it("oklar ve noktalar var; otomatik oynatma zamanlayıcısı yok; 'Tüm yorumları gör' /reviews'e gider", async () => {
    const interval = vi.spyOn(window, "setInterval");
    state.lang = "tr";
    render(<HomeReviewsCarousel data={featured()} lang="tr" defaultLocaleCode="en" />);
    expect(screen.getByRole("button", { name: "Önceki yorum" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sonraki yorum" })).toBeEnabled();
    const dots = within(screen.getByTestId("reviews-dots")).getAllByRole("button");
    expect(dots.length).toBeGreaterThan(1);
    expect(dots[0]).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: /Tüm yorumları gör/ })).toHaveAttribute("href", "/tr/reviews");
    expect(interval).not.toHaveBeenCalled();
    interval.mockRestore();
    state.lang = "en";
  });

  it("oklar bir sayfa kaydırır; RTL'de yön ters", async () => {
    state.lang = "en";
    const scrollBy = vi.fn();
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    HTMLElement.prototype.scrollBy = scrollBy as unknown as typeof HTMLElement.prototype.scrollBy;
    const user = userEvent.setup();
    const ltr = render(<HomeReviewsCarousel data={featured()} lang="en" defaultLocaleCode="en" />);
    await user.click(screen.getByTestId("reviews-next"));
    expect(scrollBy).toHaveBeenLastCalledWith(expect.objectContaining({ left: 816 }));
    ltr.unmount();
    render(
      <div dir="rtl">
        <HomeReviewsCarousel data={featured()} lang="ar" defaultLocaleCode="en" />
      </div>,
    );
    await user.click(screen.getByTestId("reviews-next"));
    expect(scrollBy).toHaveBeenLastCalledWith(expect.objectContaining({ left: -816 }));
    expect(screen.getByTestId("reviews-next").querySelector("svg")?.getAttribute("class")).toContain("rtl:rotate-180");
    width.mockRestore();
  });

  it("API'nin döndürdüğü tüm kartlar karuselde yer alır; özet şeridi ortalama, sayı, bayraklar ve +N içerir", () => {
    state.lang = "en";
    const items = Array.from({ length: 12 }, (_, i) => makeItem({ id: `i${i}` }));
    render(<HomeReviewsCarousel data={featured({ items })} lang="en" defaultLocaleCode="en" />);
    expect(screen.getAllByTestId("review-card")).toHaveLength(12);
    const summary = screen.getByTestId("home-reviews-summary");
    expect(summary).toHaveTextContent("5.0");
    expect(summary).toHaveTextContent("26 verified reviews");
    const flags = within(screen.getByTestId("reviews-countries")).getAllByRole("listitem");
    expect(flags).toHaveLength(7);
    expect(flags[6]).toHaveTextContent("+3");
    expect(screen.getByRole("heading", { level: 2, name: t.homeHeading })).toBeInTheDocument();
  });

  it("average null iken ortalama ve sayı gizlenir, bayraklar kalır", () => {
    render(<HomeReviewsCarousel data={featured({ summary: { count: 2, average: null, distribution: null } })} lang="en" defaultLocaleCode="en" />);
    expect(screen.queryByTestId("home-reviews-summary")).not.toBeInTheDocument();
    expect(screen.getByTestId("reviews-countries")).toBeInTheDocument();
  });

  it("items boşsa hiçbir şey çizilmez", () => {
    const { container } = render(<HomeReviewsCarousel data={featured({ items: [] })} lang="en" defaultLocaleCode="en" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ReviewsSummaryStrip", () => {
  it("average null ve ülke yoksa null döner", () => {
    const { container } = render(<ReviewsSummaryStrip summary={{ count: 1, average: null, distribution: null }} countries={{ codes: [], more: 0 }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("en çok 6 bayrak gösterir, fazlasını keser", () => {
    render(<ReviewsSummaryStrip summary={{ count: 9, average: 4.6, distribution: null }} countries={{ codes: ["DE", "TR", "GB", "FR", "NL", "SA", "US", "ES"], more: 0 }} />);
    expect(within(screen.getByTestId("reviews-countries")).getAllByRole("listitem")).toHaveLength(6);
  });
});

describe("ReviewGridCard", () => {
  it("başlık boşsa başlık öğesi yoktur (otomatik başlık üretilmez)", () => {
    render(<ReviewGridCard review={makeItem({ title: "" })} defaultLocaleCode="en" />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("başlık doluysa h3 olarak gösterilir", () => {
    render(<ReviewGridCard review={makeItem()} defaultLocaleCode="en" />);
    expect(screen.getByRole("heading", { level: 3, name: "Great care" })).toBeInTheDocument();
  });

  it("kısa yorumda 'Devamını oku' yoktur; gövde 5 satırla sınırlıdır", () => {
    render(<ReviewGridCard review={makeItem()} defaultLocaleCode="en" />);
    expect(screen.getByTestId("review-body").className).toContain("line-clamp-5");
    expect(screen.queryByRole("button", { name: /Read the full review/ })).not.toBeInTheDocument();
  });

  it("uzun yorum: modal açılır, ESC ile kapanır ve odak tetikleyiciye döner", async () => {
    const user = userEvent.setup();
    render(<ReviewGridCard review={makeItem({ body: LONG_BODY })} defaultLocaleCode="en" />);
    const trigger = screen.getByRole("button", { name: "Read the full review by Maria K." });
    expect(trigger).toHaveTextContent(t.readMore);
    await user.click(trigger);
    const modal = await screen.findByTestId("review-modal");
    expect(modal).toBeInTheDocument();
    expect(within(modal).getByText(LONG_BODY.trim())).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("review-modal")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("anonim yazar ve doğrulanmamış hasta: anonim metni, rozet yok", () => {
    render(<ReviewGridCard review={makeItem({ displayMode: "anonymous", authorDisplay: null, verified: false })} defaultLocaleCode="en" />);
    expect(screen.getByText(t.anonymousPatient)).toBeInTheDocument();
    expect(screen.queryByText(t.verifiedPatient)).not.toBeInTheDocument();
  });

  it("doğrulanmış hasta rozeti, hekim bağlantısı ve dil etiketi görünür", () => {
    render(<ReviewGridCard review={makeItem({ language: "de" })} defaultLocaleCode="en" />);
    expect(screen.getByText(t.verifiedPatient)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Dr. E. Aydemir" });
    expect(link).toHaveAttribute("href", "/physicians/elif-aydemir-4");
    expect(screen.getByTestId("review-language")).toHaveTextContent(/German/i);
  });

  it("doctor null ise hekim bağlantısı yok", () => {
    render(<ReviewGridCard review={makeItem({ doctor: null })} defaultLocaleCode="en" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("çeviri anahtarı özgün metin ile çeviri arasında geçiş yapar", async () => {
    const user = userEvent.setup();
    render(<ReviewGridCard review={makeItem({ language: "de", body: "Sehr gut.", translation: { title: null, body: "Very good." } })} defaultLocaleCode="en" />);
    expect(screen.getByText("Sehr gut.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t.showTranslation }));
    expect(screen.getByText("Very good.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.showOriginal })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("yardımcılar", () => {
  it("bayrak ve baş harf", () => {
    expect(countryFlag("de")).toBe("\u{1F1E9}\u{1F1EA}");
    expect(countryFlag("xyz")).toBe("");
    expect(reviewInitials("Maria K.")).toBe("MK");
    expect(reviewInitials(null)).toBeNull();
  });

  it("URL sorgusu ayrıştırma: geçersiz değerler atılır", () => {
    expect(parseReviewsQuery({ doctor: "elif-aydemir-4", language: "TR", minRating: "4", page: "3" })).toEqual({ doctor: "elif-aydemir-4", language: "tr", minRating: 4, page: 3 });
    expect(parseReviewsQuery({ doctor: "a b;", language: "<x>", minRating: "9", page: "-1" })).toEqual({ doctor: undefined, language: undefined, minRating: undefined, page: 1 });
  });

  it("sorgu dizesi: boşlar ve page=1 atılır", () => {
    expect(reviewsQueryString({ page: 1 })).toBe("");
    expect(reviewsQueryString({ doctor: "x", language: "de", minRating: 4, page: 2 })).toBe("?doctor=x&language=de&minRating=4&page=2");
  });
});

function listData(over: Partial<ReviewsListResponse> = {}): ReviewsListResponse {
  return {
    summary: { count: 40, average: 4.9, distribution: null },
    countries: { codes: ["DE"], more: 0 },
    languages: [
      { code: "en", count: 30 },
      { code: "de", count: 10 },
    ],
    doctors: [{ slug: "elif-aydemir-4", name: "Dr. E. Aydemir", count: 20 }],
    page: 1,
    pageSize: 12,
    total: 40,
    items: [makeItem({ id: "x1" }), makeItem({ id: "x2" })],
    ...over,
  };
}

describe("/reviews sayfası", () => {
  const view = (data: ReviewsListResponse | null, q: Partial<ReturnType<typeof parseReviewsQuery>> = {}, dir?: "ltr" | "rtl", dict = t) =>
    render(<ReviewsPageView t={dict} data={data} query={{ page: 1, ...q }} basePath="/reviews" intlLocale="en" defaultLocaleCode="en" dir={dir} />);

  it("h1, gizli h2, filtre formu (GET) ve kartlar", () => {
    view(listData());
    expect(screen.getByTestId("reviews-page")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: t.reviewsPageTitle })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: t.reviewsListHeading })).toBeInTheDocument();
    const form = screen.getByTestId("reviews-filters");
    expect(form).toHaveAttribute("method", "get");
    expect(form).toHaveAttribute("action", "/reviews");
    expect(within(form).getByLabelText(t.filterPhysician)).toHaveAttribute("name", "doctor");
    expect(within(form).getByLabelText(t.languageFilterLabel)).toHaveAttribute("name", "language");
    expect(within(form).getByLabelText(t.filterMinRating)).toHaveAttribute("name", "minRating");
    expect(screen.getAllByTestId("review-card")).toHaveLength(2);
  });

  it("URL'deki filtreler formda seçili gelir ve 'temizle' bağlantısı çıkar", () => {
    view(listData(), { doctor: "elif-aydemir-4", language: "de", minRating: 4 });
    const form = screen.getByTestId("reviews-filters");
    expect(within(form).getByLabelText(t.filterPhysician)).toHaveValue("elif-aydemir-4");
    expect(within(form).getByLabelText(t.languageFilterLabel)).toHaveValue("de");
    expect(within(form).getByLabelText(t.filterMinRating)).toHaveValue("4");
    expect(within(form).getByRole("link", { name: t.filterReset })).toHaveAttribute("href", "/reviews");
  });

  it("sayfalama bağlantıları filtreleri korur", () => {
    view(listData(), { doctor: "elif-aydemir-4", minRating: 4, page: 2 });
    const nav = screen.getByRole("navigation", { name: t.paginationAria });
    expect(within(nav).getByRole("link", { name: t.previousPage })).toHaveAttribute("href", "/reviews?doctor=elif-aydemir-4&minRating=4");
    expect(within(nav).getByRole("link", { name: t.nextPage })).toHaveAttribute("href", "/reviews?doctor=elif-aydemir-4&minRating=4&page=3");
    expect(within(nav).getByRole("link", { name: "Go to page 3" })).toHaveAttribute("href", "/reviews?doctor=elif-aydemir-4&minRating=4&page=3");
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent("2");
  });

  it("tek sayfada sayfalama çizilmez; boş liste ve hata durumları ayrıdır", () => {
    const a = view(listData({ total: 2 }));
    expect(screen.queryByTestId("reviews-pagination")).not.toBeInTheDocument();
    a.unmount();
    const b = view(listData({ items: [], total: 0 }), { minRating: 5 });
    expect(screen.getByText(t.reviewsFilteredEmpty)).toBeInTheDocument();
    b.unmount();
    const c = view(listData({ items: [], total: 0 }));
    expect(screen.getByText(t.reviewsPageEmpty)).toBeInTheDocument();
    c.unmount();
    view(null, { language: "de" });
    expect(screen.getByRole("alert")).toHaveTextContent(t.reviewsPageError);
    expect(screen.getByRole("link", { name: t.reviewsRetry })).toHaveAttribute("href", "/reviews?language=de");
  });

  it("RTL: dir=rtl uygulanır, sayfalama okları rtl:rotate-180 taşır", () => {
    state.lang = "ar";
    view(listData(), { page: 2 }, "rtl", ar.reviews);
    expect(screen.getByTestId("reviews-page")).toHaveAttribute("dir", "rtl");
    const nav = screen.getByTestId("reviews-pagination");
    const chevrons = nav.querySelectorAll("svg");
    expect(chevrons.length).toBe(2);
    for (const svg of chevrons) expect(svg.getAttribute("class")).toContain("rtl:rotate-180");
    state.lang = "en";
  });
});
