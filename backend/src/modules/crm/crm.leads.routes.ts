import type { FastifyInstance, FastifyRequest } from "fastify";
import type { CrmLeadStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { ok } from "../../lib/envelope";
import { logAudit } from "../../lib/audit";
import { NotFoundError, ValidationError } from "../../lib/errors";
import { toCsv } from "../reports/reports.format";
import { readCrmSettings } from "./crm.settings";
import { parseOr422 } from "./crm.validate";
import { istanbulDate, istanbulDayRange } from "./crm.rollup";
import { computeFunnel, FunnelQuerySchema } from "./crm.funnel";
import {
  AddNoteSchema,
  addLeadNote,
  buildLeadWhere,
  BulkStatusSchema,
  CRM_FINAL_STATUSES,
  CRM_LEAD_CHANNEL_LABELS,
  CRM_LEAD_STATUS_LABELS,
  CRM_LEAD_STATUSES,
  CreateLeadSchema,
  decryptNoteBody,
  findBookingSuggestions,
  findVisitorCandidates,
  LeadListQuerySchema,
  loadAssigneeNames,
  normalizeEmail,
  normalizePhone,
  notifyNewLeads,
  runLeadIngest,
  toLeadDto,
  UpdateLeadSchema,
} from "./crm.leads";

const IdParam = z.object({ id: z.string().uuid() });
const EXPORT_MAX_ROWS = 10_000;

function actor(request: FastifyRequest) {
  return { id: request.user!.id, email: request.user!.email };
}

async function actorName(app: FastifyInstance, userId: string): Promise<string> {
  const user = await app.prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  return user?.name || user?.email || "Yönetici";
}

async function resolveSpecialtyDoctor(app: FastifyInstance, input: { specialtyId?: string | null; doctorId?: string | null }) {
  const data: Prisma.CrmLeadUncheckedUpdateInput = {};
  if (input.specialtyId !== undefined) {
    if (input.specialtyId === null) Object.assign(data, { specialtyId: null, specialtyName: null });
    else {
      const sp = await app.prisma.specialty.findUnique({ where: { id: input.specialtyId }, select: { name: true } });
      if (!sp) throw new ValidationError("Uzmanlık bulunamadı.", { specialtyId: ["Uzmanlık bulunamadı."] });
      Object.assign(data, { specialtyId: input.specialtyId, specialtyName: sp.name });
    }
  }
  if (input.doctorId !== undefined) {
    if (input.doctorId === null) Object.assign(data, { doctorId: null, doctorName: null });
    else {
      const doc = await app.prisma.doctorProfile.findUnique({ where: { id: input.doctorId }, select: { title: true, fullName: true } });
      if (!doc) throw new ValidationError("Doktor bulunamadı.", { doctorId: ["Doktor bulunamadı."] });
      Object.assign(data, { doctorId: input.doctorId, doctorName: `${doc.title} ${doc.fullName}` });
    }
  }
  return data;
}

/**
 * Paket N2 — `/admin/crm/leads*` ve `/admin/crm/funnel`. `crmAdminRoutes` içinde kaydedilir; bütün uçlar
 * ADMIN + 2FA kapısının arkasındadır. Talep detayını açmak (`crm.lead.viewed`), dışa aktarmak (`crm.export`)
 * ve silmek (`crm.lead.deleted`) denetim kaydına yazılır — kayıtlara kişi bilgisi/not metni YAZILMAZ.
 */
export async function registerCrmLeadRoutes(app: FastifyInstance) {
  app.get("/leads", async (request, reply) => {
    const query = parseOr422(LeadListQuerySchema, request.query);
    const where = buildLeadWhere(query);
    const [settings, assignees, total, items, counts] = await Promise.all([
      readCrmSettings(app.prisma),
      loadAssigneeNames(app),
      app.prisma.crmLead.count({ where }),
      app.prisma.crmLead.findMany({ where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      app.prisma.crmLead.groupBy({ by: ["status"], where: { ...where, status: undefined }, _count: { _all: true } }),
    ]);
    const statusCounts = Object.fromEntries(CRM_LEAD_STATUSES.map((s) => [s, 0])) as Record<CrmLeadStatus, number>;
    for (const c of counts) statusCounts[c.status] = c._count._all;
    return reply.send(
      ok(
        items.map((lead) => toLeadDto(lead, settings.slaHours, assignees)),
        { total, page: query.page, pageSize: query.pageSize, statusCounts }
      )
    );
  });

  app.get("/leads/today", async (_request, reply) => {
    const { end } = istanbulDayRange(istanbulDate());
    const [settings, assignees, items] = await Promise.all([
      readCrmSettings(app.prisma),
      loadAssigneeNames(app),
      app.prisma.crmLead.findMany({
        where: { nextActionAt: { lt: end }, status: { notIn: [...CRM_FINAL_STATUSES] }, anonymizedAt: null },
        orderBy: { nextActionAt: "asc" },
        take: 200,
      }),
    ]);
    return reply.send(ok(items.map((lead) => toLeadDto(lead, settings.slaHours, assignees))));
  });

  app.get("/leads/assignees", async (_request, reply) => {
    const users = await app.prisma.user.findMany({
      where: { role: { in: ["ADMIN", "MANAGER"] }, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    });
    return reply.send(ok(users.map((u) => ({ id: u.id, name: u.name || u.email }))));
  });

  app.get("/leads/export", async (request, reply) => {
    const query = parseOr422(LeadListQuerySchema, request.query);
    const where = buildLeadWhere(query);
    const [settings, assignees, items] = await Promise.all([
      readCrmSettings(app.prisma),
      loadAssigneeNames(app),
      app.prisma.crmLead.findMany({ where, orderBy: { createdAt: "desc" }, take: EXPORT_MAX_ROWS }),
    ]);
    const columns = [
      "No", "Tarih", "Kanal", "Durum", "Aday", "Ad", "Telefon", "E-posta", "Ülke", "Dil", "Uzmanlık", "Doktor",
      "Kaynak", "Ortam", "Kampanya", "Açılış sayfası", "Ref", "Atanan", "İlk yanıt (dk)", "SLA", "Sonraki aksiyon", "Randevu",
    ];
    const rows = items.map((lead) => {
      const dto = toLeadDto(lead, settings.slaHours, assignees);
      return [
        lead.seq,
        lead.createdAt.toISOString(),
        CRM_LEAD_CHANNEL_LABELS[lead.channel],
        CRM_LEAD_STATUS_LABELS[lead.status],
        lead.candidate ? "evet" : "hayır",
        lead.name ?? "",
        lead.phone ?? "",
        lead.email ?? "",
        lead.country ?? "",
        lead.language ?? "",
        lead.specialtyName ?? "",
        lead.doctorName ?? "",
        lead.source ?? "",
        lead.medium ?? "",
        lead.campaign ?? "",
        lead.landingPath ?? "",
        lead.refCode ?? "",
        dto.assignedToName ?? "",
        lead.firstResponseAt ? Math.round((lead.firstResponseAt.getTime() - lead.createdAt.getTime()) / 60_000) : "",
        dto.sla.state,
        lead.nextActionAt?.toISOString() ?? "",
        lead.bookingId ?? "",
      ];
    });
    await logAudit(app, {
      actorId: actor(request).id,
      actorEmail: actor(request).email,
      action: "crm.export",
      targetType: "CrmLead",
      metadata: { rows: rows.length, filters: { status: query.status ?? null, channel: query.channel ?? null, from: query.from ?? null, to: query.to ?? null, q: query.q ? true : false } },
      ipAddress: request.ip,
    });
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="crm-talepler-${istanbulDate()}.csv"`)
      .header("cache-control", "no-store")
      .send(toCsv(columns, rows));
  });

  app.post("/leads/sync", async (_request, reply) => {
    const result = await runLeadIngest(app);
    return reply.send(ok(result));
  });

  app.post("/leads", async (request, reply) => {
    const input = parseOr422(CreateLeadSchema, request.body);
    if (input.visitorId) {
      const visitor = await app.prisma.crmVisitor.findUnique({ where: { id: input.visitorId }, select: { id: true } });
      if (!visitor) throw new ValidationError("Ziyaretçi bulunamadı.", { visitorId: ["Ziyaretçi bulunamadı."] });
    }
    const refs = await resolveSpecialtyDoctor(app, input);
    const lead = await app.prisma.crmLead.create({
      data: {
        channel: input.channel,
        name: input.name || null,
        phone: normalizePhone(input.phone),
        email: normalizeEmail(input.email),
        country: input.country?.toUpperCase() || null,
        language: input.language || null,
        source: input.source || null,
        campaign: input.campaign || null,
        visitorId: input.visitorId ?? null,
        ...(refs as Pick<Prisma.CrmLeadUncheckedCreateInput, "specialtyId" | "specialtyName" | "doctorId" | "doctorName">),
      },
    });
    const name = await actorName(app, actor(request).id);
    if (input.note) await addLeadNote(app.prisma, lead.id, input.note, "NOTE", { id: actor(request).id, name });
    await logAudit(app, { actorId: actor(request).id, actorEmail: actor(request).email, action: "crm.lead.create", targetType: "CrmLead", targetId: lead.id, ipAddress: request.ip });
    await notifyNewLeads(app, [lead]);
    const settings = await readCrmSettings(app.prisma);
    return reply.code(201).send(ok(toLeadDto(lead, settings.slaHours, await loadAssigneeNames(app))));
  });

  app.post("/leads/bulk-status", async (request, reply) => {
    const input = parseOr422(BulkStatusSchema, request.body);
    const leads = await app.prisma.crmLead.findMany({ where: { id: { in: input.ids } }, select: { id: true, status: true, firstResponseAt: true } });
    const name = await actorName(app, actor(request).id);
    const now = new Date();
    let changed = 0;
    for (const lead of leads) {
      if (lead.status === input.status) continue;
      await app.prisma.$transaction(async (tx) => {
        await tx.crmLead.update({
          where: { id: lead.id },
          data: { status: input.status, statusChangedAt: now, ...(lead.firstResponseAt || input.status === "NEW" ? {} : { firstResponseAt: now }) },
        });
        await addLeadNote(tx, lead.id, `Durum: ${CRM_LEAD_STATUS_LABELS[lead.status]} → ${CRM_LEAD_STATUS_LABELS[input.status]}`, "STATUS", { id: actor(request).id, name });
      });
      changed++;
    }
    await logAudit(app, {
      actorId: actor(request).id,
      actorEmail: actor(request).email,
      action: "crm.lead.bulk_status",
      targetType: "CrmLead",
      metadata: { count: changed, status: input.status },
      ipAddress: request.ip,
    });
    return reply.send(ok({ updated: changed }));
  });

  app.get("/leads/:id", async (request, reply) => {
    const { id } = parseOr422(IdParam, request.params);
    const lead = await app.prisma.crmLead.findUnique({ where: { id }, include: { notes: { orderBy: { createdAt: "desc" } } } });
    if (!lead) throw new NotFoundError("Talep bulunamadı.");
    const [settings, assignees, bookingSuggestions, linkedBooking] = await Promise.all([
      readCrmSettings(app.prisma),
      loadAssigneeNames(app),
      findBookingSuggestions(app, lead),
      lead.bookingId
        ? app.prisma.appointmentBooking.findUnique({
            where: { id: lead.bookingId },
            select: { id: true, bookingNumber: true, paymentStatus: true, totalCents: true, currency: true, createdAt: true },
          })
        : Promise.resolve(null),
    ]);
    await logAudit(app, { actorId: actor(request).id, actorEmail: actor(request).email, action: "crm.lead.viewed", targetType: "CrmLead", targetId: lead.id, ipAddress: request.ip });
    return reply.send(
      ok({
        ...toLeadDto(lead, settings.slaHours, assignees),
        notes: lead.notes.map((n) => ({ id: n.id, kind: n.kind, authorName: n.authorName, body: decryptNoteBody(n.bodyCiphertext), createdAt: n.createdAt.toISOString() })),
        bookingSuggestions,
        linkedBooking: linkedBooking
          ? { ...linkedBooking, createdAt: linkedBooking.createdAt.toISOString() }
          : null,
      })
    );
  });

  app.get("/leads/:id/visitor-candidates", async (request, reply) => {
    const { id } = parseOr422(IdParam, request.params);
    const lead = await app.prisma.crmLead.findUnique({ where: { id }, select: { refCode: true, createdAt: true } });
    if (!lead) throw new NotFoundError("Talep bulunamadı.");
    return reply.send(ok(await findVisitorCandidates(app, lead)));
  });

  app.patch("/leads/:id", async (request, reply) => {
    const { id } = parseOr422(IdParam, request.params);
    const input = parseOr422(UpdateLeadSchema, request.body);
    const lead = await app.prisma.crmLead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundError("Talep bulunamadı.");

    if (input.assignedToId) {
      const user = await app.prisma.user.findFirst({ where: { id: input.assignedToId, role: { in: ["ADMIN", "MANAGER"] }, status: "ACTIVE" }, select: { id: true } });
      if (!user) throw new ValidationError("Atanacak kişi bulunamadı.", { assignedToId: ["Yalnızca aktif ADMIN/MANAGER atanabilir."] });
    }
    if (input.bookingId) {
      const booking = await app.prisma.appointmentBooking.findUnique({ where: { id: input.bookingId }, select: { id: true } });
      if (!booking) throw new ValidationError("Randevu bulunamadı.", { bookingId: ["Randevu bulunamadı."] });
    }
    if (input.visitorId) {
      const visitor = await app.prisma.crmVisitor.findUnique({ where: { id: input.visitorId }, select: { id: true } });
      if (!visitor) throw new ValidationError("Ziyaretçi bulunamadı.", { visitorId: ["Ziyaretçi bulunamadı."] });
    }

    const refs = await resolveSpecialtyDoctor(app, input);
    const now = new Date();
    const data: Prisma.CrmLeadUncheckedUpdateInput = { ...refs };
    if (input.name !== undefined) data.name = input.name || null;
    if (input.phone !== undefined) data.phone = normalizePhone(input.phone);
    if (input.email !== undefined) data.email = normalizeEmail(input.email);
    if (input.country !== undefined) data.country = input.country?.toUpperCase() || null;
    if (input.language !== undefined) data.language = input.language || null;
    if (input.assignedToId !== undefined) data.assignedToId = input.assignedToId;
    if (input.nextActionAt !== undefined) data.nextActionAt = input.nextActionAt ? new Date(input.nextActionAt) : null;
    if (input.bookingId !== undefined) data.bookingId = input.bookingId;
    if (input.visitorId !== undefined) data.visitorId = input.visitorId;
    if (input.candidate !== undefined) data.candidate = input.candidate;
    const statusChanged = input.status !== undefined && input.status !== lead.status;
    if (statusChanged) {
      data.status = input.status;
      data.statusChangedAt = now;
      if (!lead.firstResponseAt && input.status !== "NEW") data.firstResponseAt = now;
    }

    const name = await actorName(app, actor(request).id);
    const updated = await app.prisma.$transaction(async (tx) => {
      const row = await tx.crmLead.update({ where: { id }, data });
      if (statusChanged) {
        await addLeadNote(tx, id, `Durum: ${CRM_LEAD_STATUS_LABELS[lead.status]} → ${CRM_LEAD_STATUS_LABELS[input.status!]}`, "STATUS", { id: actor(request).id, name });
      }
      if (input.bookingId !== undefined && input.bookingId !== lead.bookingId) {
        await addLeadNote(tx, id, input.bookingId ? "Randevu talebe bağlandı (admin onayı)." : "Randevu bağlantısı kaldırıldı.", "SYSTEM", { id: actor(request).id, name });
      }
      if (input.visitorId !== undefined && input.visitorId !== lead.visitorId) {
        await addLeadNote(tx, id, input.visitorId ? "Ziyaretçi talebe bağlandı (admin onayı)." : "Ziyaretçi bağlantısı kaldırıldı.", "SYSTEM", { id: actor(request).id, name });
      }
      return row;
    });
    await logAudit(app, {
      actorId: actor(request).id,
      actorEmail: actor(request).email,
      action: "crm.lead.update",
      targetType: "CrmLead",
      targetId: id,
      metadata: { fields: Object.keys(input), ...(statusChanged ? { status: input.status } : {}) },
      ipAddress: request.ip,
    });
    const settings = await readCrmSettings(app.prisma);
    return reply.send(ok(toLeadDto(updated, settings.slaHours, await loadAssigneeNames(app))));
  });

  app.post("/leads/:id/notes", async (request, reply) => {
    const { id } = parseOr422(IdParam, request.params);
    const input = parseOr422(AddNoteSchema, request.body);
    const lead = await app.prisma.crmLead.findUnique({ where: { id }, select: { id: true, firstResponseAt: true, anonymizedAt: true } });
    if (!lead) throw new NotFoundError("Talep bulunamadı.");
    if (lead.anonymizedAt) throw new ValidationError("Anonimleştirilmiş talebe not eklenemez.");
    const name = await actorName(app, actor(request).id);
    const note = await app.prisma.$transaction(async (tx) => {
      const created = await addLeadNote(tx, id, input.body, "NOTE", { id: actor(request).id, name });
      if (!lead.firstResponseAt) await tx.crmLead.update({ where: { id }, data: { firstResponseAt: new Date() } });
      return created;
    });
    await logAudit(app, { actorId: actor(request).id, actorEmail: actor(request).email, action: "crm.lead.note", targetType: "CrmLead", targetId: id, ipAddress: request.ip });
    return reply.code(201).send(ok({ id: note.id, kind: note.kind, authorName: note.authorName, body: input.body, createdAt: note.createdAt.toISOString() }));
  });

  app.delete("/leads/:id", async (request, reply) => {
    const { id } = parseOr422(IdParam, request.params);
    const lead = await app.prisma.crmLead.findUnique({ where: { id }, select: { id: true, channel: true, status: true } });
    if (!lead) throw new NotFoundError("Talep bulunamadı.");
    await app.prisma.crmLead.delete({ where: { id } });
    await logAudit(app, {
      actorId: actor(request).id,
      actorEmail: actor(request).email,
      action: "crm.lead.deleted",
      targetType: "CrmLead",
      targetId: id,
      metadata: { channel: lead.channel, status: lead.status },
      ipAddress: request.ip,
    });
    return reply.code(204).send();
  });

  app.get("/funnel", async (request, reply) => {
    const query = parseOr422(FunnelQuerySchema, request.query);
    if (query.from > query.to) throw new ValidationError("Başlangıç tarihi bitişten sonra olamaz.", { from: ["Geçersiz aralık."] });
    return reply.send(ok(await computeFunnel(app, query)));
  });
}
