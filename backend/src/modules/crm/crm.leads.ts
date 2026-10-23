import type { FastifyInstance } from "fastify";
import type { CrmLead, CrmLeadChannel, CrmLeadStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { env } from "../../config/env";
import { decryptSecret, encryptSecret } from "../../lib/crypto";
import { sendMail } from "../../lib/mail";
import { readCrmSettings } from "./crm.settings";
import { sanitizeText } from "./crm.privacy";

/**
 * Paket N2 — talep (lead) yönetimi. Mevcut tablolar (ContactSubmission, SupportChatSession,
 * AppointmentBooking) DEĞİŞTİRİLMEZ; içe alma işi onları OKUYUP `crm_leads`'e düz kimlikle referans
 * veren satırlar yazar (`(channel, sourceRefId)` tekil → idempotent). Ziyaretçi ve randevu bağları
 * yalnızca admin onayıyla (elle) kurulur; sistem yalnızca ÖNERİR.
 */
export const CRM_LEAD_STATUSES = [
  "NEW",
  "CALLED",
  "UNREACHABLE",
  "APPOINTMENT_GIVEN",
  "CONSULTED",
  "TREATMENT_PLANNED",
  "TREATED",
  "NEGATIVE",
  "SPAM",
] as const satisfies readonly CrmLeadStatus[];

export const CRM_LEAD_CHANNELS = [
  "CONTACT_FORM",
  "LIVE_CHAT",
  "WHATSAPP",
  "PHONE",
  "EMAIL",
  "BOOKING_ABANDONED",
  "MANUAL",
  "ADS_IMPORT",
] as const satisfies readonly CrmLeadChannel[];

export const CRM_LEAD_STATUS_LABELS: Record<CrmLeadStatus, string> = {
  NEW: "Yeni",
  CALLED: "Arandı",
  UNREACHABLE: "Ulaşılamadı",
  APPOINTMENT_GIVEN: "Randevu Verildi",
  CONSULTED: "Görüşme Yapıldı",
  TREATMENT_PLANNED: "Tedavi Planlandı",
  TREATED: "Tedavi Oldu",
  NEGATIVE: "Olumsuz",
  SPAM: "Test/Spam",
};

export const CRM_LEAD_CHANNEL_LABELS: Record<CrmLeadChannel, string> = {
  CONTACT_FORM: "İletişim formu",
  LIVE_CHAT: "Canlı destek",
  WHATSAPP: "WhatsApp",
  PHONE: "Telefon",
  EMAIL: "E-posta",
  BOOKING_ABANDONED: "Yarım kalan randevu",
  MANUAL: "Manuel",
  ADS_IMPORT: "Google Ads",
};

/** Sonuçlanmış durumlar — "bugün aranacaklar" listesine girmez. */
export const CRM_FINAL_STATUSES: readonly CrmLeadStatus[] = ["TREATED", "NEGATIVE", "SPAM"];

const CONTACT_EVENT_CHANNEL: Record<string, CrmLeadChannel> = { WHATSAPP_CLICK: "WHATSAPP", PHONE_CLICK: "PHONE", EMAIL_CLICK: "EMAIL" };

export const CRM_STATE_KEY = "crm-state";
const INGEST_OVERLAP_MS = 10 * 60 * 1000;
const INGEST_FIRST_RUN_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
export const CRM_LEAD_INGEST_INTERVAL_MS = 5 * 60 * 1000;

// --- Biçim yardımcıları ------------------------------------------------------------------------

export function normalizePhone(value: string | null | undefined): string | null {
  const cleaned = sanitizeText(value, 40).replace(/[^\d+]/g, "");
  return cleaned.length >= 5 ? cleaned.slice(0, 20) : null;
}

export function normalizeEmail(value: string | null | undefined): string | null {
  const cleaned = sanitizeText(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned) ? cleaned : null;
}

function pickString(data: unknown, keys: string[]): string | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (keys.includes(key.toLowerCase()) && typeof record[key] === "string" && (record[key] as string).trim()) return record[key] as string;
  }
  return null;
}

// --- SLA ---------------------------------------------------------------------------------------

export type SlaState = "met" | "late" | "pending" | "breached";

