/**
 * Tek seferlik İÇERİK güncelleme script'i (KOD DEĞİŞİKLİĞİ DEĞİL) — 2026-10-02 görev dosyası
 * (`docs/prompts/2026-10-02-wm-health-icerik-guncellemesi.md` §4, "Doktor: Doç. Dr. Vahit Mutlu";
 * düzeltmeler için `docs/prompts/2026-10-02-wm-health-duzeltme-1.md` madde 2).
 * `add-status-message-to-confirmation-email.ts`/`link-telehealth-demo-doctor-user.ts` İLE AYNI
 * desen (idempotent, Prisma client'ı doğrudan kullanır, `main().catch().finally()` iskeleti).
 *
 * İDEMPOTENCY TANIMI (bilerek `create-faq-page.ts`'ten FARKLI): bu bir KAYIT OLUŞTURMA script'i
 * DEĞİL, bir İÇERİK HEDEFLEME script'idir — "tekrar çalıştırınca HİÇBİR ŞEY yapmaz" ANLAMINDA
 * değil, "tekrar çalıştırınca HER ZAMAN AYNI hedef duruma getirir, bozuk/farklı bir sonuç
 * ÜRETMEZ" anlamında idempotent. `title`/`aboutHtml`/`socialLinks` HER ÇALIŞTIRMADA aynı hedef
 * değere set edilir (admin panelden elle farklı bir şey girilmişse BİLEREK ezilir — bu script
 * doktorun resmi/onaylı içeriğini zorunlu kılar). `specialtyId`/`subSpecialty` ise ARTIK
 * KOŞULSUZ EZİLMEZ (bkz. "UZMANLIK İLİŞKİSİ" notu, düzeltme-1 madde 2).
 *
 * NE YAPMAZ:
 *  - Doktor OLUŞTURMAZ. Hedef `DoctorProfile` ZATEN VAR OLMALIDIR (demo şablon veya admin panel
 *    ile) — slug="vahit-mutlu" VEYA `fullName` içinde "Vahit Mutlu" geçen bir kayıt aranır,
 *    bulunamazsa script AÇIK bir hata ile ÇIKAR (sessiz no-op YOK, bkz. `main()`).
 *  - `DoctorProfile.id`/`slug`/`userId` alanlarına DOKUNMAZ (görev dosyası "KIRMIZI ÇİZGİ"
 *    bölümü — bu alanlar randevu/LiveKit oda adı/token kimliği üretiminde kullanılıyor).
 *  - `fullName`'e DOKUNMAZ — doktor ZATEN "Vahit Mutlu" adıyla bulunduğu için değişmesi gerekmez.
 *  - `subSpecialty`'ye ARTIK DOKUNMAZ — mevcut değeri (ne ise) olduğu gibi bırakır (düzeltme-1).
 *  - WhatsApp numarası EKLEMEZ (görev dosyası açıkça yasaklıyor — sitenin kendi WhatsApp hattıyla
 *    karışmasın).
 *
 * UZMANLIK İLİŞKİSİ — DÜZELTME-1 MADDE 2 (db-agent'ın eklediği `DoctorAdditionalSpecialty`
 * tablosu KULLANILARAK GÜNCELLENDİ): `DoctorProfile.specialtyId` TEK bir FK olarak KALIR (bu
 * script onu KOŞULSUZ EZMEZ) — yalnızca `specialtyId` `null` İSE "Obesity & Metabolic Surgery"ye
 * `connect` edilir; doluysa (hangi uzmanlık olursa olsun) OLDUĞU GİBİ bırakılır. Ardından
 * {Obesity & Metabolic Surgery, Surgical Oncology} ikilisinden BİRİNCİL uzmanlığa denk GELMEYEN
 * taraf (ya da her ikisi de denk gelmiyorsa ikisi BİRDEN) `DoctorAdditionalSpecialty.upsert` ile
 * EK uzmanlık olarak eklenir — composite PK (`doctorId_specialtyId`) tekrar çalıştırmada
 * ikinci bir satır oluşturulmasını zaten engeller, SİLME YAPILMAZ. `subSpecialty` artık
 * "Surgical Oncology" ile EZİLMEZ.
 *
 * TR ÇEVİRİSİ — BİLİNEN SINIRLAMA (şema değişikliği gerektirir, bu script'in kapsamı DIŞINDA):
 * `DoctorProfile` modelinde `Page`/`Product`/diğer içerik modellerindeki gibi bir
 * `translations Json @default("{}")` alanı veya ayrı bir `*Translation` tablosu YOKTUR
 * (schema.prisma'da doğrulandı). Doktor `title`/`fullName`/`bio`/`aboutHtml`/`subSpecialty`
 * alanları dile göre AYRIŞMAZ — `/tr/doctors/vahit-mutlu` ve `/en/doctors/vahit-mutlu` ŞU AN
 * zaten AYNI (tek dilli) içeriği gösteriyor, bu script'ten ÖNCE de böyleydi. Bu nedenle TR
 * ünvanı ("Doç. Dr. Vahit Mutlu") ve TR biyografi BU SCRIPT TARAFINDAN YAZILMAZ — aşağıdaki
 * `TR_TITLE_FOR_FUTURE_USE`/`TR_ABOUT_PARAGRAPHS_FOR_FUTURE_USE` sabitleri yalnızca REFERANS
 * olarak tutulur (ileride bir `translations` alanı eklenirse hazır olsun diye). Doktor
 * içeriğinin diline göre ayrışması GEREKİYORSA bu bir db-agent/architect kararı gerektirir
 * (yeni migration) — backend-agent kendi başına şema DEĞİŞTİRMEZ.
 *
 * ÇALIŞTIRMA (backend/ dizininden):
 *   npx tsx scripts/update-vahit-mutlu-profile.ts --dry-run
 *   npx tsx scripts/update-vahit-mutlu-profile.ts
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { sanitizeRichHtml } from "../src/lib/html-sanitize";

const prisma = new PrismaClient();

function parseArgs(argv: string[]) {
  return { dryRun: argv.includes("--dry-run") };
}

const DOCTOR_SLUG = "vahit-mutlu";
const DOCTOR_NAME_NEEDLE = "Vahit Mutlu";

const TARGET_TITLE = "Assoc. Prof. Dr.";
/** Yalnızca referans — bkz. dosya başı "TR ÇEVİRİSİ" notu, ŞU AN hiçbir yere YAZILMAZ. */
const TR_TITLE_FOR_FUTURE_USE = "Doç. Dr.";

