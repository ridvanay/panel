import type { FastifyInstance } from "fastify";
import { env } from "../../../config/env";
import { logAudit } from "../../../lib/audit";
import { getLiveKitConfig, listRoomParticipantIdentities, removeRoomParticipant } from "./livekit";
import { ACTIVE_ASSIGNMENT_STATUSES, CONFLICT_BOOKING_SELECT, INTERPRETER_IDENTITY_PREFIX, isConflictOfInterest } from "./interpreters";

/**
 * Paket AA (güvenlik incelemesi, Yüksek) — çıkarılan/ataması kaldırılan tercüman elindeki token'ın
 * süresi dolana kadar (TTL doktor token'ıyla aynı) aynı kimlikle yeniden bağlanabilirdi. Bu temizleyici
 * Paket G dinleyici temizleyicisiyle aynı desende çalışır: son TTL penceresinde ataması değişmiş ya da
 * pasif/askıya alınmış tercümanı olan booking odalarını tarar; geçerli aktif ataması olmayan
 * `interpreter:<profilId>:<bookingId>` kimliklerini sunucu tarafında odadan çıkarır ve audit'e yazar.
 * Meşru tercüman (aktif atama + aktif profil + aktif hesap; rol fark etmez — Paket AA-ek) etkilenmez.
 */
export const INTERPRETER_SWEEP_INTERVAL_MS = 30 * 1000;
export const INTERPRETER_STRAY_REMOVED_ACTION = "interpreter.stray_removed";

export interface InterpreterSweepDeps {
  listIdentities: (roomName: string) => Promise<string[] | null>;
  removeParticipant: (roomName: string, identity: string) => Promise<boolean>;
}

const defaultDeps: InterpreterSweepDeps = {
  listIdentities: (roomName) => listRoomParticipantIdentities(roomName),
  removeParticipant: (roomName, identity) => removeRoomParticipant(roomName, identity),
};

/** `interpreter:<profilId>:<bookingId>` → parçalar; biçim dışıysa `null`. */
export function parseInterpreterIdentity(identity: string): { profileId: string; bookingId: string } | null {
  if (!identity.startsWith(INTERPRETER_IDENTITY_PREFIX)) return null;
  const [profileId, bookingId, ...rest] = identity.slice(INTERPRETER_IDENTITY_PREFIX.length).split(":");
  if (!profileId || !bookingId || rest.length > 0) return null;
  return { profileId, bookingId };
}

export async function runInterpreterSweep(app: FastifyInstance, deps: InterpreterSweepDeps = defaultDeps, now: Date = new Date()): Promise<{ removed: string[] }> {
  const lookbackMs = (getLiveKitConfig().tokenTtlMin + 5) * 60 * 1000;
  const since = new Date(now.getTime() - lookbackMs);
  // Taranacak odalar: yakın zamanda ataması değişen booking'ler + pasif/askıdaki tercümanın aktif ataması olanlar.
  const rows = await app.prisma.appointmentInterpreter.findMany({
    where: {
      OR: [
        { updatedAt: { gte: since } },
        { status: { in: ACTIVE_ASSIGNMENT_STATUSES }, interpreter: { OR: [{ isActive: false }, { user: { status: { not: "ACTIVE" } } }] } },
      ],
    },
    select: { bookingId: true, booking: { select: { meetingRoomName: true, ...CONFLICT_BOOKING_SELECT } } },
    take: 500,
  });
  const rooms = new Map<string, string>();
  const bookings = new Map<string, (typeof rows)[number]["booking"]>();
  for (const row of rows) {
    rooms.set(row.bookingId, row.booking.meetingRoomName);
    bookings.set(row.bookingId, row.booking);
  }

  const removed: string[] = [];
  for (const [bookingId, roomName] of rooms) {
    const identities = await deps.listIdentities(roomName);
    if (!identities) continue; // LiveKit sunucu API'si yapılandırılmamış.
    for (const identity of identities) {
      const parsed = parseInterpreterIdentity(identity);
      if (!parsed) continue;
      const active =
        parsed.bookingId === bookingId
          ? await app.prisma.appointmentInterpreter.findFirst({
              where: {
                bookingId,
                interpreterId: parsed.profileId,
                status: { in: ACTIVE_ASSIGNMENT_STATUSES },
                interpreter: { isActive: true, user: { status: "ACTIVE" } },
              },
              select: { interpreter: { select: { user: { select: { id: true, email: true } } } } },
            })
          : null;
      // Atamadan sonra doğan çıkar çatışması (tercüman bu görüşmenin hastası/doktoru oldu) da geçersizdir.
      const booking = bookings.get(bookingId);
      const valid = active !== null && !(booking && isConflictOfInterest(active.interpreter.user, booking));
      if (valid) continue;
      try {
        await deps.removeParticipant(roomName, identity);
        removed.push(identity);
        await logAudit(app, {
          actorId: null,
          actorEmail: null,
          action: INTERPRETER_STRAY_REMOVED_ACTION,
          targetType: "AppointmentBooking",
          targetId: bookingId,
          metadata: { interpreterId: parsed.profileId },
        });
      } catch (err) {
        app.log.warn({ err, bookingId }, "Geçersiz tercüman odadan çıkarılamadı (bir sonraki taramada tekrar denenecek).");
      }
    }
  }
  return { removed };
}

export function registerInterpreterSweeper(app: FastifyInstance): void {
  if (env.NODE_ENV === "test") return;
  const run = () => {
    runInterpreterSweep(app)
      .then((result) => {
        if (result.removed.length > 0) app.log.info({ removed: result.removed.length }, "Geçersiz tercüman katılımcıları odadan çıkarıldı (interpreter-sweeper)");
      })
      .catch((err) => app.log.error({ err }, "Tercüman temizleyicisi taraması başarısız oldu"));
  };
  const timer = setInterval(run, INTERPRETER_SWEEP_INTERVAL_MS);
  timer.unref();
  app.addHook("onClose", () => clearInterval(timer));
}
