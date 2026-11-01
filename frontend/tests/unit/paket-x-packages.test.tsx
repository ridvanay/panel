import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Locale, PackageCardData, PackageDetailData } from "@/lib/api/types";
import { ApiClientError } from "@/lib/api/error";

/**
 * Paket X — sağlık paketleri ön yüzü: yan panel (görünürlük, hareket, kapatma, klavye), ayrıntı gövdesi (fiyat),
 * "Plan my package" formu (rıza kuralları), JSON-LD, sitemap/llms ve sözlük eşitliği.
 */
const state = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/context/locale-alternates-context", () => ({
  useActiveLocaleCode: () => "en",
  useLocalizePath: () => (path: string) => path,
  useLocaleCodes: () => ({ activeLocaleCode: "en", defaultLocaleCode: "en" }),
}));
vi.mock("next/dynamic", async () => {
  const mod = await import("@/components/site/packages/packages-runner");
  return { default: () => mod.default };
});

const getPackage = vi.fn();
const submitPackageInquiry = vi.fn();
const reportPackageView = vi.fn();
vi.mock("@/lib/api/packages", () => ({
  getPackage: (...args: unknown[]) => getPackage(...args),
  submitPackageInquiry: (...args: unknown[]) => submitPackageInquiry(...args),
  reportPackageView: (...args: unknown[]) => reportPackageView(...args),
}));
vi.mock("@/lib/legal-pages", () => ({
  fetchLegalPagesClient: async () => [],
  resolveKvkkNoticePage: () => null,
  resolveExplicitConsentPage: () => null,
}));

import { isPackagesRunnerHiddenPath, RUNNER_DISMISS_KEY } from "@/components/site/packages/runner-visibility";
import { PackagesRunnerLazy } from "@/components/site/packages/packages-runner-lazy";
import { PackageDetailBody } from "@/components/site/packages/package-detail-body";
import { PackageInquiryForm } from "@/components/site/packages/package-inquiry-form";
import { buildPackageJsonLd, packageSocialImage } from "@/components/site/packages/package-json-ld";
import { buildPreferredDates } from "@/components/site/packages/package-format";
import { PACKAGES_DICTIONARIES } from "@/lib/i18n/use-packages-strings";
import { packagesStrings as en } from "@/lib/i18n/site-dictionaries/en/packages";
import { buildIndex, buildSection, type SitemapData } from "@/lib/sitemap/build";
import { buildLlmsTxt } from "@/lib/seo/llms";

const card = (over: Partial<PackageCardData> = {}): PackageCardData => ({
  id: "p1",
  slug: "executive-check-up",
  category: "check-up",
  title: "Executive Check-up",
  summary: "A full-day check-up.",
  duration: "1 day",
  contentLocale: "en",
  isFeatured: true,
  cover: null,
  price: null,
  ...over,
});
const detail = (over: Partial<PackageDetailData> = {}): PackageDetailData => ({
  ...card(),
  includes: ["Blood panel", "ECG"],
  notIncluded: ["Surgery"],
  idealFor: "Busy professionals",
  faq: [{ question: "How long?", answer: "One day." }],
  availableLocales: ["en", "tr"],
  relatedDoctors: [{ slug: "dr-a", name: "Prof. Dr. Ayse Demir", specialty: "Cardiology", avatarUrl: null }],
  relatedSpecialties: [],
  ...over,
});

