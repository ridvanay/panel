import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import type { PublicBlogList, Specialty } from "@/lib/api/types";
import { GROUPS, LOCALES, PACKAGE, makeCard, makeDetail } from "./blog-z1-fixtures";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  topics: vi.fn(),
  packages: vi.fn(),
  specialties: vi.fn(),
  doctors: vi.fn(),
  detail: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  permanentRedirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));
vi.mock("@/lib/api/server-blog", () => ({
  fetchBlogListServer: (...a: unknown[]) => mocks.list(...a),
  fetchBlogTopicsServer: (...a: unknown[]) => mocks.topics(...a),
  fetchBlogDetailServer: (...a: unknown[]) => mocks.detail(...a),
}));
vi.mock("@/lib/api/server-locales", () => ({ fetchLocalesServer: async () => LOCALES }));
vi.mock("@/lib/api/server-settings", () => ({ fetchSiteSettingsServer: async () => ({ siteName: "WM Health" }) }));
vi.mock("@/lib/api/server-packages", () => ({ fetchPackagesServer: (...a: unknown[]) => mocks.packages(...a) }));
vi.mock("@/lib/api/server-telehealth", () => ({
  fetchSpecialtiesServer: (...a: unknown[]) => mocks.specialties(...a),
  fetchAllDoctorsServer: (...a: unknown[]) => mocks.doctors(...a),
}));
vi.mock("@/components/site/matcher/matcher-modal", () => ({
  MatcherLaunchButton: () => <button type="button">Find my physician</button>,
}));
vi.mock("@/components/site/contact/contact-cta", () => ({ ContactCta: () => <div data-testid="contact-cta">Request a call back</div> }));
vi.mock("@/components/site/sync-locale-alternates", () => ({ SyncLocaleAlternates: () => null }));
vi.mock("@/components/site/view-tracker", () => ({ ViewTracker: () => null }));

import { BlogIndexPage } from "@/components/site/blog/blog-index-page";
import { BlogPostPage } from "@/components/site/blog/blog-post-page";
import { BlogReadingProgress } from "@/components/site/blog/blog-reading-progress";
import { specialtyIconFor, specialtyToneFor } from "@/lib/blog/specialty-icon";

const EMPTY: PublicBlogList = { items: [], total: 0, page: 1, pageSize: 12, featured: null };

function specialty(slug: string, name: string): Specialty {
  return { id: slug, slug, name, icon: "Stethoscope", description: null, order: 0, isActive: true, imageMediaId: null, imageUrl: null, createdAt: "", updatedAt: "" };
}

async function renderIndex(lang = "en", searchParams: Record<string, string> = {}) {
  return render(await BlogIndexPage({ lang, page: 1, searchParams }));
}

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue(EMPTY);
  mocks.topics.mockReset().mockResolvedValue([]);
  mocks.packages.mockReset().mockResolvedValue({ items: [PACKAGE], categories: [] });
  mocks.specialties.mockReset().mockResolvedValue([specialty("orthopaedics", "Orthopaedics"), specialty("cardiology", "Cardiology"), specialty("dermatology", "Dermatology")]);
  // Varsayılan: üç uzmanlığın da en az bir aktif hekimi var (biri ek uzmanlık olarak).
  mocks.doctors.mockReset().mockResolvedValue([
    { id: "d1", specialtyId: "orthopaedics", isActive: true },
    { id: "d2", specialtyId: "cardiology", isActive: true, additionalSpecialties: [{ id: "dermatology", name: "Dermatology", slug: "dermatology" }] },
  ]);
  mocks.detail.mockReset().mockResolvedValue(makeDetail());
});

