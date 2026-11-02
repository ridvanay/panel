import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { resetDatabase } from "../helpers/reset-db";
import { istanbulDate } from "../../src/modules/crm/crm.rollup";

/**
 * Paket AJ-4 - admin CRM "Talepler" uclari (/admin/crm/requests*): liste/filtre/durum esleme, atama, ic not,
 * CSV (PII + audit), mesaj goruntuleme (audit), ADMIN + 2FA kapisi.
 */
let ipCounter = 0;
const nextIp = () => `10.94.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const BASE = "/api/v1/admin/crm/requests";

vi.mock("../../src/lib/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/mail")>();
  return { ...actual, sendMail: () => Promise.resolve({ messageId: "test" }) };
});

describe("Paket AJ-4 - CRM Talepler", () => {
  let app: FastifyInstance;
  let drain: () => Promise<void>;
  let admin: { id: string; email: string; token: string };
  let manager: { id: string; email: string; token: string };
  let noTwoFa: { id: string; email: string; token: string };
  let specA: { id: string; slug: string };
  let specB: { id: string; slug: string };
  const leadIds: Record<string, string> = {};

  async function user(role: "ADMIN" | "MANAGER", twoFactorEnabled = true) {
    const { hashPassword } = await import("../../src/lib/password");
    const { signAccessToken } = await import("../../src/lib/jwt");
    const u = await app.prisma.user.create({
      data: { email: `aj4-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`, name: `AJ4 ${role}`, passwordHash: await hashPassword("Sifre12345!"), role, status: "ACTIVE", emailVerifiedAt: new Date(), twoFactorEnabled },
    });
    return { id: u.id, email: u.email, token: signAccessToken({ sub: u.id, email: u.email }).token };
  }

  async function submit(over: Record<string, unknown>) {
    const email = `aj4-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/consultation-requests",
      remoteAddress: nextIp(),
      payload: {
        serviceSlug: specA.slug,
        country: "DE",
        contactLanguage: "de",
        needsInterpreter: true,
        fullName: "Erika Mustermann",
        email,
        phone: "+49 170 1234567",
        contactConsent: true,
        healthDataConsent: false,
        locale: "de",
        website: "",
        ...over,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    await drain();
    const row = await app.prisma.consultationRequest.findFirstOrThrow({ where: { email } });
    return { leadId: row.leadId, email };
  }

  beforeAll(async () => {
    const { buildApp } = await import("../../src/app");
    const { waitForAdminNotifications } = await import("../../src/modules/telehealth/lib/admin-booking-notifications");
    drain = waitForAdminNotifications;
    app = await buildApp();
    await app.ready();
    await resetDatabase(app.prisma);
    admin = await user("ADMIN");
    manager = await user("MANAGER");
    noTwoFa = await user("ADMIN", false);
    specA = await app.prisma.specialty.create({ data: { name: "Cardiology", slug: `cardio-${crypto.randomUUID().slice(0, 6)}`, icon: "Heart" } });
    specB = await app.prisma.specialty.create({ data: { name: "Orthopedics", slug: `ortho-${crypto.randomUUID().slice(0, 6)}`, icon: "Bone" } });
    leadIds.first = (await submit({ preferredContactChannel: "whatsapp", message: "Gizli saglik notu", healthDataConsent: true })).leadId;
    leadIds.second = (await submit({ serviceSlug: specB.slug, country: "GB", contactLanguage: "en", needsInterpreter: false, preferredContactChannel: "email" })).leadId;
    leadIds.third = (await submit({ country: "FR", contactLanguage: "fr" })).leadId;
    // Talepler ekraninda gosterilmeyen durum (Test/Spam): listede/exportta yer almaz.
    await app.prisma.crmLead.update({ where: { id: leadIds.third }, data: { status: "SPAM" } });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("erisim: oturumsuz 401, MANAGER 403, 2FA olmayan ADMIN 403 TWO_FACTOR_REQUIRED, 2FA li ADMIN 200", async () => {
    expect((await app.inject({ method: "GET", url: BASE })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: BASE, headers: auth(manager.token) })).statusCode).toBe(403);
    const noFa = await app.inject({ method: "GET", url: BASE, headers: auth(noTwoFa.token) });
    expect(noFa.statusCode).toBe(403);
    expect(JSON.stringify(noFa.json())).toContain("TWO_FACTOR_REQUIRED");
    expect((await app.inject({ method: "GET", url: `${BASE}/${leadIds.first}/message`, headers: auth(noTwoFa.token) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `${BASE}/export`, headers: auth(manager.token) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: BASE, headers: auth(admin.token) })).statusCode).toBe(200);
  });

  it("liste: yalniz danisma talepleri, esleme disi durumlar gizli; alanlar ve statusCounts; mesaj icerigi YOK", async () => {
    const res = await app.inject({ method: "GET", url: BASE, headers: auth(admin.token) });
    const body = res.json();
    const rows = body.data as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id)).not.toContain(leadIds.third);
    const first = rows.find((r) => r.id === leadIds.first)!;
    expect(first).toMatchObject({ number: expect.stringMatching(/^REQ-\d{5}$/), serviceName: "Cardiology", country: "DE", contactLanguage: "de", needsInterpreter: true, preferredContactChannel: "whatsapp", status: "new", assignedToId: null, hasMessage: true });
    expect(first.fullName).toBe("Erika Mustermann");
    expect(JSON.stringify(body)).not.toContain("Gizli saglik notu");
    expect(body.meta).toMatchObject({ total: 2, page: 1, pageSize: 25, statusCounts: { new: 2, contacted: 0, planning: 0, converted: 0, closed: 0 } });
  });

  it("filtreler: hizmet (specialtyId), durum, tarih araligi, q (REQ no); gecersiz parametre 422", async () => {
    const bySpec = (await app.inject({ method: "GET", url: `${BASE}?specialtyId=${specB.id}`, headers: auth(admin.token) })).json().data as { id: string }[];
    expect(bySpec.map((r) => r.id)).toEqual([leadIds.second]);
    const none = (await app.inject({ method: "GET", url: `${BASE}?status=converted`, headers: auth(admin.token) })).json().data;
    expect(none).toHaveLength(0);
    // Filtre günleri İstanbul takvimine göredir (UTC tarihi gece 00:00-03:00 arasında bir önceki gündür).
    const today = istanbulDate();
    const inRange = (await app.inject({ method: "GET", url: `${BASE}?from=${today}&to=${today}`, headers: auth(admin.token) })).json().data;
    expect(inRange).toHaveLength(2);
    const past = (await app.inject({ method: "GET", url: `${BASE}?from=2020-01-01&to=2020-01-02`, headers: auth(admin.token) })).json().data;
    expect(past).toHaveLength(0);
    const seq = (await app.prisma.consultationRequest.findFirstOrThrow({ where: { leadId: leadIds.second } })).seq;
    const byNo = (await app.inject({ method: "GET", url: `${BASE}?q=REQ-${String(seq).padStart(5, "0")}`, headers: auth(admin.token) })).json().data as { id: string }[];
    expect(byNo.map((r) => r.id)).toEqual([leadIds.second]);
    expect((await app.inject({ method: "GET", url: `${BASE}?specialtyId=nope`, headers: auth(admin.token) })).statusCode).toBe(422);
  });

  it("durum akisi: new, contacted, planning, converted, closed CrmLeadStatus e eslenir, zaman cizelgesine yazilir; gecersiz durum 422", async () => {
    const map: [string, string][] = [["contacted", "CALLED"], ["planning", "TREATMENT_PLANNED"], ["converted", "TREATED"], ["closed", "NEGATIVE"], ["new", "NEW"]];
    for (const [status, crm] of map) {
      const res = await app.inject({ method: "PATCH", url: `${BASE}/${leadIds.first}`, headers: auth(admin.token), payload: { status } });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.status).toBe(status);
      expect((await app.prisma.crmLead.findUniqueOrThrow({ where: { id: leadIds.first } })).status).toBe(crm);
    }
    expect((await app.inject({ method: "PATCH", url: `${BASE}/${leadIds.first}`, headers: auth(admin.token), payload: { status: "SPAM" } })).statusCode).toBe(422);
    expect((await app.inject({ method: "PATCH", url: `${BASE}/${leadIds.first}`, headers: auth(admin.token), payload: { status: "unreachable" } })).statusCode).toBe(422);
    const lead = await app.prisma.crmLead.findUniqueOrThrow({ where: { id: leadIds.first } });
    expect(lead.firstResponseAt).not.toBeNull();
    expect(await app.prisma.crmLeadNote.count({ where: { leadId: leadIds.first, kind: "STATUS" } })).toBe(5);
    expect(await app.prisma.auditLog.count({ where: { action: "crm.lead.update", targetId: leadIds.first } })).toBe(5);
  });

  it("atama: aktif ADMIN/MANAGER atanabilir, EDITOR ve bilinmeyen kisi 422; atama kaldirilabilir", async () => {
    const ok1 = await app.inject({ method: "PATCH", url: `${BASE}/${leadIds.second}`, headers: auth(admin.token), payload: { assignedToId: manager.id } });
    expect(ok1.statusCode, ok1.body).toBe(200);
    expect(ok1.json().data.assignedToId).toBe(manager.id);
    expect(ok1.json().data.assignedToName).toBe("AJ4 MANAGER");
    const assignees = (await app.inject({ method: "GET", url: `${BASE}/assignees`, headers: auth(admin.token) })).json().data as { id: string }[];
    expect(assignees.map((a) => a.id)).toContain(manager.id);
    const editor = await app.prisma.user.create({ data: { email: `aj4-editor-${crypto.randomUUID()}@example.com`, name: "E", passwordHash: "x", role: "EDITOR", status: "ACTIVE" } });
    expect((await app.inject({ method: "PATCH", url: `${BASE}/${leadIds.second}`, headers: auth(admin.token), payload: { assignedToId: editor.id } })).statusCode).toBe(422);
    expect((await app.inject({ method: "PATCH", url: `${BASE}/${leadIds.second}`, headers: auth(admin.token), payload: { assignedToId: crypto.randomUUID() } })).statusCode).toBe(422);
    const filtered = (await app.inject({ method: "GET", url: `${BASE}?assignedToId=${manager.id}`, headers: auth(admin.token) })).json().data as { id: string }[];
    expect(filtered.map((r) => r.id)).toEqual([leadIds.second]);
    const cleared = await app.inject({ method: "PATCH", url: `${BASE}/${leadIds.second}`, headers: auth(admin.token), payload: { assignedToId: null } });
    expect(cleared.json().data.assignedToId).toBeNull();
  });

  it("ic notlar: yazar ve zaman damgasi, sifreli saklanir, detayda cozulur; bos not 422; baska kanal 404", async () => {
    const res = await app.inject({ method: "POST", url: `${BASE}/${leadIds.first}/notes`, headers: auth(admin.token), payload: { body: "Hasta aranacak - ozel not" } });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().data).toMatchObject({ kind: "NOTE", authorName: "AJ4 ADMIN", body: "Hasta aranacak - ozel not" });
    expect(res.json().data.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const stored = await app.prisma.crmLeadNote.findMany({ where: { leadId: leadIds.first, kind: "NOTE" } });
    expect(stored.every((n) => !n.bodyCiphertext.includes("Hasta aranacak"))).toBe(true);
    expect((await app.inject({ method: "POST", url: `${BASE}/${leadIds.first}/notes`, headers: auth(admin.token), payload: { body: "  " } })).statusCode).toBe(422);
    const detail = await app.inject({ method: "GET", url: `${BASE}/${leadIds.first}`, headers: auth(admin.token) });
    expect(detail.statusCode).toBe(200);
    const notes = detail.json().data.notes as { kind: string; body: string; authorName: string }[];
    expect(notes.some((n) => n.kind === "NOTE" && n.body === "Hasta aranacak - ozel not" && n.authorName === "AJ4 ADMIN")).toBe(true);
    expect(JSON.stringify(detail.json())).not.toContain("Gizli saglik notu");
    const other = await app.prisma.crmLead.create({ data: { channel: "MANUAL", name: "x" } });
    expect((await app.inject({ method: "GET", url: `${BASE}/${other.id}`, headers: auth(admin.token) })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `${BASE}/${other.id}/notes`, headers: auth(admin.token), payload: { body: "x" } })).statusCode).toBe(404);
  });

  it("mesaj goruntuleme: cozulur ve HER cagri audit e yazilir (icerik audit te yok); mesajsiz talepte null ve yine audit", async () => {
    const before = await app.prisma.auditLog.count({ where: { action: "crm.consultation_request.message_viewed", targetId: leadIds.first } });
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({ method: "GET", url: `${BASE}/${leadIds.first}/message`, headers: auth(admin.token) });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.message).toBe("Gizli saglik notu");
      expect(res.headers["cache-control"]).toContain("no-store");
    }
    const logs = await app.prisma.auditLog.findMany({ where: { action: "crm.consultation_request.message_viewed", targetId: leadIds.first } });
    expect(logs.length - before).toBe(2);
    expect(JSON.stringify(logs)).not.toContain("Gizli saglik notu");
    const none = await app.inject({ method: "GET", url: `${BASE}/${leadIds.second}/message`, headers: auth(admin.token) });
    expect(none.json().data.message).toBeNull();
    expect(await app.prisma.auditLog.count({ where: { action: "crm.consultation_request.message_viewed", targetId: leadIds.second } })).toBe(1);
  });

  it("CSV: ADMIN icin kisisel sutunlar var, mesaj yok, formul enjeksiyonu notr, export audit e yazilir", async () => {
    await submit({ fullName: "=HYPERLINK(1)", serviceSlug: specB.slug });
    const res = await app.inject({ method: "GET", url: `${BASE}/export`, headers: auth(admin.token) });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("talepler-");
    const csv = res.body;
    const header = csv.split("\r\n")[0]!;
    expect(header).toContain("Hizmet");
    expect(header).toContain("Tercih edilen kanal");
    expect(header).toContain("E-posta");
    expect(csv).toContain("Erika Mustermann");
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    expect(csv).not.toContain("Gizli saglik notu");
    expect(csv).toContain("WhatsApp");
    const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: "crm.requests.export" }, orderBy: { createdAt: "desc" } });
    expect(audit.metadata).toMatchObject({ rows: 3, includesPii: true });
    expect(JSON.stringify(audit.metadata)).not.toContain("Mustermann");
  });
});
