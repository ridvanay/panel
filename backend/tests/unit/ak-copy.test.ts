import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ABOUT_TREATMENTS, AK_LOCALES, FAQ3, FAQ8_ANSWER, HOW_IT_WORKS, JOURNEY3_TEXT, SERVICES_TITLE, TRUST_BAND } from "../../src/lib/ak-copy";
import { FAQ_EN_COPY, FAQ_TR_COPY } from "../../src/lib/faq-content";
import { TELEHEALTH_CLINIC_TEMPLATE } from "../../src/modules/demo-templates/templates/telehealth-clinic";

/** Paket AK - araci kurulus dili: 9 dilde tam kopya, kod kaynaklariyla tutarlilik, doktor/tedavi eden taraf ifadesi yok. */
const DOCTOR_WORDS = /\b(doctor|doctors|physician|physicians)\b|doktor|hekim|\bArzt\b|Ärzt|médecin|\bmédico|\bmedic\b|врач|доктор|طبيب|\blekar\b/i;

function allTexts(): string[] {
  const out: string[] = [];
  for (const l of AK_LOCALES) {
    out.push(SERVICES_TITLE[l], FAQ3[l].question, FAQ3[l].answer, FAQ8_ANSWER[l], JOURNEY3_TEXT[l]);
    TRUST_BAND[l].forEach((p) => out.push(p.title, p.text));
    HOW_IT_WORKS[l].forEach((p) => out.push(p.title, p.text));
    out.push(ABOUT_TREATMENTS[l].eyebrow, ABOUT_TREATMENTS[l].title, ABOUT_TREATMENTS[l].body);
  }
  return out;
}

describe("Paket AK - ak-copy", () => {
  it("9 dilin hepsinde tum kopya dolu (3 ozellik, 3 adim)", () => {
    for (const l of AK_LOCALES) {
      expect(TRUST_BAND[l]).toHaveLength(3);
      expect(HOW_IT_WORKS[l]).toHaveLength(3);
    }
    expect(allTexts().every((t) => t.trim().length > 3)).toBe(true);
  });

  it("hicbir dilde doktor / tedavi eden taraf ifadesi yok", () => {
    expect(allTexts().filter((t) => DOCTOR_WORDS.test(t))).toEqual([]);
  });

  it("EN/TR SSS metinleri faq-content.ts ile birebir ayni", () => {
    expect(FAQ_EN_COPY.items[2]).toMatchObject({ id: "faq-3", question: FAQ3.en.question, answer: FAQ3.en.answer });
    expect(FAQ_TR_COPY.items[2]).toMatchObject({ id: "faq-3", question: FAQ3.tr.question, answer: FAQ3.tr.answer });
    expect(FAQ_EN_COPY.items[7]!.answer).toBe(FAQ8_ANSWER.en);
    expect(FAQ_TR_COPY.items[7]!.answer).toBe(FAQ8_ANSWER.tr);
  });

  it("kod kaynaklarinda doktor/tedavi eden taraf ifadesi kalmadi (SSS, yolculuk scripti)", () => {
    const joined = [...FAQ_EN_COPY.items, ...FAQ_TR_COPY.items].map((i) => `${i.question} ${i.answer}`).join(" ");
    expect(joined).not.toMatch(/physician|treating specialist|hekim/i);
    const journey = readFileSync(join(__dirname, "../../scripts/add-home-journey-faq-blocks.ts"), "utf8");
    expect(journey).toContain(JOURNEY3_TEXT.en);
    expect(journey).toContain(JOURNEY3_TEXT.tr);
    expect(journey).not.toMatch(/physician responsible|sorumlu hekim/i);
  });

  it("demo sablonu (TR) ozellik seridi / nasil calisir / sayac / baslik metinleri araci kurulus dilinde", () => {
    const json = JSON.stringify(TELEHEALTH_CLINIC_TEMPLATE.page.blocks);
    for (const p of TRUST_BAND.tr) expect(json).toContain(p.text);
    for (const [i, p] of HOW_IT_WORKS.tr.entries()) expect(json).toContain(`${i + 1}. ${p.title}`);
    expect(json).toContain(SERVICES_TITLE.tr);
    expect(json).not.toMatch(/Doktorunuzu Seçin|Uzman Doktor|Doğrulanmış Profiller|doktorun müsaitlik|müsait bir doktor|"Branşlar"/i);
    for (const metric of ["activeServices", "visitorLanguages", "activeCoordinators", "consultationMinutes"]) expect(json).toContain(`"metric":"${metric}"`);
  });
});
