import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requirePanelAccess } from "../../middleware/panel-access";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { ROLES_ADMIN, ROLES_ADMIN_MANAGER } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { ConflictError, NotFoundError, ValidationError } from "../../lib/errors";
import { logAudit } from "../../lib/audit";
import { hashPassword } from "../../lib/password";
import { LOCALE_CODE_PATTERN, getLocaleSet } from "../../lib/localization";
import { env } from "../../config/env";
import { createPasswordResetToken } from "../auth/auth.service";
import { sendPasswordResetEmail } from "../email-templates/email-templates.service";
import { toCsv } from "../reports/reports.format";
import { sendBrandedMail } from "../../lib/branded-mail";
import { mergeTelehealthSettings } from "./lib/emergency-notice";
import { removeRoomParticipant } from "./lib/livekit";
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  CONFIDENTIALITY_TEXT_MAX,
  INTERPRETER_AUDIT,
  bookingSpan,
  buildInterpreterIdentity,
  conflictParties,
  findAssignableInterpreters,
  hasCurrentConfidentiality,
  initialsDisplayName,
  isConflictOfInterest,
  nativeLanguageName,
  parseConfidentialityText,
  parseInterpreterRequire2fa,
} from "./lib/interpreters";
import {
  buildInterpreterAccessGrantedEmail,
  buildInterpreterAssignmentEmail,
  buildParticipantInterpreterEmail,
  interpreterEmailLocale,
  sendInterpreterEmails,
  toNotificationLocale,
} from "./lib/interpreter-notifications";

/**
 * Paket AA — admin tarafı: tercüman hesapları (`/admin/telehealth/interpreters`), booking'e atama
 * (`/admin/telehealth/bookings/:bookingId/interpreter`), rapor (CSV) ve gizlilik taahhüdü metni.
 * Okuma ADMIN/MANAGER (randevu listesiyle aynı görünürlük); hesap oluşturma/düzenleme ve taahhüt metni
 * yalnızca ADMIN; atama ADMIN/MANAGER. Her yazma audit kaydına düşer.
 */

const languageCode = z.string().trim().toLowerCase().regex(LOCALE_CODE_PATTERN, "Geçersiz dil kodu.");
const languagesSchema = z
  .array(languageCode)
  .min(1, "En az bir dil seçin.")
  .max(20)
  .refine((codes) => new Set(codes).size === codes.length, "Aynı dil iki kez seçilemez.");
const timeZoneSchema = z
  .string()
  .trim()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Geçersiz saat dilimi.");

const CreateInterpreterSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(200),
    displayName: z.string().trim().min(2).max(80).optional(),
    languages: languagesSchema,
    timeZone: timeZoneSchema.default("Europe/Istanbul"),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();

/** Paket AA-ek — var olan kullanıcıya tercümanlık yetkisi (rolü değişmez). */
const CreateFromUserSchema = z
  .object({
    userId: z.string().uuid(),
    displayName: z.string().trim().min(2).max(80).optional(),
    languages: languagesSchema,
    timeZone: timeZoneSchema.default("Europe/Istanbul"),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();

const UserSearchQuerySchema = z.object({ q: z.string().trim().min(3).max(120) });
const UserSearchResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  isDoctor: z.boolean(),
  interpreterProfileId: z.string().nullable(),
});

const InterpreterSettingsSchema = z.object({ require2fa: z.boolean() });

/** Yeni hesap formunda e-posta zaten kayıtlıysa — ön yüz bu kodla "Var olan kullanıcıdan ekle" sekmesine yönlendirir. */
export const EMAIL_REGISTERED_USE_EXISTING = "EMAIL_REGISTERED_USE_EXISTING";

const UpdateInterpreterSchema = z
  .object({
    displayName: z.string().trim().min(2).max(80).optional(),
    languages: languagesSchema.optional(),
    timeZone: timeZoneSchema.optional(),
    isActive: z.boolean().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Güncellenecek bir alan gönderin.");

const IdParamSchema = z.object({ id: z.string().uuid() });
const BookingParamSchema = z.object({ bookingId: z.string().uuid() });

const AdminInterpreterSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  /** Kullanıcının asıl rolü (tercümanlık rolü değiştirmez). */
  role: z.string(),
  isDoctor: z.boolean(),
  displayName: z.string(),
  languages: z.array(z.string()),
  timeZone: z.string(),
  isActive: z.boolean(),
  twoFactorEnabled: z.boolean(),
  hasLoggedIn: z.boolean(),
  confidentialityAcceptedAt: z.string().nullable(),
  /** Onay güncel metne mi ait (metin değişince yeniden onay gerekir). */
  confidentialityCurrent: z.boolean(),
  notes: z.string().nullable(),
  activeAssignments: z.number().int(),
});