function stubMatchMedia(opts: { reduced?: boolean; desktop?: boolean }) {
  const { reduced = false, desktop = true } = opts;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduced : query.includes("min-width") ? desktop : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  state.pathname = "/";
  window.sessionStorage.clear();
  getPackage.mockReset();
  reportPackageView.mockReset();
  submitPackageInquiry.mockReset();
  stubMatchMedia({});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("yan panel görünürlüğü (hariç tutulan yollar)", () => {
  const hidden = [
    "/cart",
    "/checkout",
    "/checkout/success",
    "/consultation/abc",
    "/patient",
    "/patient/bookings",
    "/hesabim",
    "/siparislerim",
    "/interpreter",
    "/find-a-physician",
    "/review/token123",
    "/physicians/dr-a",
    "/admin/packages",
    "/doctor/console",
    "/packages",
    "/packages/executive-check-up",
  ];
  it.each(hidden)("%s ve dil önekli hâlleri gizli", (path) => {
    expect(isPackagesRunnerHiddenPath(path)).toBe(true);
    expect(isPackagesRunnerHiddenPath(`/tr${path}`)).toBe(true);
    expect(isPackagesRunnerHiddenPath(`/sr-latn${path}`)).toBe(true);
    expect(isPackagesRunnerHiddenPath(`/en${path}?x=1#y`)).toBe(true);
  });
  it.each(["/", "/tr", "/en/about", "/physicians", "/en/physicians", "/reviews", "/sr-latn/blog/post", "/contact", "/cartilage-care", "/specialties/cardiology"])("%s görünür", (path) => {
    expect(isPackagesRunnerHiddenPath(path)).toBe(false);
  });
  it("hariç tutulan yolda panel paketi hiç çizilmez", async () => {
    state.pathname = "/tr/cart";
    render(<PackagesRunnerLazy featured={[card()]} items={[card()]} categories={["check-up"]} />);
    await act(async () => {});
    expect(screen.queryByTestId("packages-runner")).toBeNull();
    expect(screen.queryByTestId("packages-runner-strip")).toBeNull();
  });
});

describe("yan panel davranışı", () => {
  const props = { featured: [card(), card({ id: "p2", slug: "longevity", title: "Longevity" })], items: [card(), card({ id: "p2", slug: "longevity", title: "Longevity", category: "longevity" })], categories: ["check-up", "longevity"] as ("check-up" | "longevity")[] };

  it("3 sn sonra peek açılır; kartlar kayar (animasyonlu) ve döngü kopyası yardımcı teknolojiden gizlidir", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<PackagesRunnerLazy {...props} />);
    await act(async () => {});
    expect(screen.getByTestId("packages-runner-tab")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("packages-runner-peek")).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(3100);
    });
    expect(screen.getByTestId("packages-runner-peek")).toBeInTheDocument();
    expect(screen.getByTestId("packages-runner-viewport")).toHaveAttribute("data-animated", "true");
    expect(screen.getByTestId("packages-runner-loop-copy")).toHaveAttribute("aria-hidden", "true");
    // Satır içi `animation` kısaltması `animation-play-state`'i sıfırlayıp hover/odak duraklatmasını ezer; süre değişkenle verilmeli.
    const track = screen.getByTestId("packages-runner-list").parentElement!;
    expect(track).toHaveAttribute("data-animated");
    expect(track.getAttribute("style") ?? "").toContain("--pkg-runner-duration");
    expect(track.getAttribute("style") ?? "").not.toMatch(/(^|;)\s*animation\s*:/);
    expect(document.head.innerHTML + document.body.innerHTML).toContain("animation-play-state:paused");
  });

  it("prefers-reduced-motion: animasyon ve döngü kopyası yok", async () => {
    stubMatchMedia({ reduced: true });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<PackagesRunnerLazy {...props} />);
    await act(async () => {
      vi.advanceTimersByTime(3100);
    });
    expect(screen.getByTestId("packages-runner-viewport")).toHaveAttribute("data-animated", "false");
    expect(screen.queryByTestId("packages-runner-loop-copy")).toBeNull();
    expect(screen.getByTestId("packages-runner-list").closest("[style]")?.getAttribute("style") ?? "").not.toContain("animation");
  });

  it("kapatma sessionStorage'a yazılır ve sonraki mount'ta panel çizilmez", async () => {
    const user = userEvent.setup();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { unmount } = render(<PackagesRunnerLazy {...props} />);
    await act(async () => {
      vi.advanceTimersByTime(3100);
    });
    await user.click(screen.getByTestId("packages-runner-dismiss"));
    expect(window.sessionStorage.getItem(RUNNER_DISMISS_KEY)).toBe("1");
    expect(screen.queryByTestId("packages-runner")).toBeNull();
    unmount();
    render(<PackagesRunnerLazy {...props} />);
    await act(async () => {});
    expect(screen.queryByTestId("packages-runner")).toBeNull();
  });

  it("sessionStorage hata verirse çökmez (panel görünür, kapatma yalnızca bu sayfa için)", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<PackagesRunnerLazy {...props} />);
    await act(async () => {
      vi.advanceTimersByTime(3100);
    });
    expect(screen.getByTestId("packages-runner")).toBeInTheDocument();
    await user.click(screen.getByTestId("packages-runner-dismiss"));
    expect(screen.queryByTestId("packages-runner")).toBeNull();
  });

  it("klavye: sekme odaklanır, Enter ile peek açılır, karta Tab ile gidilir, Enter ayrıntı sheet'i açar, ESC kapatır", async () => {
    getPackage.mockResolvedValue(detail());
    const user = userEvent.setup();
    render(<PackagesRunnerLazy {...props} />);
    await act(async () => {});
    await user.tab();
    const tab = screen.getByTestId("packages-runner-tab");
    expect(tab).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("packages-runner-peek")).toBeInTheDocument();
    // peek açıkken Escape paneli daraltır ve odak sekmeye döner
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("packages-runner-peek")).toBeNull();
    expect(tab).toHaveFocus();
    await user.keyboard("{Enter}");
    const first = within(screen.getByTestId("packages-runner-list")).getAllByTestId("package-card")[0]!;
    await user.click(first);
    expect(await screen.findByTestId("package-detail-sheet")).toBeInTheDocument();
    expect(await screen.findByTestId("package-detail-body")).toBeInTheDocument();
    expect(getPackage).toHaveBeenCalledWith("executive-check-up", "en");
    // Kullanıcı kararı (2026-11-01): panel ve sheet CRM'de kişi bazında izlenmez; yalnızca anonim sayaç artar.
    expect(screen.getByTestId("packages-runner")).toHaveAttribute("data-crm-ignore");
    expect(screen.getByTestId("package-detail-sheet")).toHaveAttribute("data-crm-ignore");
    expect(reportPackageView).toHaveBeenCalledWith("package", "executive-check-up");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("package-detail-sheet")).toBeNull());
  });

  it("ayrıntı yüklenemezse hata ve yeniden dene gösterilir", async () => {
    getPackage.mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce(detail());
    const user = userEvent.setup();
    render(<PackagesRunnerLazy {...props} />);
    await act(async () => {});
    await user.click(screen.getByTestId("packages-runner-tab"));
    await user.click(within(screen.getByTestId("packages-runner-list")).getAllByTestId("package-card")[0]!);
    expect(await screen.findByTestId("package-detail-error")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: en.retry }));
    expect(await screen.findByTestId("package-detail-body")).toBeInTheDocument();
  });

  it("mobil: alt şerit kategori adlarını gösterir, dokununca kategori sekmeli sheet açılır", async () => {
    stubMatchMedia({ desktop: false });
    const user = userEvent.setup();
    render(<PackagesRunnerLazy {...props} />);
    await act(async () => {});
    const strip = screen.getByTestId("packages-runner-strip");
    expect(strip).toHaveAttribute("data-bottom-bar");
    expect(strip.textContent).toContain("Check-up");
    expect(strip.textContent).toContain("Longevity");
    await user.click(within(strip).getByRole("button", { name: new RegExp(en.sectionTitle) }));
    const sheet = await screen.findByTestId("packages-runner-sheet");
    await user.click(within(sheet).getByRole("tab", { name: "Longevity" }));
    expect(within(sheet).getAllByTestId("package-card")).toHaveLength(1);
  });
});