/** İlk yanıt süresi: yanıtlandıysa hedef içinde mi; yanıtlanmadıysa kalan/aşan süre (dakika). */
export function computeSla(lead: Pick<CrmLead, "createdAt" | "firstResponseAt">, slaHours: number, now: Date = new Date()) {
  const targetMs = slaHours * 3_600_000;
  if (lead.firstResponseAt) {
    const took = lead.firstResponseAt.getTime() - lead.createdAt.getTime();
    return { state: (took <= targetMs ? "met" : "late") as SlaState, minutes: Math.max(0, Math.round(took / 60_000)) };
  }
  const elapsed = now.getTime() - lead.createdAt.getTime();
  return elapsed > targetMs
    ? { state: "breached" as SlaState, minutes: Math.round((elapsed - targetMs) / 60_000) }
    : { state: "pending" as SlaState, minutes: Math.round((targetMs - elapsed) / 60_000) };
}

// --- Notlar (şifreli) --------------------------------------------------------------------------

export async function addLeadNote(
  db: Prisma.TransactionClient | FastifyInstance["prisma"],
  leadId: string,
  body: string,
  kind: "NOTE" | "STATUS" | "SYSTEM",
  author: { id: string | null; name: string | null }
) {
  return db.crmLeadNote.create({
    data: { leadId, kind, authorId: author.id, authorName: author.name, bodyCiphertext: encryptSecret(body) },
  });
}

export function decryptNoteBody(ciphertext: string): string {
  try {
    return decryptSecret(ciphertext);
  } catch {
    return "[Not çözülemedi]";
  }
}

// --- DTO ---------------------------------------------------------------------------------------

export function toLeadDto(lead: CrmLead, slaHours: number, assignees: Map<string, string>) {
  return {
    id: lead.id,
    seq: lead.seq,
    channel: lead.channel,
    status: lead.status,
    candidate: lead.candidate,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    country: lead.country,
    language: lead.language,
    specialtyId: lead.specialtyId,
    specialtyName: lead.specialtyName,
    doctorId: lead.doctorId,
    doctorName: lead.doctorName,
    source: lead.source,
    medium: lead.medium,
    campaign: lead.campaign,
    landingPath: lead.landingPath,
    refCode: lead.refCode,
    gclid: lead.gclid,
    assignedToId: lead.assignedToId,
    assignedToName: lead.assignedToId ? (assignees.get(lead.assignedToId) ?? null) : null,
    firstResponseAt: lead.firstResponseAt?.toISOString() ?? null,
    nextActionAt: lead.nextActionAt?.toISOString() ?? null,
    statusChangedAt: lead.statusChangedAt.toISOString(),
    bookingId: lead.bookingId,
    visitorId: lead.visitorId,
    anonymizedAt: lead.anonymizedAt?.toISOString() ?? null,
    createdAt: lead.createdAt.toISOString(),
    sla: computeSla(lead, slaHours),
  };
}

export async function loadAssigneeNames(app: FastifyInstance): Promise<Map<string, string>> {
  const users = await app.prisma.user.findMany({
    where: { role: { in: ["ADMIN", "MANAGER"] }, status: "ACTIVE" },
    select: { id: true, name: true, email: true },
  });
  return new Map(users.map((u) => [u.id, u.name || u.email]));
}

// --- Bildirim ----------------------------------------------------------------------------------

/**
 * Yeni talep e-postası — BEST-EFFORT. İçerik bilinçli olarak ASGARİ: kanal + panel bağlantısı. Ad,
 * telefon ve mesaj (sağlık bilgisi içerebilir) e-postaya YAZILMAZ; ayrıntılar yalnızca panelde (2FA).
 */
export async function notifyNewLeads(app: FastifyInstance, leads: Pick<CrmLead, "id" | "channel" | "candidate">[]): Promise<void> {
  const real = leads.filter((l) => !l.candidate);
  if (real.length === 0) return;
  const settings = await readCrmSettings(app.prisma);
  if (!settings.notificationEmail) return;
  const base = env.FRONTEND_URL.replace(/\/$/, "");
  const items = real
    .slice(0, 20)
    .map((l) => `<li>${CRM_LEAD_CHANNEL_LABELS[l.channel]} — <a href="${base}/admin/crm/leads/${l.id}">Talebi aç</a></li>`)
    .join("");
  try {
    await sendMail(app, {
      to: settings.notificationEmail,
      subject: real.length === 1 ? `Yeni talep: ${CRM_LEAD_CHANNEL_LABELS[real[0]!.channel]}` : `${real.length} yeni talep`,
      html: `<p>CRM'e yeni talep düştü. Kişi bilgileri güvenlik nedeniyle e-postada gösterilmez.</p><ul>${items}</ul>`,
    });
  } catch (err) {
    app.log.error({ err }, "CRM yeni talep bildirimi gönderilemedi");
  }
}

// --- İçe alma ----------------------------------------------------------------------------------