const AssignmentSchema = z.object({
  id: z.string(),
  interpreterId: z.string(),
  interpreterDisplayName: z.string(),
  language: z.string(),
  languageName: z.string(),
  status: z.enum(["ASSIGNED", "JOINED", "LEFT", "REMOVED", "CANCELLED"]),
  assignedAt: z.string(),
  joinedAt: z.string().nullable(),
  leftAt: z.string().nullable(),
  removedReason: z.string().nullable(),
});

const BookingInterpreterStateSchema = z.object({
  bookingId: z.string(),
  bookingNumber: z.string(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  request: z.object({ language: z.string(), languageName: z.string(), requestedAt: z.string() }).nullable(),
  active: AssignmentSchema.nullable(),
  history: z.array(AssignmentSchema),
  candidates: z.array(z.object({ id: z.string(), displayName: z.string(), languages: z.array(z.string()), twoFactorEnabled: z.boolean() })),
});

const AssignSchema = z.object({ interpreterId: z.string().uuid(), language: languageCode }).strict();
const UnassignSchema = z.object({ reason: z.string().trim().max(300).optional() }).strict();

const ReportQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  format: z.enum(["json", "csv"]).default("json"),
});

const ReportRowSchema = z.object({
  interpreterId: z.string(),
  displayName: z.string(),
  language: z.string(),
  consultations: z.number().int(),
  totalSeconds: z.number().int(),
});

const ConfidentialityTextSchema = z.object({ en: z.string(), tr: z.string(), version: z.string() });
const UpdateConfidentialityTextSchema = z
  .object({ en: z.string().trim().min(50).max(CONFIDENTIALITY_TEXT_MAX), tr: z.string().trim().min(50).max(CONFIDENTIALITY_TEXT_MAX) })
  .strict();

type ProfileWithUser = Prisma.InterpreterProfileGetPayload<{
  include: {
    user: { select: { name: true; email: true; role: true; twoFactorEnabled: true; lastLoginAt: true; doctorProfile: { select: { id: true } } } };
    _count: { select: { assignments: true } };
  };
}>;

function toAssignmentDto(row: Prisma.AppointmentInterpreterGetPayload<{ include: { interpreter: { select: { displayName: true } } } }>) {
  return {
    id: row.id,
    interpreterId: row.interpreterId,
    interpreterDisplayName: row.interpreter.displayName,
    language: row.language,
    languageName: nativeLanguageName(row.language),
    status: row.status,
    assignedAt: row.assignedAt.toISOString(),
    joinedAt: row.joinedAt?.toISOString() ?? null,
    leftAt: row.leftAt?.toISOString() ?? null,
    removedReason: row.removedReason,
  };
}

async function loadBooking(app: FastifyInstance, bookingId: string) {
  const booking = await app.prisma.appointmentBooking.findUnique({
    where: { id: bookingId },
    include: {
      appointments: { select: { id: true, startsAt: true, endsAt: true, status: true, patientUserId: true, patientEmail: true }, orderBy: { startsAt: "asc" } },
      doctor: { select: { userId: true, fullName: true, isFounder: true, publicName: true, timeZone: true, user: { select: { email: true } } } },
      interpreterRequest: true,
      interpreterAssignments: { include: { interpreter: { select: { displayName: true } } }, orderBy: { assignedAt: "desc" } },
    },
  });
  if (!booking) throw new NotFoundError("Rezervasyon bulunamadı.");
  return booking;
}

async function readConfidentiality(app: FastifyInstance) {
  const row = await app.prisma.siteModule.findUnique({ where: { key: "telehealth" }, select: { settings: true } });
  return { text: parseConfidentialityText(row?.settings), raw: row?.settings };
}

