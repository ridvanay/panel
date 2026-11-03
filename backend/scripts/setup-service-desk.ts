/**
 * Paket AI (Is 3) - hizmet masasi yerel/e2e kurulum script'i (IDEMPOTENT). Canlida yonetici bunun yerine admin panelini
 * kullanabilir; bu script yedek/restore GEREKTIRMEZ ama audit yazar.
 *
 * Varsayilan KURU calisir (hicbir sey yazmaz). Yazmak icin: --confirm=setup-service-desk --operator=<ad>.
 * NODE_ENV=production iken ek olarak --i-know-this-is-prod gerekir. DATABASE_URL'i ACIKCA export edin (script .env'e guvenmez):
 *
 *   DATABASE_URL=postgresql://... npx tsx scripts/setup-service-desk.ts \
 *     --hours="1-5 09:00-17:00" --coordinator=editor@example.com --display-name="Ayse K." --languages=en,ar --enable \
 *     --confirm=setup-service-desk --operator=ridvan
 *
 * Secenekler:
 *   (yok)                      masayi varsayilanlarla olusturur (Europe/Istanbul, 30 dk, 120 dk en erken, 30 gun, oda siniri 3)
 *   --hours="1-5 09:00-17:00"  haftalik saatleri TAMAMEN degistirir; birden cok aralik ";" ile: "1-5 09:00-12:00;1-5 13:00-17:00"
 *                              (gun araligi ISO 1-7; "6" tek gun; "1,3,5" liste)
 *   --coordinator=<e-posta>    mevcut aktif EDITOR/MANAGER kullanicisina koordinator profili acar (doktor profili olan olamaz)
 *   --display-name="Ayse K."   gorunen ad (unvan yok)
 *   --languages=en,ar          koordinatorun dilleri
 *   --enable                   genel rezervasyon anahtarini (serviceBookingEnabled) acar
 */
import { PrismaClient } from "@prisma/client";
import { assertProdWriteAllowed, printTargetDb } from "./_script-guard";

const prisma = new PrismaClient();
const TITLE_PREFIX = /^\s*(dr|prof|op|uzm|doç|doc|assoc|asst|mr|mrs|ms)\b\.?/i;

interface Args {
  confirm: boolean;
  operator: string | null;
  hours: string | null;
  coordinator: string | null;
  displayName: string | null;
  languages: string[];
  enable: boolean;
}

function parseArgs(argv: string[]): Args {
  const value = (name: string): string | null => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  return {
    confirm: value("confirm") === "setup-service-desk",
    operator: value("operator"),
    hours: value("hours"),
    coordinator: value("coordinator")?.trim().toLowerCase() ?? null,
    displayName: value("display-name"),
    languages: (value("languages") ?? "").split(",").map((l) => l.trim().toLowerCase()).filter(Boolean),
    enable: argv.includes("--enable"),
  };
}

function parseDays(spec: string): number[] {
  const days = new Set<number>();
  for (const part of spec.split(",")) {
    const range = /^([1-7])-([1-7])$/.exec(part.trim());
    if (range) {
      for (let d = Number(range[1]); d <= Number(range[2]); d++) days.add(d);
    } else if (/^[1-7]$/.test(part.trim())) days.add(Number(part.trim()));
    else throw new Error(`Geçersiz gün belirtimi: "${part}" (ISO 1-7).`);
  }
  return [...days];
}