async function readIngestCursor(app: FastifyInstance): Promise<Date> {
  const row = await app.prisma.siteModule.findUnique({ where: { key: CRM_STATE_KEY }, select: { settings: true } });
  const raw = (row?.settings as Record<string, unknown> | null)?.leadIngestCursor;
  const parsed = typeof raw === "string" ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(Date.now() - INGEST_FIRST_RUN_LOOKBACK_MS);
}

async function writeIngestCursor(app: FastifyInstance, at: Date): Promise<void> {
  const row = await app.prisma.siteModule.findUnique({ where: { key: CRM_STATE_KEY }, select: { settings: true } });
  const current = (row?.settings as Record<string, unknown> | null) ?? {};
  const settings = { ...current, leadIngestCursor: at.toISOString() } as Prisma.InputJsonValue;
  await app.prisma.siteModule.upsert({
    where: { key: CRM_STATE_KEY },
    create: { key: CRM_STATE_KEY, enabled: true, settings },
    update: { settings },
  });
}

/**
 * Kaynak kayıtlardan talep üretir: iletişim formu, canlı destek, yarım kalan randevu (ödenmemiş ve
 * süresi dolmuş) ve WhatsApp/telefon/e-posta tıklamalarından "aday" talep (kişi bilgisi yok; ziyaretçi
 * BAĞLANMAZ, yalnızca oturum düzeyinde kaynak + Ref kodu). Son imleçten 10 dk örtüşmeyle tarar.
 */
