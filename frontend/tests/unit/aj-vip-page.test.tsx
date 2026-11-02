import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { VipPageContent, vipRequestHref } from "@/components/site/vip/vip-page-content";
import { extractVipImages } from "@/lib/vip-images";
import { vipStrings as en } from "@/lib/i18n/site-dictionaries/en/vip";
import { vipStrings as de } from "@/lib/i18n/site-dictionaries/de/vip";
import { vipStrings as ar } from "@/lib/i18n/site-dictionaries/ar/vip";
import { vipStrings as ru } from "@/lib/i18n/site-dictionaries/ru/vip";
import { vipStrings as fr } from "@/lib/i18n/site-dictionaries/fr/vip";
import { vipStrings as es } from "@/lib/i18n/site-dictionaries/es/vip";
import { vipStrings as ro } from "@/lib/i18n/site-dictionaries/ro/vip";
import { vipStrings as sr } from "@/lib/i18n/site-dictionaries/sr-latn/vip";
import { intermediaryStrings } from "@/lib/i18n/site-dictionaries/en/intermediary";

/** Paket AJ (AJ-3) — VIP sayfası: 6 bölüm + akış şeridi + Request/CTA bağlantıları + görsel çıkarma. */

const hrefs = { request: "/request", find: "/find-your-treatment" };

function renderVip(images: { url: string; alt: string }[] = []) {
  return render(<VipPageContent strings={en} intermediary={intermediaryStrings} certificateNo={null} images={images} hrefs={hrefs} />);
}

describe("VIP sayfası", () => {
  it("6 ikonlu kart ve her kartta konulu Request bağlantısı gösterir", () => {
    renderVip();
    const items = screen.getByTestId("vip-items");
    expect(within(items).getAllByRole("listitem")).toHaveLength(6);
    const links = screen.getAllByTestId("vip-request");
    expect(links).toHaveLength(6);
    expect(links[0]).toHaveAttribute("href", "/request?topic=vip-transfer");
    expect(links[0]).toHaveAccessibleName("Request: VIP airport meet & greet and private transfer");
    expect(new Set(links.map((l) => l.getAttribute("href"))).size).toBe(6);
  });

  it("yolculuk şeridi 6 adımı sırayla verir", () => {
    renderVip();
    const steps = within(screen.getByTestId("vip-flow")).getAllByRole("heading", { level: 3 });
    expect(steps.map((s) => s.textContent)).toEqual(["Arrival", "Transfer", "Check-in", "Facility visits", "Recovery", "Return"]);
  });

  it("CTA bandı Book a consultation ve aracı kuruluş kutusu var; görsel yoksa yer tutucu", () => {
    renderVip();
    expect(screen.getByTestId("vip-cta-book")).toHaveAttribute("href", "/request");
    expect(screen.getByTestId("vip-cta-book")).toHaveTextContent("Book a consultation");
    expect(screen.getByTestId("intermediary-notice")).toBeInTheDocument();
    expect(screen.getAllByTestId("vip-image-placeholder")).toHaveLength(6);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("VIP Accommodation & Transfer");
  });

  it("yüklenen görseller ilk kartlara bağlanır", () => {
    renderVip([{ url: "/uploads/a.webp", alt: "Lobby" }]);
    expect(screen.getAllByTestId("vip-image")).toHaveLength(1);
    expect(screen.getByAltText("Lobby")).toHaveAttribute("loading", "lazy");
    expect(screen.getAllByTestId("vip-image-placeholder")).toHaveLength(5);
  });

  it("vipRequestHref mevcut sorguyu korur", () => {
    expect(vipRequestHref("/request", "vip-stay")).toBe("/request?topic=vip-stay");
    expect(vipRequestHref("/de/request?x=1", "vip-stay")).toBe("/de/request?x=1&topic=vip-stay");
  });

  it("8 dilin hepsinde aynı anahtarlar dolu, fiyat yok", () => {
    const keys = Object.keys(en).sort();
    for (const dict of [de, ar, ru, fr, es, ro, sr]) {
      expect(Object.keys(dict).sort()).toEqual(keys);
      for (const value of Object.values(dict)) {
        expect(value.trim().length).toBeGreaterThan(0);
        expect(value).not.toMatch(/[€$£₺]|\bgaranti|guarantee/i);
      }
    }
  });
});

describe("extractVipImages", () => {
  it("galeri ve görsel bloklarından sırayla en çok 6 görsel çıkarır, güvensiz URL'leri atlar", () => {
    const blocks = [
      { type: "image", data: { url: "/uploads/1.webp", alt: "1" } },
      { type: "container", children: [{ type: "gallery", data: { images: [{ url: "https://cdn.example/2.webp", alt: "2" }, { url: "javascript:alert(1)", alt: "x" }, { url: "//evil.example/3.png", alt: "y" }, { url: "/uploads/4.webp", alt: "4" }] } }] },
    ];
    expect(extractVipImages(blocks).map((i) => i.alt)).toEqual(["1", "2", "4"]);
    const many = [{ type: "gallery", data: { images: Array.from({ length: 10 }, (_, i) => ({ url: `/u/${i}.webp`, alt: String(i) })) } }];
    expect(extractVipImages(many)).toHaveLength(6);
    expect(extractVipImages(undefined)).toEqual([]);
  });
});
