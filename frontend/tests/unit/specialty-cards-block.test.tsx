import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { Specialty } from "@/lib/api/types";
import type { SpecialtyCardsBlock } from "@/lib/page-builder/types";
import { createBlock } from "@/lib/page-builder/registry";

const fetchSpecialtiesServer = vi.fn<() => Promise<Specialty[]>>();
vi.mock("@/lib/api/server-telehealth", () => ({ fetchSpecialtiesServer: () => fetchSpecialtiesServer() }));

import { SpecialtyCardsBlockView } from "@/components/site/blocks/specialty-cards-block";
import { SpecialtyCardsBlockEditor } from "@/components/admin/page-builder/blocks/specialty-cards-block";

function specialty(overrides: Partial<Specialty>): Specialty {
  return {
    id: overrides.slug ?? "id",
    name: "Kardiyoloji",
    slug: "kardiyoloji",
    icon: "HeartPulse",
    description: "Kalp sağlığı.",
    order: 0,
    isActive: true,
    imageMediaId: null,
    imageUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function block(data: Partial<SpecialtyCardsBlock["data"]> = {}): SpecialtyCardsBlock {
  const base = createBlock("specialty-cards") as SpecialtyCardsBlock;
  return { ...base, data: { ...base.data, ...data } };
}

describe("SpecialtyCardsBlockView", () => {
  beforeEach(() => fetchSpecialtiesServer.mockReset());

  it("uzmanlıkları modül sırasıyla, dile göre başlık ve dil önekli bağlantılarla render eder", async () => {
    fetchSpecialtiesServer.mockResolvedValue([
      specialty({ slug: "kardiyoloji", name: "Kardiyoloji", imageUrl: "http://x/k.png", imageMediaId: "m1" }),
      specialty({ slug: "dermatoloji", name: "Dermatoloji", description: null }),
    ]);
    render(await SpecialtyCardsBlockView({ block: block(), chrome: "page", siteContext: { lang: "en", defaultLocaleCode: "tr" } }));

    expect(screen.getByRole("heading", { level: 2, name: "Our Specialties" })).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/en/specialties/kardiyoloji", "/en/specialties/dermatoloji"]);
    // Kartın tamamı tek bağlantı; erişilebilir adı uzmanlık adı (görsel dekoratif).
    expect(within(links[0]!).getByRole("heading", { level: 3, name: "Kardiyoloji" })).toBeInTheDocument();
    expect(links[0]!.querySelector("img")).toHaveAttribute("alt", "");
    // Görselsiz uzmanlık → ikonlu varsayılan görünüm (img yok, svg var).
    expect(links[1]!.querySelector("img")).toBeNull();
    expect(links[1]!.querySelector("svg")).not.toBeNull();
  });

  it("varsayılan dilde önek yok; eşit yükseklik için auto-rows-fr ve 2 satır sınırı", async () => {
    fetchSpecialtiesServer.mockResolvedValue([specialty({})]);
    const { container } = render(
      await SpecialtyCardsBlockView({ block: block({ columns: 6, imageShape: "square" }), chrome: "page", siteContext: { lang: "tr", defaultLocaleCode: "tr" } })
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/specialties/kardiyoloji");
    const grid = container.querySelector("ul")!;
    expect(grid.className).toContain("auto-rows-fr");
    expect(grid.className).toContain("grid-cols-2");
    expect(grid.className).toContain("md:grid-cols-3");
    expect(grid.className).toContain("lg:grid-cols-6");
    expect(screen.getByRole("heading", { level: 3 }).className).toContain("line-clamp-2");
    expect(screen.getByRole("heading", { level: 2, name: "Uzmanlık Alanlarımız" })).toBeInTheDocument();
  });

  it("açıklama kapatılabilir; uzmanlık yoksa hiçbir şey render edilmez", async () => {
    fetchSpecialtiesServer.mockResolvedValue([specialty({})]);
    render(await SpecialtyCardsBlockView({ block: block({ showDescription: false }), chrome: "bare" }));
    expect(screen.queryByText("Kalp sağlığı.")).toBeNull();

    fetchSpecialtiesServer.mockResolvedValue([]);
    expect(await SpecialtyCardsBlockView({ block: block(), chrome: "bare" })).toBeNull();
  });
});

describe("SpecialtyCardsBlockEditor", () => {
  it("dil sekmesine göre başlığı, kolon ve şekli günceller", () => {
    const onChange = vi.fn();
    render(<SpecialtyCardsBlockEditor block={block()} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    fireEvent.change(screen.getByLabelText("Başlık"), { target: { value: "Treatments" } });
    expect(onChange.mock.calls.at(-1)![0].data.content.en.title).toBe("Treatments");

    fireEvent.click(screen.getByRole("button", { name: "6" }));
    expect(onChange.mock.calls.at(-1)![0].data.columns).toBe(6);
    fireEvent.click(screen.getByRole("button", { name: "Köşeli" }));
    expect(onChange.mock.calls.at(-1)![0].data.imageShape).toBe("rounded");
  });

  it("şablon modunda kolon ve şekil kilitli", () => {
    render(<SpecialtyCardsBlockEditor block={block()} onChange={vi.fn()} simple />);
    expect(screen.queryByText("Masaüstü kolon sayısı")).toBeNull();
    expect(screen.queryByText("Görsel şekli")).toBeNull();
    expect(screen.getByRole("switch", { name: "Açıklamayı göster" })).toBeInTheDocument();
  });
});
