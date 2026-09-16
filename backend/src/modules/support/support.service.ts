import type { FastifyInstance } from "fastify";
import type { SupportChatSession, SupportChatMessage, User } from "@prisma/client";
import { generateOpaqueToken, hashToken } from "../../lib/tokens";
import { timingSafeEqualHex } from "../../lib/api-key";
import { ValidationError, SupportSessionClosedError, SupportMessageLimitError } from "../../lib/errors";
import { SETTINGS_ID } from "../settings/settings.routes";

/**
 * `.claude/architect-scope-support-desk-and-reminders.md` §3 — Canlı Destek iş mantığı.
 * `support.routes.ts` (admin) ve `support.public.routes.ts` (ziyaretçi) BU dosyayı çağırır;
 * route dosyaları yalnızca doğrulama/yetkilendirme/audit/HTTP kodları taşır.
 */

/** Oturum başına üst sınır (§3.6 madde 4, bağlayıcı). */
export const SUPPORT_MESSAGE_LIMIT = 200;

const WITH_AGENT_SELECT = { select: { id: true, name: true, role: true } } as const;

export const WITH_SESSION_RELATIONS = {
  assignedAgent: WITH_AGENT_SELECT,
  closedBy: WITH_AGENT_SELECT,
} as const;

export type SupportAgentLike = Pick<User, "id" | "name" | "role">;
export type SupportChatSessionWithRelations = SupportChatSession & {
  assignedAgent: SupportAgentLike | null;
  closedBy: SupportAgentLike | null;
};

/**
 * [ASD] §3.1 — `liveChatEnabled = true` VE `liveChatProvider === "internal"` DEĞİLSE public
 * uçlar 404 verir (modül kapalı davranışıyla AYNI, ayrım yapılmaz). Satır yoksa (henüz hiç
 * `PATCH /admin/settings` çağrılmamış taze kurulum) `settings.routes.ts::DEFAULTS.liveChatEnabled
 * = false` ile TUTARLI şekilde "kapalı" sayılır.
 */
export async function isInternalLiveChatEnabled(app: FastifyInstance): Promise<boolean> {
  const settings = await app.prisma.siteSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: { liveChatEnabled: true, liveChatProvider: true },
  });
  if (!settings) return false;
  return settings.liveChatEnabled === true && settings.liveChatProvider === "internal";
}

/**
 * Ziyaretçi token doğrulaması — `telehealth.livekit.routes.ts::isAuthorizedForMeetingAccess`
 * disipliniyle AYNI: SABİT ZAMANLI karşılaştırma (`timingSafeEqualHex`), yanlış/eksik token için
 * `null` döner (çağıran taraf bunu `404`'e çevirir — varlık sızdırılmaz).
 */
export async function findSessionByAccessToken(app: FastifyInstance, sessionId: string, rawToken: string | undefined): Promise<SupportChatSessionWithRelations | null> {
  if (!rawToken) return null;
  const session = await app.prisma.supportChatSession.findUnique({
    where: { id: sessionId },
    include: WITH_SESSION_RELATIONS,
  });
  if (!session) return null;
  const providedHash = hashToken(rawToken);
  if (!timingSafeEqualHex(providedHash, session.accessTokenHash)) return null;
  return session;
}

/** Son temsilci mesajından SONRA gelen ziyaretçi mesajı sayısı — temsilci hiç yazmadıysa TÜMÜ. */
export async function computeUnreadForAgent(app: FastifyInstance, sessionId: string, lastAgentMessageAt: Date | null): Promise<number> {
  return app.prisma.supportChatMessage.count({
    where: {
      sessionId,
      senderType: "VISITOR",
      ...(lastAgentMessageAt ? { createdAt: { gt: lastAgentMessageAt } } : {}),
    },
  });
}

/** Son mesajın ilk 120 karakteri, düz metin — `null` = hiç mesaj yok (teorik, oturum İLK mesajla açılır). */
export async function fetchLastMessagePreview(app: FastifyInstance, sessionId: string): Promise<string | null> {
  const last = await app.prisma.supportChatMessage.findFirst({
    where: { sessionId },
    orderBy: { seq: "desc" },
    select: { body: true },
  });
  if (!last) return null;
  return last.body.length > 120 ? `${last.body.slice(0, 120)}` : last.body;
}

/**
 * [ASD] §3.1 (ilk mesaj BİRLİKTE) — oturum + ilk ziyaretçi mesajı TEK transaction'da oluşturulur.
 * `accessToken` HAM değeri yalnızca burada üretilir ve çağıran tarafa (route) döner — bir daha
 * ASLA okunamaz (`lib/tokens.ts` deseni, `Appointment.accessTokenHash` İLE AYNI).
 */
