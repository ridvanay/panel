import crypto from "node:crypto";
import type { InterpreterAssignmentStatus, Prisma, PrismaClient } from "@prisma/client";
import { abbreviateDoctorName } from "../../../lib/doctor-display-name";

/**
 * Paket AA (2026-10-30) — görüşmeye tercüman katılımı. Tercüman, ADMIN kalite dinleyicisinden (Paket C)
 * AYRI bir katılımcı rolüdür: görünür, kamera ve mikrofonla yayın yapar, ekran paylaşamaz.
 *
 * Erişim kuralları (tek yer, testlerle sabitlenir):
 *  - Atama yalnızca aktif + gizlilik taahhüdü onaylı tercümana yapılır; booking başına en çok 1 aktif
 *    atama (ASSIGNED / JOINED / LEFT — ayrıca DB'de kısmi tekil indeks).
 *  - Token: rol INTERPRETER + 2FA etkin + profil aktif + güncel taahhüt onayı + aktif atama + doktorun
 *    erişim kuralı (randevu SCHEDULED/IN_PROGRESS, booking ödenmiş). Tercüman görüşmeyi BAŞLATMAZ
 *    (SCHEDULED→IN_PROGRESS geçişi yalnızca hasta/doktor token'ında olur).
 *  - Tercüman hasta belgelerini, intake cevaplarını, doktor notlarını, reçeteleri ve kayıtları görmez;
 *    panelde hastanın yalnızca adının baş harfi gösterilir.
 */
export const ACTIVE_ASSIGNMENT_STATUSES: InterpreterAssignmentStatus[] = ["ASSIGNED", "JOINED", "LEFT"];

export const INTERPRETER_AUDIT = {
  assigned: "interpreter.assigned",
  unassigned: "interpreter.unassigned",
  joined: "interpreter.joined",
  left: "interpreter.left",
  removedByDoctor: "interpreter.removed_by_doctor",
  confidentialityAccepted: "interpreter.confidentiality_accepted",
  created: "interpreter.created",
  updated: "interpreter.updated",
  requested: "interpreter.requested",
  confidentialityTextUpdated: "interpreter.confidentiality_text_updated",
} as const;

export const INTERPRETER_IDENTITY_PREFIX = "interpreter:";

/** LiveKit kimliği — `interpreter:<interpreterProfileId>:<bookingId>` (kişisel veri içermez). */
export function buildInterpreterIdentity(interpreterProfileId: string, bookingId: string): string {
  return `${INTERPRETER_IDENTITY_PREFIX}${interpreterProfileId}:${bookingId}`;
}

/** "Ayşe Nur YILMAZ" → "A. N. Yılmaz" — doktor adlarıyla aynı kural (`abbreviateDoctorName`). Varsayılan görünen ad. */
export function initialsDisplayName(fullName: string): string {
  return abbreviateDoctorName(fullName);
}

/** Hastanın yalnızca adının baş harfi ("Ayşe Yılmaz" → "A."). */
export function patientInitial(patientName: string): string {
  const first = patientName.trim().charAt(0);
  return first ? `${first.toLocaleUpperCase("tr")}.` : "—";
}

/** Dilin kendi dilindeki adı ("ar" → "العربية", "sr-latn" → "srpski"); tanınmazsa kod büyük harfle. */
export function nativeLanguageName(code: string): string {
  const tag = code.toLowerCase() === "sr-latn" ? "sr-Latn" : code;
  try {
    const name = new Intl.DisplayNames([tag], { type: "language" }).of(tag);
    if (name && name.toLowerCase() !== code.toLowerCase()) return name;
  } catch {
    // Geçersiz etiket — koda düşülür.
  }
  return code.toUpperCase();
}

/** LiveKit görünen adı: "<displayName> · Interpreter (العربية)". */
export function interpreterParticipantName(displayName: string, language: string): string {
  return `${displayName} · Interpreter (${nativeLanguageName(language)})`;
}