export async function adminInterpretersRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());

  function toAdminInterpreterDto(row: ProfileWithUser, text: ReturnType<typeof parseConfidentialityText>, active: number) {
    return {
      id: row.id,
      userId: row.userId,
      name: row.user.name,
      email: row.user.email,
      role: row.user.role,
      isDoctor: row.user.doctorProfile !== null,
      displayName: row.displayName,
      languages: row.languages,
      timeZone: row.timeZone,
      isActive: row.isActive,
      twoFactorEnabled: row.user.twoFactorEnabled,
      hasLoggedIn: row.user.lastLoginAt !== null,
      confidentialityAcceptedAt: row.confidentialityAcceptedAt?.toISOString() ?? null,
      confidentialityCurrent: hasCurrentConfidentiality(row, text),
      notes: row.notes,
      activeAssignments: active,
    };
  }

  const PROFILE_INCLUDE = {
    user: { select: { name: true, email: true, role: true, twoFactorEnabled: true, lastLoginAt: true, doctorProfile: { select: { id: true } } } },
    _count: { select: { assignments: true } },
  } as const;

  /**
   * Tercümanlığı kapatır (profil pasif) — kullanıcının rolüne/hesabına DOKUNULMAZ. Bitmemiş görüşmelerdeki
   * aktif atamalar `CANCELLED` olur; odada olan tercümanı temizleyici (interpreter-sweeper) çıkarır.
   */
  async function cancelOpenAssignments(profileId: string, actorId: string): Promise<number> {
    const rows = await app.prisma.appointmentInterpreter.findMany({
      where: { interpreterId: profileId, status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
      select: {
        id: true,
        status: true,
        bookingId: true,
        booking: { select: { meetingRoomName: true, appointments: { select: { startsAt: true, endsAt: true, status: true } } } },
      },
    });
    const now = Date.now();
    const open = rows.filter((row) => {
      const span = bookingSpan(row.booking.appointments.filter((a) => a.status !== "CANCELLED"));
      return span !== null && span.endsAt.getTime() > now;
    });
    let cancelled = 0;
    for (const row of open) {
      const result = await app.prisma.appointmentInterpreter.updateMany({
        where: { id: row.id, status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
        data: { status: "CANCELLED", removedById: actorId, removedReason: "interpreter_deactivated", ...(row.status === "JOINED" ? { leftAt: new Date() } : {}) },
      });
      cancelled += result.count;
      // Odadaysa hemen çıkarılır (temizleyiciyi beklemeden); başarısız olursa temizleyici yakalar.
      if (result.count > 0 && row.status === "JOINED") {
        try {
          await removeRoomParticipant(row.booking.meetingRoomName, buildInterpreterIdentity(profileId, row.bookingId));
        } catch (err) {
          app.log.info({ err: (err as Error).message }, "Tercüman odadan çıkarılamadı (odada olmayabilir); temizleyici tekrar dener.");
        }
      }
    }
    return cancelled;
  }

  async function activeCounts(ids: string[]) {
    const rows = await app.prisma.appointmentInterpreter.groupBy({
      by: ["interpreterId"],
      where: { interpreterId: { in: ids }, status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.interpreterId, r._count._all]));
  }

  server.get(
    "/",
    { preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER), schema: { response: { 200: ApiSuccessSchema(z.array(AdminInterpreterSchema)) } } },
    async (_request, reply) => {
      const [rows, { text }] = await Promise.all([
        app.prisma.interpreterProfile.findMany({ include: PROFILE_INCLUDE, orderBy: { displayName: "asc" } }),
        readConfidentiality(app),
      ]);
      const counts = await activeCounts(rows.map((r) => r.id));
      return reply.send(ok(rows.map((r) => toAdminInterpreterDto(r, text, counts.get(r.id) ?? 0))));
    }
  );

  /**
   * Hesap + profil oluşturur; tercüman şifresini mevcut davet akışıyla (şifre belirleme bağlantısı,
   * `PASSWORD_RESET` şablonu) kendisi belirler. İlk girişte gizlilik taahhüdünü onaylar ve 2FA kurar.
   */
  server.post(
    "/",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN),
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: { body: CreateInterpreterSchema, response: { 201: ApiSuccessSchema(z.object({ interpreter: AdminInterpreterSchema, emailStatus: z.enum(["sent", "failed"]) })) } },
    },
    async (request, reply) => {
      const body = request.body;
      const email = body.email.toLowerCase();
      if (await app.prisma.user.findUnique({ where: { email }, select: { id: true } })) {
        throw new ConflictError("Bu e-posta kayıtlı. Var olan kullanıcıdan ekle sekmesinden tercümanlık verebilirsiniz.", { email: [EMAIL_REGISTERED_USE_EXISTING] });
      }
      const passwordHash = await hashPassword(crypto.randomBytes(32).toString("hex"));
      const profile = await app.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { name: body.name, email, passwordHash, role: "INTERPRETER", emailVerifiedAt: new Date() } });
        return tx.interpreterProfile.create({
          data: {
            userId: user.id,
            displayName: body.displayName ?? initialsDisplayName(body.name),
            languages: body.languages,
            timeZone: body.timeZone,
            notes: body.notes ?? null,
          },
          include: PROFILE_INCLUDE,
        });
      });

      let emailStatus: "sent" | "failed" = "failed";
      try {
        const rawToken = await createPasswordResetToken(app, profile.userId);
        await sendPasswordResetEmail(app, { email, name: body.name }, `${env.FRONTEND_URL}/reset-password?token=${rawToken}`);
        emailStatus = "sent";
      } catch (err) {
        app.log.warn({ err }, "Tercüman davet e-postası gönderilemedi.");
      }

      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: INTERPRETER_AUDIT.created,
        targetType: "InterpreterProfile",
        targetId: profile.id,
        metadata: { languages: body.languages, emailStatus },
        ipAddress: request.ip,
      });
      const { text } = await readConfidentiality(app);
      return reply.status(201).send(ok({ interpreter: toAdminInterpreterDto(profile, text, 0), emailStatus }));
    }
  );

  server.patch(
    "/:id",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN),
      schema: { params: IdParamSchema, body: UpdateInterpreterSchema, response: { 200: ApiSuccessSchema(AdminInterpreterSchema) } },
    },
    async (request, reply) => {
      const existing = await app.prisma.interpreterProfile.findUnique({ where: { id: request.params.id } });
      if (!existing) throw new NotFoundError("Tercüman bulunamadı.");
      const body = request.body;
      const deactivating = existing.isActive && body.isActive === false;
      const updated = await app.prisma.interpreterProfile.update({
        where: { id: existing.id },
        data: {
          ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
          ...(body.languages !== undefined ? { languages: body.languages } : {}),
          ...(body.timeZone !== undefined ? { timeZone: body.timeZone } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
        },
        include: PROFILE_INCLUDE,
      });
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: INTERPRETER_AUDIT.updated,
        targetType: "InterpreterProfile",
        targetId: existing.id,
        metadata: { fields: Object.keys(body), isActive: updated.isActive },
        ipAddress: request.ip,
      });
      if (deactivating) {
        const cancelledAssignments = await cancelOpenAssignments(existing.id, request.user!.id);
        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: INTERPRETER_AUDIT.deactivated,
          targetType: "InterpreterProfile",
          targetId: existing.id,
          metadata: { userId: existing.userId, cancelledAssignments },
          ipAddress: request.ip,
        });
      }
      const [{ text }, counts] = await Promise.all([readConfidentiality(app), activeCounts([updated.id])]);
      return reply.send(ok(toAdminInterpreterDto(updated, text, counts.get(updated.id) ?? 0)));
    }
  );

  /** Var olan kullanıcıyı ara (e-posta / ad) — ad, e-posta, mevcut rol ve varsa tercüman profili. */
  server.get(
    "/user-search",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN),
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: { querystring: UserSearchQuerySchema, response: { 200: ApiSuccessSchema(z.array(UserSearchResultSchema)) } },
    },
    async (request, reply) => {
      const q = request.query.q;
      const users = await app.prisma.user.findMany({
        where: { deletedAt: null, status: "ACTIVE", OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] },
        select: { id: true, name: true, email: true, role: true, doctorProfile: { select: { id: true } }, interpreterProfile: { select: { id: true } } },
        orderBy: { name: "asc" },
        take: 20,
      });
      // Arama terimi audit'e YAZILMAZ (e-posta/ad olabilir) — yalnızca uzunluk ve sonuç sayısı.
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: INTERPRETER_AUDIT.userSearched,
        targetType: "User",
        targetId: null,
        metadata: { queryLength: q.length, results: users.length },
        ipAddress: request.ip,
      });
      return reply.send(
        ok(users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, isDoctor: u.doctorProfile !== null, interpreterProfileId: u.interpreterProfile?.id ?? null })))
      );
    }
  );

  /**
   * Var olan kullanıcıya tercümanlık yetkisi — rolü ve mevcut yetkileri DEĞİŞMEZ. Profili zaten varsa
   * yenisi açılmaz, mevcut profil `existing: true` ile döner. Kişiye "Tercümanlık yetkisi verildi" e-postası gider.
   */
  server.post(
    "/from-user",
    {
      preHandler: requireSiteRole(...ROLES_ADMIN),
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        body: CreateFromUserSchema,
        response: {
          200: ApiSuccessSchema(z.object({ interpreter: AdminInterpreterSchema, existing: z.literal(true) })),
          201: ApiSuccessSchema(z.object({ interpreter: AdminInterpreterSchema, existing: z.literal(false), emailStatus: z.enum(["sent", "failed"]) })),
        },
      },
    },
    async (request, reply) => {
      const body = request.body;
      const user = await app.prisma.user.findFirst({ where: { id: body.userId, deletedAt: null }, select: { id: true, name: true, email: true, role: true, status: true } });
      if (!user) throw new NotFoundError("Kullanıcı bulunamadı.");
      const { text, raw } = await readConfidentiality(app);
      const current = await app.prisma.interpreterProfile.findUnique({ where: { userId: user.id }, include: PROFILE_INCLUDE });
      if (current) {
        const counts = await activeCounts([current.id]);
        return reply.status(200).send(ok({ interpreter: toAdminInterpreterDto(current, text, counts.get(current.id) ?? 0), existing: true as const }));
      }
      if (user.status !== "ACTIVE") throw new ConflictError("Bu hesap aktif değil; önce hesabı etkinleştirin.");
      let profile;
      try {
        profile = await app.prisma.interpreterProfile.create({
          data: { userId: user.id, displayName: body.displayName ?? initialsDisplayName(user.name), languages: body.languages, timeZone: body.timeZone, notes: body.notes ?? null },
          include: PROFILE_INCLUDE,
        });
      } catch (err) {
        if ((err as { code?: string }).code === "P2002") throw new ConflictError("Bu kullanıcının tercüman profili az önce oluşturuldu; sayfayı yenileyin.");
        throw err;
      }

      const locale = interpreterEmailLocale(body.languages);
      const granted = buildInterpreterAccessGrantedEmail({
        locale,
        panelUrl: `${env.FRONTEND_URL}/${locale}/interpreter`,
        twoFactorRequired: parseInterpreterRequire2fa(raw),
      });
      let emailStatus: "sent" | "failed" = "failed";
      try {
        await sendBrandedMail(app, { to: user.email, subject: granted.subject, preheader: granted.subject, bodyHtml: granted.html, locale: granted.locale, audience: granted.audience, ...(granted.cta ? { cta: granted.cta } : {}) });
        emailStatus = "sent";
      } catch (err) {
        // Alıcı adresi loga düşmesin diye yalnızca hata mesajı.
        app.log.warn({ err: (err as Error).message }, "Tercümanlık yetkisi e-postası gönderilemedi.");
      }

      // E-posta adresi audit'e YAZILMAZ — yalnızca kullanıcı kimliği ve rolü.
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: INTERPRETER_AUDIT.profileCreatedForExistingUser,
        targetType: "InterpreterProfile",
        targetId: profile.id,
        metadata: { userId: user.id, role: user.role, languages: body.languages, emailStatus },
        ipAddress: request.ip,
      });
      return reply.status(201).send(ok({ interpreter: toAdminInterpreterDto(profile, text, 0), existing: false as const, emailStatus }));
    }
  );

  /** Tercüman ayarları — şimdilik yalnızca 2FA zorunluluğu (varsayılan kapalı). */
  server.get(
    "/settings",
    { preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER), schema: { response: { 200: ApiSuccessSchema(InterpreterSettingsSchema) } } },
    async (_request, reply) => reply.send(ok({ require2fa: parseInterpreterRequire2fa((await readConfidentiality(app)).raw) }))
  );

  server.put(
    "/settings",
    { preHandler: requireSiteRole(...ROLES_ADMIN), schema: { body: InterpreterSettingsSchema.strict(), response: { 200: ApiSuccessSchema(InterpreterSettingsSchema) } } },
    async (request, reply) => {
      const { raw } = await readConfidentiality(app);
      const before = parseInterpreterRequire2fa(raw);
      const merged = mergeTelehealthSettings(raw, { interpreterRequire2fa: request.body.require2fa });
      const row = await app.prisma.siteModule.upsert({
        where: { key: "telehealth" },
        create: { key: "telehealth", settings: merged, updatedById: request.user!.id },
        update: { settings: merged, updatedById: request.user!.id },
      });
      const after = parseInterpreterRequire2fa(row.settings);
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: INTERPRETER_AUDIT.settingsUpdated,
        targetType: "SiteModule",
        targetId: "telehealth",
        metadata: { require2faBefore: before, require2faAfter: after },
        ipAddress: request.ip,
      });
      return reply.send(ok({ require2fa: after }));
    }
  );

  server.post(
    "/:id/resend-invite",
    { preHandler: requireSiteRole(...ROLES_ADMIN), config: { rateLimit: { max: 10, timeWindow: "1 minute" } }, schema: { params: IdParamSchema, response: { 200: ApiSuccessSchema(z.object({ emailStatus: z.enum(["sent", "failed"]) })) } } },
    async (request, reply) => {
      const profile = await app.prisma.interpreterProfile.findUnique({ where: { id: request.params.id }, include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true } } } });
      if (!profile) throw new NotFoundError("Tercüman bulunamadı.");
      if (profile.user.lastLoginAt) throw new ConflictError("Tercüman hesabını zaten etkinleştirmiş; şifresini giriş ekranındaki 'Şifremi unuttum' ile yenileyebilir.");
      const rawToken = await createPasswordResetToken(app, profile.user.id);
      try {
        await sendPasswordResetEmail(app, profile.user, `${env.FRONTEND_URL}/reset-password?token=${rawToken}`);
        return reply.send(ok({ emailStatus: "sent" as const }));
      } catch (err) {
        app.log.warn({ err }, "Tercüman davet e-postası yeniden gönderilemedi.");
        return reply.send(ok({ emailStatus: "failed" as const }));
      }
    }
  );

  /** Tercüman bazında görüşme sayısı, dil ve toplam süre — audit join/leave verisinden. */
  server.get(
    "/report",
    { preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER), schema: { querystring: ReportQuerySchema } },
    async (request, reply) => {
      const from = new Date(`${request.query.from}T00:00:00+03:00`);
      const to = new Date(new Date(`${request.query.to}T00:00:00+03:00`).getTime() + 86_400_000);
      if (!(from < to)) throw new ValidationError("Geçersiz tarih aralığı.", { from: ["Başlangıç bitişten önce olmalı."] });
      const rows = await buildInterpreterReport(app, from, to);
      if (request.query.format === "csv") {
        const csv = toCsv(
          ["Tercüman", "Dil", "Görüşme sayısı", "Toplam süre (dk)"],
          rows.map((r) => [r.displayName, r.language, r.consultations, Math.round(r.totalSeconds / 60)])
        );
        return reply
          .header("content-type", "text/csv; charset=utf-8")
          .header("content-disposition", `attachment; filename="tercuman-raporu-${request.query.from}-${request.query.to}.csv"`)
          .header("cache-control", "no-store")
          .send(csv);
      }
      return reply.send(ok(z.array(ReportRowSchema).parse(rows)));
    }
  );

  server.get(
    "/confidentiality-text",
    { preHandler: requireSiteRole(...ROLES_ADMIN_MANAGER), schema: { response: { 200: ApiSuccessSchema(ConfidentialityTextSchema) } } },
    async (_request, reply) => reply.send(ok((await readConfidentiality(app)).text))
  );

  /** HUKUK KONTROLÜ GEREKLİ metin. Değişince sürüm değişir ve tercümanlardan yeniden onay istenir. */
  server.put(
    "/confidentiality-text",
    { preHandler: requireSiteRole(...ROLES_ADMIN), schema: { body: UpdateConfidentialityTextSchema, response: { 200: ApiSuccessSchema(ConfidentialityTextSchema) } } },
    async (request, reply) => {
      const { text: before, raw } = await readConfidentiality(app);
      const merged = mergeTelehealthSettings(raw, { interpreterConfidentiality: { en: request.body.en, tr: request.body.tr } });
      const row = await app.prisma.siteModule.upsert({
        where: { key: "telehealth" },
        create: { key: "telehealth", settings: merged, updatedById: request.user!.id },
        update: { settings: merged, updatedById: request.user!.id },
      });
      const after = parseConfidentialityText(row.settings);
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: INTERPRETER_AUDIT.confidentialityTextUpdated,
        targetType: "SiteModule",
        targetId: "telehealth",
        metadata: { versionBefore: before.version, versionAfter: after.version },
        ipAddress: request.ip,
      });
      return reply.send(ok(after));
    }
  );
}

