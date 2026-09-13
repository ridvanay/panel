/**
 * [TCT] §9.7.7 KARAR K9 — UAT (User Acceptance Test) yardımcı script'i: bir panel kullanıcısını
 * (`User`) bir `DoctorProfile`'a bağlar, böylece QA/UAT o hesapla `/doctor/*` portalına
 * giriş yapabilir. `backend/scripts/fix-telehealth-demo-doctor-currency.ts` İLE AYNI desen
 * (idempotent, Prisma client'ı doğrudan kullanır, `main().catch().finally()` iskeleti).
 *
 * BU SCRIPT NE YAPMAZ (bilinçli sınırlar):
 *  - Kullanıcı OLUŞTURMAZ — hedef `User` zaten `POST /auth/register` (veya admin panel) ile
 *    VAR OLMALIDIR; script yalnızca MEVCUT bir kullanıcıyı MEVCUT bir doktor profiline bağlar.
 *  - Rol DEĞİŞTİRMEZ (`User.role` dokunulmaz — doktorluk `DoctorProfile.userId` ilişkisidir,
 *    `SiteRole.DOCTOR` YOKTUR, bkz. `.claude/architect-scope-telehealth-template.md` §9.7.7 K).
 *  - 2FA'yı ASLA taklit ETMEZ/etkinleştirmez — doktor portalı 2FA'yı KENDİSİ zorunlu kılar
 *    (bkz. telehealth.portal.routes.ts::requireDoctorPortalAccess); bu script'in konsol
 *    çıktısı kullanıcıyı bunu KENDİSİNİN yapması gerektiği konusunda UYARIR.
 *  - Zaten BAŞKA bir kullanıcıya bağlı bir `DoctorProfile`'ın ÜZERİNE YAZMAZ — hata verip çıkar
 *    (K8'deki ADMIN-only bağlama kısıtlamasıyla AYNI temkinli disiplin, ama bu script bir HTTP
 *    ucu DEĞİLDİR — doğrudan DB'ye yazar, bu yüzden kendi güvenlik/idempotency kontrolünü taşır).
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/link-telehealth-demo-doctor-user.ts --dry-run
 *   npx tsx scripts/link-telehealth-demo-doctor-user.ts --email uat.doctor.elif@example.com --doctor-slug elif-aydemir
 *
 * ARGÜMANLAR (hepsi opsiyonel):
 *   --email <email>         Varsayılan: uat.doctor.elif@example.com
 *   --doctor-slug <slug>    Varsayılan: verilmezse EN SON eklenen (createdAt DESC), henüz
 *                           hiçbir kullanıcıya bağlı OLMAYAN doktor profili seçilir.
 *   --dry-run               Hiçbir yazma yapmaz; ne yapılacağını konsola basar.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface ScriptArgs {
  email: string;
  doctorSlug?: string;
  dryRun: boolean;
}

const DEFAULT_EMAIL = "uat.doctor.elif@example.com";

function parseArgs(argv: string[]): ScriptArgs {
  const args: ScriptArgs = { email: DEFAULT_EMAIL, doctorSlug: undefined, dryRun: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--email") {
      args.email = argv[++i] ?? args.email;
      continue;
    }
    if (arg.startsWith("--email=")) {
      args.email = arg.slice("--email=".length);
      continue;
    }
    if (arg === "--doctor-slug") {
      args.doctorSlug = argv[++i];
      continue;
    }
    if (arg.startsWith("--doctor-slug=")) {
      args.doctorSlug = arg.slice("--doctor-slug=".length);
      continue;
    }
  }

  return args;
}

// "Global TeleHealth & Clinic" demo şablonunun varsayılan doktoru — `--email` varsayılanıyla
// (uat.doctor.elif@example.com) isim/niyet olarak eşleşir (bkz. templates/telehealth-clinic.ts).
const PREFERRED_DEFAULT_SLUG = "elif-aydemir";

async function resolveTargetDoctorSlug(explicitSlug: string | undefined): Promise<string> {
  if (explicitSlug) return explicitSlug;

  const preferred = await prisma.doctorProfile.findUnique({ where: { slug: PREFERRED_DEFAULT_SLUG }, select: { slug: true } });
  if (preferred) return preferred.slug;

  // Şablonun varsayılan doktoru YOKSA — hiçbir kullanıcıya bağlı OLMAYAN, EN SON eklenen doktor
  // profili ("en son eklenen demo doktoru seç" — §9.7.7 K9 notu).
  const fallback = await prisma.doctorProfile.findFirst({
    where: { userId: null },
    orderBy: { createdAt: "desc" },
    select: { slug: true },
  });

  if (!fallback) {
    throw new Error(
      "--doctor-slug verilmedi ve bağlanabilecek (userId=null) bir DoctorProfile bulunamadı. " +
        "Önce bir doktor profili oluşturun (ör. demo şablon veya /admin/telehealth/doctors) " +
        "VEYA --doctor-slug ile hedefi açıkça belirtin."
    );
  }

  return fallback.slug;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const doctorSlug = await resolveTargetDoctorSlug(args.doctorSlug);

  console.log(`[link-telehealth-demo-doctor-user] email="${args.email}" doctorSlug="${doctorSlug}" dryRun=${args.dryRun}`);

  const user = await prisma.user.findUnique({
    where: { email: args.email.toLowerCase() },
    select: { id: true, email: true, name: true, role: true, status: true, twoFactorEnabled: true },
  });
  if (!user) {
    throw new Error(
      `Kullanıcı bulunamadı: "${args.email}". Bu script kullanıcı OLUŞTURMAZ — önce POST /auth/register ` +
        "(veya admin panelden) bu e-posta ile bir hesap oluşturun, sonra script'i tekrar çalıştırın."
    );
  }
  if (user.status !== "ACTIVE") {
    throw new Error(`Kullanıcı "${args.email}" ACTIVE durumda değil (status="${user.status}") — önce hesabı aktifleştirin.`);
  }

  const doctor = await prisma.doctorProfile.findUnique({
    where: { slug: doctorSlug },
    select: { id: true, slug: true, fullName: true, userId: true },
  });
  if (!doctor) {
    throw new Error(`Doktor profili bulunamadı: slug="${doctorSlug}".`);
  }

  if (doctor.userId && doctor.userId !== user.id) {
    throw new Error(
      `Doktor profili "${doctor.fullName}" (${doctor.slug}) ZATEN BAŞKA bir kullanıcıya (userId="${doctor.userId}") bağlı. ` +
        "Üzerine YAZILMADI — önce ilgili bağlantıyı elle çözün (PATCH /admin/telehealth/doctors/{id} { userId: null }, yalnızca ADMIN)."
    );
  }

  if (doctor.userId === user.id) {
    console.log(`[ok] "${user.email}" zaten "${doctor.fullName}" (${doctor.slug}) doktor profiline bağlı — değişiklik gerekmiyor.`);
  } else if (args.dryRun) {
    console.log(`[dry-run] "${user.email}" -> "${doctor.fullName}" (${doctor.slug}) bağlanacaktı (hiçbir şey YAZILMADI).`);
  } else {
    await prisma.doctorProfile.update({ where: { id: doctor.id }, data: { userId: user.id } });
    console.log(`[fix] "${user.email}" -> "${doctor.fullName}" (${doctor.slug}) doktor profiline bağlandı.`);
  }

  console.log(
    "\n[UYARI] Doktor portalı 2FA zorunludur — bu hesapla /hesabim/profil üzerinden iki adımlı doğrulamayı etkinleştirin."
  );
  if (!args.dryRun && user.twoFactorEnabled !== true) {
    console.log("(Not: bu kullanıcının 2FA'sı şu an KAPALI — etkinleştirilmeden /doctor/* uçları 403 TWO_FACTOR_REQUIRED döner.)");
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