export async function createSupportSessionWithFirstMessage(
  app: FastifyInstance,
  input: {
    message: string;
    visitorName: string | null;
    visitorEmail: string | null;
    visitorUserId: string | null;
    pageUrl: string | null;
    locale: string | null;
    ipAddress: string | null;
    userAgent: string | null;
  }
): Promise<{ session: SupportChatSession; message: SupportChatMessage; rawAccessToken: string }> {
  const rawAccessToken = generateOpaqueToken();
  const accessTokenHash = hashToken(rawAccessToken);
  const now = new Date();

  const { session, message } = await app.prisma.$transaction(async (tx) => {
    const createdSession = await tx.supportChatSession.create({
      data: {
        status: "PENDING",
        visitorName: input.visitorName,
        visitorEmail: input.visitorEmail,
        visitorUserId: input.visitorUserId,
        accessTokenHash,
        pageUrl: input.pageUrl,
        locale: input.locale,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        lastMessageAt: now,
        lastVisitorMessageAt: now,
        messageCount: 1,
      },
    });
    const createdMessage = await tx.supportChatMessage.create({
      data: {
        sessionId: createdSession.id,
        senderType: "VISITOR",
        body: input.message,
      },
    });
    return { session: createdSession, message: createdMessage };
  });

  return { session, message, rawAccessToken };
}

/**
 * [ASD] §3.5 (bağlayıcı) — ziyaretçi mesajı. `CLOSED` → `SupportSessionClosedError` (409);
 * 200. mesaj denemesi → `SupportMessageLimitError` (409). Başarılı gönderim `ANSWERED → PENDING`
 * geri çeker (`PENDING` zaten `PENDING` kalır) ve `lastVisitorMessageAt`/`lastMessageAt`/
 * `messageCount`'ı AYNI transaction'da günceller.
 */
export async function appendVisitorMessage(app: FastifyInstance, session: SupportChatSession, body: string): Promise<SupportChatMessage> {
  if (session.status === "CLOSED") throw new SupportSessionClosedError();
  if (session.messageCount >= SUPPORT_MESSAGE_LIMIT) throw new SupportMessageLimitError();

  const now = new Date();
  return app.prisma.$transaction(async (tx) => {
    const created = await tx.supportChatMessage.create({
      data: { sessionId: session.id, senderType: "VISITOR", body },
    });
    await tx.supportChatSession.update({
      where: { id: session.id },
      data: {
        status: "PENDING",
        lastMessageAt: now,
        lastVisitorMessageAt: now,
        messageCount: { increment: 1 },
      },
    });
    return created;
  });
}

/**
 * [ASD] §3.5 (bağlayıcı) — temsilci yanıtı. Aynı `CLOSED`/200-mesaj kısıtı. Yan etkiler:
 * `status → ANSWERED`, `lastAgentMessageAt` güncellenir, oturum ATANMAMIŞSA gönderene OTOMATİK
 * atanır ("yanıtlayan sahiplenir" — zaten atanmışsa DEĞİŞMEZ), `templateId` verilmişse
 * `SupportReplyTemplate.usageCount` artar. `senderDisplayName` gönderim ANINDAKİ ad SNAPSHOT'ıdır.
 */
export async function appendAgentMessage(
  app: FastifyInstance,
  session: SupportChatSession,
  actor: { id: string; name: string },
  body: string,
  templateId: string | null
): Promise<{ message: SupportChatMessage; autoAssigned: boolean }> {
  if (session.status === "CLOSED") throw new SupportSessionClosedError();
  if (session.messageCount >= SUPPORT_MESSAGE_LIMIT) throw new SupportMessageLimitError();

  if (templateId) {
    const template = await app.prisma.supportReplyTemplate.findUnique({ where: { id: templateId }, select: { id: true } });
    if (!template) {
      throw new ValidationError("templateId geçersiz.", { templateId: ["Şablon bulunamadı."] });
    }
  }

  const now = new Date();
  const autoAssigned = session.assignedAgentId === null;

  const message = await app.prisma.$transaction(async (tx) => {
    const created = await tx.supportChatMessage.create({
      data: {
        sessionId: session.id,
        senderType: "AGENT",
        senderUserId: actor.id,
        senderDisplayName: actor.name,
        body,
      },
    });
    await tx.supportChatSession.update({
      where: { id: session.id },
      data: {
        status: "ANSWERED",
        lastMessageAt: now,
        lastAgentMessageAt: now,
        messageCount: { increment: 1 },
        ...(autoAssigned ? { assignedAgentId: actor.id, assignedAt: now } : {}),
      },
    });
    if (templateId) {
      await tx.supportReplyTemplate.update({ where: { id: templateId }, data: { usageCount: { increment: 1 } } });
    }
    return created;
  });

  return { message, autoAssigned };
}

/**
 * [ASD] §3.2/§3.5 (bağlayıcı) — hedef `agentId` `null` DEĞİLSE `status = ACTIVE` VE
 * `role ∈ {ADMIN, MANAGER}` VE `deletedAt IS NULL` olmalıdır; aksi hâlde `422` (`404` DEĞİL —
 * hata gövdeye ait bir alandadır, kaynağa değil).
 */
export async function assertValidAssignmentTarget(app: FastifyInstance, agentId: string | null): Promise<void> {
  if (agentId === null) return;
  const target = await app.prisma.user.findFirst({
    where: { id: agentId, status: "ACTIVE", deletedAt: null, role: { in: ["ADMIN", "MANAGER"] } },
    select: { id: true },
  });
  if (!target) {
    throw new ValidationError("agentId geçersiz.", { agentId: ["Hedef kullanıcı uygun değil (ACTIVE + ADMIN/MANAGER olmalı)."] });
  }
}
