import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DoctorProfile } from "@/lib/api/types";
import type { FeaturedDoctorsBlock, HeadingBlock, ImageBlock, TextBlock } from "@/lib/page-builder/types";
import { createBlock } from "@/lib/page-builder/registry";

/**
 * Paket A3 (2026-10-18) — "Öne Çıkan Doktorlar" bloğu + metin hizalama + görsel/başlık bağlantısı.
 */
const fetchDoctorsServer = vi.fn<() => Promise<DoctorProfile[]>>();
vi.mock("@/lib/api/server-telehealth", () => ({ fetchAllDoctorsServer: () => fetchDoctorsServer() }));
const listAdminDoctors = vi.fn();
vi.mock("@/lib/api/telehealth", () => ({ listAdminDoctors: (...args: unknown[]) => listAdminDoctors(...args) }));

import { FeaturedDoctorsBlockView, pickFeaturedDoctors, resolveFeaturedDoctors, resolveFeaturedDoctorsContent } from "@/components/site/blocks/featured-doctors-block";
import { FEATURED_DOCTORS_AUTOPLAY_MS, FeaturedDoctorsCarousel } from "@/components/site/blocks/featured-doctors-carousel";
import { FeaturedDoctorsBlockEditor } from "@/components/admin/page-builder/blocks/featured-doctors-block";
import { TextBlockView } from "@/components/site/blocks/text-block";
import { HeadingBlockView } from "@/components/site/blocks/heading-block";
import { ImageBlockView } from "@/components/site/blocks/image-block";
import { linkAttrs } from "@/lib/page-builder/link-attrs";