describe("fiyat gösterimi", () => {
  const t = en;
  it("price null → fiyat ve not yok", () => {
    render(<PackageDetailBody pkg={detail({ price: null })} t={t} intlLocale="en-US" localize={(p) => p} />);
    expect(screen.queryByTestId("package-price")).toBeNull();
    expect(screen.queryByText(t.priceNote)).toBeNull();
  });
  it("price doluysa 'Starting from €X' ve kesin fiyat notu birlikte", () => {
    render(<PackageDetailBody pkg={detail({ price: { from: 1200, currency: "EUR" } })} t={t} intlLocale="en-US" localize={(p) => p} />);
    expect(screen.getByTestId("package-price")).toHaveTextContent("Starting from €1,200");
    expect(screen.getByTestId("package-price-note")).toHaveTextContent("Final price is confirmed after medical evaluation.");
  });
  it("ilgili hekim bağlantıları /physicians/<slug> ve HTML'de backend:4000 / localhost yok (canlı benzeri medya kökü)", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://site.example/api/v1");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://site.example");
    vi.stubEnv("NEXT_PUBLIC_INTERNAL_MEDIA_URL", "http://backend:4000");
    vi.stubEnv("INTERNAL_API_URL", "http://backend:4000/api/v1");
    const { PackageDetailBody: Body } = await import("@/components/site/packages/package-detail-body");
    const { container } = render(
      <Body
        pkg={detail({ relatedDoctors: [{ slug: "dr-a", name: "Prof. Dr. Ayse Demir", specialty: "Cardiology", avatarUrl: "http://localhost:4000/uploads/a.webp" }] })}
        t={t}
        intlLocale="en-US"
        localize={(p) => p}
      />
    );
    const link = screen.getByRole("link", { name: /Ayse Demir/ });
    expect(link).toHaveAttribute("href", "/physicians/dr-a");
    expect(container.querySelector("img")).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/backend:4000|localhost|127.0.0.1/);
    vi.unstubAllEnvs();
  });
});

