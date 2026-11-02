import { describe, expect, it } from "vitest";
import { renderBrandedEmail, resolveEmailLocale, toCustomerEmailLocale, type EmailBrandContext } from "../../src/lib/branded-email";
import { INTERMEDIARY_IDENTITY, INTERMEDIARY_LOCALES, toIntermediaryLocale } from "../../src/lib/intermediary-identity";
import {
  buildConsultationAdminEmail,
  buildConsultationConfirmationEmail,
  CONSULTATION_CONFIRMATION,
  formatRequestNumber,
} from "../../src/modules/consultation-requests/consultation-request-email";
import { toMatcherEmailLocale } from "../../src/modules/matcher/matcher-notifications";
import { toPackageEmailLocale } from "../../src/modules/packages/packages.notifications";
import { patientEmailLocale } from "../../src/modules/telehealth/lib/notifications";
import { buildParticipantInterpreterEmail } from "../../src/modules/telehealth/lib/interpreter-notifications";

/** Paket AH - danisma talebi e-postalari, kimlik ibaresi footer'i ve musteri e-postalarinda tr -> en. */
const CTX: EmailBrandContext = {
  siteName: "WM Health Istanbul",
  siteUrl: "https://example.com",
  logoUrl: null,
  primaryColor: "#0f766e",
  address: null,
  phone: null,
  infoEmail: "info@example.com",
  contactUrl: "https://example.com/en/contact",
  supportLanguages: null,
  kvkk: null,
  privacy: null,
};

describe("danisma talebi - yonetici e-postasi", () => {
  const data = {
    requestNumber: formatRequestNumber(12),
    serviceName: "Gastroenterology",
    country: "DE",
    contactLanguage: "de",
    needsInterpreter: true,
    preferredFrom: "2026-12-01",
    preferredTo: "2026-12-15",
    leadId: "lead-1",
    frontendUrl: "https://example.com/",
  };

  it("konu, satirlar ve 'Open request' baglantisi; talep no REQ-00012", () => {
    const mail = buildConsultationAdminEmail(data);
    expect(mail.subject).toBe("New consultation request #REQ-00012 — Gastroenterology");
    expect(mail.cta).toEqual({ label: "Open request", url: "https://example.com/admin/crm/leads/lead-1" });
    const branded = renderBrandedEmail(CTX, { locale: "en", audience: "staff", title: mail.title, bodyHtml: mail.bodyHtml, cta: mail.cta });
    for (const line of ["Service: Gastroenterology", "Country: Germany (DE)", "Contact language: German (de)", "Interpreter: yes", "Preferred dates: 2026-12-01 - 2026-12-15", "Open request (https://example.com/admin/crm/leads/lead-1)"]) {
      expect(branded.text).toContain(line);
    }
  });

  it("tarih yoksa 'not specified'; tercuman hayir", () => {
    const mail = buildConsultationAdminEmail({ ...data, preferredFrom: null, preferredTo: null, needsInterpreter: false });
    const text = renderBrandedEmail(CTX, { locale: "en", audience: "staff", bodyHtml: mail.bodyHtml }).text;
    expect(text).toContain("Preferred dates: not specified");
    expect(text).toContain("Interpreter: no");
  });

  it("girdi tipi kisisel veri tasimaz; HTML kacisi: bolum adinda etiket calismaz", () => {
    const mail = buildConsultationAdminEmail({ ...data, serviceName: "<b>x</b>" });
    expect(mail.bodyHtml).not.toContain("<b>x</b>");
    expect(mail.bodyHtml).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(Object.keys(data)).not.toEqual(expect.arrayContaining(["fullName", "email", "phone", "message"]));
  });
});

describe("danisma talebi - ziyaretci onay e-postasi (8 dil)", () => {
  it("her dilde konu/govde dolu, yer tutucu kalmaz, talep no ve hizmet adi gecer; ar RTL", () => {
    for (const code of INTERMEDIARY_LOCALES) {
      const mail = buildConsultationConfirmationEmail({ locale: code, requestNumber: "REQ-00012", serviceName: "Gastroenterology" });
      expect(mail.locale).toBe(code);
      expect(mail.subject).toContain("REQ-00012");
      expect(mail.html).toContain("REQ-00012");
      expect(mail.html).toContain("Gastroenterology");
      expect(mail.subject + mail.html).not.toMatch(/\{no\}|\{service\}/);
      expect(mail.html).toContain(`lang="${code}"`);
      expect(mail.html.includes('dir="rtl"')).toBe(code === "ar");
    }
  });

  it("tr ve bilinmeyen dil -> en (musteriye Turkce gitmez)", () => {
    for (const code of ["tr", "TR", "xx", null, undefined, ""]) {
      expect(buildConsultationConfirmationEmail({ locale: code, requestNumber: "REQ-1", serviceName: "S" }).locale).toBe("en");
    }
    expect(CONSULTATION_CONFIRMATION).not.toHaveProperty("tr");
  });

  it("hizmet adindaki '$&' kalibi yorumlanmaz; 1 is gunu cumlesi var", () => {
    const mail = buildConsultationConfirmationEmail({ locale: "en", requestNumber: "REQ-1", serviceName: "A $& B" });
    expect(mail.html).toContain("A $&amp; B");
    expect(mail.html).toContain("within 1 business day");
  });
});