const PRIMARY_SPECIALTY_NEEDLE = "Obesity & Metabolic Surgery";
const SECONDARY_SPECIALTY_NEEDLE = "Surgical Oncology";

const EN_ABOUT_PARAGRAPHS = [
  "Dr. Vahit Mutlu was born in Erzincan in 1989. He graduated from Ondokuz Mayıs University Faculty of Medicine and began his medical career in 2013 as a general practitioner at Erzincan Mengücek Gazi Training and Research Hospital. In 2015, he began his residency in general surgery at Ondokuz Mayıs University, participating in more than 2,000 surgical cases and developing a particular focus on gastrointestinal, hepatopancreatobiliary, and bariatric surgery. During this period, he also took part in organ procurement and liver transplantation procedures and completed his specialist thesis on bariatric surgery.",
  "Between 2020 and 2023, he worked as a general surgeon at Tokat State Hospital, contributing to the development of bariatric surgery, the Whipple procedure, and advanced laparoscopic surgical practices in the city. His clinical experience includes more than 1,000 bariatric procedures and over 3,000 laparoscopic abdominal surgeries.",
  "Continuing his clinical and academic career in Istanbul, Dr. Vahit Mutlu contributes to surgical knowledge through national and international scientific publications, conference presentations, and book chapters. His research focuses particularly on bariatric and oncological surgery, and he is actively involved in educating future physicians.",
  "As the founder of WM Health, he guides international patients through their treatment journeys in Türkiye. His approach is grounded in scientific evidence, patient safety, and individualized treatment planning, with an emphasis on attentive care and clear communication from the initial assessment through post-treatment follow-up.",
];

