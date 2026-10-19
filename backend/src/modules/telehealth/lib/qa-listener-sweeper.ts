import type { FastifyInstance } from "fastify";
import { env } from "../../../config/env";
import { logAudit } from "../../../lib/audit";
import { QA_LISTENER_IDENTITY_PREFIX, listRoomParticipantIdentities, removeRoomParticipant } from "./livekit";

/**
 * Paket G (2026-10-19, güvenlik notu O-2/B-3) — QA dinleyici oturumlarının sunucu tarafında
 * kapatılması. Eskiden oturum yalnızca istemcinin `leave` çağrısıyla kapanıyordu; LiveKit bağlı
 * katılımcının token'ını yenilediği için 10 dk TTL oturumu sınırlamıyordu.
 *
 * Dakikada bir: son 24 saatte açılmış ve `left` kaydı olmayan her oturum için
 *   - 60 dk aşıldıysa                         → `auto:max_duration`
 *   - randevu artık `IN_PROGRESS` değilse      → `auto:appointment_ended`
 *   - admin artık aktif ADMIN değil / 2FA kapalı → `auto:actor_revoked`
 * dinleyici odadan çıkarılır ve `left` kaydı yazılır. Ayrıca açık ve geçerli bir oturuma ait
 * OLMAYAN `qa-listener-` katılımcıları da (ör. kapatılmış oturumun yenilenmiş token'la geri
 * bağlanması) odadan atılır.
 *
 * GÜVENLİK KURALI: yalnızca `qa-listener-` önekli katılımcı atılabilir (`removeListener`) — hasta ve
 * doktor katılımcılarına bu modülden hiçbir şekilde dokunulamaz.
 *
 * Atma başarısız olursa `left` YAZILMAZ ve sonraki turda tekrar denenir; `MAX_REMOVE_ATTEMPTS`
 * sonra `removed: false` ile yazılıp hata loglanır (kayıt dürüst kalır). `LIVEKIT_INTERNAL_URL`
 * boşsa odadan atılamaz; kayıt `removed: false` ile kapatılır.
 */

export const QA_LISTENER_MAX_SESSION_MS = 60 * 60 * 1000;
export const QA_LISTENER_SWEEP_INTERVAL_MS = 60 * 1000;
export const QA_LISTENER_SWEEP_LOOKBACK_MS = 24 * 60 * 60 * 1000;
export const QA_LISTENER_MAX_REMOVE_ATTEMPTS = 5;
export const QA_LISTENER_STRAY_REMOVED_ACTION = "telehealth.qa_listener.stray_removed";

const JOINED_ACTION = "telehealth.qa_listener.joined";
const LEFT_ACTION = "telehealth.qa_listener.left";

export type QaListenerAutoCloseReason = "auto:max_duration" | "auto:appointment_ended" | "auto:actor_revoked";

export interface QaListenerSweepDeps {
  listParticipants: (roomName: string) => Promise<string[] | null>;
  removeParticipant: (roomName: string, identity: string) => Promise<boolean>;
}

export interface QaListenerSweepOptions {
  now?: Date;
  deps?: QaListenerSweepDeps;
  /** Oturum başına başarısız atma sayısı — turlar arasında `register...` tarafından tutulur. */
  removeFailures?: Map<string, number>;
}

export interface QaListenerSweepResult {
  closed: Array<{ sessionId: string; reason: QaListenerAutoCloseReason; removed: boolean }>;
  strayRemoved: Array<{ roomName: string; identity: string }>;
}

const DEFAULT_DEPS: QaListenerSweepDeps = {
  listParticipants: (roomName) => listRoomParticipantIdentities(roomName),
  removeParticipant: (roomName, identity) => removeRoomParticipant(roomName, identity),
};

type JoinedMeta = { sessionId?: string; identity?: string; roomName?: string };

function readMeta(value: unknown): JoinedMeta {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JoinedMeta) : {};
}

