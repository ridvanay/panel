import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Paket U (B1, B3) — iletişim formu bloğunun dile göre metinleri: başlık, düğme, alan etiketleri ve
 * onay cümlesi 9 dilde sunucudan; bağlantı aktif dilin yasal sayfa slug'ına; saklanan onay kanıtı =
 * gösterilen metin; admin `/contact` sayfa kaydı form çevirilerini silmez; çeviri export/import'u
 * `contactForm` türünü yazar ve geri döndürür; `instructions` gerçek hedef dilleri listeler.
 */
const sendMailMock = vi.hoisted(() => vi.fn(async () => ({ messageId: "m" })));
vi.mock("../../src/lib/mail", () => ({ sendMail: sendMailMock }));

import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { CONTACT_CONSENT_TEXTS, CONTACT_FORM_DEFAULTS, CONTACT_LOCALES } from "../../src/modules/contact/contact-i18n";
import {
  IMPORT_CONFIRM_KEY,
  RESTORE_CONFIRM_KEY,
  applyImportPlan,
  buildImportPlan,
  buildTranslationExport,
  restoreTranslations,
} from "../../src/lib/content-translations";

const OP = { operator: "Test Operatör", osUser: "ci", hostname: "test-host" };
let ipCounter = 0;
const nextIp = () => `10.9.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

describe("iletişim formu — diller (Paket U)", () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    const legal = await app.prisma.page.create({
      data: { title: "Privacy Notice", slug: "privacy-notice", status: "PUBLISHED", isLegalDocument: true, blocks: [] },
    });
    await app.prisma.locale.upsert({ where: { code: "tr" }, create: { code: "tr", label: "Türkçe", nativeLabel: "Türkçe", isDefault: true, enabled: true, sortOrder: 0 }, update: {} });
    await app.prisma.contentSlug.create({ data: { entityType: "PAGE", entityId: legal.id, locale: "tr", slug: "aydinlatma-metni" } });
    await app.prisma.contactForm.create({
      data: {
        id: "singleton",
        title: "Contact Us",
        submitLabel: "Submit",
        successMessage: "Thanks!",
        consentText: "",
        consentLegalPageId: legal.id,
        fields: {
          create: [
            { order: 0, key: "name", label: "Your Name", type: "TEXT", required: true, isSystem: true },
            { order: 1, key: "email", label: "E-mail", type: "EMAIL", required: true, isSystem: true },
            { order: 2, key: "message", label: "Message", type: "TEXTAREA", required: true, isSystem: true },
            {
              order: 3,
              key: "topic",
              label: "Topic",
              type: "SELECT",
              required: false,
              options: [
                { value: "general", label: "General" },
                { value: "billing", label: "Billing" },
              ],
            },
          ],
        },
      },
    });
    const { hashPassword } = await import("../../src/lib/password");
    const user = await app.prisma.user.create({
      data: { email: `cf-admin-${crypto.randomUUID()}@example.com`, name: "A", passwordHash: await hashPassword("GucluSifre.2026!"), role: "ADMIN", status: "ACTIVE", emailVerifiedAt: new Date() },
    });
    adminToken = (await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: user.email, password: "GucluSifre.2026!" } })).json().data.tokens.accessToken;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  beforeEach(() => sendMailMock.mockClear());

  const getForm = async (locale?: string) => (await app.inject({ method: "GET", url: `/api/v1/contact/form${locale ? `?locale=${locale}` : ""}` })).json().data;

  it("9 dilde başlık, düğme, sistem alanı etiketi ve onay cümlesi; bağlantı etiketi cümlede aynen geçer", async () => {
    for (const locale of CONTACT_LOCALES) {
      const form = await getForm(locale);
      expect(form.locale).toBe(locale);
      expect(form.consentSentence).toBe(CONTACT_CONSENT_TEXTS[locale].formConsent);
      expect(form.consentSentence).toContain(form.privacyLinkLabel);
      if (locale === "en") {
        expect([form.title, form.submitLabel, form.fields[0].label]).toEqual(["Contact Us", "Submit", "Your Name"]);
      } else {
        expect(form.title).toBe(CONTACT_FORM_DEFAULTS[locale].title);
        expect(form.submitLabel).toBe(CONTACT_FORM_DEFAULTS[locale].submitLabel);
        expect(form.fields.map((f: { label: string }) => f.label).slice(0, 3)).toEqual(Object.values(CONTACT_FORM_DEFAULTS[locale].fieldLabels));
        // Hiçbir dilde Türkçe onay kalıntısı yok (TR hariç).
        if (locale !== "tr") expect(JSON.stringify(form)).not.toContain("okudum");
      }
      expect(form.consentLegalPage).toMatchObject({ slug: "privacy-notice", localizedSlugs: { tr: "aydinlatma-metni" } });
    }
    expect((await getForm("xx")).locale).toBe("en");
    expect((await getForm()).locale).toBe("en");
  });

  it("gönderim: saklanan onay kanıtı ve başarı mesajı formun gösterildiği dilde", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/contact/submissions",
      remoteAddress: nextIp(),
      payload: { values: { name: "Ana Pop", email: "ana@example.com", message: "Bună ziua" }, consent: true, locale: "ro" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.message).toBe(CONTACT_FORM_DEFAULTS.ro.successMessage);
    const row = await app.prisma.contactSubmission.findUniqueOrThrow({ where: { id: res.json().data.id } });
    expect(row.consentTextSnapshot).toBe(CONTACT_CONSENT_TEXTS.ro.formConsent);
  });

  it("/contact sayfası onay metinleri 9 dilde; içerik en/tr dışında EN'e düşer", async () => {
    const sr = (await app.inject({ method: "GET", url: "/api/v1/contact/page?locale=sr-latn" })).json().data;
    expect(sr.locale).toBe("sr-latn");
    expect(sr.consent.notice).toBe(CONTACT_CONSENT_TEXTS["sr-latn"].notice);
    for (const locale of CONTACT_LOCALES) {
      const t = CONTACT_CONSENT_TEXTS[locale];
      expect(t.notice, locale).toContain(t.privacyLinkLabel);
      expect(t.explicit, locale).toContain(t.privacyLinkLabel);
    }
  });

  it("çeviri import'u contactForm'u yazar (anahtar/değer korunur), admin sayfa kaydı silmez, geri dönüş; instructions hedef dilleri listeler", async () => {
    const backupDir = await fs.mkdtemp(path.join(os.tmpdir(), "cf-backup-"));
    const data = await buildTranslationExport(app.prisma, new Date(), { locales: ["ro", "fr", "sr-latn"] });
    expect(data.instructions).toContain("translations.<ro|fr|sr-latn>");
    expect(data.instructions).not.toContain("tr|es|de|ar|ru");
    const item = data.items.find((i) => i.type === "contactForm")!;
    expect(item.importable).toBe(true);
    expect(item.fields).toMatchObject({ title: "Contact Us", fields: { topic: { label: "Topic", options: { general: "General", billing: "Billing" } } } });

    item.translations.ro = { title: "Scrieți-ne", submitLabel: "Trimite", fields: { topic: { label: "Subiect", options: { general: "General", billing: "Facturare" } } } };
    item.translations.fr = { fields: { unknown_field: { label: "x" } } };
    const plan = await buildImportPlan(app.prisma, data);
    expect(plan.contactForm.map((c) => c.locale)).toEqual(["ro"]);
    expect(plan.skipped.find((s) => s.type === "contactForm")?.reason).toMatch(/Formda olmayan alan: unknown_field/);
    const { backupFile, contactForm } = await applyImportPlan(app.prisma, plan, { ...OP, confirm: IMPORT_CONFIRM_KEY, backupDir, sourceFile: "x.json", revalidate: false });
    expect(contactForm).toBe(1);

    const ro = await getForm("ro");
    expect([ro.title, ro.submitLabel, ro.fields[3].label]).toEqual(["Scrieți-ne", "Trimite", "Subiect"]);
    expect(ro.fields[3].options).toEqual([
      { value: "general", label: "General" },
      { value: "billing", label: "Facturare" },
    ]);

    // Admin `/contact` sayfa içeriği kaydı aynı JSON'daki form çevirilerini korur.
    const put = await app.inject({ method: "PUT", url: "/api/v1/admin/contact/page", headers: { authorization: `Bearer ${adminToken}` }, payload: { locales: { en: { title: "Contact" } } } });
    expect(put.statusCode).toBe(200);
    expect((await getForm("ro")).title).toBe("Scrieți-ne");

    await restoreTranslations(app.prisma, backupFile, { ...OP, confirm: RESTORE_CONFIRM_KEY, backupDir, revalidate: false });
    expect((await getForm("ro")).title).toBe(CONTACT_FORM_DEFAULTS.ro.title);
  });
});
