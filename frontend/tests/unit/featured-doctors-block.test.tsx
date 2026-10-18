import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DoctorProfile } from "@/lib/api/types";
import type { FeaturedDoctorsBlock, HeadingBlock, ImageBlock, TextBlock } from "@/lib/page-builder/types";
import { createBlock } from "@/lib/page-builder/registry";

/**
 * Paket A3 (2026-10-18) — "Öne Çıkan Doktorlar" bloğu + metin hizalama + görsel/başlık bağlantısı.
 */
const fetchDoctorsServer = vi.fn<() => Promise<DoctorProfile[]>>();
vi.mock("@/lib/api/server-telehealth", () => ({ fetchDoctorsServer: () => fetchDoctorsServer() }));
const listAdminDoctors = vi.fn();
vi.mock("@/lib/api/telehealth", () => ({ listAdminDoctors: (...args: unknown[]) => listAdminDoctors(...args) }));

import { FeaturedDoctorsBlockView, pickFeaturedDoctors } from "@/components/site/blocks/featured-doctors-block";
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
  it("metin bloğu `align` değerini uygular, eski kayıtta sola düşer", () => {
    const text = (align?: TextBlock["data"]["align"]): TextBlock => ({ id: "t", type: "text", data: { html: "<p>Merhaba</p>", align } });
    const { container, rerender } = render(<TextBlockView block={text("center")} chrome="page" />);
    expect(container.firstElementChild!.className).toContain("text-center");
    rerender(<TextBlockView block={text()} chrome="page" />);
    expect(container.firstElementChild!.className).toContain("text-left");
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