// ---------------------------------------------------------------------------------------------
// Gizlilik taahhüdü metni — SiteModule(telehealth).settings.interpreterConfidentiality {en, tr}.
// Metin değişince sürüm (içerik özeti) değişir ve tercümandan yeniden onay istenir.
// HUKUK KONTROLÜ GEREKLİ: aşağıdaki varsayılanlar taslaktır.
// ---------------------------------------------------------------------------------------------
export const DEFAULT_CONFIDENTIALITY_TEXT = {
  en: [
    "Interpreter confidentiality undertaking (draft — subject to legal review)",
    "",
    "1. I will keep strictly confidential everything I see or hear during consultations, including patients' identity and health information, and I will not disclose it to anyone.",
    "2. I will not record, photograph, copy or store any part of a consultation, and I will not take notes containing personal data.",
    "3. I will interpret completely and accurately, without adding, omitting or changing anything, and I will not give medical advice.",
    "4. I will join consultations only from a private place, using headphones, where no third person can see or hear the session; I will not use any recording device or any other person or tool to interpret on my behalf.",
    "5. I will process the information I learn only to interpret the consultation I am assigned to, following WM Health's instructions, and I will not pass it on to anyone else.",
    "6. I will use my account only myself, keep my password and two-factor authentication secure, and report any suspected data breach to WM Health within 24 hours.",
    "7. I understand that if a consultation is recorded, my voice and image will also be included in the recording, and that my assignments, join and leave times are logged.",
    "8. These obligations continue after my work with WM Health ends. I understand that breaching them may have legal and criminal consequences under the Turkish Personal Data Protection Law (KVKK), the Turkish Criminal Code and other applicable law.",
  ].join("\n"),
  tr: [
    "Tercüman gizlilik taahhüdü (taslak — hukuk kontrolüne tabidir)",
    "",
    "1. Görüşmeler sırasında gördüğüm ve duyduğum her şeyi, hastaların kimlik ve sağlık bilgileri dahil, kesinlikle gizli tutacağım ve kimseyle paylaşmayacağım.",
    "2. Görüşmenin hiçbir bölümünü kaydetmeyecek, fotoğraflamayacak, kopyalamayacak ya da saklamayacağım; kişisel veri içeren not almayacağım.",
    "3. Hiçbir şey eklemeden, çıkarmadan ya da değiştirmeden eksiksiz ve doğru çeviri yapacağım; tıbbi tavsiye vermeyeceğim.",
    "4. Görüşmelere yalnızca üçüncü kişilerin göremeyeceği ve duyamayacağı özel bir ortamdan, kulaklıkla katılacağım; kayıt cihazı kullanmayacak, yerime başka bir kişi ya da araçla çeviri yaptırmayacağım.",
    "5. Öğrendiğim bilgileri yalnızca atandığım görüşmenin çevirisi için ve WM Health'in talimatlarına uygun olarak işleyecek, başkasına aktarmayacağım.",
    "6. Hesabımı yalnızca kendim kullanacak, şifremi ve iki adımlı doğrulamamı güvende tutacak, olası bir veri ihlalini 24 saat içinde WM Health'e bildireceğim.",
    "7. Görüşme kaydediliyorsa sesimin ve görüntümün de kayda gireceğini, atamalarımın ve görüşmeye giriş-çıkış zamanlarımın kayıt altına alındığını biliyorum.",
    "8. Bu yükümlülükler WM Health ile çalışmam sona erdikten sonra da devam eder. İhlalin 6698 sayılı KVKK, Türk Ceza Kanunu ve ilgili mevzuat kapsamında hukuki ve cezai sonuçları olabileceğini biliyorum.",
  ].join("\n"),
};

export interface ConfidentialityText {
  en: string;
  tr: string;
  version: string;
}

export const CONFIDENTIALITY_TEXT_MAX = 6000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function confidentialityVersion(en: string, tr: string): string {
  return crypto.createHash("sha256").update(`${en}\n---\n${tr}`).digest("hex").slice(0, 16);
}

