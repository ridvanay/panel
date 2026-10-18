/**
 * Paket B4 (2026-10-18) — test booking'lerini TOPLU arşivler (doktor kazancı, analitik ve
 * listelerden çıkarır). HİÇBİR ŞEY SİLMEZ; yalnızca `archivedAt` + `archivedReason` yazar.
 * Mantık `src/lib/test-booking-archive.ts` içindedir.
 *
 * ÇALIŞTIRMA (backend/ dizininden) — dry-run ZORUNLU ilk adımdır, onay anahtarını o basar.
 * `--operator` zorunludur (audit'e yazılır):
 *   npx tsx scripts/archive-test-bookings.ts --ids=<id1>,<id2> --reason="Eylül-Ekim test ödemeleri" --operator="Ad Soyad" --dry-run
 *   npx tsx scripts/archive-test-bookings.ts --ids=<id1>,<id2> --reason="Eylül-Ekim test ödemeleri" --operator="Ad Soyad" --confirm=<anahtar>
 * veya tarih aralığı + doktor (üçü birlikte):
 *   npx tsx scripts/archive-test-bookings.ts --from=2026-09-01 --to=2026-10-17 --doctor=<slug> --reason="..." --operator="..." --dry-run
 * Gerçek tahsilat izi olan (stripe/manual) booking'ler çıktıda [GERÇEK ÖDEME] ile işaretlenir:
 * arşivlenirse gelir raporlarından düşer; muhasebe mutabakatında `includeArchived` ile görülebilir.
 */

import { PrismaClient } from "@prisma/client";
import { parseArchiveSelection, runTestBookingArchive, type ArchiveCandidate } from "../src/lib/test-booking-archive";

const prisma = new PrismaClient();

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

function printRows(title: string, rows: readonly ArchiveCandidate[]) {
  if (rows.length === 0) return;
  console.log(`${title}: ${rows.length}`);
  for (const r of rows) {
    console.log(
      `  ${r.id}  ${r.bookingNumber}  /${r.doctorSlug}  ${r.paymentStatus}  paidBy=${r.paidBy ?? "-"}  ${formatCents(r.totalCents)} ${r.currency}  ilk randevu=${r.firstStartsAt ?? "-"}${r.realPayment ? "  [GERÇEK ÖDEME]" : ""}`
    );
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const selection = parseArchiveSelection({
    ids: argValue("ids"),
    from: argValue("from"),
    to: argValue("to"),
    doctor: argValue("doctor"),
  });
  const reason = argValue("reason") ?? "";

  const { plan, archivedCount } = await runTestBookingArchive(prisma, {
    selection,
    reason,
    dryRun,
    operator: argValue("operator") ?? "",
    confirmKey: argValue("confirm"),
  });

  printRows(dryRun ? "[dry-run] Arşivlenecek" : "Arşivlenen", plan.toArchive);
  for (const [currency, cents] of Object.entries(plan.totalsByCurrency)) {
    console.log(`  toplam: ${formatCents(cents)} ${currency}`);
  }
  printRows("Zaten arşivli (atlandı)", plan.alreadyArchived);
  printRows("Açık/gelecek randevusu var — ARŞİVLENMEZ", plan.notArchivable);
  if (plan.missingIds.length > 0) console.log(`Bulunamayan id'ler: ${plan.missingIds.join(", ")}`);

  if (dryRun) {
    console.log(`\n[dry-run] hiçbir şey YAZILMADI. Uygulamak için aynı argümanlara ekleyin: --confirm=${plan.confirmKey}`);
  } else {
    console.log(`\n[uygulandı] ${archivedCount} booking arşivlendi.`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
