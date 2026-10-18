/**
 * Paket A2 (2026-10-18) — canlıda birikmiş, süresi geçmiş ama hâlâ `SCHEDULED`/`IN_PROGRESS`
 * görünen randevuları TEK SEFERLİK kapatır. Mantık `src/lib/appointment-auto-close.ts` ile
 * BİREBİR AYNIDIR (aynı fonksiyon çağrılır): kanıt varsa `COMPLETED`, yoksa `NO_SHOW`; ödenmemiş
 * booking'ler atlanır ve ayrı listelenir. Her geçiş audit'e (`source: "backfill_script"`) yazılır.
 * E-posta gönderilmez; ödeme, not ve kayıt verisine dokunulmaz. İdempotenttir.
 *
 * ÇALIŞTIRMA (backend/ dizininden) — ÖNCE dry-run:
 *   npx tsx scripts/close-stale-appointments.ts --dry-run
 *   npx tsx scripts/close-stale-appointments.ts
 */

import { PrismaClient } from "@prisma/client";
import { runAppointmentAutoClose, type AutoCloseTransition } from "../src/lib/appointment-auto-close";

const prisma = new PrismaClient();

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

function printTransitions(transitions: readonly AutoCloseTransition[]) {
  for (const t of transitions) {
    console.log(
      `  ${t.appointmentId}  booking=${t.bookingId ?? "-"}  ${t.fromStatus} -> ${t.toStatus}  (${t.reason})  bitiş=${t.plannedEndsAt.toISOString()}`
    );
  }

  // Doktor kazancı / analitik COMPLETED satırların priceCents toplamını okur — etkisi görünür olsun.
  const totals = new Map<string, number>();
  for (const t of transitions) {
    if (t.toStatus !== "COMPLETED") continue;
    const key = `${t.doctorId} ${t.currency}`;
    totals.set(key, (totals.get(key) ?? 0) + t.priceCents);
  }
  if (totals.size > 0) {
    console.log("COMPLETED'a geçen tutar (doktor, para birimi):");
    for (const [key, cents] of totals) {
      const [doctorId, currency] = key.split(" ");
      console.log(`  doktor=${doctorId}  ${formatCents(cents)} ${currency}`);
    }
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const result = await runAppointmentAutoClose(prisma, { dryRun, source: "backfill_script" });

  const completed = result.transitions.filter((t) => t.toStatus === "COMPLETED").length;
  const noShow = result.transitions.filter((t) => t.toStatus === "NO_SHOW").length;
  const prefix = dryRun ? "[dry-run]" : "[uygulandı]";

  console.log(`${prefix} ${result.transitions.length} randevu: ${completed} COMPLETED, ${noShow} NO_SHOW.`);
  printTransitions(result.transitions);

  if (result.skippedUnpaid.length > 0) {
    console.log(`Anomali — ödenmemiş booking'e bağlı açık randevular (DOKUNULMADI): ${result.skippedUnpaid.length} booking`);
    for (const s of result.skippedUnpaid) {
      console.log(`  booking=${s.bookingId}  paymentStatus=${s.paymentStatus}  randevular=${s.appointmentIds.join(",")}`);
    }
  }

  if (dryRun) console.log("[dry-run] hiçbir şey YAZILMADI.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
