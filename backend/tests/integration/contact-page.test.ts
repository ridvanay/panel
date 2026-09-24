import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * İletişim sayfası (`/contact`) — sabit alanlı form ucu + sayfa içeriği. Bkz.
 * `src/modules/contact/contact-page.ts` (güvenlik: honeypot + imzalı zaman damgası + rate limit;
 * KVKK: yalnızca form alanları, tedavi seçilirse ayrı açık rıza kanıtı).
 */
const sendMailMock = vi.hoisted(() => vi.fn(async (_app: unknown, _input: { to: string; subject: string; html: string }) => ({ messageId: "m" })));
vi.mock("../../src/lib/mail", () => ({ sendMail: sendMailMock }));

import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { issueContactFormToken, checkContactFormToken, CONTACT_PAGE_CONSENT_TEXTS } from "../../src/modules/contact/contact-page";

const SUBMIT = "/api/v1/contact/page-submissions";
const ADMIN_PAGE = "/api/v1/admin/contact/page";

/** Rota limiti (5/dk/IP) testleri birbirine bağlamasın diye her gönderim ayrı bir IP'den. */
let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

function oldToken(ageMs = 10_000) {
  return issueContactFormToken(Date.now() - ageMs);
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    token: oldToken(),
    website: "",
    locale: "en",
    fullName: "Jane Doe",
    email: "jane@example.com",
    phoneCountry: "GB",
    phoneNumber: "7700 900123",
    country: "GB",
    contactMethod: "email",
    message: "I would like to learn about an online consultation.",
    noticeAccepted: true,
    ...overrides,
  };
}

