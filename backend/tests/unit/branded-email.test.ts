import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Paket AC — kurumsal e-posta kabuğu. Saf render (`renderBrandedEmail`), marka bağlamı
 * (`loadEmailBrandContext`: KVKK bağlantısı alıcının dilinde), gönderim (`sendBrandedMail`: düz metin
 * + Reply-To), sistem e-postaları önizleme kataloğunun TR/EN/AR snapshot'ları, personel e-postalarında
 * hasta bilgisi olmaması ve "ham HTML ile sendMail kalmadı" statik taraması.
 */
const sendMailMock = vi.hoisted(() => vi.fn(async () => ({ messageId: "id-1" })));
vi.mock("../../src/lib/mail", () => ({ sendMail: sendMailMock }));

import { renderBrandedEmail, type EmailBrandContext } from "../../src/lib/branded-email";
import { loadEmailBrandContext, sendBrandedMail } from "../../src/lib/branded-mail";
import { SYSTEM_EMAILS, renderSystemEmailSample } from "../../src/modules/email-templates/system-email-catalog";
import { getSystemVariablesForPurpose } from "../../src/lib/email-variables";
import { env } from "../../src/config/env";

const CTX: EmailBrandContext = {
  siteName: "WM Health Istanbul",
  siteUrl: "https://example.com",
  logoUrl: "https://example.com/logo.png",
  primaryColor: "#0f766e",
  address: "Örnek Mah. 1, İstanbul",
  phone: "+90 212 000 00 00",
  infoEmail: "info@example.com",
  contactUrl: "https://example.com/tr/contact",
  supportLanguages: ["Türkçe", "English"],
  kvkk: { title: "KVKK Aydınlatma Metni", url: "https://example.com/tr/kvkk" },
  privacy: { title: "Gizlilik Politikası", url: "https://example.com/tr/gizlilik" },
};

const LEGAL_PAGES = [
  { id: "p-kvkk", title: "KVKK Aydınlatma Metni", slug: "kvkk-aydinlatma-metni", translations: { en: { title: "Privacy Notice" } } },
  { id: "p-privacy", title: "Gizlilik Politikası", slug: "gizlilik-politikasi", translations: { en: { title: "Privacy Policy" } } },
];
const EN_SLUGS = [
  { entityId: "p-kvkk", slug: "privacy-notice" },
  { entityId: "p-privacy", slug: "privacy-policy" },
];

/** Şablonlu sistem e-postaları için sabit bir satır: registry'deki her değişkeni basar. */
function fakeTemplateRow(purpose: string) {
  const keys = getSystemVariablesForPurpose(purpose as never).map((d) => d.key);
  return {
    purpose,
    editorMode: "RAW",
    subject: `Konu — ${purpose}`,
    bodyHtml: `<p>${keys.map((k) => `${k}: {{${k}}}`).join("<br/>")}</p>`,
    blocks: [],
    customVariables: [],
  };
}

function fakeApp(opts: { logoUrl?: string | null; withTemplates?: boolean } = {}) {
  return {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    prisma: {
      siteSettings: { findUnique: vi.fn().mockResolvedValue({ siteName: "WM Health Istanbul", logoUrl: opts.logoUrl === undefined ? "https://cdn.example.com/logo.png" : opts.logoUrl }) },
      siteAppearance: { findUnique: vi.fn().mockResolvedValue({ primaryColor: "#0f766e" }) },
      contactForm: {
        findUnique: vi.fn().mockResolvedValue({
          pageContent: {
            locales: {
              tr: { address: "Örnek Mah. 1, İstanbul", phone: "+90 212 000 00 00", email: "info@example.com" },
              en: { address: "Sample St. 1, Istanbul", phone: "+90 212 000 00 00", email: "info@example.com" },
            },
          },
        }),
      },
      siteModule: { findUnique: vi.fn().mockResolvedValue({ enabled: true, settings: {} }) },
      locale: { findMany: vi.fn().mockResolvedValue([]) },
      page: { findMany: vi.fn().mockResolvedValue(LEGAL_PAGES) },
      contentSlug: {
        findMany: vi.fn().mockImplementation(({ where }: { where: { locale: string } }) => Promise.resolve(where.locale === "en" ? EN_SLUGS : [])),
      },
      contactFormField: { findMany: vi.fn().mockResolvedValue([]) },
      emailTemplate: {
        findFirst: vi.fn().mockImplementation(({ where }: { where: { purpose: string } }) => Promise.resolve(opts.withTemplates === false ? null : fakeTemplateRow(where.purpose))),
      },
    },
  } as unknown as FastifyInstance;
}