/** Yalnızca referans — bkz. dosya başı "TR ÇEVİRİSİ" notu, ŞU AN hiçbir yere YAZILMAZ. */
const TR_ABOUT_PARAGRAPHS_FOR_FUTURE_USE = [
  "Dr. Vahit Mutlu, 1989 yılında Erzincan'da doğdu. Ondokuz Mayıs Üniversitesi Tıp Fakültesi'nden mezun olarak 2013 yılında Erzincan Mengücek Gazi Eğitim ve Araştırma Hastanesi'nde pratisyen hekim olarak mesleki hayatına başladı. 2015 yılında Ondokuz Mayıs Üniversitesi'nde genel cerrahi alanında uzmanlık eğitimine başladı; 2.000'den fazla cerrahi vakada görev aldı ve özellikle gastrointestinal, hepatopankreatobiliyer ve bariatrik cerrahi alanlarında odaklandı. Bu süreçte organ nakli ve karaciğer transplantasyonu işlemlerinde de yer aldı ve uzmanlık tezini bariatrik cerrahi üzerine tamamladı.",
  "2020-2023 yılları arasında Tokat Devlet Hastanesi'nde genel cerrah olarak çalıştı ve şehirde bariatrik cerrahinin, Whipple prosedürünün ve ileri laparoskopik cerrahi uygulamalarının gelişimine katkıda bulundu. Klinik deneyimi 1.000'den fazla bariatrik işlem ve 3.000'den fazla laparoskopik abdominal cerrahiyi kapsamaktadır.",
  "İstanbul'da klinik ve akademik kariyerine devam eden Dr. Vahit Mutlu, ulusal ve uluslararası bilimsel yayınlar, kongre sunumları ve kitap bölümleriyle cerrahi bilgi birikimine katkı sağlamaktadır. Araştırmaları özellikle bariatrik ve onkolojik cerrahi üzerine odaklanmakta olup, geleceğin hekimlerinin eğitiminde de aktif rol almaktadır.",
  "WM Health'in kurucusu olarak, Türkiye'deki tedavi süreçlerinde uluslararası hastalara rehberlik etmektedir. Yaklaşımı bilimsel kanıta, hasta güvenliğine ve kişiye özel tedavi planlamasına dayanmakta olup, ilk değerlendirmeden tedavi sonrası takibe kadar dikkatli bakım ve açık iletişime önem vermektedir.",
];

// WhatsApp YOK (bilerek) — görev dosyası "sitenin kendi WhatsApp hattıyla karışmasın" diye
// açıkça yasaklıyor.
const TARGET_SOCIAL_LINKS = [
  { platform: "instagram", url: "https://www.instagram.com/doc.dr.vahitmutlu/", label: "Instagram (TR)" },
  { platform: "instagram", url: "https://www.instagram.com/docdrvahitmutlu/", label: "Instagram (EN)" },
  { platform: "facebook", url: "https://www.facebook.com/profile.php?id=100090827795012" },
  { platform: "youtube", url: "https://www.youtube.com/@doc.dr.vahitmutlu" },
] as const;