describe("iletişim sayfası", () => {
  let app: FastifyInstance;
  let adminToken: string;
  let editorToken: string;

  async function createUser(role: "ADMIN" | "EDITOR") {
    const { hashPassword } = await import("../../src/lib/password");
    const user = await app.prisma.user.create({
      data: {
        email: `contact-page-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`,
        name: role,
        passwordHash: await hashPassword("Sifre12345!"),
        role,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
    const res = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: user.email, password: "Sifre12345!" } });
    return res.json().data.tokens.accessToken as string;
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    await app.prisma.contactForm.create({
      data: {
        id: "singleton",
        notifyEmail: "team@example.com",
        consentText: "eski",
        // Sistem alanları (prod'da her zaman var) — `{{name}}`/`{{email}}`/`{{message}}` değişkenlerinin kaynağı.
        fields: {
          create: [
            { order: 0, key: "name", label: "Ad Soyad", type: "TEXT", required: true, isSystem: true },
            { order: 1, key: "email", label: "E-posta", type: "EMAIL", required: true, isSystem: true },
            { order: 2, key: "message", label: "Mesaj", type: "TEXTAREA", required: true, isSystem: true },
          ],
        },
      },
    });
    await app.prisma.emailTemplate.create({
      data: {
        name: "İletişim bildirimi",
        purpose: "CONTACT_FORM_NOTIFICATION",
        editorMode: "RAW",
        isActive: true,
        subject: "Yeni mesaj",
        bodyHtml: "<p>{{name}}|{{email}}|{{phone}}|{{country}}|{{contact_method}}|{{treatment}}|{{treatment_name}}</p>",
        availableVariables: [],
      },
    });
    await app.prisma.specialty.create({ data: { name: "Kardiyoloji", slug: "kardiyoloji", icon: "heart-pulse" } });
    await app.prisma.specialty.create({ data: { name: "Pasif", slug: "pasif", icon: "x", isActive: false } });
    adminToken = await createUser("ADMIN");
    editorToken = await createUser("EDITOR");
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  beforeEach(() => sendMailMock.mockClear());

  describe("zaman damgası", () => {
    it("imza/yaş kontrolü: 3 sn'den genç too_fast, 24 saatten eski expired, değiştirilmiş invalid", () => {
      const now = Date.now();
      expect(checkContactFormToken(issueContactFormToken(now - 5_000), now)).toBe("ok");
      expect(checkContactFormToken(issueContactFormToken(now - 1_000), now)).toBe("too_fast");
      expect(checkContactFormToken(issueContactFormToken(now - 24 * 60 * 60 * 1000 - 1), now)).toBe("expired");
      const token = issueContactFormToken(now - 5_000);
      expect(checkContactFormToken(token.replace(/.$/, (c) => (c === "A" ? "B" : "A")), now)).toBe("invalid");
      expect(checkContactFormToken(token.replace(/\.(\d+)\./, (_m, ts) => `.${Number(ts) - 1000}.`), now)).toBe("invalid");
      expect(checkContactFormToken(undefined, now)).toBe("invalid");
    });

    it("GET /contact/page/token önbelleğe alınmaz", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/contact/page/token" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(checkContactFormToken(res.json().data.token)).toBe("too_fast");
    });
  });

  describe("gönderim", () => {
    it("geçerli gönderim: yalnızca form alanları + aydınlatma metni kopyası saklanır, bildirim gider", async () => {
      const res = await app.inject({ method: "POST", url: SUBMIT, remoteAddress: nextIp(), payload: validBody() });
      expect(res.statusCode).toBe(201);
      const row = await app.prisma.contactSubmission.findUniqueOrThrow({ where: { id: res.json().data.id } });
      expect(row.status).toBe("NEW");
      expect(row.consentTextSnapshot).toBe(CONTACT_PAGE_CONSENT_TEXTS.en.notice);
      expect(row.consentAt).toBeInstanceOf(Date);
      expect(row.data).toEqual({
        source: "contact_page",
        locale: "en",
        name: "Jane Doe",
        email: "jane@example.com",
        message: "I would like to learn about an online consultation.",
        contact_method: "email",
        phone: "+44 7700 900123",
        phone_country: "GB",
        country: "GB",
      });
      expect(sendMailMock).toHaveBeenCalledTimes(1);
      expect(sendMailMock.mock.calls[0]![1].html).toContain("Jane Doe|jane@example.com|+44 7700 900123|GB|email");
    });

    it("tedavi seçilirse açık rıza ZORUNLU; verilirse metin kopyası + zamanı saklanır, tedavi e-postaya YAZILMAZ", async () => {
      const without = await app.inject({ method: "POST", url: SUBMIT, remoteAddress: nextIp(), payload: validBody({ locale: "tr", treatment: "kardiyoloji" }) });
      expect(without.statusCode).toBe(422);
      expect(without.json().error.details.explicitConsent).toEqual(["required"]);

      const res = await app.inject({
        method: "POST",
        url: SUBMIT,
        remoteAddress: nextIp(),
        payload: validBody({ locale: "tr", treatment: "kardiyoloji", explicitConsent: true }),
      });
      expect(res.statusCode).toBe(201);
      const row = await app.prisma.contactSubmission.findUniqueOrThrow({ where: { id: res.json().data.id } });
      const data = row.data as Record<string, string>;
      expect(data.treatment).toBe("kardiyoloji");
      expect(data.treatment_name).toBe("Kardiyoloji");
      expect(data.explicit_consent_text).toBe(CONTACT_PAGE_CONSENT_TEXTS.tr.explicit);
      expect(Number.isNaN(Date.parse(data.explicit_consent_at!))).toBe(false);
      expect(row.consentTextSnapshot).toBe(CONTACT_PAGE_CONSENT_TEXTS.tr.notice);
      const html = sendMailMock.mock.calls.at(-1)![1].html;
      expect(html).not.toContain("kardiyoloji");
      expect(html).not.toContain("Kardiyoloji");
    });

    it("'Henüz emin değilim' açık rıza gerektirmez ve rıza kanıtı saklanmaz", async () => {
      const res = await app.inject({ method: "POST", url: SUBMIT, remoteAddress: nextIp(), payload: validBody({ treatment: "not_sure" }) });
      expect(res.statusCode).toBe(201);
      const data = (await app.prisma.contactSubmission.findUniqueOrThrow({ where: { id: res.json().data.id } })).data as Record<string, string>;
      expect(data.treatment).toBe("not_sure");
      expect(data.explicit_consent_at).toBeUndefined();
    });

    it.each([
      ["pasif/bilinmeyen tedavi", { treatment: "pasif", explicitConsent: true }, "treatment"],
      ["aydınlatma onayı yok", { noticeAccepted: false }, "noticeAccepted"],
      ["geçersiz e-posta", { email: "x@" }, "email"],
      ["boş ad", { fullName: " " }, "fullName"],
      ["boş mesaj", { message: "" }, "message"],
      ["listede olmayan ülke", { country: "ZZ" }, "country"],
      ["telefonla dönüş ama numara yok", { contactMethod: "whatsapp", phoneNumber: "" }, "phoneNumber"],
      ["geçersiz telefon", { phoneNumber: "abc" }, "phoneNumber"],
    ])("422 alan bazlı hata: %s", async (_label, overrides, field) => {
      const res = await app.inject({ method: "POST", url: SUBMIT, remoteAddress: nextIp(), payload: validBody(overrides) });
      expect(res.statusCode).toBe(422);
      expect(Object.keys(res.json().error.details)).toContain(field);
    });

    it("honeypot doluysa sahte başarı, SPAM olarak işaretlenir, e-posta gitmez", async () => {
      const res = await app.inject({ method: "POST", url: SUBMIT, remoteAddress: nextIp(), payload: validBody({ website: "http://spam", email: "not-an-email" }) });
      expect(res.statusCode).toBe(201);
      const row = await app.prisma.contactSubmission.findUniqueOrThrow({ where: { id: res.json().data.id } });
      expect(row.status).toBe("SPAM");
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it("3 saniyeden hızlı gönderim sahte başarı + SPAM", async () => {
      const res = await app.inject({ method: "POST", url: SUBMIT, remoteAddress: nextIp(), payload: validBody({ token: issueContactFormToken() }) });
      expect(res.statusCode).toBe(201);
      const row = await app.prisma.contactSubmission.findUniqueOrThrow({ where: { id: res.json().data.id } });
      expect(row.status).toBe("SPAM");
      expect((row.data as Record<string, string>).spam_reason).toBe("too_fast");
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it("aynı IP'den dakikada 5'ten fazla gönderim 429 (gerçek ziyaretçi IP'si)", async () => {
      const ip = "10.9.9.9";
      const statuses: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        statuses.push((await app.inject({ method: "POST", url: SUBMIT, remoteAddress: ip, payload: validBody() })).statusCode);
      }
      expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
      expect(statuses[5]).toBe(429);
    });

    it("geçersiz veya 24 saatten eski damga 422 CONTACT_FORM_TOKEN_INVALID", async () => {
      const invalid = await app.inject({ method: "POST", url: SUBMIT, remoteAddress: nextIp(), payload: validBody({ token: "v1.123.abc" }) });
      expect(invalid.statusCode).toBe(422);
      expect(invalid.json().error.code).toBe("CONTACT_FORM_TOKEN_INVALID");
      expect(invalid.json().error.details.token).toEqual(["invalid"]);

      const expired = await app.inject({ method: "POST", url: SUBMIT, remoteAddress: nextIp(), payload: validBody({ token: oldToken(25 * 60 * 60 * 1000) }) });
      expect(expired.json().error.details.token).toEqual(["expired"]);
    });
  });

  describe("sayfa içeriği", () => {
    it("ADMIN içeriği kaydeder; public uç dile göre döner, WhatsApp yalnızca rakam; EDITOR yazamaz", async () => {
      const content = {
        locales: {
          en: { title: "Contact us", phone: "+90 212 000 00 00", whatsapp: "+90 555 000 00 00", email: "hello@example.com", hours: [{ label: "Mon–Fri", value: "09:00–18:00" }] },
          tr: { title: "Bize ulaşın" },
        },
        mapUrl: "https://maps.app.goo.gl/abc123",
      };
      const forbidden = await app.inject({ method: "PUT", url: ADMIN_PAGE, headers: { authorization: `Bearer ${editorToken}` }, payload: content });
      expect(forbidden.statusCode).toBe(403);

      const saved = await app.inject({ method: "PUT", url: ADMIN_PAGE, headers: { authorization: `Bearer ${adminToken}` }, payload: content });
      expect(saved.statusCode).toBe(200);
      expect(await app.prisma.auditLog.count({ where: { action: "contact.page_update" } })).toBe(1);

      const en = (await app.inject({ method: "GET", url: "/api/v1/contact/page?locale=en" })).json().data;
      expect(en.content.title).toBe("Contact us");
      expect(en.whatsappDigits).toBe("905550000000");
      expect(en.mapUrl).toBe("https://maps.app.goo.gl/abc123");
      expect(en.consent).toEqual(CONTACT_PAGE_CONSENT_TEXTS.en);

      const tr = (await app.inject({ method: "GET", url: "/api/v1/contact/page?locale=tr" })).json().data;
      expect(tr.content.title).toBe("Bize ulaşın");
      expect(tr.content.phone).toBe("");
      expect(tr.consent).toEqual(CONTACT_PAGE_CONSENT_TEXTS.tr);
    });

    it.each([
      ["Google dışı harita bağlantısı", { mapUrl: "https://evil.example.com/maps" }],
      ["javascript: harita bağlantısı", { mapUrl: "javascript:alert(1)" }],
      ["HTML içeren metin", { locales: { en: { title: "<b>x</b>" } } }],
      ["geçersiz e-posta", { locales: { en: { email: "x@" } } }],
      ["11 çalışma saati satırı", { locales: { en: { hours: Array.from({ length: 11 }, () => ({ label: "a", value: "b" })) } } }],
      ["desteklenmeyen dil", { locales: { de: { title: "x" } } }],
    ])("422: %s", async (_label, payload) => {
      const res = await app.inject({ method: "PUT", url: ADMIN_PAGE, headers: { authorization: `Bearer ${adminToken}` }, payload });
      expect(res.statusCode).toBe(422);
    });

    it("form kapalıysa public sayfa ve gönderim 404", async () => {
      await app.prisma.contactForm.update({ where: { id: "singleton" }, data: { isEnabled: false } });
      expect((await app.inject({ method: "GET", url: "/api/v1/contact/page?locale=en" })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: SUBMIT, remoteAddress: nextIp(), payload: validBody() })).statusCode).toBe(404);
      await app.prisma.contactForm.update({ where: { id: "singleton" }, data: { isEnabled: true } });
    });
  });
});