describe("renderBrandedEmail (saf kabuk)", () => {
  it("logo varsa mutlak https <img> + alt; yoksa metin başlığı", () => {
    const withLogo = renderBrandedEmail(CTX, { locale: "tr", audience: "user", bodyHtml: "<p>Gövde</p>" });
    expect(withLogo.html).toContain('<img src="https://example.com/logo.png" alt="WM Health Istanbul"');

    const noLogo = renderBrandedEmail({ ...CTX, logoUrl: null }, { locale: "tr", audience: "user", bodyHtml: "<p>Gövde</p>" });
    expect(noLogo.html).not.toContain("<img");
    expect(noLogo.html).toMatch(/<span[^>]*font-weight:bold[^>]*>WM Health Istanbul<\/span>/);
  });

  it("600px tablo, marka şeridi, preheader ve bulletproof buton", () => {
    const { html } = renderBrandedEmail(CTX, {
      locale: "en",
      audience: "user",
      preheader: "Gizli önizleme metni",
      bodyHtml: "<p>Body</p>",
      cta: { label: "Open", url: "https://example.com/x" },
    });
    expect(html).toContain('width="600"');
    expect(html).toContain("max-width:600px");
    expect(html).toContain('bgcolor="#0f766e"');
    expect(html).toMatch(/display:none[^>]*>Gizli önizleme metni</);
    expect(html).toMatch(/<a href="https:\/\/example\.com\/x"[^>]*>Open<\/a>/);
    expect(html).not.toMatch(/<style|<script/i);
  });

  it("Arapça: dir=rtl ve sağa hizalı", () => {
    const { html } = renderBrandedEmail(CTX, { locale: "ar", audience: "patient", bodyHtml: "<p>x</p>" });
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain('align="right"');
  });

  it("Türkçe şablon gövdesi Arapça alıcıda LTR kalır (bodyLocale); footer RTL", () => {
    const { html } = renderBrandedEmail(CTX, { locale: "ar", bodyLocale: "tr", audience: "patient", bodyHtml: "<p>Merhaba,</p>" });
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toMatch(/<td dir="ltr" align="left"[^>]*><p>Merhaba,<\/p>/);
    expect(html).toMatch(/<td dir="rtl" align="right"[^>]*border-top/);
  });

  it("KVKK bağlantı metni: TR/EN'de sayfa başlığı, diğer dillerde alıcının dilinde etiket", () => {
    const ctx = { ...CTX, kvkk: { title: "Privacy Notice", url: "https://example.com/en/privacy-notice" } };
    expect(renderBrandedEmail(ctx, { locale: "en", audience: "patient", bodyHtml: "" }).html).toContain(">Privacy Notice</a>");
    const de = renderBrandedEmail(ctx, { locale: "de", audience: "patient", bodyHtml: "" }).html;
    expect(de).toContain('<a href="https://example.com/en/privacy-notice" style="color:#6b7280;text-decoration:underline;">Datenschutzhinweise</a>');
    const enNoTitle = renderBrandedEmail({ ...ctx, kvkk: { title: "", url: ctx.kvkk.url } }, { locale: "en", audience: "patient", bodyHtml: "" }).html;
    expect(enNoTitle).toContain(">Privacy notice</a>");
  });

  it("hasta footer'ı 112 notu içerir; personel footer'ı sade (iletişim/KVKK/112 yok)", () => {
    const patient = renderBrandedEmail(CTX, { locale: "tr", audience: "patient", bodyHtml: "<p>x</p>" });
    expect(patient.html).toContain("112");
    expect(patient.html).toContain("https://example.com/tr/kvkk");
    expect(patient.html).toContain("Bu e-posta otomatik olarak gönderilmiştir.");

    const staff = renderBrandedEmail(CTX, { locale: "tr", audience: "staff", bodyHtml: "<p>x</p>" });
    expect(staff.html).not.toContain("112");
    expect(staff.html).not.toContain("https://example.com/tr/kvkk");
    expect(staff.html).toContain("Kurum içi bildirim");
    expect(staff.html).toContain("Bu e-posta otomatik olarak gönderilmiştir.");
  });

  it("abonelikten çık bağlantısı YOK (işlemsel e-posta)", () => {
    for (const audience of ["patient", "user", "staff"] as const) {
      const { html, text } = renderBrandedEmail(CTX, { locale: "en", audience, bodyHtml: "<p>x</p>" });
      expect(html + text).not.toMatch(/unsubscribe|abonelik/i);
    }
  });

  it("text/plain üretilir: gövde, CTA adresi ve footer düz metin", () => {
    const { text } = renderBrandedEmail(CTX, { locale: "tr", audience: "patient", bodyHtml: "<p>Merhaba <strong>Ayşe</strong></p>", cta: { label: "Aç", url: "https://example.com/a" } });
    expect(text).toContain("Merhaba Ayşe");
    expect(text).toContain("Aç (https://example.com/a)");
    expect(text).toContain("112");
    expect(text).not.toMatch(/<[a-z]/i);
  });

  it("destek dili satırı yalnızca liste varsa", () => {
    const on = renderBrandedEmail(CTX, { locale: "tr", audience: "patient", bodyHtml: "" });
    expect(on.html).toContain("Kendi dilinizde ücretsiz destek: Türkçe, English");
    const off = renderBrandedEmail({ ...CTX, supportLanguages: null }, { locale: "tr", audience: "patient", bodyHtml: "" });
    expect(off.html).not.toContain("Kendi dilinizde");
  });
});

