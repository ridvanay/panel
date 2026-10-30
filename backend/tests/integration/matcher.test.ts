import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { resetDatabase } from "../helpers/reset-db";

/**
 * Paket W — "Find my physician": katalog, öneri (hekimsiz uzmanlık düşülür, eşik, sıralama), kırmızı
 * bayrak, gönderim (rıza kuralları, E.164, honeypot, hız sınırı), bildirim içeriği (şikayet YOK),
 * geri arama anahtarı, CRM kanal filtresi + yetkili kart + audit, saklama anonimleştirmesi, admin
 * katalog/önizleme/rapor/ayarlar ve seed betiği.
 */
let ipCounter = 0;
const nextIp = () => `10.60.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const ORIGIN = { origin: "http://localhost:3000" };

const mailSpy = vi.fn();
vi.mock("../../src/lib/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/mail")>();
  return { ...actual, sendMail: (...args: unknown[]) => (mailSpy(...args), Promise.resolve({ messageId: "test" })) };
});

describe("matcher — hekim eşleştirme sihirbazı (Paket W)", () => {
  let app: FastifyInstance;
  let admin: { id: string; token: string };
  let manager: { id: string; token: string };
  const sp = { gas: "", obe: "", onc: "", ir: "", ivf: "", den: "", ort: "", neu: "" } as Record<"gas" | "obe" | "onc" | "ir" | "ivf" | "den" | "ort" | "neu", string>;
  const topic = { reflux: "", hiatal: "", fibroid: "", abscess: "", headache: "", neck: "", chestPain: "", braces: "" };

  async function user(role: "ADMIN" | "MANAGER" | "USER", twoFactor = true) {
    const { hashPassword } = await import("../../src/lib/password");
    const { signAccessToken } = await import("../../src/lib/jwt");
    const u = await app.prisma.user.create({
      data: { email: `w-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`, name: `W ${role}`, passwordHash: await hashPassword("Sifre12345!"), role, status: "ACTIVE", emailVerifiedAt: new Date(), twoFactorEnabled: twoFactor },
    });
    return { id: u.id, token: signAccessToken({ sub: u.id, email: u.email }).token };
  }

  async function doctor(opts: { slug: string; specialty: keyof typeof sp; additional?: (keyof typeof sp)[]; languages?: string[]; fullName: string; withAvailability?: boolean; isFounder?: boolean }) {
    const d = await app.prisma.doctorProfile.create({
      data: {
        title: "Op. Dr.",
        fullName: opts.fullName,
        bio: "Test.",
        slug: opts.slug,
        languages: opts.languages ?? ["tr"],
        timeZone: "Europe/Istanbul",
        specialtyId: sp[opts.specialty]!,
        sessionDurationMin: 30,
        sessionPriceCents: 50000,
        currency: "EUR",
        isActive: true,
        isFounder: opts.isFounder ?? false,
        additionalSpecialties: opts.additional ? { create: opts.additional.map((s) => ({ specialtyId: sp[s]! })) } : undefined,
        availability: opts.withAvailability === false ? undefined : { create: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({ dayOfWeek, startMinute: 0, endMinute: 24 * 60, isActive: true })) },
      },
    });
    return d.id;
  }

  async function recommendReq(topicIds: string[], preferredLanguage = "tr") {
    return app.inject({ method: "POST", url: "/api/v1/matcher/recommend", headers: ORIGIN, payload: { topicIds, preferredLanguage, locale: "tr" }, remoteAddress: nextIp() });
  }

  function submitPayload(over: Record<string, unknown> = {}) {
    return {
      locale: "tr",
      name: "Ayşe Yılmaz",
      age: 42,
      email: `hasta-${crypto.randomUUID()}@example.com`,
      phoneCountry: "TR",
      phoneNumber: "0532 123 45 67",
      country: "TR",
      timeZone: "Europe/Istanbul",
      forWhom: "self",
      duration: "1to6m",
      priorDiagnosis: "no",
      preference: "online",
      preferredLanguage: "tr",
      topicIds: [topic.reflux],
      freeText: "Yemekten sonra yanma oluyor",
      consentHealth: true,
      consentContact: true,
      ...over,
    };
  }

  function submit(payload: Record<string, unknown>, ip = nextIp()) {
    return app.inject({ method: "POST", url: "/api/v1/matcher/submit", headers: ORIGIN, payload, remoteAddress: ip });
  }

  beforeAll(async () => {
    vi.resetModules();
    const { buildApp } = await import("../../src/app");
    app = buildApp();
    await app.ready();
    await resetDatabase(app.prisma);
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
    admin = await user("ADMIN");
    manager = await user("MANAGER");
    for (const [key, slug] of [
      ["gas", "gastroenterology"],
      ["obe", "obesity-and-metabolic-surgery"],
      ["onc", "surgical-oncology"],
      ["ir", "interventional-radiology-specialist"],
      ["ivf", "ivf-and-reproductive-health"],
      ["den", "dentalcare"],
      ["ort", "orthodontist"],
      ["neu", "neurosurgery"],
    ] as const) {
      sp[key] = (await app.prisma.specialty.create({ data: { name: slug, slug, icon: "Heart" } })).id;
    }
    // Seed betiği gerçek katalogla (dentalcare/neurosurgery hekimsiz).
    const { buildSeedCareTopicsPlan, applySeedCareTopicsPlan } = await import("../../src/lib/care-topics/seed");
    const plan = await buildSeedCareTopicsPlan(app.prisma);
    await applySeedCareTopicsPlan(app.prisma, plan, { confirm: "seed-care-topics", operator: "Test", osUser: "t", hostname: "h" });
    const bySlug = async (slug: string) => (await app.prisma.careTopic.findUniqueOrThrow({ where: { slug } })).id;
    topic.reflux = await bySlug("reflux-heartburn");
    topic.hiatal = await bySlug("hiatal-hernia");
    topic.fibroid = await bySlug("uterine-fibroids");
    topic.abscess = await bySlug("dental-abscess");
    topic.headache = await bySlug("headache-migraine");
    topic.neck = await bySlug("neck-pain");
    topic.chestPain = await bySlug("rf-chest-pain-breathless");
    topic.braces = await bySlug("braces-crooked-teeth");

    await doctor({ slug: "gas-tr", specialty: "gas", fullName: "Ali Veli", languages: ["tr"] });
    await doctor({ slug: "gas-ar", specialty: "gas", fullName: "Zeki Arap", languages: ["ar", "en"] });
    await doctor({ slug: "obe-ek-gas", specialty: "obe", additional: ["gas"], fullName: "Can Obez", languages: ["tr"] });
    await doctor({ slug: "gas-nosched", specialty: "gas", fullName: "Bora Boş", languages: ["tr"], withAvailability: false });
    await doctor({ slug: "onc-1", specialty: "onc", fullName: "Onur Onk", languages: ["tr"], isFounder: true });
    await doctor({ slug: "ir-1", specialty: "ir", fullName: "İrem Rad", languages: ["tr"] });
    await doctor({ slug: "ort-1", specialty: "ort", fullName: "Orhan Tel", languages: ["tr"] });
  });

  beforeEach(() => mailSpy.mockClear());

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
    vi.resetModules();
  });

  describe("seed ve katalog", () => {
    it("seed: 110 konu, ağırlıklar slug ile bağlanır, kırmızı bayrak eşlenmez; ikinci çalıştırma hiçbir şey eklemez", async () => {
      expect(await app.prisma.careTopic.count()).toBe(110);
      expect(await app.prisma.careTopic.count({ where: { isRedFlag: true } })).toBe(8);
      const fibroid = await app.prisma.careTopicSpecialty.findMany({ where: { topicId: topic.fibroid }, include: { specialty: true } });
      expect(Object.fromEntries(fibroid.map((f) => [f.specialty.slug, f.weight]))).toEqual({ "surgical-oncology": 70, "interventional-radiology-specialist": 50, "ivf-and-reproductive-health": 30 });
      expect(await app.prisma.careTopicSpecialty.count({ where: { topic: { isRedFlag: true } } })).toBe(0);
      const { buildSeedCareTopicsPlan } = await import("../../src/lib/care-topics/seed");
      const again = await buildSeedCareTopicsPlan(app.prisma);
      expect([again.toCreate.length, again.existing.length]).toEqual([0, 110]);
    });

    it("GET /matcher/topics: aktif dil + EN eş anlamlıları; kırmızı bayrakta tüm dillerin terimleri; iletişim ayarı", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/matcher/topics?lang=de", remoteAddress: nextIp() });
      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect(data.contactRequired).toBe(true);
      const reflux = data.topics.find((t: { slug: string }) => t.slug === "reflux-heartburn");
      expect(reflux.synonyms.map((s: string) => s.toLowerCase())).toContain("sodbrennen");
      const chest = data.topics.find((t: { slug: string }) => t.slug === "rf-chest-pain-breathless");
      expect(chest.isRedFlag).toBe(true);
      expect(chest.synonyms.length).toBeGreaterThan(40);
    });
  });

  describe("öneri", () => {
    it("reflü: gastroenteroloji önerilir; hekimler birincil > ek, dil, en yakın slot; 3 hekim × en çok 3 slot; kişisel veri almaz", async () => {
      const res = await recommendReq([topic.reflux], "tr");
      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      expect([data.redFlag, data.coordinator]).toEqual([false, false]);
      expect(data.specialties.map((s: { slug: string }) => s.slug)).toEqual(["gastroenterology", "obesity-and-metabolic-surgery"]);
      const slugs = data.doctors.map((d: { slug: string }) => d.slug);
      // Hepsi birincil eşleşme (GAS ve OBE önerilen); TR konuşan + slotlu önce, eşitlikte ad; slotsuz sonra; TR konuşmayan en sona.
      expect(slugs).toEqual(["gas-tr", "obe-ek-gas", "gas-nosched"]);
      expect(slugs).toHaveLength(3);
      expect(slugs).not.toContain("onc-1");
      for (const d of data.doctors) expect(d.slots.length).toBeLessThanOrEqual(3);
      expect(data.doctors[0].slots).toHaveLength(3);
      expect(data.doctors[0].displayName).toBe("A. Veli");
      // Randevu bağlantısı ?specialty=: birincil uzmanlık önerilenlerdeyse o; ek uzmanlıkla eşleşen hekimde eşleşen ek uzmanlık.
      expect(data.doctors.map((d: { matchedSpecialtySlug: string }) => d.matchedSpecialtySlug)).toEqual(["gastroenterology", "obesity-and-metabolic-surgery", "gastroenterology"]);
      // Arapça konuşan hasta: dil eşleşmesi öne alır.
      const ar = (await recommendReq([topic.reflux], "ar")).json().data;
      expect(ar.doctors[0].slug).toBe("gas-ar");
      expect(await app.prisma.matcherSubmission.count()).toBe(0);
      expect((await app.prisma.matcherStat.findMany({ where: { kind: "topic", key: "reflux-heartburn" } }))[0]!.count).toBeGreaterThanOrEqual(2);
    });

    it("hekimi olmayan uzmanlık düşülür (diş apsesi → dentalcare hekimsiz → koordinatör); baş ağrısı koordinatör; eşik altı koordinatör", async () => {
      const abscess = (await recommendReq([topic.abscess])).json().data;
      expect([abscess.coordinator, abscess.specialties.length]).toEqual([true, 0]);
      expect((await recommendReq([topic.headache])).json().data.coordinator).toBe(true);
      // Boyun ağrısı: yalnızca neurosurgery 70 ve hekimi yok → koordinatör.
      expect((await recommendReq([topic.neck])).json().data.coordinator).toBe(true);
      // Ortodonti konusu yalnızca orthodontist'e.
      const braces = (await recommendReq([topic.braces])).json().data;
      expect(braces.specialties.map((s: { slug: string }) => s.slug)).toEqual(["orthodontist"]);
      // Miyom: ONC 70 > IR 50 (IVF 30 eşik altı ve hekimsiz) → en çok 2.
      const fibroid = (await recommendReq([topic.fibroid])).json().data;
      expect(fibroid.specialties.map((s: { slug: string }) => s.slug)).toEqual(["surgical-oncology", "interventional-radiology-specialist"]);
    });

    it("kırmızı bayrak seçilince öneri yok, redFlag=true; en çok 3 konu", async () => {
      const res = (await recommendReq([topic.reflux, topic.chestPain])).json().data;
      expect([res.redFlag, res.redFlagTopicSlugs, res.doctors.length]).toEqual([true, ["rf-chest-pain-breathless"], 0]);
      expect((await recommendReq([topic.reflux, topic.hiatal, topic.fibroid, topic.abscess])).statusCode).toBe(422);
    });
  });

  describe("gönderim", () => {
    it("sağlık rızasıyla: lead (MATCHER) + talep; E.164 telefon; öneri sunucuda; bildirimde şikayet metni yok; kullanıcıya kendi dilinde onay", async () => {
      await app.prisma.siteModule.upsert({ where: { key: "crm" }, create: { key: "crm", enabled: true, settings: { notificationEmail: "koordinator@example.com" } }, update: { settings: { notificationEmail: "koordinator@example.com" } } });
      const payload = submitPayload({ locale: "de" });
      const res = await submit(payload);
      expect(res.statusCode).toBe(201);
      const { id, number, token } = res.json().data;
      expect(number).toBeGreaterThan(0);
      expect(token.length).toBeGreaterThan(20);
      const sub = await app.prisma.matcherSubmission.findUniqueOrThrow({ where: { id }, include: { lead: true } });
      expect(sub.lead.channel).toBe("MATCHER");
      expect(sub.lead.phone).toBe("+905321234567");
      expect(sub.lead.specialtyName).toBe("gastroenterology");
      expect(sub.topicIds).toEqual([topic.reflux]);
      expect(sub.freeText).toBe("Yemekten sonra yanma oluyor");
      expect(sub.ageBand).toBe("30-44");
      expect(sub.recommendedDoctorIds).toHaveLength(3);
      expect(sub.consentHealthAt).not.toBeNull();
      expect(sub.consentContactAt).not.toBeNull();
      expect(sub.accessTokenHash).not.toBe(token);

      const mails = mailSpy.mock.calls.map((c) => c[1] as { to: string; subject: string; html: string });
      const toAdmin = mails.find((m) => m.to === "koordinator@example.com")!;
      expect(toAdmin.subject).toBe(`Yeni eşleştirme talebi #${number}`);
      expect(toAdmin.html).toContain(`/admin/crm/leads/${sub.leadId}`);
      const toUser = mails.find((m) => m.to === payload.email)!;
      expect(toUser.subject).toBe(`Wir haben Ihre Anfrage #${number} erhalten`);
      for (const m of mails) {
        expect(m.html).not.toContain("yanma");
        expect(m.html).not.toContain("gastroenterology");
        expect(m.subject).not.toContain("yanma");
      }
    });

    it("(a) sağlık rızası yoksa sağlık alanları ve öneriler kaydedilmez", async () => {
      const termsBefore = await app.prisma.matcherStat.aggregate({ where: { kind: "unmatched_term" }, _sum: { count: true } });
      const res = await submit(submitPayload({ consentHealth: false }));
      const sub = await app.prisma.matcherSubmission.findUniqueOrThrow({ where: { id: res.json().data.id }, include: { lead: true } });
      expect([sub.topicIds, sub.freeText, sub.ageBand, sub.duration, sub.priorDiagnosis, sub.recommendedSpecialtyIds]).toEqual([[], null, null, null, null, []]);
      expect(sub.consentHealthAt).toBeNull();
      expect(sub.consentContactAt).not.toBeNull();
      expect([sub.lead.specialtyId, sub.lead.doctorId]).toEqual([null, null]);
      const termsAfter = await app.prisma.matcherStat.aggregate({ where: { kind: "unmatched_term" }, _sum: { count: true } });
      expect(termsAfter._sum.count).toBe(termsBefore._sum.count);
    });

    it("(b) iletişim izni yoksa ad, telefon, e-posta (ve sağlık bilgisi) KAYDEDİLMEZ; lead/talep yok, e-posta gitmez; yalnızca anonim sayaç", async () => {
      const email = `izinsiz-${crypto.randomUUID()}@example.com`;
      const leadsBefore = await app.prisma.crmLead.count();
      const subsBefore = await app.prisma.matcherSubmission.count();
      const statBefore = (await app.prisma.matcherStat.findMany({ where: { kind: "submit", key: "not_stored" } })).reduce((n, r) => n + r.count, 0);
      const res = await submit(submitPayload({ consentContact: false, email, name: "İzinsiz Kişi" }));
      expect(res.statusCode).toBe(201);
      expect(res.json().data).toMatchObject({ number: 0, token: "", stored: false });
      expect([await app.prisma.crmLead.count(), await app.prisma.matcherSubmission.count()]).toEqual([leadsBefore, subsBefore]);
      expect(await app.prisma.crmLead.count({ where: { OR: [{ email }, { name: "İzinsiz Kişi" }] } })).toBe(0);
      expect(mailSpy).not.toHaveBeenCalled();
      const statAfter = (await app.prisma.matcherStat.findMany({ where: { kind: "submit", key: "not_stored" } })).reduce((n, r) => n + r.count, 0);
      expect(statAfter - statBefore).toBe(1);
      // İzin yokken ad/e-posta gönderilmese de kabul edilir (doğrulama yalnızca kayıt varsa).
      const minimal = await submit({ locale: "tr", forWhom: "self", preference: "either", preferredLanguage: "tr", topicIds: [], consentHealth: false, consentContact: false });
      expect(minimal.json().data.stored).toBe(false);
    });

    it("doğrulama: e-posta/telefon en az biri, telefon ülke koduyla, 18 yaş altı veli adı, kırmızı bayrak onayı (seçim ve serbest metin)", async () => {
      const bad = async (over: Record<string, unknown>) => (await submit(submitPayload(over))).json().error.details;
      expect(await bad({ email: undefined, phoneNumber: undefined })).toHaveProperty("email");
      expect(await bad({ phoneNumber: "12" })).toHaveProperty("phoneNumber");
      expect(await bad({ age: 15 })).toHaveProperty("guardianName");
      expect(await bad({ topicIds: [topic.chestPain] })).toEqual({ redFlag: ["ACK_REQUIRED"] });
      expect(await bad({ freeText: "Dün gece nefes alamıyorum diye uyandı" })).toEqual({ redFlag: ["ACK_REQUIRED"] });
      const ok = await submit(submitPayload({ age: 15, guardianName: "Veli Ad", freeText: "nefes alamıyorum", redFlagAcknowledged: true }));
      expect(ok.statusCode).toBe(201);
      const sub = await app.prisma.matcherSubmission.findUniqueOrThrow({ where: { id: ok.json().data.id } });
      expect(sub.redFlagAcknowledgedAt).not.toBeNull();
      expect(sub.guardianName).toBe("Veli Ad");
      expect(sub.ageBand).toBe("0-17");
      expect(sub.birthYear).toBeNull();
    });

    it("honeypot: sahte başarı, hiçbir şey yazılmaz ve e-posta gitmez; hız sınırı 5/dk; serbest metinde HTML temizlenir", async () => {
      const before = await app.prisma.crmLead.count();
      const res = await submit(submitPayload({ website: "http://spam" }));
      expect(res.statusCode).toBe(201);
      expect(res.json().data.number).toBeGreaterThanOrEqual(1000);
      expect(await app.prisma.crmLead.count()).toBe(before);
      expect(mailSpy).not.toHaveBeenCalled();

      const ip = "10.99.99.99";
      const codes: number[] = [];
      for (let i = 0; i < 6; i++) codes.push((await submit(submitPayload({ freeText: "<img src=x onerror=alert(1)>boyun" }), ip)).statusCode);
      expect(codes.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
      expect(codes[5]).toBe(429);
      const last = await app.prisma.matcherSubmission.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
      expect(last.freeText).toBe("boyun");
    });

    it("geri arama: doğru anahtarla callback + lead nextActionAt; yanlış anahtar 404", async () => {
      const { id, token } = (await submit(submitPayload())).json().data;
      expect((await app.inject({ method: "POST", url: `/api/v1/matcher/submissions/${id}/callback`, headers: ORIGIN, payload: { token: "x".repeat(32), consentContact: true }, remoteAddress: nextIp() })).statusCode).toBe(404);
      const res = await app.inject({ method: "POST", url: `/api/v1/matcher/submissions/${id}/callback`, headers: ORIGIN, payload: { token, consentContact: true }, remoteAddress: nextIp() });
      expect(res.statusCode).toBe(204);
      const sub = await app.prisma.matcherSubmission.findUniqueOrThrow({ where: { id }, include: { lead: true } });
      expect(sub.callbackRequestedAt).not.toBeNull();
      expect(sub.consentContactAt).not.toBeNull();
      expect(sub.lead.nextActionAt).not.toBeNull();
    });

    it("adım sayacı anonim (kişi verisi yok)", async () => {
      for (const step of ["1", "2", "red_flag"]) {
        expect((await app.inject({ method: "POST", url: "/api/v1/matcher/progress", headers: ORIGIN, payload: { step }, remoteAddress: nextIp() })).statusCode).toBe(204);
      }
      expect((await app.inject({ method: "POST", url: "/api/v1/matcher/progress", headers: ORIGIN, payload: { step: "1", email: "a@b.c" }, remoteAddress: nextIp() })).statusCode).toBe(422);
      const stats = await app.prisma.matcherStat.findMany({ where: { kind: { in: ["step", "red_flag"] } } });
      expect(JSON.stringify(stats)).not.toMatch(/@/);
    });
  });

  describe("CRM, admin ve saklama", () => {
    it("lead listesinde MATCHER kanalı filtresi; sihirbaz kartı yalnızca CRM yetkisiyle (ADMIN+2FA) ve audit'li", async () => {
      const { id } = (await submit(submitPayload())).json().data;
      const sub = await app.prisma.matcherSubmission.findUniqueOrThrow({ where: { id } });
      const list = await app.inject({ method: "GET", url: "/api/v1/admin/crm/leads?channel=MATCHER", headers: auth(admin.token) });
      expect(list.statusCode).toBe(200);
      expect(list.json().data.items ?? list.json().data).toBeDefined();
      expect(JSON.stringify(list.json())).toContain(sub.leadId);

      const card = await app.inject({ method: "GET", url: `/api/v1/admin/matcher/leads/${sub.leadId}`, headers: auth(admin.token) });
      expect(card.statusCode).toBe(200);
      expect(card.json().data.topics[0].slug).toBe("reflux-heartburn");
      expect(card.json().data.freeText).toBe("Yemekten sonra yanma oluyor");
      expect(await app.prisma.auditLog.count({ where: { action: "crm.lead.matcher_viewed", targetId: sub.leadId } })).toBe(1);
      expect((await app.inject({ method: "GET", url: `/api/v1/admin/matcher/leads/${sub.leadId}`, headers: auth(manager.token) })).statusCode).toBe(403);
      const no2fa = await user("ADMIN", false);
      expect((await app.inject({ method: "GET", url: `/api/v1/admin/matcher/leads/${sub.leadId}`, headers: auth(no2fa.token) })).statusCode).toBe(403);
    });

    it("saklama: süre dolunca sağlık alanları anonimleşir, lead uzmanlık/hekim alanı temizlenir; geri arama artık reddedilir", async () => {
      const { id, token } = (await submit(submitPayload())).json().data;
      await app.prisma.matcherSubmission.update({ where: { id }, data: { createdAt: new Date(Date.now() - 400 * 86_400_000) } });
      const { anonymizeExpiredMatcherSubmissions } = await import("../../src/modules/matcher/matcher.admin.routes");
      expect(await anonymizeExpiredMatcherSubmissions(app)).toBeGreaterThanOrEqual(1);
      const sub = await app.prisma.matcherSubmission.findUniqueOrThrow({ where: { id }, include: { lead: true } });
      expect([sub.topicIds, sub.freeText, sub.ageBand, sub.recommendedDoctorIds, sub.accessTokenHash]).toEqual([[], null, null, [], null]);
      expect(sub.anonymizedAt).not.toBeNull();
      expect([sub.lead.specialtyName, sub.lead.doctorName]).toEqual([null, null]);
      // Kullanıcı kararı: sihirbaz lead'inin kişi alanları da aynı sürede (365 gün) anonimleşir.
      expect([sub.lead.name, sub.lead.email, sub.lead.phone, sub.lead.country]).toEqual([null, null, null, null]);
      expect(sub.lead.anonymizedAt).not.toBeNull();
      expect((await app.inject({ method: "POST", url: `/api/v1/matcher/submissions/${id}/callback`, headers: ORIGIN, payload: { token, consentContact: true }, remoteAddress: nextIp() })).statusCode).toBe(404);
    });

    it("admin katalog: ekle/düzenle (kırmızı bayrak ağırlık alamaz), önizleme (hekimsiz uzmanlık işaretli), rapor, ayarlar; MANAGER yazamaz", async () => {
      const body = {
        slug: "test-topic",
        bodyArea: "other",
        translations: { en: { label: "Test topic", description: "", synonyms: ["zzqtest"] }, tr: { label: "Test konu", description: "", synonyms: ["zzqdeneme"] } },
        weights: [{ specialtyId: sp.gas, weight: 60 }],
      };
      const created = await app.inject({ method: "POST", url: "/api/v1/admin/matcher/topics", headers: auth(admin.token), payload: body });
      expect(created.statusCode).toBe(201);
      expect((await app.inject({ method: "POST", url: "/api/v1/admin/matcher/topics", headers: auth(manager.token), payload: { ...body, slug: "x-y" } })).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url: "/api/v1/admin/matcher/topics", headers: auth(admin.token), payload: { ...body, slug: "rf-x", isRedFlag: true } })).statusCode).toBe(422);
      // Yeni konu herkese açık katalogda hemen görünür (önbellek temizlenir).
      const pub = (await app.inject({ method: "GET", url: "/api/v1/matcher/topics?lang=tr", remoteAddress: nextIp() })).json().data;
      expect(pub.topics.some((t: { slug: string }) => t.slug === "test-topic")).toBe(true);

      const preview = (await app.inject({ method: "GET", url: `/api/v1/admin/matcher/preview?q=${encodeURIComponent("diş apsesi")}&lang=tr`, headers: auth(manager.token) })).json().data;
      expect(preview.topics[0].slug).toBe("dental-abscess");
      expect(preview.specialties[0]).toMatchObject({ slug: "dentalcare", hasDoctors: false, passesThreshold: true });

      const today = new Date().toISOString().slice(0, 10);
      const report = (await app.inject({ method: "GET", url: `/api/v1/admin/matcher/report?from=${today}&to=${today}`, headers: auth(manager.token) })).json().data;
      expect(report.topTopics[0].key).toBe("reflux-heartburn");
      expect(report.funnel.map((f: { step: string }) => f.step)).toEqual(["1", "2", "3", "4", "5"]);
      for (const term of report.unmatchedTerms) expect(term.count).toBeGreaterThanOrEqual(3);

      const defaults = { contactRequired: true, retentionDays: 365, scoreThreshold: 40, maxSpecialties: 2 };
      expect((await app.inject({ method: "GET", url: "/api/v1/admin/matcher/settings", headers: auth(manager.token) })).json().data).toEqual(defaults);
      expect((await app.inject({ method: "PUT", url: "/api/v1/admin/matcher/settings", headers: auth(manager.token), payload: { ...defaults, contactRequired: false } })).statusCode).toBe(403);
      const put = await app.inject({ method: "PUT", url: "/api/v1/admin/matcher/settings", headers: auth(admin.token), payload: { ...defaults, contactRequired: false, retentionDays: 90 } });
      expect(put.json().data).toEqual({ ...defaults, contactRequired: false, retentionDays: 90 });
      expect((await app.inject({ method: "GET", url: "/api/v1/matcher/topics?lang=tr", remoteAddress: nextIp() })).json().data.contactRequired).toBe(false);
      await app.inject({ method: "PUT", url: "/api/v1/admin/matcher/settings", headers: auth(admin.token), payload: defaults });
    });
  });

  describe("güvenlik/uyumluluk incelemesi düzeltmeleri", () => {
    it("Origin yoksa ya da yabancıysa herkese açık POST'lar 403", async () => {
      for (const url of ["/api/v1/matcher/recommend", "/api/v1/matcher/progress", "/api/v1/matcher/submit"]) {
        const none = await app.inject({ method: "POST", url, payload: {}, remoteAddress: nextIp() });
        const evil = await app.inject({ method: "POST", url, headers: { origin: "https://evil.example" }, payload: {}, remoteAddress: nextIp() });
        expect([none.statusCode, evil.statusCode], url).toEqual([403, 403]);
      }
    });

    it("yaş ve doğum yılı tutarsızsa reddedilir; doğum yılından türeyen 18 yaş altı veli kuralı atlatılamaz; doğum yılı saklanmaz", async () => {
      const y = new Date().getUTCFullYear();
      const mismatch = await submit(submitPayload({ age: 30, birthYear: y - 10 }));
      expect(mismatch.json().error.details).toHaveProperty("age");
      const child = await submit(submitPayload({ age: undefined, birthYear: y - 10 }));
      expect(child.json().error.details).toHaveProperty("guardianName");
      const ok = await submit(submitPayload({ age: undefined, birthYear: y - 40 }));
      const sub = await app.prisma.matcherSubmission.findUniqueOrThrow({ where: { id: ok.json().data.id } });
      expect([sub.ageBand, sub.birthYear]).toEqual(["30-44", null]);
    });

    it("serbest metinde e-posta, telefon ve kimlik numarası maskelenir", async () => {
      const res = await submit(submitPayload({ freeText: "Bana ali@example.com veya 0532 123 45 67 ile ulaşın, TC 12345678901, boyun ağrısı" }));
      const sub = await app.prisma.matcherSubmission.findUniqueOrThrow({ where: { id: res.json().data.id } });
      expect(sub.freeText).not.toMatch(/ali@example\.com|0532|12345678901/);
      expect(sub.freeText).toContain("boyun ağrısı");
    });

    it("geri arama idempotent (ikinci çağrı zaman damgasını değiştirmez)", async () => {
      const { id, token } = (await submit(submitPayload())).json().data;
      const call = () => app.inject({ method: "POST", url: `/api/v1/matcher/submissions/${id}/callback`, headers: ORIGIN, payload: { token, consentContact: true }, remoteAddress: nextIp() });
      expect((await call()).statusCode).toBe(204);
      const first = (await app.prisma.matcherSubmission.findUniqueOrThrow({ where: { id } })).callbackRequestedAt;
      expect((await call()).statusCode).toBe(204);
      expect((await app.prisma.matcherSubmission.findUniqueOrThrow({ where: { id } })).callbackRequestedAt).toEqual(first);
    });

    it("aynı adrese saatte en çok 3 onay e-postası (talep yine kaydedilir)", async () => {
      const email = `tekrar-${crypto.randomUUID()}@example.com`;
      for (let i = 0; i < 5; i++) expect((await submit(submitPayload({ email }))).statusCode).toBe(201);
      expect(mailSpy.mock.calls.filter((c) => (c[1] as { to: string }).to === email)).toHaveLength(3);
    });

    it("öneri 60 sn önbellekte; tekrarlar konu sayacını artırmaz", async () => {
      const { clearRecommendCache } = await import("../../src/modules/matcher/matcher.service");
      clearRecommendCache();
      const before = (await app.prisma.matcherStat.findMany({ where: { kind: "topic", key: "hiatal-hernia" } })).reduce((n, r) => n + r.count, 0);
      for (let i = 0; i < 3; i++) await recommendReq([topic.hiatal]);
      const after = (await app.prisma.matcherStat.findMany({ where: { kind: "topic", key: "hiatal-hernia" } })).reduce((n, r) => n + r.count, 0);
      expect(after - before).toBe(1);
    });

    it("eşleşmeyen terim günlük üst sınırı; 90 günden eski sayaçlar silinir; anonimleştirme veli adı/konum/acil onayını da siler ve audit'e yazar", async () => {
      const svc = await import("../../src/modules/matcher/matcher.service");
      const day = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
      await app.prisma.matcherStat.createMany({ data: Array.from({ length: svc.MATCHER_UNMATCHED_DAILY_CAP }, (_, i) => ({ day, kind: "unmatched_term", key: `zz-cap-${i}`, count: 1 })), skipDuplicates: true });
      await svc.incrementUnmatchedTerm(app, "yepyenibirterim");
      expect(await app.prisma.matcherStat.count({ where: { key: "yepyenibirterim" } })).toBe(0);
      await app.prisma.matcherStat.create({ data: { day: new Date(Date.now() - 120 * 86_400_000), kind: "unmatched_term", key: "eski-terim", count: 9 } });
      expect(await svc.purgeOldMatcherStats(app)).toBeGreaterThanOrEqual(1);
      expect(await app.prisma.matcherStat.count({ where: { key: "eski-terim" } })).toBe(0);
      await app.prisma.matcherStat.deleteMany({ where: { key: { startsWith: "zz-cap-" } } });

      const res = await submit(submitPayload({ age: 12, guardianName: "Veli Kişi", freeText: "nefes alamıyorum", redFlagAcknowledged: true }));
      const id = res.json().data.id as string;
      await app.prisma.matcherSubmission.update({ where: { id }, data: { createdAt: new Date(Date.now() - 400 * 86_400_000) } });
      const { anonymizeExpiredMatcherSubmissions } = await import("../../src/modules/matcher/matcher.admin.routes");
      await anonymizeExpiredMatcherSubmissions(app);
      const sub = await app.prisma.matcherSubmission.findUniqueOrThrow({ where: { id } });
      expect([sub.guardianName, sub.country, sub.timeZone, sub.redFlagAcknowledgedAt]).toEqual([null, null, null, null]);
      expect(await app.prisma.auditLog.count({ where: { action: "matcher.anonymized" } })).toBeGreaterThan(0);
    });
  });

  describe("kullanıcı kararları (rebase sonrası)", () => {
    const defaults = { contactRequired: true, retentionDays: 365, scoreThreshold: 40, maxSpecialties: 2 };
    const putSettings = (payload: Record<string, unknown>) => app.inject({ method: "PUT", url: "/api/v1/admin/matcher/settings", headers: auth(admin.token), payload });

    it("eşik ve en çok uzmanlık sayısı ayardan değişir, öneriye hemen yansır ve audit'e önce/sonra değerleriyle yazılır", async () => {
      // Varsayılan: reflü → GAS (100) + OBE (40) → 2 uzmanlık.
      expect((await recommendReq([topic.reflux])).json().data.specialties).toHaveLength(2);
      // En çok 1 uzmanlık.
      expect((await putSettings({ ...defaults, maxSpecialties: 1 })).statusCode).toBe(200);
      expect((await recommendReq([topic.reflux])).json().data.specialties.map((s: { slug: string }) => s.slug)).toEqual(["gastroenterology"]);
      // Eşik 150 → reflü tek başına eşiği geçemez → koordinatör yolu.
      await putSettings({ ...defaults, scoreThreshold: 150 });
      expect((await recommendReq([topic.reflux])).json().data.coordinator).toBe(true);
      // Sınır dışı değerler reddedilir; MANAGER değiştiremez.
      expect((await putSettings({ ...defaults, scoreThreshold: 0 })).statusCode).toBe(422);
      expect((await putSettings({ ...defaults, maxSpecialties: 6 })).statusCode).toBe(422);
      expect((await app.inject({ method: "PUT", url: "/api/v1/admin/matcher/settings", headers: auth(manager.token), payload: defaults })).statusCode).toBe(403);
      const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: "matcher.settings_updated" }, orderBy: { createdAt: "desc" } });
      expect(audit.metadata).toMatchObject({ before: { scoreThreshold: 40, maxSpecialties: 1 }, after: { scoreThreshold: 150, maxSpecialties: 2 } });
      await putSettings(defaults);
      expect((await recommendReq([topic.reflux])).json().data.specialties).toHaveLength(2);
    });
  });
});