const toMinute = (hhmm: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Geçersiz saat: "${hhmm}" (SS:DD).`);
  return Number(m[1]) * 60 + Number(m[2]);
};

export function parseHours(spec: string): Array<{ dayOfWeek: number; startMinute: number; endMinute: number }> {
  const rows: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }> = [];
  for (const chunk of spec.split(";")) {
    const m = /^\s*(\S+)\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\s*$/.exec(chunk);
    if (!m) throw new Error(`Geçersiz --hours parçası: "${chunk}" (örnek: "1-5 09:00-17:00").`);
    const start = toMinute(m[2]!);
    const end = toMinute(m[3]!);
    if (end <= start || end > 1440) throw new Error(`Geçersiz aralık: "${chunk}".`);
    for (const dayOfWeek of parseDays(m[1]!)) rows.push({ dayOfWeek, startMinute: start, endMinute: end });
  }
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i]!;
      const b = rows[j]!;
      if (a.dayOfWeek === b.dayOfWeek && a.startMinute < b.endMinute && b.startMinute < a.endMinute) throw new Error("--hours içinde çakışan aralıklar var.");
    }
  }
  return rows;
}

function defaultDisplayName(fullName: string): string {
  const words = fullName.replace(TITLE_PREFIX, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "Coordinator";
  if (words.length === 1) return words[0]!.slice(0, 40);
  return `${words.slice(0, -1).join(" ")} ${[...words[words.length - 1]!][0]!.toLocaleUpperCase()}.`.slice(0, 40);
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const write = args.confirm;
  printTargetDb();
  assertProdWriteAllowed(write, argv);
  if (write && !args.operator) throw new Error("Yazma modu için --operator=<ad> gerekir.");
  console.log(`[setup-service-desk] mod=${write ? "YAZMA" : "KURU (hiçbir şey yazılmaz)"} operatör=${args.operator ?? "-"}`);

  const hours = args.hours ? parseHours(args.hours) : null;
  let coordinatorUser: { id: string; name: string } | null = null;
  if (args.coordinator) {
    const user = await prisma.user.findUnique({
      where: { email: args.coordinator },
      select: { id: true, name: true, role: true, status: true, doctorProfile: { select: { id: true } } },
    });
    if (!user) throw new Error(`Kullanıcı bulunamadı: ${args.coordinator}`);
    if (user.status !== "ACTIVE" || user.doctorProfile || !["EDITOR", "MANAGER"].includes(user.role)) {
      throw new Error("Koordinatör aktif bir EDITOR/MANAGER olmalı ve doktor profili olmamalı.");
    }
    coordinatorUser = { id: user.id, name: user.name };
  }
  const displayName = args.displayName ?? (coordinatorUser ? defaultDisplayName(coordinatorUser.name) : null);
  if (displayName && TITLE_PREFIX.test(displayName)) throw new Error("Görünen ad unvan içeremez.");

  console.log("Plan:");
  console.log(" - masa: varsayılanlarla oluştur / mevcutsa dokunma");
  if (hours) console.log(` - saatler: ${hours.length} aralık (mevcut saatlerin yerine geçer)`);
  if (coordinatorUser) console.log(` - koordinatör: ${args.coordinator} -> "${displayName}" [${args.languages.join(",") || "dil yok"}]`);
  if (args.enable) console.log(" - serviceBookingEnabled = true");
  if (!write) {
    console.log("Kuru çalıştırma bitti. Yazmak için --confirm=setup-service-desk --operator=<ad> ekleyin.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.serviceDesk.upsert({ where: { id: "main" }, create: { id: "main" }, update: {} });
    if (hours) {
      await tx.serviceDeskHours.deleteMany({ where: { deskId: "main" } });
      if (hours.length > 0) await tx.serviceDeskHours.createMany({ data: hours.map((h) => ({ deskId: "main", ...h })) });
    }
    if (coordinatorUser && displayName) {
      await tx.coordinatorProfile.upsert({
        where: { userId: coordinatorUser.id },
        create: { userId: coordinatorUser.id, displayName, languages: args.languages },
        update: { displayName, languages: args.languages, isActive: true },
      });
    }
    if (args.enable) {
      await tx.siteSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", serviceBookingEnabled: true }, update: { serviceBookingEnabled: true } });
    }
    await tx.auditLog.create({
      data: {
        actorEmail: `script:${args.operator}`,
        action: "script.setup_service_desk",
        targetType: "ServiceDesk",
        targetId: "main",
        metadata: { hours: hours ? hours.length : null, coordinator: Boolean(coordinatorUser), enabled: args.enable },
      },
    });
  });
  console.log("Tamamlandı.");
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