describe("loadEmailBrandContext — KVKK bağlantısı alıcının dilinde", () => {
  it("TR → Türkçe sayfa; EN ve diğer diller → İngilizce sayfa", async () => {
    const tr = await loadEmailBrandContext(fakeApp(), "tr");
    expect(tr.kvkk).toEqual({ title: "KVKK Aydınlatma Metni", url: `${env.FRONTEND_URL}/tr/kvkk-aydinlatma-metni` });
    expect(tr.privacy?.url).toBe(`${env.FRONTEND_URL}/tr/gizlilik-politikasi`);

    for (const code of ["en", "de", "ar"]) {
      const ctx = await loadEmailBrandContext(fakeApp(), code);
      expect(ctx.kvkk).toEqual({ title: "Privacy Notice", url: `${env.FRONTEND_URL}/en/privacy-notice` });
      expect(ctx.privacy?.url).toBe(`${env.FRONTEND_URL}/en/privacy-policy`);
      expect(ctx.contactUrl).toBe(`${env.FRONTEND_URL}/${code}/contact`);
    }
  });

  it("logo ayarı yoksa logoUrl null (metin başlığına düşer)", async () => {
    const ctx = await loadEmailBrandContext(fakeApp({ logoUrl: null }), "tr");
    expect(ctx.logoUrl).toBeNull();
    const { html } = renderBrandedEmail(ctx, { locale: "tr", audience: "user", bodyHtml: "" });
    expect(html).not.toContain("<img");
  });
});

describe("sendBrandedMail", () => {
  beforeEach(() => sendMailMock.mockClear());

  it("HTML + text/plain + Reply-To (iletişim sayfası adresi) ile gönderir", async () => {
    await sendBrandedMail(fakeApp(), { to: "a@example.com", subject: "S", locale: "de", audience: "patient", bodyHtml: "<p>Hallo</p>" });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const [, input] = sendMailMock.mock.calls[0] as unknown as [unknown, { html: string; text: string; replyTo: string }];
    expect(input.html).toContain('<html lang="de"');
    expect(input.text).toContain("Hallo");
    expect(input.replyTo).toBe("info@example.com");
  });
});

