import { describe, expect, it } from "vitest";
import { PageBlockListSchema } from "../../src/modules/pages/pages.schemas";
import { HOME_MAX_JOURNEY_COUNTRIES, HOME_MAX_JOURNEY_STEPS, HOME_MIN_JOURNEY_STEPS } from "../../src/lib/home-page-template";

/**
 * journey-faq-blok turu (2026-10-03) — yeni `journey-map` blok tipi VE `accordion`'un yeni
 * opsiyonel `spotlight` alanları (`badge`/`intro`/`defaultOpenFirst`). Sınırlar frontend
 * `lib/page-builder/types.ts` ile SAYISAL OLARAK BİREBİR AYNI olmak zorunda — bu dosya o
 * sayıları `home-page-template.ts`'ten import eder, YENİDEN YAZMAZ.
 */

function step(id: string, overrides: Record<string, unknown> = {}) {
  return { id, icon: "BadgeCheck", title: "Başlık", text: "Metin", ...overrides };
}

function country(id: string, label = "Almanya") {
  return { id, label };
}

function journeyMapBlock(overrides: Record<string, unknown> = {}) {
  return {
    id: "journey-1",
    type: "journey-map",
    data: {
      eyebrow: "Küresel hasta yolculuğu",
      title: "Başlık",
      body: "Açıklama",
      steps: [step("s1"), step("s2")],
      countries: [country("c1")],
      ...overrides,
    },
  };
}

describe("PageBlockListSchema — journey-map bloğu", () => {
  it("geçerli bir journey-map bloğunu (2 adım, 1 ülke) kabul eder", () => {
    const result = PageBlockListSchema.safeParse([journeyMapBlock()]);
    expect(result.success).toBe(true);
  });

  it(`HOME_MIN_JOURNEY_STEPS (${HOME_MIN_JOURNEY_STEPS}) altında adım sayısını REDDEDER`, () => {
    const steps = Array.from({ length: HOME_MIN_JOURNEY_STEPS - 1 }, (_, i) => step(`s${i}`));
    const result = PageBlockListSchema.safeParse([journeyMapBlock({ steps })]);
    expect(result.success).toBe(false);
  });

  it(`HOME_MAX_JOURNEY_STEPS (${HOME_MAX_JOURNEY_STEPS}) üstünde adım sayısını REDDEDER`, () => {
    const steps = Array.from({ length: HOME_MAX_JOURNEY_STEPS + 1 }, (_, i) => step(`s${i}`));
    const result = PageBlockListSchema.safeParse([journeyMapBlock({ steps })]);
    expect(result.success).toBe(false);
  });

  it(`HOME_MAX_JOURNEY_COUNTRIES (${HOME_MAX_JOURNEY_COUNTRIES}) üstünde ülke sayısını REDDEDER`, () => {
    const countries = Array.from({ length: HOME_MAX_JOURNEY_COUNTRIES + 1 }, (_, i) => country(`c${i}`));
    const result = PageBlockListSchema.safeParse([journeyMapBlock({ countries })]);
    expect(result.success).toBe(false);
  });

  it("countries alanı VERİLMEZSE boş diziye düşer (varsayılan)", () => {
    const { countries, ...rest } = journeyMapBlock().data as Record<string, unknown>;
    const result = PageBlockListSchema.safeParse([{ id: "journey-1", type: "journey-map", data: rest }]);
    expect(result.success).toBe(true);
    if (result.success) {
      const parsedNode = (result.data as unknown as { data: { countries: unknown[] } }[])[0];
      expect(parsedNode?.data.countries).toEqual([]);
    }
  });

  it("geçersiz bir ikon anahtarını REDDEDER (AboutIconSchema allowlist dışı)", () => {
    const result = PageBlockListSchema.safeParse([journeyMapBlock({ steps: [step("s1", { icon: "NotARealIcon" }), step("s2")] })]);
    expect(result.success).toBe(false);
  });
});

function accordionBlock(dataOverrides: Record<string, unknown> = {}) {
  return {
    id: "faq-1",
    type: "accordion",
    data: {
      items: [{ id: "q1", question: "Soru?", answer: "Cevap." }],
      allowMultipleOpen: false,
      ...dataOverrides,
    },
  };
}

describe("PageBlockListSchema — accordion spotlight alanları (badge/intro/defaultOpenFirst)", () => {
  it("layoutStyle: 'spotlight' + badge/intro/defaultOpenFirst'ü kabul eder", () => {
    const result = PageBlockListSchema.safeParse([
      accordionBlock({ layoutStyle: "spotlight", badge: "FAQ", intro: "Kısa açıklama.", defaultOpenFirst: true }),
    ]);
    expect(result.success).toBe(true);
  });

  it("badge/intro/defaultOpenFirst OPSİYONELDİR — eski kayıtlar (bu alanlar yok) hâlâ geçerlidir", () => {
    const result = PageBlockListSchema.safeParse([accordionBlock({ layoutStyle: "card" })]);
    expect(result.success).toBe(true);
  });

  it("mevcut 'bordered'/'card'/'minimal' layoutStyle değerleri DEĞİŞMEDEN geçerli kalır", () => {
    for (const layoutStyle of ["bordered", "card", "minimal"]) {
      const result = PageBlockListSchema.safeParse([accordionBlock({ layoutStyle })]);
      expect(result.success).toBe(true);
    }
  });

  it("geçersiz bir layoutStyle değerini REDDEDER", () => {
    const result = PageBlockListSchema.safeParse([accordionBlock({ layoutStyle: "not-a-real-style" })]);
    expect(result.success).toBe(false);
  });
});