describe("kimlik ibaresi footer'i ve musteri e-postasinda tr -> en", () => {
  it("8 dilde kisa ibare + aciklama; hasta ve kullanici e-postasinda var, personelde yok", () => {
    for (const code of INTERMEDIARY_LOCALES) {
      const id = INTERMEDIARY_IDENTITY[code];
      expect(id.shortLabel.length).toBeGreaterThan(10);
      expect(id.description.length).toBeGreaterThan(80);
      for (const audience of ["patient", "user"] as const) {
        const { html, text } = renderBrandedEmail(CTX, { locale: code, audience, bodyHtml: "<p>x</p>" });
        expect(html).toContain(id.shortLabel);
        expect(text).toContain(id.shortLabel);
        expect(text).toContain(id.description);
      }
      const staff = renderBrandedEmail(CTX, { locale: code, audience: "staff", bodyHtml: "<p>x</p>" });
      expect(staff.html).not.toContain(id.shortLabel);
    }
    // EN ana metin birebir (kullanici metni).
    expect(INTERMEDIARY_IDENTITY.en.shortLabel).toBe("International Health Tourism Intermediary");
    expect(INTERMEDIARY_IDENTITY.en.description).toBe(
      "WM Health is an international health tourism intermediary organization, not a healthcare provider. All medical treatments are performed by healthcare facilities holding an International Health Tourism Authorization Certificate issued by the Republic of Türkiye Ministry of Health."
    );
  });

  it("alici dili tr: musteri (hasta/kullanici) en; personel tr kalir", () => {
    expect(toCustomerEmailLocale("tr")).toBe("en");
    expect(toCustomerEmailLocale("de")).toBe("de");
    expect(toCustomerEmailLocale(undefined)).toBe("en");
    expect(resolveEmailLocale("tr", "patient")).toBe("en");
    expect(resolveEmailLocale("tr", "user")).toBe("en");
    expect(resolveEmailLocale("tr", "staff")).toBe("tr");
    expect(toIntermediaryLocale("tr")).toBe("en");
    const staff = renderBrandedEmail(CTX, { locale: "tr", audience: "staff", bodyHtml: "" });
    expect(staff.html).toContain("Kurum içi bildirim");
    const patient = renderBrandedEmail(CTX, { locale: "tr", audience: "patient", bodyHtml: "" });
    expect(patient.html).not.toMatch(/Acil durumda|Bu e-posta otomatik|Bize ulaşın/);
  });

  it("e-posta dil cozumleyicileri tr gelirse en doner (hasta rezervasyonu, sihirbaz, paket, tercuman katilimci)", () => {
    expect(patientEmailLocale({ locale: "tr" })).toBe("en");
    expect(patientEmailLocale({ locale: null })).toBe("en");
    expect(patientEmailLocale(undefined)).toBe("en");
    expect(patientEmailLocale({ locale: "ar" })).toBe("ar");
    expect(toMatcherEmailLocale("tr")).toBe("en");
    expect(toPackageEmailLocale("TR")).toBe("en");
    expect(toMatcherEmailLocale("sr-latn")).toBe("sr-latn");
    const input = { audience: "patient" as const, startsAt: new Date("2026-11-12T10:30:00Z"), timeZone: "Europe/Istanbul", language: "ar", interpreterDisplayName: "A. Y." };
    const patient = buildParticipantInterpreterEmail({ ...input, locale: "tr" });
    expect(patient.locale).toBe("en");
    expect(patient.html).not.toMatch(/tercüman|Görüşmenize/i);
    const doctor = buildParticipantInterpreterEmail({ ...input, audience: "doctor", locale: "tr" });
    expect(doctor.locale).toBe("tr");
  });
});