describe("Paket Z1-ek — blog ana sayfası, yazı yokken", () => {
  it("düzgün boş durum: mesaj, Find my physician, hasta koordinatörü ve Popular packages; sahte sayaç/ızgara yok", async () => {
    await renderIndex();
    const empty = screen.getByTestId("blog-empty");
    expect(empty).toHaveTextContent("Our first guides will be published soon.");
    expect(within(empty).getByRole("button", { name: "Find my physician" })).toBeInTheDocument();
    const coordinator = screen.getByTestId("blog-coordinator-cta");
    expect(coordinator).toHaveTextContent("Talk to a patient coordinator");
    expect(within(coordinator).getByTestId("contact-cta")).toBeInTheDocument();
    expect(screen.getByTestId("blog-popular-packages")).toBeInTheDocument();
    expect(screen.queryByText(/Articles: 0/)).toBeNull();
    expect(screen.queryByTestId("blog-total")).toBeNull();
    expect(screen.queryByTestId("blog-grid")).toBeNull();
    expect(screen.queryByTestId("blog-featured")).toBeNull();
  });

  it("üst bant: H1, açıklama, arama ve güven satırı Content standards'a gider", async () => {
    await renderIndex();
    const hero = screen.getByTestId("blog-hero");
    expect(within(hero).getByRole("heading", { level: 1, name: "Health Guides" })).toBeInTheDocument();
    expect(within(hero).getByRole("search")).toBeInTheDocument();
    const trust = within(hero).getByTestId("blog-trust-line");
    expect(trust).toHaveAttribute("href", "/content-standards");
    expect(trust).toHaveTextContent("Written by our editorial team");
    expect(trust).not.toHaveTextContent(/physician/i);
    expect(trust).toHaveTextContent("Sources cited");
    expect(trust).toHaveTextContent("Regularly updated");
  });

  it("uzmanlık kartları: yazısı olmayan uzmanlık, uzmanlık sayfasına gider ve SAYI göstermez", async () => {
    await renderIndex();
    const cards = screen.getAllByTestId("blog-specialty-card");
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card).toHaveAttribute("data-has-posts", "false");
      expect(within(card).getByTestId("blog-specialty-meta")).toHaveTextContent("View service");
      expect(card.textContent).not.toMatch(/\d/);
    }
    expect(screen.getByRole("link", { name: /Orthopaedics/ })).toHaveAttribute("href", "/specialties/orthopaedics");
  });

  it("uzmanlık modülü kapalı/hatalıysa kartlar gizlenir, sayfa yine çalışır", async () => {
    mocks.specialties.mockRejectedValue(new Error("boom"));
    await renderIndex();
    expect(screen.queryByTestId("blog-specialties")).toBeNull();
    expect(screen.getByTestId("blog-empty")).toBeInTheDocument();
  });

  it.each(["tr", "ar", "de", "ro"])("%s: boş durum çevrilmiş ve yön doğru", async (lang) => {
    const { container } = await renderIndex(lang);
    expect(screen.getByTestId("blog-empty")).not.toHaveTextContent("Our first guides");
    expect(container.firstElementChild).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
  });

  it("filtre/aramada sonuç yoksa 'sonuç bulunamadı' durumu (boş durum mesajı değil)", async () => {
    await renderIndex("en", { q: "zzz" });
    expect(screen.getByTestId("blog-empty")).toHaveTextContent("No articles found");
    expect(screen.queryByTestId("blog-coordinator-cta")).toBeNull();
  });
});

