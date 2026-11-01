import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { resetDatabase } from "../helpers/reset-db";

/**
 * Paket X — sağlık paketleri, "Top destinations", iletişim kanalları (WhatsApp) ve "Plan my package" talebi.
 * Uydurma veri yok: bütün kayıtlar test içinde açıkça oluşturulur.
 */
let ipCounter = 0;
const nextIp = () => `10.92.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const ORIGIN = { origin: "http://localhost:3000" };

const mailSpy = vi.fn();
vi.mock("../../src/lib/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/mail")>();
  return { ...actual, sendMail: (...args: unknown[]) => (mailSpy(...args), Promise.resolve({ messageId: "test" })) };
});

describe("Paket X — paketler, destinasyonlar, iletişim kanalları", () => {
  let app: FastifyInstance;
  let admin: { id: string; email: string; token: string };
  let manager: { id: string; email: string; token: string };
  let editor: { id: string; email: string; token: string };

  async function user(role: "ADMIN" | "MANAGER" | "EDITOR") {
    const { hashPassword } = await import("../../src/lib/password");
    const { signAccessToken } = await import("../../src/lib/jwt");
    const u = await app.prisma.user.create({
      data: { email: `x-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`, name: `X ${role}`, passwordHash: await hashPassword("Sifre12345!"), role, status: "ACTIVE", emailVerifiedAt: new Date(), twoFactorEnabled: true },
    });
    return { id: u.id, email: u.email, token: signAccessToken({ sub: u.id, email: u.email }).token };
  }

  const pkgBody = (over: Record<string, unknown> = {}) => ({
    slug: `executive-${crypto.randomUUID().slice(0, 6)}`,
    category: "check-up",
    translations: { en: { title: "Executive Check-up", summary: "Summary", includes: ["Consultation"], notIncluded: [], duration: "1 day", idealFor: "Adults", faq: [] }, tr: { title: "Yönetici Check-up", summary: "Özet", includes: [], notIncluded: [], duration: "1 gün", idealFor: "", faq: [] } },
    isActive: true,
    ...over,
  });

  async function createPackage(over: Record<string, unknown> = {}) {
    const res = await app.inject({ method: "POST", url: "/api/v1/admin/packages", headers: auth(admin.token), payload: pkgBody(over) });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().data as { id: string; slug: string };
  }

  function inquiry(slug: string, payload: Record<string, unknown>, headers: Record<string, string> = ORIGIN) {
    return app.inject({ method: "POST", url: `/api/v1/packages/${slug}/inquiries`, headers, payload: { locale: "de", consentContact: true, consentHealth: false, ...payload }, remoteAddress: nextIp() });
  }

  beforeAll(async () => {
    const { buildApp } = await import("../../src/app");
    app = await buildApp();
    await app.ready();
    await resetDatabase(app.prisma);
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
    admin = await user("ADMIN");
    manager = await user("MANAGER");
    editor = await user("EDITOR");
  });

  beforeEach(() => mailSpy.mockClear());

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
    vi.resetModules();
  });

  describe("paketler", () => {
    it("yalnızca aktif paketler listelenir; fiyat yalnızca showPrice açıkken; dil seçimi ve geri düşüş", async () => {
      const visible = await createPackage({ priceFrom: 450, currency: "EUR", showPrice: false });
      await createPackage({ isActive: false });
      const priced = await createPackage({ priceFrom: 900, showPrice: true, isFeatured: true });
      const list = (await app.inject({ method: "GET", url: "/api/v1/packages?locale=tr", remoteAddress: nextIp() })).json().data;
      const slugs = list.items.map((i: { slug: string }) => i.slug);
      expect(slugs).toEqual(expect.arrayContaining([visible.slug, priced.slug]));
      expect(list.items).toHaveLength(2);
      const byslug = (s: string) => list.items.find((i: { slug: string }) => i.slug === s);
      expect(byslug(visible.slug).price).toBeNull();
      expect(byslug(priced.slug).price).toEqual({ from: 900, currency: "EUR" });
      expect(byslug(visible.slug).title).toBe("Yönetici Check-up");
      const fr = (await app.inject({ method: "GET", url: `/api/v1/packages/${visible.slug}?locale=fr`, remoteAddress: nextIp() })).json().data;
      expect([fr.title, fr.contentLocale]).toEqual(["Executive Check-up", "en"]);
      const featured = (await app.inject({ method: "GET", url: "/api/v1/packages?featured=true", remoteAddress: nextIp() })).json().data.items;
      expect(featured.map((i: { slug: string }) => i.slug)).toEqual([priced.slug]);
      expect((await app.inject({ method: "GET", url: `/api/v1/packages/${(await createPackage({ isActive: false })).slug}`, remoteAddress: nextIp() })).statusCode).toBe(404);
    });

    it("ilgili hekimler: görünen ad kuralı + dilde unvan, yalnızca herkese açık hekimler, yönetici sırası", async () => {
      const specialty = await app.prisma.specialty.create({ data: { name: `Kardiyoloji ${crypto.randomUUID()}`, slug: `card-${crypto.randomUUID()}`, icon: "Heart" } });
      const mk = (fullName: string, extra: Record<string, unknown> = {}) =>
        app.prisma.doctorProfile.create({
          data: { title: "Assoc. Prof. Dr.", translations: { tr: { title: "Doç. Dr." } }, fullName, bio: "", slug: `x-${crypto.randomUUID().slice(0, 8)}`, languages: ["tr"], timeZone: "Europe/Istanbul", specialtyId: specialty.id, sessionDurationMin: 30, sessionPriceCents: 1, currency: "EUR", isActive: true, ...extra },
        });
      const a = await mk("Mehmet DEMİR");
      const b = await mk("Ayşe KAYA");
      const archived = await mk("Gizli HEKİM", { archivedAt: new Date() });
      const pkg = await createPackage({ relatedDoctorIds: [b.id, a.id, archived.id], relatedSpecialtyIds: [specialty.id] });
      const tr = (await app.inject({ method: "GET", url: `/api/v1/packages/${pkg.slug}?locale=tr`, remoteAddress: nextIp() })).json().data;
      expect(tr.relatedDoctors.map((d: { name: string; slug: string }) => [d.name, d.slug])).toEqual([
        ["Doç. Dr. A. Kaya", b.slug],
        ["Doç. Dr. M. Demir", a.slug],
      ]);
      expect(tr.relatedSpecialties).toEqual([{ slug: specialty.slug, name: specialty.name }]);
      const en = (await app.inject({ method: "GET", url: `/api/v1/packages/${pkg.slug}?locale=en`, remoteAddress: nextIp() })).json().data;
      expect(en.relatedDoctors[0].name).toBe("Assoc. Prof. Dr. A. Kaya");
    });

    it("admin: slug çakışması 409; showPrice açıkken fiyat zorunlu; EDITOR 403; silinince talep kalır (packageId boşalır)", async () => {
      const p = await createPackage();
      expect((await app.inject({ method: "POST", url: "/api/v1/admin/packages", headers: auth(admin.token), payload: pkgBody({ slug: p.slug }) })).statusCode).toBe(409);
      expect((await app.inject({ method: "POST", url: "/api/v1/admin/packages", headers: auth(admin.token), payload: pkgBody({ showPrice: true }) })).statusCode).toBe(422);
      expect((await app.inject({ method: "POST", url: "/api/v1/admin/packages", headers: auth(admin.token), payload: pkgBody({ category: "surgery" }) })).statusCode).toBe(422);
      expect((await app.inject({ method: "POST", url: "/api/v1/admin/packages", headers: auth(admin.token), payload: pkgBody({ translations: { en: { title: "<b>x</b>" } } }) })).statusCode).toBe(422);
      expect((await app.inject({ method: "GET", url: "/api/v1/admin/packages", headers: auth(editor.token) })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: "/api/v1/admin/packages", headers: auth(manager.token) })).statusCode).toBe(200);
      const sent = await inquiry(p.slug, { name: "Anna Müller", email: `anna-${crypto.randomUUID()}@example.com` });
      expect(sent.json().data.stored).toBe(true);
      expect((await app.inject({ method: "DELETE", url: `/api/v1/admin/packages/${p.id}`, headers: auth(admin.token) })).statusCode).toBe(204);
      const kept = await app.prisma.packageInquiry.findFirstOrThrow({ where: { packageSlug: p.slug } });
      expect([kept.packageId, kept.packageTitle]).toEqual([null, "Executive Check-up"]);
    });

    it("taslak seed: 8 paket, yalnızca EN, fiyatsız, isActive=false; kuru plan ve idempotent", async () => {
      const { buildSeedHealthPackagesPlan, applySeedHealthPackagesPlan } = await import("../../src/lib/health-packages-seed");
      const plan = await buildSeedHealthPackagesPlan(app.prisma);
      expect(plan.toCreate).toHaveLength(8);
      await expect(applySeedHealthPackagesPlan(app.prisma, plan, { confirm: "yanlis", operator: "Test" })).rejects.toThrow(/--confirm/);
      await expect(applySeedHealthPackagesPlan(app.prisma, plan, { confirm: "seed-health-packages", operator: " " })).rejects.toThrow(/--operator/);
      expect((await applySeedHealthPackagesPlan(app.prisma, plan, { confirm: "seed-health-packages", operator: "Test" })).created).toBe(8);
      const rows = await app.prisma.healthPackage.findMany({ where: { slug: { in: plan.toCreate.map((p) => p.slug) } } });
      expect(rows).toHaveLength(8);
      for (const r of rows) {
        expect([r.isActive, r.showPrice, r.priceFrom, Object.keys(r.translations as object)]).toEqual([false, false, null, ["en"]]);
      }
      expect((await buildSeedHealthPackagesPlan(app.prisma)).toCreate).toEqual([]);
      // Taslaklar sitede görünmez.
      const list = (await app.inject({ method: "GET", url: "/api/v1/packages", remoteAddress: nextIp() })).json().data.items;
      expect(list.map((i: { slug: string }) => i.slug)).not.toContain("executive-check-up");
    });
  });

  describe("Plan my package talebi", () => {
    let slug: string;
    beforeAll(async () => {
      slug = (await createPackage()).slug;
      await app.prisma.siteModule.upsert({ where: { key: "crm" }, create: { key: "crm", enabled: true, settings: { notificationEmail: "crm@example.com" } }, update: { settings: { notificationEmail: "crm@example.com" } } });
    });

    it("iletişim onayı yoksa HİÇBİR ŞEY kaydedilmez ve e-posta gitmez", async () => {
      const before = await app.prisma.crmLead.count();
      const res = await inquiry(slug, { name: "Anna Müller", email: "anna@example.com", note: "Kalp ritmi bozukluğum var", consentContact: false, consentHealth: true });
      expect([res.statusCode, res.json().data]).toEqual([201, { number: 0, stored: false }]);
      expect(await app.prisma.crmLead.count()).toBe(before);
      expect(mailSpy).not.toHaveBeenCalled();
    });

    it("rıza kuralları: not + sağlık onayı yok → 422; ad ve e-posta/telefon zorunlu; aynı-site Origin zorunlu; honeypot", async () => {
      expect((await inquiry(slug, { name: "Anna", email: "a@example.com", note: "Diyabet" })).json().error.details.consentHealth).toBeDefined();
      expect((await inquiry(slug, { email: "a@example.com" })).json().error.details.name).toBeDefined();
      expect((await inquiry(slug, { name: "Anna" })).json().error.details.email).toBeDefined();
      expect((await inquiry(slug, { name: "Anna", email: "a@example.com" }, {})).statusCode).toBe(403);
      const before = await app.prisma.crmLead.count();
      expect((await inquiry(slug, { name: "Bot", email: "b@example.com", website: "http://spam" })).statusCode).toBe(201);
      expect(await app.prisma.crmLead.count()).toBe(before);
    });

    it("kaydedilir: PACKAGE lead + talep; koordinatöre e-postada not/ad/sağlık YOK; hastaya kendi dilinde onay", async () => {
      await app.inject({
        method: "PUT",
        url: "/api/v1/admin/telehealth/settings/contact-channels",
        headers: auth(admin.token),
        payload: { whatsappEnabled: false, whatsappNumber: null, coordinatorEmail: "koordinator@example.com", whatsappMessages: {} },
      });
      const email = `hasta-${crypto.randomUUID()}@example.com`;
      const res = await inquiry(slug, { name: "Anna Müller", email, phoneCountry: "DE", phoneNumber: "1512 3456789", country: "DE", preferredDates: "2026-12-01 – 2026-12-10", travellers: 2, note: "Ich habe Diabetes Typ 2", consentHealth: true });
      expect(res.statusCode).toBe(201);
      const { number, stored } = res.json().data;
      expect(stored).toBe(true);
      const inq = await app.prisma.packageInquiry.findFirstOrThrow({ where: { seq: number }, include: { lead: true } });
      expect([inq.lead.channel, inq.lead.candidate, inq.lead.name, inq.lead.phone, inq.lead.language]).toEqual(["PACKAGE", false, "Anna Müller", "+4915123456789", "de"]);
      expect([inq.note, inq.travellers, inq.preferredDates, inq.consentHealthAt !== null]).toEqual(["Ich habe Diabetes Typ 2", 2, "2026-12-01 – 2026-12-10", true]);

      const mails = mailSpy.mock.calls.map((c) => c[1] as { to: string; subject: string; html: string; text: string });
      const staff = mails.find((m) => m.to === "koordinator@example.com")!;
      expect(staff.subject).toBe(`Yeni paket talebi #${number}`);
      expect(staff.html).toContain(`/admin/crm/leads/${inq.leadId}`);
      for (const secret of ["Anna", "Müller", "Diabetes", email, "1512"]) expect(staff.html + staff.text).not.toContain(secret);
      const patient = mails.find((m) => m.to === email)!;
      expect(patient.subject).toBe(`Wir haben Ihre Paketanfrage #${number} erhalten`);
      expect(patient.html).toContain('<html lang="de"');
      expect(patient.html).not.toContain("Diabetes");
      expect(mails.find((m) => m.to === "crm@example.com")).toBeUndefined(); // koordinatör adresi varken CRM adresine gitmez

      // CRM ayrıntısında paket talebi.
      const detail = (await app.inject({ method: "GET", url: `/api/v1/admin/crm/leads/${inq.leadId}`, headers: auth(admin.token) })).json().data;
      expect(detail.channel).toBe("PACKAGE");
      expect(detail.packageInquiry).toMatchObject({ number, packageSlug: slug, travellers: 2, note: "Ich habe Diabetes Typ 2" });
    });

    it("inceleme düzeltmeleri: tarih serbest metin değil; sağlık onayı yalnızca notla; rıza sürümü; tekrar gönderim; onay geri çekme; denetim izi", async () => {
      // Tarih alanına serbest metin (sağlık bilgisi) yazılamaz.
      expect((await inquiry(slug, { name: "Anna", email: "d@example.com", preferredDates: "after my surgery" })).statusCode).toBe(422);
      // Sağlık onayı işaretli ama not yok → onay kaydı yazılmaz; rıza metni sürümü saklanır.
      const email = `dup-${crypto.randomUUID()}@example.com`;
      const first = await inquiry(slug, { name: "Anna", email, preferredDates: "2026-12-01", consentHealth: true });
      const row = await app.prisma.packageInquiry.findFirstOrThrow({ where: { seq: first.json().data.number } });
      expect([row.consentHealthAt, row.consentTextVersion, row.preferredDates]).toEqual([null, "package-v1", "2026-12-01"]);
      // 10 dk içinde aynı kişi + aynı paket: yeni talep açılmaz, e-posta tekrar gitmez.
      mailSpy.mockClear();
      const leadsBefore = await app.prisma.crmLead.count();
      const again = await inquiry(slug, { name: "Anna", email });
      expect(again.json().data).toEqual({ number: first.json().data.number, stored: true });
      expect(await app.prisma.crmLead.count()).toBe(leadsBefore);
      expect(mailSpy).not.toHaveBeenCalled();
      // Onay e-postasında silme / rıza geri çekme yolu.
      const withNote = await inquiry(slug, { name: "Ben", email: `note-${crypto.randomUUID()}@example.com`, note: "Allergic to penicillin", consentHealth: true, locale: "en" });
      const patientMail = mailSpy.mock.calls.map((c) => c[1] as { subject: string; html: string }).find((m) => m.subject.startsWith("We have received your package request"))!;
      expect(patientMail.html).toContain("withdraw your consent");
      // Admin görüntüleyince denetim izine "sağlık notu görüntülendi"; onay geri çekilince not silinir.
      const inq = await app.prisma.packageInquiry.findFirstOrThrow({ where: { seq: withNote.json().data.number } });
      await app.inject({ method: "GET", url: `/api/v1/admin/crm/leads/${inq.leadId}`, headers: auth(admin.token) });
      const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: "crm.lead.viewed", targetId: inq.leadId }, orderBy: { createdAt: "desc" } });
      expect(audit.metadata).toEqual({ healthNoteViewed: true });
      const w = await app.inject({ method: "POST", url: `/api/v1/admin/crm/leads/${inq.leadId}/package-inquiry/withdraw-health-consent`, headers: auth(admin.token) });
      expect(w.statusCode).toBe(200);
      const after = await app.prisma.packageInquiry.findUniqueOrThrow({ where: { id: inq.id } });
      expect([after.note, after.consentHealthAt]).toEqual([null, null]);
      expect(await app.prisma.auditLog.count({ where: { action: "crm.package_inquiry.health_consent_withdrawn", targetId: inq.leadId } })).toBe(1);
    });

    it("hız sınırı: aynı IP'den dakikada 5'ten fazla talep 429", async () => {
      const ip = "10.93.0.1";
      const codes: number[] = [];
      for (let i = 0; i < 6; i++) {
        codes.push(
          (await app.inject({ method: "POST", url: `/api/v1/packages/${slug}/inquiries`, headers: ORIGIN, payload: { locale: "en", consentContact: false, consentHealth: false }, remoteAddress: ip })).statusCode
        );
      }
      expect(codes.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
      expect(codes[5]).toBe(429);
    });

    it("saklama: not 365 gün sonra silinir; lead anonimleşince tarih/kişi sayısı da silinir", async () => {
      const res = await inquiry(slug, { name: "Old Patient", email: `old-${crypto.randomUUID()}@example.com`, note: "Eski not", consentHealth: true, travellers: 3 });
      const inq = await app.prisma.packageInquiry.findFirstOrThrow({ where: { seq: res.json().data.number } });
      const { anonymizeExpiredLeads } = await import("../../src/modules/crm/crm.leads");
      await anonymizeExpiredLeads(app, new Date(Date.now() + 366 * 86_400_000));
      const after = await app.prisma.packageInquiry.findUniqueOrThrow({ where: { id: inq.id } });
      expect(after.note).toBeNull();
      await anonymizeExpiredLeads(app, new Date(Date.now() + 3000 * 86_400_000));
      const anon = await app.prisma.packageInquiry.findUniqueOrThrow({ where: { id: inq.id } });
      expect([anon.travellers, anon.preferredDates, anon.anonymizedAt !== null]).toEqual([null, null, true]);
    });
  });

  describe("iletişim kanalları (WhatsApp)", () => {
    const put = (token: string, payload: Record<string, unknown>) => app.inject({ method: "PUT", url: "/api/v1/admin/telehealth/settings/contact-channels", headers: auth(token), payload });
    const pub = async (locale: string) => (await app.inject({ method: "GET", url: `/api/v1/contact-channels?locale=${locale}`, remoteAddress: nextIp() })).json().data;

    it("varsayılan kapalı: numara yokken whatsapp null; açmak için numara zorunlu; yalnızca {package} yer tutucusu; PUT yalnızca ADMIN", async () => {
      await put(admin.token, { whatsappEnabled: false, whatsappNumber: null, coordinatorEmail: null, whatsappMessages: {} });
      expect((await pub("en")).whatsapp).toBeNull();
      expect((await put(admin.token, { whatsappEnabled: true, whatsappNumber: null, coordinatorEmail: null, whatsappMessages: {} })).statusCode).toBe(422);
      expect((await put(admin.token, { whatsappEnabled: true, whatsappNumber: "0555 000 00 00", coordinatorEmail: null, whatsappMessages: {} })).statusCode).toBe(422);
      expect((await put(admin.token, { whatsappEnabled: true, whatsappNumber: "+905550000000", coordinatorEmail: null, whatsappMessages: { en: "Hi {name}, {package}" } })).statusCode).toBe(422);
      expect((await put(manager.token, { whatsappEnabled: false, whatsappNumber: null, coordinatorEmail: null, whatsappMessages: {} })).statusCode).toBe(403);
      // Numara girildi ama kapalı → yine görünmez.
      await put(admin.token, { whatsappEnabled: false, whatsappNumber: "+905550000000", coordinatorEmail: null, whatsappMessages: {} });
      expect((await pub("en")).whatsapp).toBeNull();
    });

    it("açık ve numaralı: rakamlar + dilde hazır şablon (özel mesaj yoksa varsayılan)", async () => {
      expect((await put(admin.token, { whatsappEnabled: true, whatsappNumber: "+905550000000", coordinatorEmail: null, whatsappMessages: { tr: "Merhaba, {package} paketini soruyorum." } })).statusCode).toBe(200);
      expect((await pub("tr")).whatsapp).toEqual({ number: "905550000000", message: "Merhaba, {package} paketini soruyorum." });
      expect((await pub("de")).whatsapp).toEqual({ number: "905550000000", message: "Hallo, ich interessiere mich für {package}." });
      await put(admin.token, { whatsappEnabled: false, whatsappNumber: null, coordinatorEmail: null, whatsappMessages: {} });
    });
  });

  describe("Top destinations", () => {
    const destBody = (over: Record<string, unknown> = {}) => ({
      slug: `istanbul-${crypto.randomUUID().slice(0, 6)}`,
      city: "Istanbul",
      translations: { en: { title: "Istanbul", summary: "", highlights: [] } },
      topTreatments: [{ label: { en: "Check-up", tr: "Check-up" }, priceFrom: 300, currency: "EUR" }],
      isActive: true,
      ...over,
    });

    it("kayıt yokken boş; hasta sayısı boşken null; fiyat yalnızca showPrices açıkken; en çok 3 tedavi", async () => {
      await app.prisma.destinationHighlight.deleteMany({});
      expect((await app.inject({ method: "GET", url: "/api/v1/destinations", remoteAddress: nextIp() })).json().data.items).toEqual([]);
      const create = (over: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/v1/admin/destinations", headers: auth(admin.token), payload: destBody(over) });
      expect((await create({})).statusCode).toBe(201);
      expect((await create({ showPrices: true, patientCountLastYear: 1200, dataPeriodLabel: "Nov 2025 – Oct 2026", sortOrder: 1 })).statusCode).toBe(201);
      expect((await create({ isActive: false })).statusCode).toBe(201);
      expect((await create({ topTreatments: Array(4).fill({ label: { en: "x" }, priceFrom: null, currency: "EUR" }) })).statusCode).toBe(422);
      const items = (await app.inject({ method: "GET", url: "/api/v1/destinations?locale=tr", remoteAddress: nextIp() })).json().data.items;
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({ patientCountLastYear: null, dataPeriodLabel: null, treatments: [{ label: "Check-up", price: null }] });
      expect(items[1]).toMatchObject({ patientCountLastYear: 1200, dataPeriodLabel: "Nov 2025 – Oct 2026", treatments: [{ label: "Check-up", price: { from: 300, currency: "EUR" } }] });
    });
  });

  describe("anonim görüntülenme sayacı (kullanıcı kararı 2026-11-01)", () => {
    const view = (payload: Record<string, unknown>, headers: Record<string, string> = ORIGIN) =>
      app.inject({ method: "POST", url: "/api/v1/packages/views", headers, payload, remoteAddress: nextIp() });

    it("yalnızca kimliksiz günlük toplam artar; pasif/bilinmeyen paket sayılmaz; CRM'e kişi bazında hiçbir şey yazılmaz", async () => {
      await app.prisma.packageViewStat.deleteMany();
      const active = await createPackage();
      const draft = await createPackage({ isActive: false });
      const [visitors, events] = await Promise.all([app.prisma.crmVisitor.count(), app.prisma.crmEvent.count()]);

      for (const payload of [{ kind: "list" }, { kind: "list" }, { kind: "package", slug: active.slug }, { kind: "destinations" }, { kind: "package", slug: draft.slug }, { kind: "package", slug: "yok" }, { kind: "package" }]) {
        expect((await view(payload)).statusCode, JSON.stringify(payload)).toBe(204);
      }
      expect((await view({ kind: "list", vid: "abc" })).statusCode).toBe(422);
      expect((await view({ kind: "doctor" })).statusCode).toBe(422);
      expect((await view({ kind: "list" }, {})).statusCode).toBe(403);

      const rows = await app.prisma.packageViewStat.findMany({ orderBy: [{ kind: "asc" }, { key: "asc" }] });
      expect(rows.map((r) => [r.kind, r.key, r.count])).toEqual([
        ["destinations", "all", 1],
        ["list", "all", 2],
        ["package", active.slug, 1],
      ]);
      // Tablo şemasında kişi/oturum/IP alanı yok; CRM ham verisi değişmedi.
      expect(Object.keys(rows[0]!).sort()).toEqual(["count", "day", "key", "kind"]);
      expect([await app.prisma.crmVisitor.count(), await app.prisma.crmEvent.count()]).toEqual([visitors, events]);

      const summary = await app.inject({ method: "GET", url: "/api/v1/admin/packages/view-stats", headers: auth(manager.token) });
      expect(summary.statusCode).toBe(200);
      expect(summary.json().data).toEqual({ days: 90, list: 2, destinations: 1, packages: { [active.slug]: 1 } });
      expect((await app.inject({ method: "GET", url: "/api/v1/admin/packages/view-stats", headers: auth(editor.token) })).statusCode).toBe(403);
    });

    it("saklama: 90 günden eski satırlar silinir", async () => {
      const { purgeOldPackageViewStats } = await import("../../src/modules/packages/packages.stats");
      await app.prisma.packageViewStat.deleteMany();
      const day = (daysAgo: number) => new Date(`${new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)}T00:00:00Z`);
      await app.prisma.packageViewStat.createMany({ data: [{ day: day(120), kind: "list", key: "all", count: 5 }, { day: day(10), kind: "list", key: "all", count: 3 }] });
      expect(await purgeOldPackageViewStats(app)).toBe(1);
      expect((await app.prisma.packageViewStat.findMany()).map((r) => r.count)).toEqual([3]);
    });

    it("paket yolları CRM'de her zaman hariç (ön yüz ile aynı liste)", async () => {
      const { isExcludedPath: isCrmExcludedPath } = await import("../../src/modules/crm/crm.privacy");
      for (const path of ["/packages", "/en/packages", "/tr/packages/executive", "/sr-latn/packages/x"]) expect(isCrmExcludedPath(path), path).toBe(true);
      expect(isCrmExcludedPath("/en/packaging")).toBe(false);
      expect(isCrmExcludedPath("/en")).toBe(false);
    });
  });

  it("CRM varsayılanı: WhatsApp Ref kodu açık (kod yalnızca onaylı izleyicide eklenir)", async () => {
    const { DEFAULT_CRM_SETTINGS } = await import("../../src/modules/crm/crm.settings");
    expect(DEFAULT_CRM_SETTINGS.whatsappRef).toBe(true);
  });

  it("telehealth modülü kapalıyken herkese açık uçlar 404", async () => {
    await app.prisma.siteModule.update({ where: { key: "telehealth" }, data: { enabled: false } });
    try {
      for (const url of ["/api/v1/packages", "/api/v1/destinations", "/api/v1/contact-channels"]) {
        expect((await app.inject({ method: "GET", url, remoteAddress: nextIp() })).statusCode, url).toBe(404);
      }
    } finally {
      await app.prisma.siteModule.update({ where: { key: "telehealth" }, data: { enabled: true } });
    }
  });
});
