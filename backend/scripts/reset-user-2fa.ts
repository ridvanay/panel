/**
 * Paket G (2026-10-19) — ACİL DURUM 2FA sıfırlaması (break-glass). Ayrıntı ve güvenlik kuralları:
 * `src/lib/break-glass-two-factor.ts`. Runbook: `docs/prompts/2026-10-19-G-RAPOR.md` → "Acil durum".
 *
 * ÇALIŞTIRMA (backend/ dizininden; varsayılan KURU ÇALIŞMA, hiçbir şey yazmaz):
 *   npx tsx scripts/reset-user-2fa.ts --email=yonetici@ornek.com --operator="Ad Soyad"
 * Gerçek sıfırlama (e-postayı AYNEN tekrar yazın):
 *   npx tsx scripts/reset-user-2fa.ts --email=yonetici@ornek.com --operator="Ad Soyad" --confirm=yonetici@ornek.com
 */

import os from "node:os";
import { PrismaClient } from "@prisma/client";
import { BreakGlassError, resetUserTwoFactorBreakGlass } from "../src/lib/break-glass-two-factor";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await resetUserTwoFactorBreakGlass(prisma, {
      email: arg("email") ?? "",
      operator: arg("operator") ?? "",
      confirmEmail: arg("confirm"),
      allowNonStaff: process.argv.includes("--allow-non-staff"),
      osUser: os.userInfo().username,
      hostname: os.hostname(),
    });
    const u = result.user;
    console.log(`Hedef: ${u.email} (${u.role}) · 2FA: ${u.twoFactorEnabled ? "açık" : "kapalı"} · kullanılmamış yedek kod: ${u.backupCodeCount} · açık oturum: ${u.activeRefreshTokens}`);
    if (result.dryRun) {
      console.log("KURU ÇALIŞMA — hiçbir şey değişmedi. Uygulamak için --confirm=<aynı e-posta> ekleyin.");
    } else {
      console.log("2FA sıfırlandı, tüm oturumlar kapatıldı, audit kaydı yazıldı (security.2fa_break_glass_reset).");
      console.log("Kullanıcıyı ayrı bir kanaldan bilgilendirin; bir sonraki girişte 2FA'yı yeniden kurmalı.");
    }
  } catch (err) {
    if (err instanceof BreakGlassError) {
      console.error(`HATA: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