function buildAboutHtml(paragraphs: readonly string[]): string {
  const raw = paragraphs.map((p) => `<p>${p}</p>`).join("");
  // [DPI] §1.1/§1.2 — `aboutHtml` HER ZAMAN `lib/html-sanitize.ts`'ten geçer (`telehealth.admin
  // .routes.ts::sanitizeAboutHtml` İLE AYNI disiplin), bu script bir HTTP ucu DEĞİLDİR ama AYNI
  // kuralı kendi tarafında tekrar eder.
  return sanitizeRichHtml(raw);
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));
  console.log(`[update-vahit-mutlu-profile] dryRun=${dryRun}`);

  const doctor = await prisma.doctorProfile.findFirst({
    where: { OR: [{ slug: DOCTOR_SLUG }, { fullName: { contains: DOCTOR_NAME_NEEDLE, mode: "insensitive" } }] },
    select: { id: true, slug: true, fullName: true, title: true, subSpecialty: true, specialtyId: true, aboutHtml: true, socialLinks: true },
  });

  if (!doctor) {
    throw new Error(
      `Doktor profili bulunamadı: slug="${DOCTOR_SLUG}" VEYA fullName içinde "${DOCTOR_NAME_NEEDLE}" geçen bir kayıt yok. ` +
        "Bu script doktor OLUŞTURMAZ — önce demo şablon içe aktarımı veya /admin/telehealth/doctors üzerinden " +
        '"Vahit Mutlu" adında bir doktor profili oluşturun, sonra script\'i tekrar çalıştırın.'
    );
  }

  console.log(`[bulundu] doktor id="${doctor.id}" slug="${doctor.slug}" fullName="${doctor.fullName}"`);

  const primarySpecialty = await prisma.specialty.findFirst({
    where: { name: { contains: PRIMARY_SPECIALTY_NEEDLE, mode: "insensitive" } },
    select: { id: true, name: true, slug: true },
  });
  if (!primarySpecialty) {
    throw new Error(
      `Uzmanlık bulunamadı: name içinde "${PRIMARY_SPECIALTY_NEEDLE}" geçen bir \`Specialty\` kaydı yok. ` +
        "Bu script uzmanlık OLUŞTURMAZ — önce /admin/specialties üzerinden bu uzmanlığı oluşturun, sonra script'i tekrar çalıştırın."
    );
  }

  const secondarySpecialty = await prisma.specialty.findFirst({
    where: { name: { contains: SECONDARY_SPECIALTY_NEEDLE, mode: "insensitive" } },
    select: { id: true, name: true, slug: true },
  });
  if (!secondarySpecialty) {
    throw new Error(
      `Uzmanlık bulunamadı: name içinde "${SECONDARY_SPECIALTY_NEEDLE}" geçen bir \`Specialty\` kaydı yok. ` +
        "Bu script uzmanlık OLUŞTURMAZ — önce /admin/specialties üzerinden bu uzmanlığı oluşturun, sonra script'i tekrar çalıştırın."
    );
  }

  console.log(`[bulundu] birincil uzmanlık="${primarySpecialty.name}" (${primarySpecialty.slug}), ikincil uzmanlık="${secondarySpecialty.name}" (${secondarySpecialty.slug})`);

  const targetAboutHtml = buildAboutHtml(EN_ABOUT_PARAGRAPHS);

  // `specialtyId` KOŞULSUZ EZİLMEZ (düzeltme-1 madde 2): yalnızca mevcut değer `null` ise
  // birincil uzmanlık (Obesity & Metabolic Surgery) bağlanır; doluysa OLDUĞU GİBİ bırakılır.
  const willConnectPrimary = doctor.specialtyId === null;
  const finalPrimarySpecialtyId = doctor.specialtyId ?? primarySpecialty.id;

  // {Obesity & Metabolic Surgery, Surgical Oncology} ikilisinden BİRİNCİL uzmanlığa denk
  // GELMEYEN taraf(lar) EK uzmanlık olarak eklenir (tipik durumda yalnızca biri — bkz. dosya
  // başı "UZMANLIK İLİŞKİSİ" notu).
  const additionalSpecialtiesToAdd = [primarySpecialty, secondarySpecialty].filter(
    (specialty) => specialty.id !== finalPrimarySpecialtyId
  );

  // Yazmadan ÖNCE eski (mevcut) değerleri aç — geri alınabilsin diye (görev dosyası madde 5).
  console.log("[ÖNCESİ] title:", JSON.stringify(doctor.title));
  console.log("[ÖNCESİ] subSpecialty:", JSON.stringify(doctor.subSpecialty), "(bu script ARTIK bu alana DOKUNMUYOR)");
  console.log(
    "[ÖNCESİ] specialtyId:",
    doctor.specialtyId ?? "null",
    willConnectPrimary ? "(null → Obesity & Metabolic Surgery'ye bağlanacak)" : "(ZATEN dolu, DOKUNULMAYACAK)"
  );
  console.log("[ÖNCESİ] aboutHtml (ilk 100 karakter):", JSON.stringify((doctor.aboutHtml ?? "").slice(0, 100)));
  console.log("[ÖNCESİ] socialLinks:", JSON.stringify(doctor.socialLinks));

  if (dryRun) {
    console.log(`\n[dry-run] doktor "${doctor.fullName}" (${doctor.slug}) için ÖNCE → SONRA (hiçbir şey YAZILMADI):`);
    console.log(`  title: ${JSON.stringify(doctor.title)} → ${JSON.stringify(TARGET_TITLE)}`);
    console.log(
      `  specialtyId: ${JSON.stringify(doctor.specialtyId ?? null)} → ${JSON.stringify(finalPrimarySpecialtyId)} ` +
        (willConnectPrimary ? "(YENİ bağlanacak)" : "(DEĞİŞMEYECEK, zaten dolu)")
    );
    console.log(`  subSpecialty: ${JSON.stringify(doctor.subSpecialty)} → DEĞİŞMEYECEK (artık ezilmiyor)`);
    console.log(
      `  eklenecek ek uzmanlık(lar) (DoctorAdditionalSpecialty, upsert): ${
        additionalSpecialtiesToAdd.length > 0 ? additionalSpecialtiesToAdd.map((s) => s.name).join(", ") : "(yok)"
      }`
    );
    console.log(
      `  aboutHtml ilk 100 karakter: ${JSON.stringify((doctor.aboutHtml ?? "").slice(0, 100))} → ${JSON.stringify(
        targetAboutHtml.slice(0, 100)
      )}`
    );
    console.log(`  socialLinks: ${JSON.stringify(doctor.socialLinks)} → ${JSON.stringify(TARGET_SOCIAL_LINKS)}`);
    console.log(
      "\n[NOT] TR çevirisi YAZILMAYACAK — DoctorProfile şemasında bir `translations` alanı/tablosu yok (bkz. script başı yorumu)."
    );
    console.log("[referans, henüz yazılmadı] TR unvan:", TR_TITLE_FOR_FUTURE_USE);
    console.log("[referans, henüz yazılmadı] TR biyografi paragrafları:", TR_ABOUT_PARAGRAPHS_FOR_FUTURE_USE.length);
    return;
  }

  const data: Prisma.DoctorProfileUpdateInput = {
    title: TARGET_TITLE,
    aboutHtml: targetAboutHtml.length > 0 ? targetAboutHtml : null,
    socialLinks: TARGET_SOCIAL_LINKS as unknown as Prisma.InputJsonValue,
    ...(willConnectPrimary ? { specialty: { connect: { id: primarySpecialty.id } } } : {}),
  };

  await prisma.doctorProfile.update({ where: { id: doctor.id }, data });

  // Ek uzmanlıklar — composite PK (`doctorId_specialtyId`) SAYESİNDE `upsert` tekrar
  // çalıştırmada ikinci bir satır OLUŞTURMAZ; mevcut ek uzmanlıklar SİLİNMEZ.
  for (const specialty of additionalSpecialtiesToAdd) {
    await prisma.doctorAdditionalSpecialty.upsert({
      where: { doctorId_specialtyId: { doctorId: doctor.id, specialtyId: specialty.id } },
      create: { doctorId: doctor.id, specialtyId: specialty.id },
      update: {},
    });
  }

  console.log(
    `[fix] doktor "${doctor.fullName}" (${doctor.slug}) güncellendi: title="${TARGET_TITLE}", ` +
      `specialtyId=${willConnectPrimary ? `YENİ bağlandı (${primarySpecialty.name})` : "değişmedi"}, ` +
      `ek uzmanlık(lar)=${additionalSpecialtiesToAdd.map((s) => s.name).join(", ") || "(yok)"}, ` +
      `subSpecialty DOKUNULMADI, socialLinks=${TARGET_SOCIAL_LINKS.length} öğe.`
  );
  console.log(
    "\n[NOT] TR çevirisi YAZILMADI — DoctorProfile şemasında bir `translations` alanı/tablosu yok; " +
      '`/tr/doctors/vahit-mutlu` ve `/en/doctors/vahit-mutlu` şu an AYNI (tek dilli) içeriği gösteriyor. ' +
      "Doktor içeriğinin dile göre ayrışması gerekiyorsa bu db-agent/architect kararı gerektiren bir şema değişikliğidir " +
      "(bkz. `TR_TITLE_FOR_FUTURE_USE`/`TR_ABOUT_PARAGRAPHS_FOR_FUTURE_USE` — hazır TR metin, yalnızca referans)."
  );
  console.log("[referans, henüz yazılmadı] TR unvan:", TR_TITLE_FOR_FUTURE_USE);
  console.log("[referans, henüz yazılmadı] TR biyografi paragrafları:", TR_ABOUT_PARAGRAPHS_FOR_FUTURE_USE.length);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