const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ID_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function doctor(overrides: Partial<DoctorProfile>): DoctorProfile {
  return {
    id: ID_A,
    userId: null,
    specialtyId: null,
    specialty: null,
    title: "Dr.",
    subSpecialty: null,
    fullName: "Ayşe Yılmaz",
    slug: "ayse-yilmaz",
    bio: "Kısa özet",
    aboutHtml: null,
    practiceStartYear: null,
    experienceYears: null,
    cvEntries: [],
    publications: [],
    socialLinks: [],
    languages: ["tr"],
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

function block(data: Partial<FeaturedDoctorsBlock["data"]> = {}): FeaturedDoctorsBlock {
  const base = createBlock("featured-doctors") as FeaturedDoctorsBlock;
  return { ...base, data: { ...base.data, ...data } };
}

beforeEach(() => {
  fetchDoctorsServer.mockReset();
  listAdminDoctors.mockReset();
});

describe("pickFeaturedDoctors", () => {
  it("seçim sırasını korur, listede olmayan (pasif/silinmiş) ve pasif doktorları atar", () => {
    const list = [doctor({ id: ID_A }), doctor({ id: ID_B, isActive: false })];
    expect(pickFeaturedDoctors(list, [ID_B, ID_C, ID_A]).map((d) => d.id)).toEqual([ID_A]);
  });
});

describe("FeaturedDoctorsBlockView", () => {
  it("seçili doktorları sırayla, dile göre başlıkla ve /doctors/<slug> bağlantısıyla render eder", async () => {
    fetchDoctorsServer.mockResolvedValue([
      doctor({ id: ID_A, fullName: "Ayşe Yılmaz", slug: "ayse-yilmaz" }),
      doctor({ id: ID_B, title: "Prof. Dr.", fullName: "Mehmet Kaya", slug: "mehmet-kaya", specialty: { name: "Kardiyoloji" } as DoctorProfile["specialty"] }),
    ]);
    render(await FeaturedDoctorsBlockView({ block: block({ doctorIds: [ID_B, ID_A] }), chrome: "page", siteContext: { lang: "en", defaultLocaleCode: "tr" } }));

    expect(screen.getByRole("heading", { level: 2, name: "Featured Doctors" })).toBeInTheDocument();
    const cards = screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/en/doctors/"));
    expect(cards.map((c) => c.getAttribute("href"))).toEqual(["/en/doctors/mehmet-kaya", "/en/doctors/ayse-yilmaz"]);
    expect(cards[0]).toHaveAccessibleName("Prof. Dr. Mehmet Kaya");
    expect(within(cards[0]!).getByText("Kardiyoloji")).toBeInTheDocument();
    // Hover: kart yükselir, fotoğraf yakınlaşır.
    expect(cards[0]!.className).toContain("hover:-translate-y-1");
    expect(cards[0]!.innerHTML).toContain("group-hover:scale-105");
    expect(screen.getByRole("link", { name: "All Doctors" })).toHaveAttribute("href", "/en/doctors");
  });

  it("fotoğraf şekli ve sütun sayısı sınıflara yansır; buton kapatılabilir", async () => {
    fetchDoctorsServer.mockResolvedValue([doctor({ id: ID_A })]);
    const { container } = render(
      await FeaturedDoctorsBlockView({
        block: block({ doctorIds: [ID_A], columns: 3, imageShape: "circle", showAllButton: false }),
        chrome: "page",
        siteContext: { lang: "tr", defaultLocaleCode: "tr" },
      })
    );
    expect(container.querySelector("ul")!.className).toContain("lg:grid-cols-3");
    expect(container.innerHTML).toContain("rounded-full");
    expect(screen.queryByRole("link", { name: "Tüm Doktorlar" })).not.toBeInTheDocument();
  });

  it("seçili doktor yoksa veya hepsi pasifse hiçbir şey render etmez", async () => {
    expect(await FeaturedDoctorsBlockView({ block: block({ doctorIds: [] }), chrome: "page" })).toBeNull();
    fetchDoctorsServer.mockResolvedValue([doctor({ id: ID_A, isActive: false })]);
    expect(await FeaturedDoctorsBlockView({ block: block({ doctorIds: [ID_A] }), chrome: "page" })).toBeNull();
  });
});

describe("FeaturedDoctorsBlockEditor", () => {
  it("doktor kayıtlarından seçim ekler, pasifleri işaretler ve 8 sınırını uygular", async () => {
    const user = userEvent.setup();
    listAdminDoctors.mockResolvedValue({ items: [doctor({ id: ID_A }), doctor({ id: ID_B, fullName: "Pasif Doktor", isActive: false })], meta: { nextCursor: null } });
    const onChange = vi.fn();
    const { rerender } = render(<FeaturedDoctorsBlockEditor block={block()} onChange={onChange} />);

    const select = await screen.findByLabelText("Doktor ekle");
    await waitFor(() => expect(select).toBeEnabled());
    expect(within(select).getByRole("option", { name: "Dr. Pasif Doktor (pasif)" })).toBeInTheDocument();
    await user.selectOptions(select, ID_A);
    expect(onChange.mock.calls.at(-1)![0].data.doctorIds).toEqual([ID_A]);

    rerender(<FeaturedDoctorsBlockEditor block={block({ doctorIds: [ID_B] })} onChange={onChange} />);
    expect(await screen.findByText("Pasif — sitede gizli")).toBeInTheDocument();

    const eight = Array.from({ length: 8 }, (_, i) => `0000000${i}-0000-4000-8000-000000000000`);
    rerender(<FeaturedDoctorsBlockEditor block={block({ doctorIds: eight })} onChange={onChange} />);
    expect(screen.getByLabelText("Doktor ekle")).toBeDisabled();
    expect(screen.getByText("8/8")).toBeInTheDocument();
  });
});

describe("metin hizalama ve bağlantılar", () => {
  it("metin bloğu `align` değerini uygular, eski kayıtta satır başına (LTR'de sol, RTL'de sağ) düşer", () => {
    const text = (align?: TextBlock["data"]["align"]): TextBlock => ({ id: "t", type: "text", data: { html: "<p>Merhaba</p>", align } });
    const { container, rerender } = render(<TextBlockView block={text("center")} chrome="page" />);
    expect(container.firstElementChild!.className).toContain("text-center");
    rerender(<TextBlockView block={text()} chrome="page" />);
    // Paket L — mantıksal hizalama (`text-start`): Arapça (RTL) sayfada da doğru tarafa yaslanır.
    expect(container.firstElementChild!.className).toContain("text-start");
  });

  it("dış bağlantı yeni sekme + rel=noopener, site içi bağlantı aynı sekme", () => {
    expect(linkAttrs("https://example.com")).toEqual({ href: "https://example.com", target: "_blank", rel: "noopener noreferrer" });
    expect(linkAttrs("/doctors/ayse")).toEqual({ href: "/doctors/ayse" });
  });

  it("başlık ve görsel blokları `href` verildiğinde bağlantı olur", () => {
    const heading: HeadingBlock = { id: "h", type: "heading", data: { text: "Doktorlar", level: 2, align: "center", underline: false, href: "https://example.com/x" } };
    render(<HeadingBlockView block={heading} chrome="page" />);
    const headingLink = screen.getByRole("link", { name: "Doktorlar" });
    expect(headingLink).toHaveAttribute("rel", expect.stringContaining("noopener"));

    const image: ImageBlock = { id: "i", type: "image", data: { url: "/x.png", alt: "Dr. Ayşe", href: "/doctors/ayse", lightbox: true } };
    render(<ImageBlockView block={image} chrome="page" />);
    const imageLink = screen.getByRole("link", { name: "Dr. Ayşe" });
    expect(imageLink).toHaveAttribute("href", "/doctors/ayse");
    expect(imageLink).not.toHaveAttribute("target");
    expect(screen.queryByRole("button", { name: /Görseli büyüt/ })).not.toBeInTheDocument();
  });
});

/**
 * Paket D (2026-10-19) — eşit kartlar, `source: "all"`, carousel düzeni.
 */
describe("Paket D — eşit kart yapısı", () => {
  function skeleton(element: Element): string {
    return `${element.tagName}.${element.getAttribute("class")}[${Array.from(element.children).map(skeleton).join(",")}]`;
  }

  it("isim ve uzmanlık line-clamp-2 + iki satırlık min-height taşır; uzun ve kısa isimde DOM yapısı aynıdır", async () => {
    fetchDoctorsServer.mockResolvedValue([
      doctor({ id: ID_A, title: "Op. Dr.", fullName: "Hasan Tuna TÜRKMEN", slug: "hasan", subSpecialty: "Gynecologic Oncology Surgery Specialist" }),
      doctor({ id: ID_B, title: "Doç. Dr.", fullName: "Vahit MUTLU", slug: "vahit", specialty: { name: "Ortopedi" } as DoctorProfile["specialty"] }),
      doctor({ id: ID_C, title: "Dr.", fullName: "Ali", slug: "ali" }),
    ]);
    render(
      await FeaturedDoctorsBlockView({
        block: block({ doctorIds: [ID_A, ID_B, ID_C] }),
        chrome: "page",
        siteContext: { lang: "en", defaultLocaleCode: "en" },
      })
    );
    const cards = screen.getAllByRole("link").filter((link) => /\/doctors\/[a-z]/.test(link.getAttribute("href") ?? ""));
    expect(cards).toHaveLength(3);

    for (const card of cards) {
      const name = card.querySelector(".featured-doctor-name")!;
      const specialty = card.querySelector(".featured-doctor-specialty")!;
      expect(name.className).toContain("line-clamp-2");
      expect(name.className).toContain("min-h-14");
      expect(specialty.className).toContain("line-clamp-2");
      expect(specialty.className).toContain("min-h-10");
      expect(name).toHaveAttribute("title", card.getAttribute("aria-label"));
    }
    // Uzmanlık satırı boş olsa bile (Dr. Ali) aynı DOM üretilir — hizalama bozulmaz.
    expect(new Set(cards.map(skeleton)).size).toBe(1);
    // `subSpecialty` doluysa o, değilse birincil uzmanlık adı.
    expect(within(cards[0]!).getByText("Gynecologic Oncology Surgery Specialist")).toBeInTheDocument();
    expect(within(cards[1]!).getByText("Ortopedi")).toBeInTheDocument();
  });
});

describe("Paket D — resolveFeaturedDoctors", () => {
  const ID_D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

  it("source=all pasif ve arşivli doktorları dışlar, liste (seq) sırasını korur; doctorIds yok sayılır", () => {
    const list = [
      doctor({ id: ID_C }),
      doctor({ id: ID_A, isActive: false }),
      doctor({ id: ID_B, archivedAt: "2026-10-18T00:00:00.000Z" }),
      doctor({ id: ID_D }),
    ];
    const data = { ...block().data, source: "all" as const, doctorIds: [ID_A] };
    expect(resolveFeaturedDoctors(list, data).map((d) => d.id)).toEqual([ID_C, ID_D]);
  });

  it("seçili kaynakta ızgara 8, carousel 24 doktorla sınırlanır", () => {
    const ids = Array.from({ length: 30 }, (_, i) => `id-${i}`);
    const list = ids.map((id) => doctor({ id }));
    expect(resolveFeaturedDoctors(list, { ...block().data, doctorIds: ids })).toHaveLength(8);
    expect(resolveFeaturedDoctors(list, { ...block().data, doctorIds: ids, layout: "carousel" })).toHaveLength(24);
  });
});

describe("Paket D — carousel", () => {
  const labels = {
    region: "Featured Doctors",
    previous: "Previous doctors",
    next: "Next doctors",
    goToPage: "Page {page} of {total}",
    pause: "Pause automatic scrolling",
    play: "Resume automatic scrolling",
  };
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, node: <a href={`/doctors/${i}`}>Doktor {i}</a> }));

  function mockMatchMedia(matching: string[]) {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: matching.includes(query),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    return () => {
      window.matchMedia = original;
    };
  }

  it("blok carousel düzeninde region + aria-roledescription ve sözlükten gelen etiketlerle render edilir", async () => {
    fetchDoctorsServer.mockResolvedValue(Array.from({ length: 6 }, (_, i) => doctor({ id: `id-${i}`, slug: `d-${i}` })));
    render(
      await FeaturedDoctorsBlockView({
        block: block({ layout: "carousel", source: "all" }),
        chrome: "page",
        siteContext: { lang: "tr", defaultLocaleCode: "en" },
      })
    );
    const region = screen.getByRole("region", { name: "Öne Çıkan Doktorlarımız" });
    expect(region).toHaveAttribute("aria-roledescription", "carousel");
    expect(screen.getByRole("button", { name: "Önceki doktorlar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sonraki doktorlar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sayfa 2 / 2" })).toBeInTheDocument();
    expect(within(region).getAllByRole("link")).toHaveLength(6);
  });

  it("doktor sayısı görünür kart sayısına eşit ya da azsa oklar ve noktalar gizlenir, kartlar ortalanır", () => {
    // matchMedia yok → masaüstü varsayımı (4 görünür kart).
    const { rerender, container } = render(<FeaturedDoctorsCarousel items={items(4)} labels={labels} />);
    expect(screen.queryByRole("button", { name: "Next doctors" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Page/ })).not.toBeInTheDocument();
    expect(container.querySelector("ul")!.className).toContain("justify-center-safe");

    rerender(<FeaturedDoctorsCarousel items={items(5)} labels={labels} />);
    expect(screen.getByRole("button", { name: "Next doctors" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Page \d of 2$/ })).toHaveLength(2);
  });

  it("10 sayfadan fazlasında noktalar yerine sayfa sayacı gösterilir", () => {
    render(<FeaturedDoctorsCarousel items={items(48)} labels={labels} />);
    expect(screen.queryByRole("button", { name: /^Page / })).not.toBeInTheDocument();
    // jsdom düzen ölçmez (scrollWidth 0), aktif sayfa değeri anlamsızdır; toplam doğrulanır.
    expect(screen.getByText(/^\d+ \/ 12$/)).toBeInTheDocument();
  });

  it("mobilde (1 görünür kart) 2 doktorla oklar görünür", () => {
    const restore = mockMatchMedia([]);
    try {
      render(<FeaturedDoctorsCarousel items={items(2)} labels={labels} />);
      expect(screen.getByRole("button", { name: "Previous doctors" })).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("autoplay açıkken 5 saniyelik timer kurulur; prefers-reduced-motion açıkken hiç başlamaz", () => {
    const spy = vi.spyOn(window, "setInterval");
    const restore = mockMatchMedia(["(min-width: 1024px)"]);
    try {
      const { unmount } = render(<FeaturedDoctorsCarousel items={items(6)} labels={labels} autoplay />);
      expect(spy).toHaveBeenCalledWith(expect.any(Function), FEATURED_DOCTORS_AUTOPLAY_MS);
      // Kartlar slayt olarak etiketlenir; görünür Duraklat düğmesi (WCAG 2.2.2) timer'ı durdurur.
      expect(screen.getAllByRole("group", { name: /^\d+ \/ 6$/ })).toHaveLength(6);
      spy.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "Pause automatic scrolling" }));
      expect(screen.getByRole("button", { name: "Resume automatic scrolling" })).toHaveAttribute("aria-pressed", "true");
      expect(spy).not.toHaveBeenCalled();
      unmount();
    } finally {
      restore();
    }

    spy.mockClear();
    const restoreReduced = mockMatchMedia(["(min-width: 1024px)", "(prefers-reduced-motion: reduce)"]);
    try {
      render(<FeaturedDoctorsCarousel items={items(6)} labels={labels} autoplay />);
      expect(spy).not.toHaveBeenCalledWith(expect.any(Function), FEATURED_DOCTORS_AUTOPLAY_MS);
      expect(screen.queryByRole("button", { name: "Pause automatic scrolling" })).not.toBeInTheDocument();
    } finally {
      restoreReduced();
      spy.mockRestore();
    }
  });

  it("autoplay varsayılan olarak kapalıdır (timer kurulmaz)", () => {
    const spy = vi.spyOn(window, "setInterval");
    render(<FeaturedDoctorsCarousel items={items(6)} labels={labels} />);
    expect(spy).not.toHaveBeenCalledWith(expect.any(Function), FEATURED_DOCTORS_AUTOPLAY_MS);
    spy.mockRestore();
  });
});