/** Rapor: `interpreter.joined`/`interpreter.left` audit satırları (süre `left.durationSeconds`). */
export async function buildInterpreterReport(app: FastifyInstance, from: Date, to: Date) {
  const joined = await app.prisma.auditLog.findMany({
    where: { action: INTERPRETER_AUDIT.joined, createdAt: { gte: from, lt: to } },
    select: { metadata: true },
  });
  const left = await app.prisma.auditLog.findMany({
    where: { action: INTERPRETER_AUDIT.left, createdAt: { gte: from, lt: to } },
    select: { metadata: true },
  });
  const meta = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const key = (interpreterId: string, language: string) => `${interpreterId}|${language}`;
  const acc = new Map<string, { interpreterId: string; language: string; bookings: Set<string>; totalSeconds: number }>();
  for (const row of joined) {
    const m = meta(row.metadata);
    if (typeof m.interpreterId !== "string" || typeof m.language !== "string" || typeof m.bookingId !== "string") continue;
    const k = key(m.interpreterId, m.language);
    const entry = acc.get(k) ?? { interpreterId: m.interpreterId, language: m.language, bookings: new Set<string>(), totalSeconds: 0 };
    entry.bookings.add(m.bookingId);
    acc.set(k, entry);
  }
  for (const row of left) {
    const m = meta(row.metadata);
    if (typeof m.interpreterId !== "string" || typeof m.language !== "string" || typeof m.durationSeconds !== "number") continue;
    const entry = acc.get(key(m.interpreterId, m.language));
    if (entry) entry.totalSeconds += Math.max(0, Math.round(m.durationSeconds));
  }
  const profiles = await app.prisma.interpreterProfile.findMany({ where: { id: { in: [...new Set([...acc.values()].map((e) => e.interpreterId))] } }, select: { id: true, displayName: true } });
  const names = new Map(profiles.map((p) => [p.id, p.displayName]));
  return [...acc.values()]
    .map((e) => ({ interpreterId: e.interpreterId, displayName: names.get(e.interpreterId) ?? "—", language: e.language, consultations: e.bookings.size, totalSeconds: e.totalSeconds }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "tr") || a.language.localeCompare(b.language));
}