describe("JSON-LD ve Open Graph", () => {
  const url = "https://site.example/packages/executive-check-up";
  it("MedicalProcedure; offers yalnızca fiyatlıysa", () => {
    const free = JSON.parse(buildPackageJsonLd(detail(), url));
    expect(free["@type"]).toBe("MedicalProcedure");
    expect(free.offers).toBeUndefined();
    expect(JSON.stringify(free)).not.toMatch(/price/i);
    const priced = JSON.parse(buildPackageJsonLd(detail({ price: { from: 900, currency: "EUR" } }), url));
    expect(priced.offers).toEqual({ "@type": "Offer", url, priceCurrency: "EUR", price: "900" });
  });
  it("Open Graph görseli compatUrl varsa onu kullanır", () => {
    const cover = { url: "https://site.example/uploads/a.webp", compatUrl: "https://site.example/uploads/a.jpg", width: 10, height: 10, alt: null };
    expect(packageSocialImage({ cover })).toBe("https://site.example/uploads/a.jpg");
    expect(packageSocialImage({ cover: null })).toBeNull();
  });
});

describe("tarih biçimi", () => {
  it("iki tarih → 'YYYY-MM-DD – YYYY-MM-DD' (≤23 karakter), tek tarih, boş", () => {
    expect(buildPreferredDates("2026-12-01", "2026-12-10")).toBe("2026-12-01 – 2026-12-10");
    expect(buildPreferredDates("2026-12-01", "2026-12-10")!.length).toBeLessThanOrEqual(23);
    expect(buildPreferredDates("2026-12-10", "2026-12-01")).toBe("2026-12-01 – 2026-12-10");
    expect(buildPreferredDates("2026-12-01", "")).toBe("2026-12-01");
    expect(buildPreferredDates("", "")).toBeUndefined();
  });
});