describe("Paket D — editör", () => {
  it("Kaydırmalı düzende sınır 24 olur ve otomatik kaydır görünür; Tüm aktif doktorlar seçimi gizler; önizleme düzeni izler", async () => {
    const user = userEvent.setup();
    listAdminDoctors.mockResolvedValue({ items: [doctor({ id: ID_A }), doctor({ id: ID_B, isActive: false })], meta: { nextCursor: null } });
    const onChange = vi.fn();
    const { rerender } = render(<FeaturedDoctorsBlockEditor block={block({ doctorIds: [ID_A] })} onChange={onChange} />);
    expect(await screen.findByText("1/8")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Otomatik kaydır" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Kaydırmalı" }));
    expect(onChange.mock.calls.at(-1)![0].data.layout).toBe("carousel");

    const carousel = block({ doctorIds: [ID_A], layout: "carousel" });
    rerender(<FeaturedDoctorsBlockEditor block={carousel} onChange={onChange} />);
    expect(screen.getByText("1/24")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Otomatik kaydır" })).toBeInTheDocument();
    expect(screen.getByTestId("featured-doctors-preview")).toHaveAttribute("data-layout", "carousel");

    await user.click(screen.getByRole("button", { name: "Tüm aktif doktorlar" }));
    expect(onChange.mock.calls.at(-1)![0].data.source).toBe("all");
    rerender(<FeaturedDoctorsBlockEditor block={{ ...carousel, data: { ...carousel.data, source: "all" } }} onChange={onChange} />);
    expect(screen.queryByLabelText("Doktor ekle")).not.toBeInTheDocument();
    // Önizleme yalnızca aktif doktoru gösterir.
    await waitFor(() => expect(within(screen.getByTestId("featured-doctors-preview")).getAllByRole("listitem")).toHaveLength(1));
  });

  it("ızgaraya dönüşte 8'den fazla seçim 8'e kırpılır", async () => {
    const user = userEvent.setup();
    listAdminDoctors.mockResolvedValue({ items: [], meta: { nextCursor: null } });
    const onChange = vi.fn();
    const ten = Array.from({ length: 10 }, (_, i) => `0000000${i}-0000-4000-8000-000000000000`);
    render(<FeaturedDoctorsBlockEditor block={block({ doctorIds: ten, layout: "carousel" })} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Izgara" }));
    expect(onChange.mock.calls.at(-1)![0].data).toMatchObject({ layout: "grid", doctorIds: ten.slice(0, 8) });
  });
});

describe("Paket O — blok metni aktif dilde, yoksa EN", () => {
  const ctx = (lang: string) => ({ lang, defaultLocaleCode: "tr" }) as Parameters<typeof resolveFeaturedDoctorsContent>[1];
  it("aktif dil → EN (kanonik) → varsayılan dil sırasıyla düşer; TR de EN'e düşer", () => {
    const b = block({
      content: {
        en: { title: "Our Doctors", subtitle: "", buttonLabel: "" },
        ru: { title: "Наши врачи", subtitle: "", buttonLabel: "" },
      },
    });
    expect(resolveFeaturedDoctorsContent(b, ctx("ru")).title).toBe("Наши врачи");
    expect(resolveFeaturedDoctorsContent(b, ctx("ar")).title).toBe("Our Doctors");
    expect(resolveFeaturedDoctorsContent(b, ctx("tr")).title).toBe("Our Doctors");
    const trOnly = block({ content: { tr: { title: "Doktorlarımız", subtitle: "", buttonLabel: "" } } });
    expect(resolveFeaturedDoctorsContent(trOnly, ctx("de")).title).toBe("Doktorlarımız");
  });
});