describe("Paket Z1-ek — blog ana sayfası, yazı varken", () => {
  const items = [
    makeCard({ id: "a", slug: "a-post", title: "Alpha post", reviewer: { name: "Prof. Dr. H. Sofu", slug: "hakan-sofu", avatarUrl: "/uploads/h.webp" } }),
    makeCard({ id: "b", slug: "b-post", title: "Beta post", specialty: { slug: "cardiology", name: "Cardiology" }, category: { name: "Heart", slug: "heart" } }),
  ];

  beforeEach(() => {
    mocks.list.mockResolvedValue({ items, total: 2, page: 1, pageSize: 12, featured: items[0]! });
    mocks.topics.mockResolvedValue(GROUPS);
  });

  it("öne çıkan yazı, kart ızgarası ve toplam; boş durum yok", async () => {
    await renderIndex();
    expect(screen.getByTestId("blog-featured")).toHaveTextContent("Alpha post");
    expect(within(screen.getByTestId("blog-grid")).getByText("Beta post")).toBeInTheDocument();
    expect(screen.getByTestId("blog-total")).toHaveTextContent("Articles: 2");
    expect(screen.queryByTestId("blog-coordinator-cta")).toBeNull();
    expect(screen.queryByTestId("blog-featured-reviewer")).toBeNull();
  });

  it("uzmanlık kartları: yazısı olan uzmanlık filtreye gider ve gerçek sayıyı gösterir; olmayanda sayı yok", async () => {
    await renderIndex();
    const byName = (name: string) => screen.getAllByTestId("blog-specialty-card").find((c) => c.textContent!.includes(name))!;
    expect(byName("Orthopaedics")).toHaveAttribute("href", "/blog?topic=orthopaedics");
    expect(byName("Orthopaedics")).toHaveTextContent("Guides: 9");
    expect(byName("Cardiology")).toHaveTextContent("Guides: 3");
    expect(byName("Dermatology")).toHaveAttribute("href", "/specialties/dermatology");
    expect(byName("Dermatology").textContent).not.toMatch(/\d/);
  });

  it("kartlarda uzmanlık ikonlu/tonlu çip var, hekim satırı yok (öne çıkan yazı ızgarada tekrarlanmaz)", async () => {
    mocks.list.mockResolvedValue({ items: [...items, makeCard({ id: "c", slug: "c-post", title: "Gamma post", reviewer: null })], total: 3, page: 1, pageSize: 12, featured: items[0]! });
    await renderIndex();
    const [beta, gamma] = screen.getAllByTestId("blog-card");
    expect(within(beta!).getByTestId("blog-specialty-chip")).toHaveTextContent("Heart");
    expect(within(beta!).queryByTestId("blog-card-reviewer")).toBeNull();
    expect(within(gamma!).queryByTestId("blog-card-reviewer")).toBeNull();
  });

  it("uzmanlık ikon/ton eşlemesi kararlı ve yalnızca tema tokenlarıdır", () => {
    expect(specialtyToneFor("orthopaedics")).toBe(specialtyToneFor("orthopaedics"));
    for (const slug of ["orthopaedics", "cardiology", "dermatology", "x", ""]) {
      expect(specialtyToneFor(slug).soft).toMatch(/var\(--site-(primary|secondary|accent)\)|text-foreground/);
      expect(specialtyToneFor(slug).soft).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
    expect(specialtyIconFor("cardiology")).toBe(specialtyIconFor("cardiology-care"));
  });
});

describe("Paket Z1-ek — yazı sayfası", () => {
  it("hekim onaylı olsa bile 'Medically reviewed by' satırı, hekim adı ve 'Last reviewed' çizilmez; yazar Editorial Team", async () => {
    mocks.detail.mockResolvedValue(makeDetail({ reviewer: { name: "H. Sofu", title: "Prof. Dr.", slug: "hakan-sofu", avatarUrl: null, specialty: { slug: "orthopaedics", name: "Orthopaedics" } } }));
    const { container } = render(await BlogPostPage({ lang: "en", slug: "knee-pain-guide" }));
    expect(screen.queryByTestId("blog-byline-reviewer")).toBeNull();
    expect(screen.queryByText("Medically reviewed by")).toBeNull();
    expect(screen.queryByTestId("blog-last-reviewed")).toBeNull();
    expect(container.textContent).not.toMatch(/Sofu|Demir|Last reviewed/);
    expect(container.querySelector('a[href*="/physicians/"]')).toBeNull();
    expect(screen.getByTestId("blog-byline")).toHaveTextContent("WM Health Editorial Team");
    expect(screen.getByTestId("blog-published-date")).toHaveTextContent("October 1, 2026");
  });

  it("yazı sonunda 'Talk to a patient coordinator' kartı talep formuna gider; 'Consult a physician' kartı yok", async () => {
    render(await BlogPostPage({ lang: "en", slug: "knee-pain-guide" }));
    const card = screen.getByTestId("blog-coordinator-card");
    expect(card).toHaveTextContent("Talk to a patient coordinator");
    expect(within(card).getByRole("link", { name: "Request a consultation" })).toHaveAttribute("href", "/request");
    expect(screen.queryByTestId("blog-consult-card")).toBeNull();
    expect(screen.queryByText("Consult a physician")).toBeNull();
  });

  it("yazının altında aracı kuruluş ibaresi; belge numarası boşken belge satırı yok", async () => {
    render(await BlogPostPage({ lang: "en", slug: "knee-pain-guide" }));
    expect(screen.getByTestId("intermediary-notice")).toHaveTextContent("International Health Tourism Intermediary");
    expect(screen.queryByTestId("intermediary-certificate")).toBeNull();
  });

  it("okuma ilerleme çubuğu, yazar kutusu (Content standards bağlantılı) ve kapak alanı; paylaşım yalnızca yazıda", async () => {
    render(await BlogPostPage({ lang: "en", slug: "knee-pain-guide" }));
    const bar = screen.getByRole("progressbar", { name: "Reading progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    const box = screen.getByTestId("blog-author-box");
    expect(within(box).getByText("WM Health Editorial Team")).toBeInTheDocument();
    expect(within(box).getByRole("link", { name: "Content standards" })).toHaveAttribute("href", "/content-standards");
    expect(within(box).queryByRole("link", { name: "Authors & medical reviewers" })).toBeNull();
    // Kapak yok → şablon kapak (sabit oranlı alan).
    expect(screen.getAllByTestId("blog-cover-template").length).toBeGreaterThan(0);
    expect(screen.getByTestId("blog-share")).toBeInTheDocument();
  });

  it("ilerleme çubuğu kaydırmaya göre güncellenir; hareket azaltma tercihi için geçiş sınıfı kapatılır", async () => {
    const original = Element.prototype.getBoundingClientRect;
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    render(
      <>
        <article id="t" />
        <BlogReadingProgress label="Reading progress" targetId="t" />
      </>
    );
    const bar = screen.getByRole("progressbar");
    expect(bar.firstElementChild!.className).toContain("motion-reduce:transition-none");
    Element.prototype.getBoundingClientRect = () => ({ top: -600, height: 1400, bottom: 800, left: 0, right: 0, width: 0, x: 0, y: -600, toJSON: () => ({}) }) as DOMRect;
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    Element.prototype.getBoundingClientRect = original;
  });
});

describe("Browse by specialty — Paket AH (hekim bilgisi kullanılmaz)", () => {
  it("tüm aktif üst bölümler listelenir; pasif olan listelenmez; hekim listesi çekilmez", async () => {
    mocks.specialties.mockResolvedValue([
      specialty("orthopaedics", "Orthopaedics"),
      specialty("cardiology", "Cardiology"),
      { ...specialty("neurosurgery", "Neurosurgery"), isActive: false },
      specialty("hair-transplantation", "Hair transplantation"),
    ]);
    mocks.doctors.mockClear();
    await renderIndex("en");
    const browse = screen.getByTestId("blog-specialties");
    expect(within(browse).getByRole("link", { name: /Orthopaedics/ })).toBeInTheDocument();
    expect(within(browse).getByRole("link", { name: /Cardiology/ })).toBeInTheDocument();
    expect(within(browse).getByRole("link", { name: /Hair transplantation/ })).toBeInTheDocument();
    expect(within(browse).queryByText(/Neurosurgery/)).toBeNull();
    expect(mocks.doctors).not.toHaveBeenCalled();
  });

  it("bölüm listesi boşsa bölüm çizilmez", async () => {
    mocks.specialties.mockResolvedValue([]);
    await renderIndex("en");
    expect(screen.queryByTestId("blog-specialties")).toBeNull();
    cleanup();
  });
});
