import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { resetDatabase } from "../helpers/reset-db";

/**
 * Paket AH (Faz 1) - `POST /consultation-requests`: dogrulama, riza kutulari, kayit (ConsultationRequest + CrmLead),
 * PII'siz yonetici bildirimi, ziyaretciye onay e-postasi (tr -> en), honeypot, oran siniri, yineleme, CRM detayi.
 */
let ipCounter = 0;
const nextIp = () => `10.93.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

const mailSpy = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/mail")>();
  return { ...actual, sendMail: (...args: unknown[]) => (mailSpy(...args), Promise.resolve({ messageId: "test" })) };
});

interface SentMail {
  to: string;
  subject: string;
  html: string;
  text: string;
}
const sent = (): SentMail[] => mailSpy.mock.calls.map((c) => c[1] as SentMail);

describe("Paket AH - danisma talebi", () => {
  let app: FastifyInstance;
  let admin: { id: string; email: string; token: string };
  let specialty: { id: string; slug: string; name: string };
  let drain: () => Promise<void>;

  async function user(role: "ADMIN" | "MANAGER" | "EDITOR") {
    const { hashPassword } = await import("../../src/lib/password");
    const { signAccessToken } = await import("../../src/lib/jwt");
    const u = await app.prisma.user.create({
      data: { email: `ah-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`, name: `AH ${role}`, passwordHash: await hashPassword("Sifre12345!"), role, status: "ACTIVE", emailVerifiedAt: new Date(), twoFactorEnabled: true },
    });
    return { id: u.id, email: u.email, token: signAccessToken({ sub: u.id, email: u.email }).token };
  }

  const body = (over: Record<string, unknown> = {}) => ({
    serviceSlug: specialty.slug,
    packageSlug: null,
    preferredFrom: "2026-12-01",
    preferredTo: "2026-12-15",
    country: "DE",
    contactLanguage: "de",
    needsInterpreter: true,
    fullName: "Max Mustermann Ozkan",
    email: `max-${crypto.randomUUID().slice(0, 8)}@example.com`,
    phone: "+49 170 1234567",
    message: null,
    contactConsent: true,
    healthDataConsent: false,
    locale: "de",
    website: "",
    ...over,
  });

  function post(payload: Record<string, unknown>, ip = nextIp()) {
    return app.inject({ method: "POST", url: "/api/v1/consultation-requests", payload, remoteAddress: ip });
  }

  beforeAll(async () => {
    const { buildApp } = await import("../../src/app");
    const { waitForAdminNotifications } = await import("../../src/modules/telehealth/lib/admin-booking-notifications");
    drain = waitForAdminNotifications;
    app = await buildApp();
    await app.ready();
    await resetDatabase(app.prisma);
    admin = await user("ADMIN");
    specialty = await app.prisma.specialty.create({ data: { name: "Gastroenterology", slug: `gastro-${crypto.randomUUID().slice(0, 6)}`, icon: "Stethoscope" } });
  });

  beforeEach(() => mailSpy.mockClear());

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
    vi.resetModules();
  });

  it("gecerli talep: 201 + requestNumber (PII yok); ConsultationRequest + CrmLead ayni kayit; mesaj yok", async () => {
    const payload = body();
    const res = await post(payload);
    await drain();
    expect(res.statusCode, res.body).toBe(201);
    const data = res.json().data as { requestNumber: string };
    expect(data.requestNumber).toMatch(/^REQ-\d{5}$/);
    expect(JSON.stringify(res.json())).not.toContain(String(payload.email));
    expect(JSON.stringify(res.json())).not.toContain("Mustermann");

    const request = await app.prisma.consultationRequest.findFirstOrThrow({ where: { email: String(payload.email) }, include: { lead: true } });
    expect(request.serviceName).toBe("Gastroenterology");
    expect(request.specialtyId).toBe(specialty.id);
    expect(request.country).toBe("DE");
    expect(request.contactLanguage).toBe("de");
    expect(request.needsInterpreter).toBe(true);
    expect(request.preferredFrom?.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(request.preferredTo?.toISOString().slice(0, 10)).toBe("2026-12-15");
    expect(request.contactConsentAt).toBeInstanceOf(Date);
    expect(request.healthDataConsentAt).toBeNull();
    expect(request.messageEncrypted).toBeNull();
    expect(request.consentTextVersion).toBe("consultation-v1");
    expect(request.phone).toBe("+491701234567");
    expect(request.lead.channel).toBe("CONSULTATION_REQUEST");
    expect(request.lead.status).toBe("NEW");
    expect(request.lead.sourceRefId).toBe(request.id);
    expect(request.lead.specialtyId).toBe(specialty.id);
    expect(request.lead.specialtyName).toBe("Gastroenterology");
    expect(request.lead.language).toBe("de");
    expect(request.lead.email).toBe(String(payload.email));
    expect(`REQ-${String(request.seq).padStart(5, "0")}`).toBe(data.requestNumber);
  });

  it("paket ile talep (hizmet istege bagli): serviceName paket EN basligi; pasif/yok paket 422 packageSlug", async () => {
    const pkg = await app.prisma.healthPackage.create({
      data: { slug: `exec-${crypto.randomUUID().slice(0, 6)}`, category: "check-up", isActive: true, translations: { en: { title: "Executive Check-up" }, tr: { title: "Yonetici Check-up" } } },
    });
    const res = await post(body({ serviceSlug: null, packageSlug: pkg.slug }));
    expect(res.statusCode, res.body).toBe(201);
    const row = await app.prisma.consultationRequest.findFirstOrThrow({ where: { packageId: pkg.id } });
    expect(row.serviceName).toBe("Executive Check-up");
    expect(row.specialtyId).toBeNull();

    await app.prisma.healthPackage.update({ where: { id: pkg.id }, data: { isActive: false } });
    const inactive = await post(body({ serviceSlug: null, packageSlug: pkg.slug }));
    expect(inactive.statusCode).toBe(422);
    expect(inactive.json().error.details.packageSlug).toBeTruthy();
  });

  it("dogrulama: hizmet/paket yok, bilinmeyen/pasif bolum, ulke, dil, tarih sirasi, e-posta, telefon, ad -> 422 alan bazli", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ serviceSlug: null, packageSlug: null }, "serviceSlug"],
      [{ serviceSlug: "yok-boyle-bolum" }, "serviceSlug"],
      [{ country: "ZZ" }, "country"],
      [{ contactLanguage: "tr" }, "contactLanguage"],
      [{ contactLanguage: "xx" }, "contactLanguage"],
      [{ preferredFrom: "2026-12-15", preferredTo: "2026-12-01" }, "preferredTo"],
      [{ preferredFrom: "2026-13-40" }, "preferredFrom"],
      [{ email: "bozuk" }, "email"],
      [{ phone: "12" }, "phone"],
      [{ fullName: "A" }, "fullName"],
      [{ needsInterpreter: undefined }, "needsInterpreter"],
    ];
    for (const [over, field] of cases) {
      const res = await post(body(over));
      expect(res.statusCode, JSON.stringify(over)).toBe(422);
      expect(res.json().error.details, JSON.stringify(over)).toHaveProperty(field);
    }
    const inactive = await app.prisma.specialty.create({ data: { name: "Kapali", slug: `kapali-${crypto.randomUUID().slice(0, 6)}`, icon: "Heart", isActive: false } });
    const res = await post(body({ serviceSlug: inactive.slug }));
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details).toHaveProperty("serviceSlug");
    expect(await app.prisma.consultationRequest.count({ where: { specialtyId: inactive.id } })).toBe(0);
  });

  it("riza: contactConsent=false -> 422 ve HICBIR kayit/e-posta olusmaz", async () => {
    const before = await app.prisma.consultationRequest.count();
    const res = await post(body({ contactConsent: false }));
    await drain();
    expect(res.statusCode).toBe(422);
    expect(res.json().error.details).toHaveProperty("contactConsent");
    expect(await app.prisma.consultationRequest.count()).toBe(before);
    expect(mailSpy).not.toHaveBeenCalled();
  });

  it("mesaj doluysa saglik rizasi zorunlu (422 healthDataConsent); onayliysa mesaj SIFRELI saklanir ve CRM detayinda cozulur", async () => {
    const MESSAGE = "I have had chronic stomach pain for three months.";
    const refused = await post(body({ message: MESSAGE, healthDataConsent: false }));
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.details).toHaveProperty("healthDataConsent");

    const payload = body({ message: MESSAGE, healthDataConsent: true });
    const res = await post(payload);
    await drain();
    expect(res.statusCode, res.body).toBe(201);
    const row = await app.prisma.consultationRequest.findFirstOrThrow({ where: { email: String(payload.email) } });
    expect(row.messageEncrypted).toBeTruthy();
    expect(row.messageEncrypted).not.toContain("stomach");
    expect(row.healthDataConsentAt).toBeInstanceOf(Date);

    const detail = await app.inject({ method: "GET", url: `/api/v1/admin/crm/leads/${row.leadId}`, headers: auth(admin.token) });
    expect(detail.statusCode, detail.body).toBe(200);
    const cr = detail.json().data.consultationRequest;
    expect(cr).toMatchObject({
      serviceName: "Gastroenterology",
      country: "DE",
      contactLanguage: "de",
      needsInterpreter: true,
      preferredFrom: "2026-12-01",
      preferredTo: "2026-12-15",
      message: MESSAGE,
    });
    expect(cr.number).toBe(`REQ-${String(row.seq).padStart(5, "0")}`);
    expect(cr.healthDataConsentAt).toBeTruthy();
    expect(detail.json().data.channel).toBe("CONSULTATION_REQUEST");
    // Saglik rizasi mesaj yoksa kayda gecmez (veri minimizasyonu).
    const noMsg = body({ healthDataConsent: true });
    await post(noMsg);
    const noMsgRow = await app.prisma.consultationRequest.findFirstOrThrow({ where: { email: String(noMsg.email) } });
    expect(noMsgRow.healthDataConsentAt).toBeNull();
  });

  it("yonetici bildirimi: konu 'New consultation request #REQ-... - <hizmet>'; govdede ad/e-posta/telefon/mesaj YOK; 'Open request' lead baglantisi; konfigure alici", async () => {
    await app.prisma.siteSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", bookingNotificationRecipients: "ops@example.com, koordinator@example.com" }, update: { bookingNotificationRecipients: "ops@example.com, koordinator@example.com" } });
    const payload = body({ message: "Private health detail xyz", healthDataConsent: true, fullName: "Hans Gizli Kisi", phone: "+49 160 9998887" });
    const res = await post(payload);
    await drain();
    expect(res.statusCode).toBe(201);
    const requestNumber = res.json().data.requestNumber as string;
    const row = await app.prisma.consultationRequest.findFirstOrThrow({ where: { email: String(payload.email) } });
    const admins = sent().filter((m) => m.subject.includes(`#${requestNumber} `));
    expect(admins.map((m) => m.to).sort()).toEqual(["koordinator@example.com", "ops@example.com"]);
    for (const mail of admins) {
      expect(mail.subject).toBe(`New consultation request #${requestNumber} — Gastroenterology`);
      const all = `${mail.subject}\n${mail.html}\n${mail.text}`;
      for (const secret of ["Hans", "Gizli", String(payload.email), "9998887", "Private health detail", "Mustermann"]) expect(all).not.toContain(secret);
      expect(mail.html).toContain(`${"http://localhost:3000"}/admin/crm/leads/${row.leadId}`);
      expect(mail.text).toContain("Open request");
      expect(mail.text).toContain("Germany (DE)");
      expect(mail.text).toContain("German (de)");
      expect(mail.text).toMatch(/Interpreter: yes/);
      expect(mail.text).toContain("2026-12-01 - 2026-12-15");
    }
    // Idempotent olay anahtari.
    const note = await app.prisma.adminNotification.findUniqueOrThrow({ where: { eventKey: `consultation-request:${row.id}:created` } });
    expect(note.status).toBe("sent");
    expect(note.kind).toBe("consultation_request");
    expect(JSON.stringify(note.payload)).not.toContain(String(payload.email));
    await app.prisma.siteSettings.update({ where: { id: "singleton" }, data: { bookingNotificationRecipients: null } });
  });

  it("ziyaretciye onay e-postasi: kendi dilinde (de), talep no, 1 is gunu, kimlik ibaresi; mesaj icerigi yok; tr -> en", async () => {
    const de = body({ locale: "de", message: "Geheime Beschwerde", healthDataConsent: true });
    const res = await post(de);
    await drain();
    const number = res.json().data.requestNumber as string;
    const mail = sent().find((m) => m.to === de.email)!;
    expect(mail.subject).toBe(`Wir haben Ihre Anfrage ${number} erhalten`);
    expect(mail.html).toContain('<html lang="de"');
    expect(mail.text).toContain(number);
    expect(mail.text).toContain("innerhalb von einem Werktag");
    expect(mail.text).toContain("Internationaler Vermittler für Gesundheitstourismus");
    expect(mail.text).toContain("kein Gesundheitsdienstleister");
    expect(mail.text).not.toContain("Geheime Beschwerde");
    // Hizmet/bolum adi onay e-postasinda YOK (yalniz talep no).
    expect(mail.subject + mail.html + mail.text).not.toContain("Gastroenterology");

    mailSpy.mockClear();
    const turkish = body({ locale: "tr", contactLanguage: "en" });
    const res2 = await post(turkish);
    await drain();
    const number2 = res2.json().data.requestNumber as string;
    const mail2 = sent().find((m) => m.to === turkish.email)!;
    expect(mail2.subject).toBe(`We received your request ${number2}`);
    expect(mail2.html).toContain('<html lang="en"');
    expect(mail2.text).toContain("A patient coordinator will contact you within 1 business day.");
    expect(mail2.text).toContain("International Health Tourism Intermediary");
    expect(mail2.text).not.toMatch(/Talebinizi|Bu e-posta|Acil durumda/);
  });

  it("ayni kisi + ayni hizmet 10 dk icinde: yeni talep acilmaz, ayni numara doner, e-posta tekrar gitmez", async () => {
    const payload = body();
    const first = await post(payload);
    await drain();
    mailSpy.mockClear();
    const again = await post(payload);
    await drain();
    expect(again.statusCode).toBe(201);
    expect(again.json().data.requestNumber).toBe(first.json().data.requestNumber);
    expect(await app.prisma.consultationRequest.count({ where: { email: String(payload.email) } })).toBe(1);
    expect(mailSpy).not.toHaveBeenCalled();
  });

  it("honeypot: 201 (sahte numara) ama hicbir kayit ve e-posta yok", async () => {
    const before = await app.prisma.consultationRequest.count();
    const leadsBefore = await app.prisma.crmLead.count();
    const res = await post(body({ website: "http://spam.example" }));
    await drain();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.requestNumber).toMatch(/^REQ-\d{5}$/);
    expect(await app.prisma.consultationRequest.count()).toBe(before);
    expect(await app.prisma.crmLead.count()).toBe(leadsBefore);
    expect(mailSpy).not.toHaveBeenCalled();
  });

  it("oran siniri: ayni IP'den dakikada en fazla 5 istek, 6.si 429", async () => {
    const ip = "10.99.99.99";
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await post(body({ fullName: "A" }), ip)).statusCode);
    expect(statuses.slice(0, 5)).toEqual([422, 422, 422, 422, 422]);
    expect(statuses[5]).toBe(429);
  });

  it("CRM 'Talepler' listesinde kanal CONSULTATION_REQUEST ile gorunur; yetkisiz erisim yok", async () => {
    const list = await app.inject({ method: "GET", url: "/api/v1/admin/crm/leads?channel=CONSULTATION_REQUEST&pageSize=100", headers: auth(admin.token) });
    expect(list.statusCode, list.body).toBe(200);
    const rows = (list.json().data.items ?? list.json().data) as { channel: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.channel === "CONSULTATION_REQUEST")).toBe(true);
    const anon = await app.inject({ method: "GET", url: "/api/v1/admin/crm/leads?channel=CONSULTATION_REQUEST" });
    expect(anon.statusCode).toBe(401);
  });

  it("saglik rizasi geri cekme: mesaj ve riza zamani silinir", async () => {
    const payload = body({ message: "to be withdrawn", healthDataConsent: true });
    await post(payload);
    await drain();
    const row = await app.prisma.consultationRequest.findFirstOrThrow({ where: { email: String(payload.email) } });
    const res = await app.inject({ method: "POST", url: `/api/v1/admin/crm/leads/${row.leadId}/consultation-request/withdraw-health-consent`, headers: auth(admin.token) });
    expect(res.statusCode, res.body).toBe(200);
    const after = await app.prisma.consultationRequest.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.messageEncrypted).toBeNull();
    expect(after.healthDataConsentAt).toBeNull();
  });

  it("saklama: sure dolan lead anonimlestirilince talepteki ad/e-posta/telefon/mesaj/IP temizlenir", async () => {
    const { anonymizeExpiredLeads } = await import("../../src/modules/crm/crm.leads");
    const payload = body({ message: "old health note", healthDataConsent: true });
    await post(payload);
    await drain();
    const row = await app.prisma.consultationRequest.findFirstOrThrow({ where: { email: String(payload.email) } });
    await app.prisma.crmLead.update({ where: { id: row.leadId }, data: { createdAt: new Date(Date.now() - 4000 * 86_400_000) } });
    await anonymizeExpiredLeads(app);
    const after = await app.prisma.consultationRequest.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ fullName: null, email: null, phone: null, messageEncrypted: null, ipAddress: null, userAgent: null });
    expect(after.anonymizedAt).toBeInstanceOf(Date);
    expect(after.serviceName).toBe("Gastroenterology");
  });

  it("consentTextVersion: bilinmeyen/yanlis tipli deger 422 DEGIL, sunucu surumune duser; bilinen surum korunur", async () => {
    for (const version of ["evil-v9", "x".repeat(150), 12345, null]) {
      const payload = body({ consentTextVersion: version });
      const res = await post(payload);
      expect(res.statusCode, String(version)).toBe(201);
      const row = await app.prisma.consultationRequest.findFirstOrThrow({ where: { email: String(payload.email) } });
      expect(row.consentTextVersion).toBe("consultation-v1");
    }
    const known = body({ consentTextVersion: "consultation-v1" });
    await post(known);
    expect((await app.prisma.consultationRequest.findFirstOrThrow({ where: { email: String(known.email) } })).consentTextVersion).toBe("consultation-v1");
  });

  it("saatlik bildirim tavani: tekil yonetici e-postasi gitmez, alicilara saatte EN FAZLA 1 'tavan asildi' uyarisi (PII'siz); honeypot sayaca girmez", async () => {
    await app.prisma.siteSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", bookingNotificationRecipients: "ops@example.com" }, update: { bookingNotificationRecipients: "ops@example.com" } });
    // Tavani (30/saat) asmak icin dogrudan kayit ekle.
    for (let i = 0; i < 32; i++) {
      const lead = await app.prisma.crmLead.create({ data: { channel: "CONSULTATION_REQUEST", name: "Kapasite Testi", email: `cap-${i}@example.com`, sourceRefId: `cap-${i}-${crypto.randomUUID()}` } });
      await app.prisma.consultationRequest.create({
        data: { leadId: lead.id, serviceName: "Gastroenterology", country: "DE", contactLanguage: "de", fullName: "Kapasite Testi", email: `cap-${i}@example.com`, contactConsentAt: new Date(), locale: "de", specialtyId: specialty.id },
      });
    }
    const before = await app.prisma.consultationRequest.count();
    await post(body({ website: "bot" }));
    await drain();
    expect(await app.prisma.consultationRequest.count()).toBe(before);

    mailSpy.mockClear();
    const first = body({ fullName: "Tavan Birinci Kisi" });
    const second = body({ fullName: "Tavan Ikinci Kisi" });
    expect((await post(first)).statusCode).toBe(201);
    expect((await post(second)).statusCode).toBe(201);
    await drain();
    const toOps = sent().filter((m) => m.to === "ops@example.com");
    expect(toOps.filter((m) => m.subject === "Consultation request notification cap reached")).toHaveLength(1);
    expect(toOps.filter((m) => m.subject.startsWith("New consultation request"))).toHaveLength(0);
    const cap = toOps.find((m) => m.subject === "Consultation request notification cap reached")!;
    for (const secret of ["Tavan", String(first.email), String(second.email), "Gastroenterology"]) expect(`${cap.html}${cap.text}`).not.toContain(secret);
    expect(cap.text).toContain("Open requests");
    await app.prisma.siteSettings.update({ where: { id: "singleton" }, data: { bookingNotificationRecipients: null } });
  });

  it("CRM detayi: mesaj cozulemezse yer tutucu doner, audit'e crm.consultation_request.decrypt_failed duser, mesaj logda yok", async () => {
    const payload = body({ message: "never logged text", healthDataConsent: true });
    await post(payload);
    await drain();
    const row = await app.prisma.consultationRequest.findFirstOrThrow({ where: { email: String(payload.email) } });
    await app.prisma.consultationRequest.update({ where: { id: row.id }, data: { messageEncrypted: "bozuk:kayit:deger" } });
    const detail = await app.inject({ method: "GET", url: `/api/v1/admin/crm/leads/${row.leadId}`, headers: auth(admin.token) });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.consultationRequest.message).toBe("[Mesaj çözülemedi]");
    expect(await app.prisma.auditLog.count({ where: { action: "crm.consultation_request.decrypt_failed", targetId: row.leadId } })).toBe(1);
  });
});