export function isQaListenerIdentity(identity: string): boolean {
  return identity.startsWith(QA_LISTENER_IDENTITY_PREFIX);
}

/** Tek atma kapısı — önek tutmuyorsa ASLA çağrı yapılmaz. */
async function removeListener(deps: QaListenerSweepDeps, roomName: string, identity: string): Promise<"removed" | "absent" | "unavailable"> {
  if (!isQaListenerIdentity(identity)) throw new Error("QA dinleyici olmayan katılımcı atılamaz.");
  const present = await deps.listParticipants(roomName);
  if (present === null) return "unavailable";
  if (!present.includes(identity)) return "absent";
  const done = await deps.removeParticipant(roomName, identity);
  return done ? "removed" : "unavailable";
}

export async function runQaListenerSweep(app: FastifyInstance, options: QaListenerSweepOptions = {}): Promise<QaListenerSweepResult> {
  const now = options.now ?? new Date();
  const deps = options.deps ?? DEFAULT_DEPS;
  const removeFailures = options.removeFailures ?? new Map<string, number>();
  const result: QaListenerSweepResult = { closed: [], strayRemoved: [] };

  const joinedRows = await app.prisma.auditLog.findMany({
    where: { action: JOINED_ACTION, targetType: "Appointment", createdAt: { gte: new Date(now.getTime() - QA_LISTENER_SWEEP_LOOKBACK_MS) } },
    select: { actorId: true, actorEmail: true, targetId: true, metadata: true, createdAt: true },
  });
  if (joinedRows.length === 0) return result;

  const sessions = joinedRows
    .map((row) => ({ ...row, meta: readMeta(row.metadata) }))
    .filter((row) => row.meta.sessionId && row.meta.identity && row.meta.roomName && row.targetId);

  const leftRows = await app.prisma.auditLog.findMany({
    where: {
      action: LEFT_ACTION,
      OR: sessions.map((s) => ({ metadata: { path: ["sessionId"], equals: s.meta.sessionId! } })),
    },
    select: { metadata: true },
  });
  const leftSessionIds = new Set(leftRows.map((row) => readMeta(row.metadata).sessionId).filter(Boolean));
  const open = sessions.filter((s) => !leftSessionIds.has(s.meta.sessionId!));

  const [appointments, actors] = await Promise.all([
    app.prisma.appointment.findMany({ where: { id: { in: open.map((s) => s.targetId!) } }, select: { id: true, status: true } }),
    app.prisma.user.findMany({
      where: { id: { in: open.map((s) => s.actorId).filter((id): id is string => Boolean(id)) } },
      select: { id: true, status: true, role: true, twoFactorEnabled: true },
    }),
  ]);
  const statusById = new Map(appointments.map((a) => [a.id, a.status]));
  const actorById = new Map(actors.map((u) => [u.id, u]));

  const stillValidIdentities = new Set<string>();
  for (const session of open) {
    const sessionId = session.meta.sessionId!;
    const actor = session.actorId ? actorById.get(session.actorId) : undefined;
    let reason: QaListenerAutoCloseReason | null = null;
    if (now.getTime() - session.createdAt.getTime() > QA_LISTENER_MAX_SESSION_MS) reason = "auto:max_duration";
    else if (statusById.get(session.targetId!) !== "IN_PROGRESS") reason = "auto:appointment_ended";
    else if (!actor || actor.status !== "ACTIVE" || actor.role !== "ADMIN" || !actor.twoFactorEnabled) reason = "auto:actor_revoked";

    if (!reason) {
      stillValidIdentities.add(session.meta.identity!);
      continue;
    }

    let removed: boolean;
    try {
      const outcome = await removeListener(deps, session.meta.roomName!, session.meta.identity!);
      removed = outcome !== "unavailable";
      if (outcome === "unavailable") {
        app.log.warn({ sessionId }, "LIVEKIT_INTERNAL_URL boş — QA dinleyicisi odadan atılamadı; kayıt removed:false ile kapatılıyor.");
      }
    } catch (err) {
      const failures = (removeFailures.get(sessionId) ?? 0) + 1;
      removeFailures.set(sessionId, failures);
      if (failures < QA_LISTENER_MAX_REMOVE_ATTEMPTS) {
        app.log.warn({ err, sessionId, failures }, "QA dinleyicisi odadan atılamadı; sonraki turda tekrar denenecek.");
        continue;
      }
      app.log.error({ err, sessionId, failures }, "QA dinleyicisi odadan atılamadı; deneme sınırı aşıldı, kayıt removed:false ile kapatılıyor.");
      removed = false;
    }
    removeFailures.delete(sessionId);

    // Bu arada istemci de `leave` çağırmış olabilir — çift kayıt yazma.
    const alreadyLeft = await app.prisma.auditLog.findFirst({
      where: { action: LEFT_ACTION, metadata: { path: ["sessionId"], equals: sessionId } },
      select: { id: true },
    });
    if (alreadyLeft) continue;

    await logAudit(app, {
      actorId: null,
      actorEmail: null,
      action: LEFT_ACTION,
      targetType: "Appointment",
      targetId: session.targetId,
      metadata: {
        sessionId,
        reason,
        removed,
        adminId: session.actorId,
        durationSeconds: Math.max(0, Math.round((now.getTime() - session.createdAt.getTime()) / 1000)),
      },
    });
    result.closed.push({ sessionId, reason, removed });
  }

  // Kaçak dinleyiciler — açık ve geçerli bir oturuma ait olmayan `qa-listener-` katılımcıları.
  const rooms = new Map<string, string>();
  for (const session of sessions) rooms.set(session.meta.roomName!, session.targetId!);
  for (const [roomName, appointmentId] of rooms) {
    let identities: string[] | null;
    try {
      identities = await deps.listParticipants(roomName);
    } catch (err) {
      app.log.warn({ err }, "QA dinleyici temizleyicisi oda katılımcılarını okuyamadı.");
      continue;
    }
    if (identities === null) break; // LiveKit Server API yapılandırılmamış — hiçbir odada yapılamaz.
    for (const identity of identities) {
      if (!isQaListenerIdentity(identity) || stillValidIdentities.has(identity)) continue;
      try {
        if ((await removeListener(deps, roomName, identity)) !== "removed") continue;
      } catch (err) {
        app.log.warn({ err }, "Kaçak QA dinleyicisi odadan atılamadı; sonraki turda tekrar denenecek.");
        continue;
      }
      await logAudit(app, {
        actorId: null,
        actorEmail: null,
        action: QA_LISTENER_STRAY_REMOVED_ACTION,
        targetType: "Appointment",
        targetId: appointmentId,
        metadata: { identity },
      });
      result.strayRemoved.push({ roomName, identity });
    }
  }

  return result;
}

/** Dakikalık kadans; test ortamında zamanlayıcı kurulmaz (testler `runQaListenerSweep`'i doğrudan çağırır). */
export function registerQaListenerSweeper(app: FastifyInstance): void {
  if (env.NODE_ENV === "test") return;
  const removeFailures = new Map<string, number>();
  const runSweep = () => {
    runQaListenerSweep(app, { removeFailures })
      .then((result) => {
        if (result.closed.length > 0 || result.strayRemoved.length > 0) {
          app.log.info(
            { closed: result.closed.length, strayRemoved: result.strayRemoved.length },
            "QA dinleyici oturumları sunucu tarafında kapatıldı (qa-listener-sweeper)"
          );
        }
      })
      .catch((err) => {
        app.log.error({ err }, "QA dinleyici temizleyicisi taraması başarısız oldu");
      });
  };

  const timer = setInterval(runSweep, QA_LISTENER_SWEEP_INTERVAL_MS);
  timer.unref();
  app.addHook("onClose", () => {
    clearInterval(timer);
  });
}