export function parseConfidentialityText(rawSettings: unknown): ConfidentialityText {
  const raw = asRecord(asRecord(rawSettings).interpreterConfidentiality);
  const pick = (value: unknown, fallback: string) =>
    typeof value === "string" && value.trim() && value.length <= CONFIDENTIALITY_TEXT_MAX ? value.trim() : fallback;
  const en = pick(raw.en, DEFAULT_CONFIDENTIALITY_TEXT.en);
  const tr = pick(raw.tr, DEFAULT_CONFIDENTIALITY_TEXT.tr);
  return { en, tr, version: confidentialityVersion(en, tr) };
}

export function hasCurrentConfidentiality(profile: { confidentialityAcceptedAt: Date | null; confidentialityVersion: string | null }, text: ConfidentialityText): boolean {
  return profile.confidentialityAcceptedAt !== null && profile.confidentialityVersion === text.version;
}

// ---------------------------------------------------------------------------------------------
// Katılım kuralı — doktorun erişim kuralıyla aynı (bkz. telehealth.livekit.routes.ts::meeting-token).
// ---------------------------------------------------------------------------------------------
export interface JoinableAppointment {
  id: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
}

/** Booking'in katılınabilir ilk randevusu (SCHEDULED/IN_PROGRESS); booking ödenmemişse `null`. */
export function pickJoinableAppointment<T extends JoinableAppointment>(booking: { paymentStatus: string; appointments: T[] }): T | null {
  if (booking.paymentStatus !== "PAID") return null;
  const open = booking.appointments
    .filter((a) => a.status === "SCHEDULED" || a.status === "IN_PROGRESS")
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return open[0] ?? null;
}

/** Booking'in zaman aralığı (ilk başlangıç — son bitiş). */
export function bookingSpan(appointments: readonly { startsAt: Date; endsAt: Date }[]): { startsAt: Date; endsAt: Date } | null {
  if (appointments.length === 0) return null;
  const startsAt = new Date(Math.min(...appointments.map((a) => a.startsAt.getTime())));
  const endsAt = new Date(Math.max(...appointments.map((a) => a.endsAt.getTime())));
  return { startsAt, endsAt };
}

export function overlaps(a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

type Db = Pick<PrismaClient, "interpreterProfile" | "appointmentInterpreter">;

/**
 * Atanabilir tercümanlar: aktif, güncel taahhüdü onaylı, dili konuşan (dil verilmişse) ve booking'in
 * saatinde başka bir aktif atamasıyla çakışmayan. `excludeBookingId` mevcut booking'in kendi atamasını
 * çakışma sayılmaktan çıkarır (değiştirme senaryosu).
 */
export async function findAssignableInterpreters(
  db: Db,
  input: { span: { startsAt: Date; endsAt: Date }; language?: string; confidentiality: ConfidentialityText; excludeBookingId?: string }
) {
  const where: Prisma.InterpreterProfileWhereInput = {
    isActive: true,
    confidentialityAcceptedAt: { not: null },
    confidentialityVersion: input.confidentiality.version,
    user: { status: "ACTIVE", role: "INTERPRETER" },
    ...(input.language ? { languages: { has: input.language } } : {}),
  };
  const profiles = await db.interpreterProfile.findMany({
    where,
    orderBy: { displayName: "asc" },
    include: {
      user: { select: { email: true, twoFactorEnabled: true } },
      assignments: {
        where: { status: { in: ACTIVE_ASSIGNMENT_STATUSES }, ...(input.excludeBookingId ? { bookingId: { not: input.excludeBookingId } } : {}) },
        include: { booking: { select: { appointments: { select: { startsAt: true, endsAt: true, status: true } } } } },
      },
    },
  });
  return profiles.filter((profile) =>
    profile.assignments.every((assignment) => {
      const live = assignment.booking.appointments.filter((a) => a.status !== "CANCELLED");
      const span = bookingSpan(live);
      return !span || !overlaps(span, input.span);
    })
  );
}