/**
 * Booking'e tercüman atama — `/admin/telehealth/bookings/:bookingId/interpreter`. ADMIN/MANAGER.
 * Atama kaldırılır ya da değiştirilirse eski tercüman o anda odadaysa sunucu tarafında çıkarılır;
 * aktif ataması olmadığı için yeni token alamaz.
 */
export async function adminBookingInterpreterRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requirePanelAccess());
  server.addHook("preHandler", requireSiteRole(...ROLES_ADMIN_MANAGER));

  async function buildState(bookingId: string, language?: string) {
    const booking = await loadBooking(app, bookingId);
    const { text } = await readConfidentiality(app);
    const span = bookingSpan(booking.appointments.filter((a) => a.status !== "CANCELLED"));
    const active = booking.interpreterAssignments.find((a) => ACTIVE_ASSIGNMENT_STATUSES.includes(a.status)) ?? null;
    const wanted = language ?? booking.interpreterRequest?.language ?? active?.language;
    const candidates = span
      ? await findAssignableInterpreters(app.prisma, {
          span,
          language: wanted,
          confidentiality: text,
          excludeBookingId: booking.id,
          exclude: conflictParties(booking),
        })
      : [];
    return {
      bookingId: booking.id,
      bookingNumber: booking.bookingNumber,
      startsAt: span?.startsAt.toISOString() ?? null,
      endsAt: span?.endsAt.toISOString() ?? null,
      request: booking.interpreterRequest
        ? { language: booking.interpreterRequest.language, languageName: nativeLanguageName(booking.interpreterRequest.language), requestedAt: booking.interpreterRequest.requestedAt.toISOString() }
        : null,
      active: active ? toAssignmentDto(active) : null,
      history: booking.interpreterAssignments.filter((a) => !ACTIVE_ASSIGNMENT_STATUSES.includes(a.status)).map(toAssignmentDto),
      candidates: candidates.map((c) => ({ id: c.id, displayName: c.displayName, languages: c.languages, twoFactorEnabled: c.user.twoFactorEnabled })),
    };
  }

  /** Aktif atamayı kapatır (CANCELLED) ve tercüman odadaysa sunucu tarafında çıkarır. */
  async function closeActive(bookingId: string, actorId: string, reason: string | null) {
    const active = await app.prisma.appointmentInterpreter.findFirst({
      where: { bookingId, status: { in: ACTIVE_ASSIGNMENT_STATUSES } },
      include: { booking: { select: { meetingRoomName: true } } },
    });
    if (!active) return null;
    await app.prisma.appointmentInterpreter.update({
      where: { id: active.id },
      data: { status: "CANCELLED", removedById: actorId, removedReason: reason, ...(active.status === "JOINED" ? { leftAt: new Date() } : {}) },
    });
    try {
      const removed = await removeRoomParticipant(active.booking.meetingRoomName, buildInterpreterIdentity(active.interpreterId, bookingId));
      if (!removed) app.log.warn("LIVEKIT_INTERNAL_URL boş — tercüman sunucu tarafında odadan çıkarılamadı; atama kapatıldı, yeni token alamaz.");
    } catch (err) {
      // Tercüman odada değilse LiveKit "not found" döner — atama yine kapatıldı.
      app.log.info({ err }, "Tercüman odadan çıkarılamadı (odada olmayabilir).");
    }
    return active;
  }

  server.get(
    "/:bookingId/interpreter",
    { schema: { params: BookingParamSchema, querystring: z.object({ language: languageCode.optional() }), response: { 200: ApiSuccessSchema(BookingInterpreterStateSchema) } } },
    async (request, reply) => reply.send(ok(await buildState(request.params.bookingId, request.query.language)))
  );

  server.post(
    "/:bookingId/interpreter",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } }, schema: { params: BookingParamSchema, body: AssignSchema, response: { 200: ApiSuccessSchema(BookingInterpreterStateSchema) } } },
    async (request, reply) => {
      const booking = await loadBooking(app, request.params.bookingId);
      const { text } = await readConfidentiality(app);
      const span = bookingSpan(booking.appointments.filter((a) => a.status !== "CANCELLED"));
      if (!span) throw new ConflictError("Bu rezervasyonda randevu yok.");
      if (span.endsAt.getTime() < Date.now()) throw new ConflictError("Geçmiş bir görüşmeye tercüman atanamaz.");
      if (booking.appointments.every((a) => a.status === "CANCELLED" || a.status === "COMPLETED")) {
        throw new ConflictError("Biten ya da iptal edilen görüşmeye tercüman atanamaz.");
      }
      const target = await app.prisma.interpreterProfile.findUnique({ where: { id: request.body.interpreterId }, select: { user: { select: { id: true, email: true } } } });
      if (target && isConflictOfInterest(target.user, booking)) {
        throw new ValidationError("Bu kişi bu görüşmenin hastası ya da doktoru; tercüman olarak atanamaz (çıkar çatışması).", { interpreterId: ["Çıkar çatışması."] });
      }
      const assignable = await findAssignableInterpreters(app.prisma, {
        span,
        language: request.body.language,
        confidentiality: text,
        excludeBookingId: booking.id,
        exclude: conflictParties(booking),
      });
      const interpreter = assignable.find((c) => c.id === request.body.interpreterId);
      if (!interpreter) {
        throw new ValidationError("Bu tercüman atanamaz (pasif, taahhüt onayı yok, dili konuşmuyor ya da o saatte başka görevi var).", {
          interpreterId: ["Uygun değil."],
        });
      }

      const previous = await closeActive(booking.id, request.user!.id, "replaced");
      if (previous) {
        await logAudit(app, {
          actorId: request.user!.id,
          actorEmail: request.user!.email,
          action: INTERPRETER_AUDIT.unassigned,
          targetType: "AppointmentBooking",
          targetId: booking.id,
          metadata: { assignmentId: previous.id, interpreterId: previous.interpreterId, reason: "replaced" },
          ipAddress: request.ip,
        });
      }
      let created;
      try {
        created = await app.prisma.appointmentInterpreter.create({
          data: { bookingId: booking.id, interpreterId: interpreter.id, language: request.body.language, assignedById: request.user!.id },
        });
      } catch (err) {
        // Eşzamanlı iki atama: kısmi tekil indeks (booking başına 1 aktif) ikincisini reddeder.
        if ((err as { code?: string }).code === "P2002") throw new ConflictError("Bu rezervasyona az önce başka bir tercüman atandı; sayfayı yenileyin.");
        throw err;
      }
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: INTERPRETER_AUDIT.assigned,
        targetType: "AppointmentBooking",
        targetId: booking.id,
        // Admin kendini tercüman olarak atadıysa ayrıca işaretlenir (izlenebilirlik).
        metadata: { assignmentId: created.id, interpreterId: interpreter.id, language: request.body.language, selfAssigned: target?.user.id === request.user!.id },
        ipAddress: request.ip,
      });

      // Bildirimler (alıcının dilinde). Tercümana hasta adı/şikayeti/belgesi GÖNDERİLMEZ.
      const locales = await getLocaleSet(app);
      const defaultLocale = toNotificationLocale(locales.default.code);
      const interpreterLocale = interpreterEmailLocale(interpreter.languages);
      const toInterpreter = buildInterpreterAssignmentEmail({
        locale: interpreterLocale,
        startsAt: span.startsAt,
        interpreterTimeZone: (await app.prisma.interpreterProfile.findUnique({ where: { id: interpreter.id }, select: { timeZone: true } }))?.timeZone ?? "Europe/Istanbul",
        language: request.body.language,
        panelUrl: `${env.FRONTEND_URL}/${interpreterLocale}/interpreter`,
      });
      const toPatient = buildParticipantInterpreterEmail({
        locale: toNotificationLocale(request.body.language, defaultLocale),
        audience: "patient",
        startsAt: span.startsAt,
        timeZone: booking.patientTimeZone ?? "Europe/Istanbul",
        language: request.body.language,
        interpreterDisplayName: interpreter.displayName,
      });
      const toDoctor = buildParticipantInterpreterEmail({
        locale: defaultLocale,
        audience: "doctor",
        startsAt: span.startsAt,
        timeZone: booking.doctor.timeZone,
        language: request.body.language,
        interpreterDisplayName: interpreter.displayName,
      });
      await sendInterpreterEmails(app, [
        { to: interpreter.user.email, ...toInterpreter },
        { to: booking.patientEmail, ...toPatient },
        { to: booking.doctor.user?.email, ...toDoctor },
      ]);
      return reply.send(ok(await buildState(booking.id, request.body.language)));
    }
  );

  server.delete(
    "/:bookingId/interpreter",
    { schema: { params: BookingParamSchema, body: UnassignSchema.optional(), response: { 200: ApiSuccessSchema(BookingInterpreterStateSchema) } } },
    async (request, reply) => {
      const booking = await loadBooking(app, request.params.bookingId);
      const closed = await closeActive(booking.id, request.user!.id, request.body?.reason ?? null);
      if (!closed) throw new NotFoundError("Aktif tercüman ataması yok.");
      await logAudit(app, {
        actorId: request.user!.id,
        actorEmail: request.user!.email,
        action: INTERPRETER_AUDIT.unassigned,
        targetType: "AppointmentBooking",
        targetId: booking.id,
        metadata: { assignmentId: closed.id, interpreterId: closed.interpreterId, reason: request.body?.reason ?? null },
        ipAddress: request.ip,
      });
      return reply.send(ok(await buildState(booking.id)));
    }
  );
}
