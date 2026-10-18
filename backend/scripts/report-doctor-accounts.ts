/**
 * Paket B3 (2026-10-18) — SALT-OKUMA: doktor profillerinin bağlı kullanıcı hesabı, 2FA durumu ve
 * son giriş tarihi. Hangi doktorlar için "2FA'yı sıfırla" / "etkinleştirme e-postası" gerektiğini
 * görmek içindir. Hiçbir şey YAZMAZ.
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/report-doctor-accounts.ts
 *
 * Eşdeğer SQL (psql ile):
 *   SELECT d.slug, d."fullName", d."isActive", d."archivedAt", u.email, u.status,
 *          u."twoFactorEnabled", u."lastLoginAt"
 *   FROM doctor_profiles d LEFT JOIN users u ON u.id = d."userId"
 *   ORDER BY d.seq;
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function date(value: Date | null): string {
  return value ? value.toISOString().slice(0, 16).replace("T", " ") : "-";
}

async function main() {
  const doctors = await prisma.doctorProfile.findMany({
    orderBy: { seq: "asc" },
    select: {
      slug: true,
      title: true,
      fullName: true,
      isActive: true,
      archivedAt: true,
      user: { select: { email: true, status: true, twoFactorEnabled: true, lastLoginAt: true } },
    },
  });

  console.log("slug | ad | aktif | arşiv | bağlı hesap | durum | 2FA | son giriş | öneri");
  for (const d of doctors) {
    const u = d.user;
    const hint = !u
      ? "hesap yok (portal girişi yok)"
      : u.lastLoginAt === null
        ? "hiç giriş yok → etkinleştirme e-postası"
        : !u.twoFactorEnabled
          ? "2FA kapalı → ilk girişte kurulum ekranı"
          : "2FA açık — admin kurduysa sıfırla";
    console.log(
      [
        d.slug,
        `${d.title} ${d.fullName}`.trim(),
        d.isActive ? "evet" : "hayır",
        d.archivedAt ? date(d.archivedAt) : "-",
        u?.email ?? "-",
        u?.status ?? "-",
        u ? (u.twoFactorEnabled ? "açık" : "kapalı") : "-",
        u ? date(u.lastLoginAt) : "-",
        hint,
      ].join(" | ")
    );
  }
  console.log(`\nToplam ${doctors.length} doktor, ${doctors.filter((d) => d.user).length} bağlı hesap.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
