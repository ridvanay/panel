import type { FastifyInstance } from "fastify";
import { generateGuestToken } from "../meetings/meeting-tokens";
import { sendPatientServiceEmail } from "./service-consultation-notify";

/**
 * Paket AI (Is 3) - hizmet gorusmesi hatirlatma supurucusu. `lib/appointment-reminders.ts` ile AYNI desen: surec-ici
 * `setInterval` (5 dk), `unref`, `onClose`'da temizlik, "ONCE SAHIPLEN, SONRA GONDER" (kosullu `updateMany` damgasi;
 * SMTP hatasinda damga kalir - bir hatirlatmanin KAYBOLMASI, IKI KEZ gitmesinden iyidir).
 *
 * Bantlar (alt sinir DAHIL DEGIL, ust sinir DAHIL; cift gonderim engeli):
 * - 24 saat: `reminded24hAt IS NULL` ve `startsAt` (23 sa, 25 sa]  -> baglantisiz bilgilendirme.
 * - 60 dk:   `reminded60mAt IS NULL` ve `startsAt` (35 dk, 65 dk] -> YENI katilim baglantisi; e-posta GIDINCE eski
 *   baglanti gecersiz olur (duz belirtec saklanmadigi icin baglantiyi hatirlatmaya koymanin tek guvenli yolu). Gonderim
 *   basarisizsa ozet degismez: eski baglanti gecerli kalir.
 * Iptal edilmis/tamamlanmis kayda gitmez (yalniz SCHEDULED).
 */
export const SERVICE_REMINDER_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export interface ServiceReminderSweepResult {
  reminded24h: number;
  reminded60m: number;
  failed: number;
}

const HOUR = 3_600_000;
const MIN = 60_000;

const SELECT = {
  id: true,
  seq: true,
  startsAt: true,
  endsAt: true,
  locale: true,
  patientTimeZone: true,
  meetingId: true,
  request: { select: { email: true } },
} as const;

export async function runServiceConsultationReminderSweep(app: FastifyInstance, now: Date = new Date()): Promise<ServiceReminderSweepResult> {
  const result: ServiceReminderSweepResult = { reminded24h: 0, reminded60m: 0, failed: 0 };

  const due24 = await app.prisma.serviceConsultation.findMany({
    where: { status: "SCHEDULED", reminded24hAt: null, startsAt: { gt: new Date(now.getTime() + 23 * HOUR), lte: new Date(now.getTime() + 25 * HOUR) } },
    select: SELECT,
  });
  for (const c of due24) {
    const claim = await app.prisma.serviceConsultation.updateMany({ where: { id: c.id, status: "SCHEDULED", reminded24hAt: null }, data: { reminded24hAt: now } });
    if (claim.count !== 1) continue;
    const sent = await sendPatientServiceEmail(app, { consultation: c, email: c.request?.email ?? null, kind: "reminder24h" });
    if (sent) result.reminded24h += 1;
    else result.failed += 1;
  }

  const due60 = await app.prisma.serviceConsultation.findMany({
    where: { status: "SCHEDULED", reminded60mAt: null, startsAt: { gt: new Date(now.getTime() + 35 * MIN), lte: new Date(now.getTime() + 65 * MIN) } },
    select: SELECT,
  });
  for (const c of due60) {
    const claim = await app.prisma.serviceConsultation.updateMany({ where: { id: c.id, status: "SCHEDULED", reminded60mAt: null }, data: { reminded60mAt: now } });
    if (claim.count !== 1) continue;
    const fresh = generateGuestToken();
    const sent = await sendPatientServiceEmail(app, { consultation: c, email: c.request?.email ?? null, kind: "reminder60m", joinToken: fresh.token });
    if (!sent) {
      result.failed += 1;
      continue;
    }
    // E-posta gitti: yeni baglanti gecerli, eskisi gecersiz.
    await app.prisma.externalMeeting.updateMany({ where: { id: c.meetingId, status: "SCHEDULED" }, data: { guestTokenHash: fresh.hash, guestTokenCreatedAt: now } });
    result.reminded60m += 1;
  }
  return result;
}

export function registerServiceConsultationReminderSweeper(app: FastifyInstance): void {
  const run = () => {
    runServiceConsultationReminderSweep(app)
      .then((r) => {
        if (r.reminded24h + r.reminded60m + r.failed > 0) app.log.info(r, "Hizmet görüşmesi hatırlatma taraması tamamlandı");
      })
      .catch((err) => app.log.error({ err }, "Hizmet görüşmesi hatırlatma taraması başarısız oldu"));
  };
  run();
  const timer = setInterval(run, SERVICE_REMINDER_SWEEP_INTERVAL_MS);
  timer.unref();
  app.addHook("onClose", () => {
    clearInterval(timer);
  });
}
