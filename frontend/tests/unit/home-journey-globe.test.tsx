import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  HomeJourney,
  GLOBE_CENTER,
  GLOBE_RADIUS,
  ISTANBUL_POINT,
  projectLonLat,
  resolveCountryPosition,
} from "@/components/site/home/home-journey";
import type { HomeJourneyContent } from "@/lib/home-page";

/**
 * journey-v2 turu (2026-10-03) — gerçek ortografik projeksiyonun DETERMİNİSTİK olduğunu ve
 * coğrafi açıdan tutarlı davrandığını (İstanbul merkeze yakın, arka-yarım-küre ülkeler kenara
 * "clamp" edilir) doğrular. Önceki turun hydration dersi burada da geçerli: aynı girdi İKİ KEZ
 * çağrıldığında BİT-EŞ aynı çıktıyı üretmeli (SSR/CSR'ın aynı anda aynı input'u işlediği varsayımı).
 */
describe("projectLonLat — determinizm ve coğrafi tutarlılık", () => {
  it("aynı lon/lat girdisi için HER ZAMAN bit-eş aynı sonucu üretir (determinizm)", () => {
    const a = projectLonLat(10.45, 51.17);
    const b = projectLonLat(10.45, 51.17);
    expect(a).toEqual(b);
  });

  it("İstanbul (merkeze yakın bir nokta) ön yarım kürede ve merkeze YAKIN projelenir (cosC merkeze yakın ~1)", () => {
    const istanbul = projectLonLat(28.97, 41.01);
    expect(istanbul.cosC).toBeGreaterThan(0.9);
    // Birim çemberde merkeze yakın (küçük x/y) — küre merkezinin yakınında bir nokta.
    expect(Math.abs(istanbul.x)).toBeLessThan(0.15);
    expect(Math.abs(istanbul.y)).toBeLessThan(0.25);
  });

  it("ABD (ortografik merkezin tam karşı tarafına yakın) ARKA yarım kürede çıkar (cosC <= eşik)", () => {
    const usa = projectLonLat(-95, 38);
    expect(usa.cosC).toBeLessThanOrEqual(0.03);
  });
});

describe("resolveCountryPosition — ISTANBUL_POINT merkeze yakın, ABD kenara clamp edilmiş", () => {
  it("ISTANBUL_POINT, GLOBE_CENTER'a (küre merkezi) yakındır", () => {
    const dx = ISTANBUL_POINT.x - GLOBE_CENTER.x;
    const dy = ISTANBUL_POINT.y - GLOBE_CENTER.y;
    const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
    expect(distanceFromCenter).toBeLessThan(GLOBE_RADIUS * 0.3);
  });

  it("'United States' arka yarım kürede olduğu için kürenin KENARINA (rim) clamp edilir", () => {
    const { point, onRim } = resolveCountryPosition("United States", 0, 1);
    expect(onRim).toBe(true);
    const dx = point.x - GLOBE_CENTER.x;
    const dy = point.y - GLOBE_CENTER.y;
    const distanceFromCenter = Math.sqrt(dx * dx + dy * dy);
    // Kenara clamp edilmiş nokta tam GLOBE_RADIUS uzaklıkta olmalı (ufuk çizgisi üzerinde).
    expect(distanceFromCenter).toBeCloseTo(GLOBE_RADIUS, 0);
    // ABD batıda (lon=-95) olduğu için kenarın SOL tarafına düşmeli (görev dosyası §"Küre").
    expect(point.x).toBeLessThan(GLOBE_CENTER.x);
  });

  it("'Germany' (ön yarım küre) GERÇEK projeksiyon konumunu kullanır, kenara clamp EDİLMEZ", () => {
    const { onRim } = resolveCountryPosition("Germany", 0, 1);
    expect(onRim).toBe(false);
  });

  it("haritası olmayan (bilinmeyen) bir ülke etiketi İÇİN ŞEMATİK yedek konuma düşer, render'dan KAYBOLMAZ", () => {
    const { point, onRim } = resolveCountryPosition("Narnia", 0, 2);
    expect(onRim).toBe(false);
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  });

  it("Türkçe ülke adı ('Almanya') İNGİLİZCE karşılığıyla (Germany) AYNI koordinata eşlenir", () => {
    const en = resolveCountryPosition("Germany", 0, 1);
    const tr = resolveCountryPosition("Almanya", 0, 1);
    expect(tr.point).toEqual(en.point);
  });
});

function journey(overrides: Partial<HomeJourneyContent> = {}): HomeJourneyContent {
  return {
    eyebrow: "Global patient journey",
    title: "From Across the World to Istanbul",
    body: "Body text",
    steps: [
      { id: "s1", icon: "Plane", title: "Pre-Travel Planning", text: "Plan ahead." },
      { id: "s2", icon: "MapPin", title: "Arrival in Istanbul", text: "We welcome you." },
    ],
    countries: [
      { id: "c1", label: "Germany" },
      { id: "c2", label: "United States" },
    ],
    ...overrides,
  };
}

describe("HomeJourney — reduced-motion KAPALIYKEN (varsayılan jsdom davranışı)", () => {
  it("comet noktaları (glow filtreli circle) render edilir, çizgiler de DOM'dadır", () => {
    const { container } = render(<HomeJourney journey={journey()} stepLabel="Step {number}" istanbulLabel="Istanbul" />);
    expect(container.querySelectorAll('circle[filter]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll("path[stroke^='url(#journey-line']").length).toBe(2);
  });
});

describe("HomeJourney — içerik render (regresyon)", () => {
  it("eyebrow/title/adım başlıkları/ülke etiketleri render edilir", () => {
    render(<HomeJourney journey={journey()} stepLabel="Step {number}" istanbulLabel="Istanbul" />);
    expect(screen.getByText("Global patient journey")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "From Across the World to Istanbul" })).toBeInTheDocument();
    expect(screen.getByText("Pre-Travel Planning")).toBeInTheDocument();
    expect(screen.getByText("Germany")).toBeInTheDocument();
    expect(screen.getByText("United States")).toBeInTheDocument();
  });
});