describe("Plan my package formu", () => {
  const fillBasics = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByLabelText(en.nameLabel), "Jane Doe");
    await user.type(screen.getByLabelText(en.emailLabel), "jane@example.com");
  };

  it("iletişim onayı yokken uyarı görünür ve gövdede kişisel veri/not gitmez; 'kaydedilmedi' gösterilir", async () => {
    submitPackageInquiry.mockResolvedValue({ number: 0, stored: false });
    const user = userEvent.setup();
    render(<PackageInquiryForm slug="executive-check-up" />);
    expect(screen.getByTestId("package-inquiry-no-contact-note")).toHaveTextContent(en.noContactNote);
    await fillBasics(userEvent.setup());
    await user.click(screen.getByRole("button", { name: en.submit }));
    const result = await screen.findByTestId("package-inquiry-not-stored");
    expect(result).toHaveTextContent(en.notStoredTitle);
    const [slug, body] = submitPackageInquiry.mock.calls[0]!;
    expect(slug).toBe("executive-check-up");
    expect(body).toEqual({ locale: "en", consentContact: false, consentHealth: false });
    expect(JSON.stringify(body)).not.toContain("jane");
  });

  it("not doluyken sağlık onayı yoksa uyarı çıkar ve gönderilmez", async () => {
    const user = userEvent.setup();
    render(<PackageInquiryForm slug="x" />);
    await fillBasics(user);
    await user.click(screen.getByTestId("package-inquiry-consent-contact"));
    await user.type(screen.getByLabelText(en.noteLabel), "I have a question");
    expect(screen.getByTestId("package-inquiry-note-warning")).toHaveTextContent(en.noteNeedsConsent);
    await user.click(screen.getByRole("button", { name: en.submit }));
    expect(await screen.findByTestId("package-inquiry-consent-health-error")).toBeInTheDocument();
    expect(submitPackageInquiry).not.toHaveBeenCalled();
  });

  it("not sayacı ve 500 sınırı", async () => {
    const user = userEvent.setup();
    render(<PackageInquiryForm slug="x" />);
    const note = screen.getByLabelText(en.noteLabel);
    expect(note).toHaveAttribute("maxlength", "500");
    await user.type(note, "abcd");
    expect(screen.getByTestId("package-inquiry-note-counter")).toHaveTextContent("4/500");
  });

  it("iki onay + tarihler: tam gövde gider, başarıda talep numarası gösterilir; onaylar ön işaretli değil", async () => {
    submitPackageInquiry.mockResolvedValue({ number: 42, stored: true });
    const user = userEvent.setup();
    render(<PackageInquiryForm slug="executive-check-up" />);
    expect(screen.getByTestId("package-inquiry-consent-contact")).not.toBeChecked();
    expect(screen.getByTestId("package-inquiry-consent-health")).not.toBeChecked();
    await fillBasics(user);
    await user.type(screen.getByTestId("package-inquiry-date-from"), "2026-12-01");
    await user.type(screen.getByTestId("package-inquiry-date-to"), "2026-12-10");
    await user.type(screen.getByLabelText(en.noteLabel), "Hello");
    await user.click(screen.getByTestId("package-inquiry-consent-health"));
    await user.click(screen.getByTestId("package-inquiry-consent-contact"));
    await user.click(screen.getByRole("button", { name: en.submit }));
    expect(await screen.findByTestId("package-inquiry-number")).toHaveTextContent("Request number: 42");
    expect(submitPackageInquiry.mock.calls[0]![1]).toMatchObject({
      locale: "en",
      name: "Jane Doe",
      email: "jane@example.com",
      preferredDates: "2026-12-01 – 2026-12-10",
      travellers: 1,
      note: "Hello",
      consentContact: true,
      consentHealth: true,
    });
  });

  it("iletişim onayıyla ad/e-posta-telefon zorunlu; honeypot dolu gider", async () => {
    submitPackageInquiry.mockResolvedValue({ number: 1, stored: true });
    const user = userEvent.setup();
    render(<PackageInquiryForm slug="x" />);
    await user.click(screen.getByTestId("package-inquiry-consent-contact"));
    await user.click(screen.getByRole("button", { name: en.submit }));
    expect(await screen.findAllByText(en.required)).not.toHaveLength(0);
    expect(submitPackageInquiry).not.toHaveBeenCalled();
    expect(screen.getByTestId("package-inquiry-website").closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("429 → hız sınırı mesajı", async () => {
    submitPackageInquiry.mockRejectedValue(new ApiClientError(429, { code: "RATE_LIMITED" as never, message: "x" }));
    const user = userEvent.setup();
    render(<PackageInquiryForm slug="x" />);
    await fillBasics(user);
    await user.click(screen.getByTestId("package-inquiry-consent-contact"));
    await user.click(screen.getByRole("button", { name: en.submit }));
    expect(await screen.findByTestId("package-inquiry-error")).toHaveTextContent(en.errorRateLimit);
  });
});

describe("sözlük eşitliği (9 dil)", () => {
  const keys = Object.keys(en).sort();
  const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
  it.each(Object.entries(PACKAGES_DICTIONARIES))("%s: EN ile aynı anahtarlar, boş değer yok, yer tutucular korunur", (code, dict) => {
    expect(Object.keys(dict).sort()).toEqual(keys);
    for (const key of keys as (keyof typeof en)[]) {
      expect(dict[key].trim().length, `${code}.${key}`).toBeGreaterThan(0);
      expect(placeholders(dict[key]), `${code}.${key}`).toBe(placeholders(en[key]));
    }
  });
  it("sr-latn Latin alfabesi", () => {
    expect(JSON.stringify(PACKAGES_DICTIONARIES["sr-latn"])).not.toMatch(/[Ѐ-ӿ]/);
  });
});

describe("sitemap ve llms.txt", () => {
  const locales = [
    { code: "en", enabled: true, isDefault: true, hreflang: "en" },
    { code: "tr", enabled: true, isDefault: false, hreflang: "tr" },
  ] as unknown as Locale[];
  const base: SitemapData = { siteUrl: "https://site.example", locales, homePageId: null, pages: [], doctors: [], specialties: [], posts: [], products: [], portfolio: [] };

  it("paket yokken bölüm ve index girdisi yok", () => {
    expect(buildSection("packages", base)).toEqual([]);
    expect(buildSection("packages", { ...base, packages: [] })).toEqual([]);
    expect(buildIndex(base).some((i) => i.loc.includes("packages"))).toBe(false);
    expect(buildLlmsTxt({ ...base, siteName: "WM" })).not.toContain("Health packages");
  });
  it("aktif paketler yalnızca içeriği olan dillerle listelenir", () => {
    const data: SitemapData = { ...base, packages: [{ slug: "executive-check-up", locales: ["en"], title: "Executive Check-up", summary: "A full-day check-up." }] };
    const locs = buildSection("packages", data).map((e) => e.loc);
    expect(locs).toContain("https://site.example/packages");
    expect(locs).toContain("https://site.example/tr/packages");
    expect(locs).toContain("https://site.example/packages/executive-check-up");
    expect(locs).not.toContain("https://site.example/tr/packages/executive-check-up");
    expect(buildIndex(data).some((i) => i.loc.endsWith("/sitemaps/packages.xml"))).toBe(true);
    expect(buildLlmsTxt({ ...data, siteName: "WM" })).toContain("[Executive Check-up](https://site.example/packages/executive-check-up)");
  });
});

describe("PackagesRunnerSlot", () => {
  it("aktif paket yoksa null döner", async () => {
    vi.resetModules();
    vi.doMock("@/lib/api/server-packages", () => ({ fetchPackagesServer: async () => ({ items: [], categories: [] }) }));
    const { PackagesRunnerSlot } = await import("@/components/site/packages/packages-runner-slot");
    expect(await PackagesRunnerSlot({ lang: "en" })).toBeNull();
    vi.doUnmock("@/lib/api/server-packages");
  });
});

describe("anonim görüntülenme sayacı", () => {
  it("PackageViewBeacon sayfa başına bir kez, kimliksiz çağrılır", async () => {
    const { PackageViewBeacon } = await import("@/components/site/packages/package-view-beacon");
    const { rerender } = render(<PackageViewBeacon kind="package" slug="executive-check-up" />);
    rerender(<PackageViewBeacon kind="package" slug="executive-check-up" />);
    expect(reportPackageView).toHaveBeenCalledTimes(1);
    expect(reportPackageView).toHaveBeenCalledWith("package", "executive-check-up");
  });

  it("mobil şerit ve bottom sheet CRM'de izlenmez", async () => {
    stubMatchMedia({ desktop: false });
    render(<PackagesRunnerLazy featured={[card()]} items={[card()]} categories={["check-up"]} />);
    await act(async () => {});
    expect(screen.getByTestId("packages-runner-strip")).toHaveAttribute("data-crm-ignore");
  });
});
