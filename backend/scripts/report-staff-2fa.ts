/**
 * Paket G (2026-10-19) — SALT-OKUMA: ADMIN/MANAGER hesaplarının 2FA durumu ve personel için
 * zorunlu 2FA anahtarı. Zorunluluğu açmadan önce çalıştırın. Hiçbir şey YAZMAZ; secret/hash basmaz.
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/report-staff-2fa.ts
 */

import { PrismaClient } from "@prisma/client";
import { listStaffTwoFactorStatus } from "../src/lib/break-glass-two-factor";

async function main() {
  const prisma = new PrismaClient();
  try {
    const { requiredAt, staff } = await listStaffTwoFactorStatus(prisma);
    console.log(`Zorunlu 2FA: ${requiredAt ? `${requiredAt.toISOString()} itibarıyla` : "KAPALI"}`);
    console.log("e-posta | rol | durum | 2FA | son giriş");
    for (const u of staff) {
      console.log([u.email, u.role, u.status, u.twoFactorEnabled ? "açık" : "KAPALI", u.lastLoginAt?.toISOString().slice(0, 16) ?? "-"].join(" | "));
    }
    const missing = staff.filter((u) => u.status === "ACTIVE" && !u.twoFactorEnabled).length;
    const adminsWith2fa = staff.filter((u) => u.role === "ADMIN" && u.status === "ACTIVE" && u.twoFactorEnabled).length;
    console.log(`\n2FA'sı kapalı aktif personel: ${missing} · 2FA'sı açık aktif ADMIN: ${adminsWith2fa}`);
    if (adminsWith2fa === 0) console.log("UYARI: 2FA'sı açık ADMIN yok — zorunluluğu açmadan önce en az bir yönetici 2FA kurmalı.");
  } finally {
    await prisma.$disconnect();
  }
}

void main();