describe("sistem e-postaları — snapshot (TR/EN/AR)", () => {
  for (const entry of SYSTEM_EMAILS) {
    for (const locale of ["tr", "en", "ar"] as const) {
      it(`${entry.id} · ${locale}`, async () => {
        const sample = await renderSystemEmailSample(fakeApp(), entry, locale);
        expect(sample.available).toBe(true);
        expect(sample.html).toContain(`<html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}">`);
        expect(sample.text.length).toBeGreaterThan(20);
        expect({ subject: sample.subject, html: sample.html, text: sample.text }).toMatchSnapshot();
      });
    }
  }

  it("aktif şablon yoksa available=false; randevu onayı yedek metne düşer", async () => {
    const app = fakeApp({ withTemplates: false });
    const welcome = await renderSystemEmailSample(app, SYSTEM_EMAILS.find((e) => e.id === "template:WELCOME")!, "tr");
    expect(welcome.available).toBe(false);
    const appointment = await renderSystemEmailSample(app, SYSTEM_EMAILS.find((e) => e.id === "template:APPOINTMENT_CONFIRMATION")!, "tr");
    expect(appointment.available).toBe(false);
    expect(appointment.html).toContain("Booking Number");
  });
});

describe("personel/doktor e-postaları — hasta adı ve sağlık bilgisi yok", () => {
  const PATIENT_NAME = /Ayşe/;
  const HEALTH = /şikay|complaint|diagnos|tanı:|symptom|semptom|specialt|uzmanlık|intake/i;
  const staffEntries = SYSTEM_EMAILS.filter((e) => e.audience === "staff");

  it("en az bir personel e-postası var", () => expect(staffEntries.length).toBeGreaterThan(5));

  for (const entry of staffEntries) {
    it(entry.id, async () => {
      for (const locale of ["tr", "en", "de", "es", "fr", "ar", "ru", "ro", "sr-latn"] as const) {
        const sample = await renderSystemEmailSample(fakeApp(), entry, locale);
        for (const body of [sample.subject, sample.html, sample.text]) {
          expect(body).not.toMatch(PATIENT_NAME);
          expect(body).not.toMatch(HEALTH);
          expect(body).not.toContain("112");
        }
      }
    });
  }
});

describe("statik tarama — ham HTML ile sendMail kalmadı", () => {
  const SRC = join(__dirname, "../../src");
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
    });
  }
  const files = walk(SRC).map((full) => ({ rel: relative(SRC, full).replace(/\\/g, "/"), code: readFileSync(full, "utf8").replace(/\r\n/g, "\n") }));
  // Yorum satırlarını at (dokümantasyondaki `sendMail(` anmaları sayılmaz).
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("`sendMail(` yalnızca lib/mail.ts ve lib/branded-mail.ts içinde çağrılır", () => {
    const offenders = files.filter((f) => /(^|[^.\w])sendMail\(/.test(strip(f.code))).map((f) => f.rel);
    expect(offenders.sort()).toEqual(["lib/branded-mail.ts", "lib/mail.ts"]);
  });

  it("`transporter.sendMail(` yalnızca mail.ts ve SMTP testinde; SMTP testi kurumsal kabukla", () => {
    const offenders = files.filter((f) => /transporter\.sendMail\(/.test(strip(f.code))).map((f) => f.rel);
    expect(offenders.sort()).toEqual(["lib/mail.ts", "modules/settings/settings.email.routes.ts"]);
    const smtp = files.find((f) => f.rel === "modules/settings/settings.email.routes.ts")!.code;
    expect(smtp).toMatch(/renderBrandedPreview\(/);
    expect(smtp).toMatch(/html: branded\.html/);
  });

  it("`sendRenderedTestMail(` yalnızca önceden kabuklanmış içerikle (admin test uçları)", () => {
    const offenders = files.filter((f) => /sendRenderedTestMail\(/.test(strip(f.code))).map((f) => f.rel);
    expect(offenders.sort()).toEqual(["lib/branded-mail.ts", "modules/email-templates/email-templates.routes.ts"]);
  });
});