export async function runLeadIngest(app: FastifyInstance, now: Date = new Date()): Promise<{ created: number }> {
  const cursor = await readIngestCursor(app);
  const since = new Date(cursor.getTime() - INGEST_OVERLAP_MS);
  const rows: Prisma.CrmLeadCreateManyInput[] = [];

  const submissions = await app.prisma.contactSubmission.findMany({
    where: { createdAt: { gte: since, lte: now } },
    select: { id: true, name: true, email: true, data: true, createdAt: true },
  });
  for (const s of submissions) {
    rows.push({
      channel: "CONTACT_FORM",
      sourceRefId: s.id,
      name: sanitizeText(s.name, 200) || null,
      email: normalizeEmail(s.email),
      phone: normalizePhone(pickString(s.data, ["phone", "telefon", "tel", "gsm", "mobile"])),
      createdAt: s.createdAt,
      statusChangedAt: s.createdAt,
    });
  }

  const chats = await app.prisma.supportChatSession.findMany({
    where: { createdAt: { gte: since, lte: now }, OR: [{ visitorName: { not: null } }, { visitorEmail: { not: null } }, { visitorPhone: { not: null } }] },
    select: { id: true, visitorName: true, visitorEmail: true, visitorPhone: true, locale: true, createdAt: true },
  });
  for (const c of chats) {
    rows.push({
      channel: "LIVE_CHAT",
      sourceRefId: c.id,
      name: sanitizeText(c.visitorName, 200) || null,
      email: normalizeEmail(c.visitorEmail),
      phone: normalizePhone(c.visitorPhone),
      language: c.locale ? sanitizeText(c.locale, 10) : null,
      createdAt: c.createdAt,
      statusChangedAt: c.createdAt,
    });
  }

  const abandoned = await app.prisma.appointmentBooking.findMany({
    where: {
      archivedAt: null,
      OR: [
        { paymentStatus: "EXPIRED", updatedAt: { gte: since } },
        { paymentStatus: "PENDING", expiresAt: { gte: since, lt: now } },
      ],
    },
    select: { id: true, patientName: true, patientEmail: true, doctorId: true, createdAt: true, doctor: { select: { fullName: true, title: true } } },
  });
  for (const b of abandoned) {
    rows.push({
      channel: "BOOKING_ABANDONED",
      sourceRefId: b.id,
      name: sanitizeText(b.patientName, 200) || null,
      email: normalizeEmail(b.patientEmail),
      doctorId: b.doctorId,
      doctorName: sanitizeText(`${b.doctor.title} ${b.doctor.fullName}`, 200),
      createdAt: b.createdAt,
      statusChangedAt: b.createdAt,
    });
  }

  const contactEvents = await app.prisma.crmEvent.findMany({
    where: { type: { in: ["WHATSAPP_CLICK", "PHONE_CLICK", "EMAIL_CLICK"] }, occurredAt: { gte: since, lte: now }, session: { botFlagged: false } },
    orderBy: { occurredAt: "asc" },
    select: {
      type: true,
      sessionId: true,
      occurredAt: true,
      session: { select: { source: true, medium: true, campaign: true, landingPath: true, country: true, language: true, gclid: true, visitor: { select: { refCode: true } } } },
    },
  });
  const seen = new Set<string>();
  for (const e of contactEvents) {
    const channel = CONTACT_EVENT_CHANNEL[e.type]!;
    const ref = `${e.sessionId}:${channel}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    rows.push({
      channel,
      candidate: true,
      sourceRefId: ref,
      source: e.session.source,
      medium: e.session.medium,
      campaign: e.session.campaign,
      landingPath: e.session.landingPath,
      country: e.session.country,
      language: e.session.language,
      gclid: e.session.gclid,
      refCode: e.session.visitor.refCode,
      createdAt: e.occurredAt,
      statusChangedAt: e.occurredAt,
    });
  }

  let created = 0;
  if (rows.length > 0) {
    const refs = rows.map((r) => r.sourceRefId!);
    const before = new Set(
      (
        await app.prisma.crmLead.findMany({
          where: { channel: { in: [...new Set(rows.map((r) => r.channel))] }, sourceRefId: { in: refs } },
          select: { channel: true, sourceRefId: true },
        })
      ).map(
        (l) => `${l.channel}|${l.sourceRefId}`
      )
    );
    const fresh = rows.filter((r) => !before.has(`${r.channel}|${r.sourceRefId}`));
    const result = await app.prisma.crmLead.createMany({ data: fresh, skipDuplicates: true });
    created = result.count;
    if (created > 0) {
      const createdLeads = await app.prisma.crmLead.findMany({
        where: { OR: fresh.map((r) => ({ channel: r.channel, sourceRefId: r.sourceRefId })) },
        select: { id: true, channel: true, candidate: true },
      });
      await notifyNewLeads(app, createdLeads);
    }
  }
  await writeIngestCursor(app, now);
  return { created };
}

// --- Eşleştirme önerileri ----------------------------------------------------------------------

/** Aynı e-postayla oluşturulmuş randevular — sistem ÖNERİR, bağlamayı admin onaylar. */
export async function findBookingSuggestions(app: FastifyInstance, lead: Pick<CrmLead, "email" | "bookingId">) {
  if (!lead.email) return [];
  const bookings = await app.prisma.appointmentBooking.findMany({
    where: { patientEmail: { equals: lead.email, mode: "insensitive" }, archivedAt: null },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      bookingNumber: true,
      createdAt: true,
      paymentStatus: true,
      totalCents: true,
      currency: true,
      doctor: { select: { fullName: true, title: true } },
    },
  });
  return bookings
    .filter((b) => b.id !== lead.bookingId)
    .map((b) => ({
      id: b.id,
      bookingNumber: b.bookingNumber,
      createdAt: b.createdAt.toISOString(),
      paymentStatus: b.paymentStatus,
      totalCents: b.totalCents,
      currency: b.currency,
      doctorName: `${b.doctor.title} ${b.doctor.fullName}`,
      reason: "Aynı e-posta adresi",
    }));
}

/**
 * Elle bağlamak için aday ziyaretçiler: Ref kodu eşleşenler + talebin oluştuğu andan 30 dk önce /
 * 5 dk sonra arasında TEMAS TIKLAMASI yapan ziyaretçiler (yalnızca aynı anda sitede olan ilgisiz
 * ziyaretçiler gösterilmez — veri minimizasyonu). Otomatik bağlama YAPILMAZ.
 */
export async function findVisitorCandidates(app: FastifyInstance, lead: Pick<CrmLead, "refCode" | "createdAt">) {
  const byRef = lead.refCode ? await app.prisma.crmVisitor.findMany({ where: { refCode: lead.refCode }, take: 5 }) : [];
  const from = new Date(lead.createdAt.getTime() - 30 * 60_000);
  const to = new Date(lead.createdAt.getTime() + 5 * 60_000);
  const sessions = await app.prisma.crmSession.findMany({
    where: { botFlagged: false, contactClicked: true, lastSeenAt: { gte: from }, startedAt: { lte: to } },
    orderBy: { lastSeenAt: "desc" },
    take: 20,
    include: { visitor: true },
  });
  const map = new Map<string, { visitor: (typeof byRef)[number]; reason: string }>();
  for (const v of byRef) map.set(v.id, { visitor: v, reason: "Ref kodu eşleşti" });
  for (const s of sessions) {
    if (!map.has(s.visitorId)) map.set(s.visitorId, { visitor: s.visitor, reason: "Aynı zamanda temas tıklaması" });
  }
  return [...map.values()].slice(0, 20).map(({ visitor, reason }) => ({
    id: visitor.id,
    lastSeenAt: visitor.lastSeenAt.toISOString(),
    country: visitor.country,
    deviceType: visitor.deviceType,
    score: visitor.score,
    refCode: visitor.refCode,
    firstSource: visitor.firstSource,
    reason,
  }));
}

// --- Saklama: anonimleştirme -------------------------------------------------------------------

/** Süresi dolan talepler: kişi alanları ve notlar silinir, istatistik için satır (kanal/durum/kaynak) kalır. */
export async function anonymizeExpiredLeads(app: FastifyInstance, now: Date = new Date()): Promise<number> {
  const settings = await readCrmSettings(app.prisma);
  const cutoff = new Date(now.getTime() - settings.leadRetentionDays * 86_400_000);
  const expired = await app.prisma.crmLead.findMany({ where: { createdAt: { lt: cutoff }, anonymizedAt: null }, select: { id: true } });
  if (expired.length === 0) return 0;
  const ids = expired.map((l) => l.id);
  await app.prisma.$transaction([
    app.prisma.crmLeadNote.deleteMany({ where: { leadId: { in: ids } } }),
    app.prisma.crmLead.updateMany({
      where: { id: { in: ids } },
      data: {
        name: null,
        phone: null,
        email: null,
        refCode: null,
        gclid: null,
        visitorId: null,
        bookingId: null,
        sourceRefId: null,
        assignedToId: null,
        landingPath: null,
        anonymizedAt: now,
      },
    }),
  ]);
  return ids.length;
}

// --- İstek şemaları ----------------------------------------------------------------------------

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const LeadListQuerySchema = z.object({
  status: z.string().max(300).optional(),
  channel: z.string().max(300).optional(),
  q: z.string().trim().max(100).optional(),
  candidate: z.enum(["true", "false", "all"]).default("all"),
  assignedToId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const CreateLeadSchema = z
  .object({
    channel: z.enum(CRM_LEAD_CHANNELS).default("MANUAL"),
    name: optionalText(200),
    phone: optionalText(40),
    email: optionalText(320),
    country: optionalText(2),
    language: optionalText(10),
    specialtyId: z.string().uuid().nullable().optional(),
    doctorId: z.string().uuid().nullable().optional(),
    source: optionalText(100),
    campaign: optionalText(150),
    visitorId: z.string().max(40).nullable().optional(),
    note: z.string().trim().max(5000).optional(),
  })
  .strict();

export const UpdateLeadSchema = z
  .object({
    status: z.enum(CRM_LEAD_STATUSES).optional(),
    assignedToId: z.string().uuid().nullable().optional(),
    nextActionAt: z.string().datetime().nullable().optional(),
    name: optionalText(200),
    phone: optionalText(40),
    email: optionalText(320),
    country: optionalText(2),
    language: optionalText(10),
    specialtyId: z.string().uuid().nullable().optional(),
    doctorId: z.string().uuid().nullable().optional(),
    bookingId: z.string().uuid().nullable().optional(),
    visitorId: z.string().max(40).nullable().optional(),
    candidate: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "En az bir alan gönderilmeli." });

export const BulkStatusSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(200), status: z.enum(CRM_LEAD_STATUSES) }).strict();
export const AddNoteSchema = z.object({ body: z.string().trim().min(1).max(5000) }).strict();

export function buildLeadWhere(query: z.infer<typeof LeadListQuerySchema>): Prisma.CrmLeadWhereInput {
  const where: Prisma.CrmLeadWhereInput = {};
  const statuses = query.status?.split(",").filter((s): s is CrmLeadStatus => (CRM_LEAD_STATUSES as readonly string[]).includes(s));
  if (statuses?.length) where.status = { in: statuses };
  const channels = query.channel?.split(",").filter((c): c is CrmLeadChannel => (CRM_LEAD_CHANNELS as readonly string[]).includes(c));
  if (channels?.length) where.channel = { in: channels };
  if (query.candidate !== "all") where.candidate = query.candidate === "true";
  if (query.assignedToId) where.assignedToId = query.assignedToId;
  if (query.from || query.to) {
    where.createdAt = {
      ...(query.from ? { gte: new Date(Date.parse(`${query.from}T00:00:00.000Z`) - 3 * 3_600_000) } : {}),
      ...(query.to ? { lt: new Date(Date.parse(`${query.to}T00:00:00.000Z`) + 21 * 3_600_000) } : {}),
    };
  }
  if (query.q) {
    const q = query.q;
    const digits = q.replace(/[^\d]/g, "");
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { refCode: { equals: q.toUpperCase().replace(/[^A-Z0-9]/g, "") } },
      ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
    ];
  }
  return where;
}
