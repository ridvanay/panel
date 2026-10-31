import type { FastifyInstance } from "fastify";
import type { Prisma, Testimonial } from "@prisma/client";
import { z } from "zod";
import { env } from "../../config/env";
import { generateOpaqueToken, hashToken } from "../../lib/tokens";
import { escapeHtml, toBrandLocale, type BrandLocale } from "../../lib/branded-email";
import { sendBrandedMail } from "../../lib/branded-mail";
import { doctorDisplayName } from "../../lib/doctor-display-name";
import { patientEmailLocale } from "../telehealth/lib/notifications";

/**
 * Paket Y — hasta memnuniyet yorumları. UYDURMA YORUM YOK: seed/demo yorum verisi üretilmez.
 * - Her yorum `pending` başlar; admin metni DÜZENLEYEMEZ, yalnızca maskeleyebilir (audit'e yazılır).
 * - "Verified patient" yalnızca `verified_booking` kaynaklı yoruma verilir.
 * - Bir hekimde 3'ten az onaylı yorum varsa ortalama ve dağılım GÖSTERİLMEZ (uydurma koruması).
 * - `Review`/`AggregateRating` JSON-LD EKLENMEZ (Google kendi hakkındaki yorum işaretlemesini
 *   desteklemiyor; yanlış kullanım manuel işleme yol açabilir).
 */
export const TESTIMONIAL_STATUSES = ["pending", "approved", "rejected", "hidden"] as const;
export const TESTIMONIAL_SOURCES = ["verified_booking", "manual_with_consent", "imported"] as const;
export const DISPLAY_MODES = ["initials", "first_initial", "anonymous"] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number];
export const MIN_APPROVED_FOR_AVERAGE = 3;
export const REVIEW_INVITE_TTL_DAYS = 30;
export const REVIEW_BODY_MIN = 30;
export const REVIEW_BODY_MAX = 1500;
export const REVIEW_LIST_PAGE_SIZE = 10;
/** Görüşme bitiminden bu kadar sonra davet gider; bu pencereden eski görüşmelere (yayın günü dahil) gönderilmez. */
export const REVIEW_REQUEST_DELAY_MS = 24 * 60 * 60 * 1000;
export const REVIEW_REQUEST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Güvenlik incelemesi — yorum alanları DÜZ METİN: HTML reddedilir; görünmez kontrol, sıfır genişlikli ve
 * yön (bidi) karakterleri silinir. Frontend bu alanları yalnızca metin düğümü olarak basar.
 */
// eslint-disable-next-line no-control-regex -- kontrol karakterleri bilinçli olarak temizleniyor
const INVISIBLE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
export function plainText(min: number, max: number) {
  return z
    .string()
    .transform((v) => v.replace(INVISIBLE_CHARS, "").trim())
    .pipe(
      z
        .string()
        .min(min)
        .max(max)
        .refine((v) => !/<[a-z!/?]/i.test(v), "HTML kullanılamaz.")
    );
}

export const ReviewSubmissionSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    title: plainText(3, 120),
    body: plainText(REVIEW_BODY_MIN, REVIEW_BODY_MAX),
    displayMode: z.enum(DISPLAY_MODES).default("initials"),
    /** KVKK incelemesi — gösterilecek ülkeyi hasta seçer (isteğe bağlı); kimlik belgesi ülkesi KULLANILMAZ. */
    country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
    /** Yayın onayı — zorunlu; onay verilen rıza metninin sürümü kaydedilir. */
    publishConsent: z.literal(true),
    consentTextVersion: z.string().trim().min(1).max(40),
  })
  .strict();
export type ReviewSubmission = z.infer<typeof ReviewSubmissionSchema>;

/** Görünen ad: baş harfler "M. K." / ad + soyad baş harfi "Mehmet K." / anonim (boş; arayüz "Anonim hasta" yazar). */
export function authorDisplayFor(fullName: string, mode: DisplayMode): string {
  if (mode === "anonymous") return "";
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const initial = (w: string) => `${w.charAt(0).toLocaleUpperCase("tr")}.`;
  if (mode === "first_initial") {
    const first = words[0]!;
    const last = words.length > 1 ? ` ${initial(words[words.length - 1]!)}` : "";
    return `${first.charAt(0).toLocaleUpperCase("tr")}${first.slice(1)}${last}`;
  }
  return words.length > 1 ? `${initial(words[0]!)} ${initial(words[words.length - 1]!)}` : initial(words[0]!);
}

/**
 * Maskeleme (karartma): `text` içindeki her `snippet` geçişi, boşluk dışı karakterleri "█" olacak
 * şekilde değiştirilir. Metnin geri kalanı DEĞİŞMEZ. Kaç geçiş maskelendiği döner.
 */
/** Admin kuyruğu için uyarı bayrakları (içerik değişmez): e-posta, telefon, bağlantı. */
export function riskFlags(text: string): string[] {
  const flags: string[] = [];
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(text)) flags.push("email");
  if (/(\+?\d[\d\s().-]{7,}\d)/.test(text)) flags.push("phone");
  if (/(https?:\/\/|www\.)\S+/i.test(text)) flags.push("url");
  return flags;
}

export function maskSnippet(text: string, snippet: string): { text: string; occurrences: number } {
  if (!snippet || snippet.trim().length < 2) return { text, occurrences: 0 };
  const parts = text.split(snippet);
  const occurrences = parts.length - 1;
  if (occurrences === 0) return { text, occurrences };
  return { text: parts.join(snippet.replace(/\S/g, "█")), occurrences };
}

export interface RatingSummary {
  count: number;
  /** 3'ten az onaylı yorumda `null` (gösterilmez). */
  average: number | null;
  /** 1..5 yıldız adetleri; 3'ten az onaylı yorumda `null`. */
  distribution: Record<"1" | "2" | "3" | "4" | "5", number> | null;
}

export const APPROVED_WHERE = { status: "approved", anonymizedAt: null } satisfies Prisma.TestimonialWhereInput;

export async function ratingSummary(app: FastifyInstance, where: Prisma.TestimonialWhereInput): Promise<RatingSummary> {
  const grouped = await app.prisma.testimonial.groupBy({ by: ["rating"], where: { ...where, ...APPROVED_WHERE }, _count: { _all: true } });
  const distribution = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 } as Record<"1" | "2" | "3" | "4" | "5", number>;
  let count = 0;
  let sum = 0;
  for (const g of grouped) {
    const n = g._count._all;
    count += n;
    sum += g.rating * n;
    const key = String(g.rating) as keyof typeof distribution;
    if (key in distribution) distribution[key] = n;
  }
  if (count < MIN_APPROVED_FOR_AVERAGE) return { count, average: null, distribution: null };
  return { count, average: Math.round((sum / count) * 10) / 10, distribution };
}

/** Herkese açık yorum DTO'su — kişisel veri yok (yalnızca seçilen görünen ad ve ülke kodu). */
export function toPublicTestimonialDto(row: Testimonial, locale?: string) {
  const translations = (row.translations ?? {}) as Record<string, { title?: string; body?: string }>;
  const translation = locale && locale !== row.language ? translations[locale] : undefined;
  return {
    id: row.id,
    authorDisplay: row.authorDisplay,
    displayMode: row.displayMode,
    country: row.country,
    language: row.language,
    rating: row.rating,
    title: row.title,
    body: row.body,
    translation: translation?.body ? { title: translation.title ?? null, body: translation.body } : null,
    verified: row.source === "verified_booking",
    publishedAt: (row.publishedAt ?? row.createdAt).toISOString(),
    doctorReply: row.doctorReply,
  };
}

/**
 * Hasta isteğiyle kaldırma: metin, görünen ad, ülke, hekim yanıtı ve onay kanıtı notu silinir; yorum gizlenir
 * (puana sayılmaz). Booking bağı İÇ kayıt olarak kalır (herkese açık değildir): aynı randevuya "sil-yeniden
 * yaz" döngüsüyle sınırsız yorum yazılamaz (booking başına tek yorum DB'de de garanti).
 */
export function anonymizedTestimonialData(now: Date): Prisma.TestimonialUpdateInput {
  return {
    status: "hidden",
    title: "",
    body: "",
    translations: {},
    authorDisplay: "",
    displayMode: "anonymous",
    country: null,
    doctorReply: null,
    consentEvidenceNote: null,
    authorUserId: null,
    featuredOnHome: false,
    anonymizedAt: now,
  };
}

/** Booking başına tek yorum (kısmi benzersiz indeks) çakışması → 409. */
export function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: string }).code === "P2002";
}

// ---------------------------------------------------------------------------------------------
// "Deneyiminizi paylaşın" daveti
// ---------------------------------------------------------------------------------------------

interface InviteStrings {
  subject: string;
  optOut: string;
  greeting: string;
  intro: string;
  cta: string;
  validity: string;
  privacy: string;
}

const INVITE: Record<BrandLocale, InviteStrings> = {
  tr: {
    subject: "Görüşmenizi değerlendirir misiniz?",
    optOut: "Bundan sonra yorum isteği almak istemiyorsanız buraya tıklayın",
    greeting: "Merhaba {name},",
    intro: "{doctor} ile yaptığınız görüşme için teşekkür ederiz. Deneyiminizi paylaşırsanız diğer hastalara yol göstermiş olursunuz.",
    cta: "Deneyiminizi paylaşın",
    validity: "Bu bağlantı yalnızca bir kez kullanılabilir ve 30 gün geçerlidir.",
    privacy: "Lütfen yorumunuza tanı, ilaç ya da başkasını tanıtan bilgi yazmayın. Yorumunuz yayınlanmadan önce incelenir.",
  },
  en: {
    subject: "How was your consultation?",
    optOut: "If you do not want to receive review requests again, click here",
    greeting: "Hello {name},",
    intro: "Thank you for your consultation with {doctor}. Sharing your experience helps other patients.",
    cta: "Share your experience",
    validity: "This link can be used once and is valid for 30 days.",
    privacy: "Please do not include a diagnosis, medication or details that identify anyone. Your review is checked before it is published.",
  },
  de: {
    subject: "Wie war Ihre Beratung?",
    optOut: "Wenn Sie keine Bewertungsanfragen mehr erhalten möchten, klicken Sie hier",
    greeting: "Hallo {name},",
    intro: "Vielen Dank für Ihre Beratung bei {doctor}. Wenn Sie Ihre Erfahrung teilen, helfen Sie anderen Patientinnen und Patienten.",
    cta: "Erfahrung teilen",
    validity: "Dieser Link kann einmal verwendet werden und ist 30 Tage gültig.",
    privacy: "Bitte nennen Sie keine Diagnose, keine Medikamente und keine Angaben, die eine Person erkennbar machen. Ihre Bewertung wird vor der Veröffentlichung geprüft.",
  },
  fr: {
    subject: "Comment s’est passée votre consultation ?",
    optOut: "Si vous ne souhaitez plus recevoir de demandes d’avis, cliquez ici",
    greeting: "Bonjour {name},",
    intro: "Merci pour votre consultation avec {doctor}. Partager votre expérience aide d’autres patients.",
    cta: "Partager mon expérience",
    validity: "Ce lien ne peut être utilisé qu’une fois et reste valable 30 jours.",
    privacy: "Merci de ne pas indiquer de diagnostic, de médicament ni d’informations permettant d’identifier quelqu’un. Votre avis est vérifié avant publication.",
  },
  es: {
    subject: "¿Qué tal fue su consulta?",
    optOut: "Si no desea recibir más solicitudes de opinión, haga clic aquí",
    greeting: "Hola, {name}:",
    intro: "Gracias por su consulta con {doctor}. Compartir su experiencia ayuda a otros pacientes.",
    cta: "Compartir mi experiencia",
    validity: "Este enlace solo se puede usar una vez y es válido durante 30 días.",
    privacy: "No incluya diagnósticos, medicamentos ni datos que identifiquen a nadie. Su opinión se revisa antes de publicarse.",
  },
  ru: {
    subject: "Как прошла ваша консультация?",
    optOut: "Если вы не хотите больше получать просьбы оставить отзыв, нажмите здесь",
    greeting: "Здравствуйте, {name}!",
    intro: "Спасибо за консультацию у {doctor}. Поделившись впечатлениями, вы поможете другим пациентам.",
    cta: "Поделиться отзывом",
    validity: "Ссылку можно использовать один раз, она действует 30 дней.",
    privacy: "Пожалуйста, не указывайте диагноз, лекарства или сведения, по которым можно узнать человека. Отзыв проверяется перед публикацией.",
  },
  ar: {
    subject: "كيف كانت استشارتك؟",
    optOut: "إذا كنت لا ترغب في تلقي طلبات تقييم مرة أخرى، اضغط هنا",
    greeting: "مرحبا {name}،",
    intro: "شكرا لاستشارتك مع {doctor}. مشاركة تجربتك تساعد مرضى آخرين.",
    cta: "شارك تجربتك",
    validity: "يمكن استخدام هذا الرابط مرة واحدة فقط، وهو صالح لمدة 30 يوما.",
    privacy: "يرجى عدم ذكر تشخيص أو دواء أو أي معلومات تكشف هوية أحد. تتم مراجعة تقييمك قبل نشره.",
  },
  ro: {
    subject: "Cum a fost consultația?",
    optOut: "Dacă nu mai doriți să primiți solicitări de recenzie, faceți clic aici",
    greeting: "Bună ziua, {name},",
    intro: "Vă mulțumim pentru consultația cu {doctor}. Împărtășindu-vă experiența, îi ajutați pe alți pacienți.",
    cta: "Împărtășiți experiența",
    validity: "Acest link poate fi folosit o singură dată și este valabil 30 de zile.",
    privacy: "Vă rugăm să nu scrieți diagnostice, medicamente sau date care identifică o persoană. Recenzia este verificată înainte de publicare.",
  },
  "sr-latn": {
    subject: "Kako je prošla vaša konsultacija?",
    optOut: "Ako više ne želite da primate zahteve za recenziju, kliknite ovde",
    greeting: "Zdravo, {name},",
    intro: "Hvala vam na konsultaciji kod {doctor}. Ako podelite svoje iskustvo, pomoći ćete drugim pacijentima.",
    cta: "Podelite iskustvo",
    validity: "Ovaj link se može upotrebiti samo jednom i važi 30 dana.",
    privacy: "Molimo vas da ne navodite dijagnozu, lekove ni podatke po kojima se neko može prepoznati. Recenzija se proverava pre objavljivanja.",
  },
};

/**
 * Konu satırı NÖTR (hekim/uzmanlık adı yok — gelen kutusunda sağlık hizmeti ilişkisini açığa vurmasın);
 * hekim adı gövdede. Her e-postada "bir daha yorum isteği gönderme" bağlantısı (itiraz hakkı).
 */
export function buildReviewInviteEmail(input: { locale: string; patientName: string; doctorName: string; url: string; optOutUrl: string }) {
  const locale = toBrandLocale(input.locale);
  const t = INVITE[locale];
  const fill = (s: string) => s.replace("{doctor}", input.doctorName).replace("{name}", input.patientName);
  const p = (s: string) => `<p>${escapeHtml(fill(s))}</p>`;
  const optOut = `<p style="font-size:12px;color:#6b7280;"><a href="${escapeHtml(input.optOutUrl)}" style="color:#6b7280;">${escapeHtml(t.optOut)}</a></p>`;
  return {
    locale,
    subject: t.subject,
    bodyHtml: [p(t.greeting), p(t.intro), p(t.validity), p(t.privacy), optOut].join(""),
    cta: { label: t.cta, url: input.url },
  };
}

export function optOutEmailHash(email: string): string {
  return hashToken(email.trim().toLowerCase());
}

function isMinor(birthDate: Date | null | undefined, now: Date): boolean {
  if (!birthDate) return false;
  const eighteen = new Date(birthDate);
  eighteen.setUTCFullYear(eighteen.getUTCFullYear() + 18);
  return eighteen > now;
}

/** Booking için tek davet oluşturur (varsa ve kullanılmamışsa yeni token üretmez → null). */
export async function createReviewInvite(app: FastifyInstance, bookingId: string, now = new Date()): Promise<string | null> {
  const existing = await app.prisma.testimonialInvite.findUnique({ where: { bookingId } });
  if (existing) return null;
  const raw = generateOpaqueToken();
  await app.prisma.testimonialInvite.create({
    data: { bookingId, tokenHash: hashToken(raw), expiresAt: new Date(now.getTime() + REVIEW_INVITE_TTL_DAYS * 86_400_000) },
  });
  return raw;
}

/** Hastaya (yalnızca hastaya) davet e-postası — hastanın dilinde, kurumsal kabukla. Sağlık bilgisi içermez. */
export async function sendReviewInvite(app: FastifyInstance, bookingId: string, now = new Date()): Promise<boolean> {
  const booking = await app.prisma.appointmentBooking.findUnique({
    where: { id: bookingId },
    select: { id: true, patientName: true, patientEmail: true, locale: true, archivedAt: true, patientBirthDate: true, doctor: { select: { title: true, fullName: true, publicName: true, isFounder: true } } },
  });
  if (!booking || booking.archivedAt) return false;
  // KVKK incelemesi — reşit olmayana ve "bir daha gönderme" diyene davet gitmez.
  if (isMinor(booking.patientBirthDate, now)) return false;
  if (await app.prisma.reviewRequestOptOut.findUnique({ where: { emailHash: optOutEmailHash(booking.patientEmail) }, select: { emailHash: true } })) return false;
  if (await app.prisma.testimonial.findFirst({ where: { bookingId }, select: { id: true } })) return false;
  const raw = await createReviewInvite(app, bookingId, now);
  if (!raw) return false;
  const locale = patientEmailLocale(booking);
  const doctorName = `${booking.doctor.title} ${doctorDisplayName(booking.doctor)}`.trim();
  const url = `${env.FRONTEND_URL}/${locale}/review/${raw}`;
  const mail = buildReviewInviteEmail({ locale, patientName: booking.patientName, doctorName, url, optOutUrl: `${url}?optout=1` });
  await sendBrandedMail(app, { to: booking.patientEmail, subject: mail.subject, preheader: mail.subject, bodyHtml: mail.bodyHtml, cta: mail.cta, locale: mail.locale, audience: "patient" });
  await app.prisma.testimonialInvite.update({ where: { bookingId }, data: { sentAt: now } });
  return true;
}

// ---------------------------------------------------------------------------------------------
// Saklama (KVKK incelemesi): kullanılmış/süresi dolmuş davet 30 gün sonra silinir; 90 günden eski
// bekleyen ve reddedilen yorumlar anonimleştirilir (onaylı yorumlar hasta silene dek kalır).
// ---------------------------------------------------------------------------------------------
export const INVITE_RETENTION_DAYS = 30;
export const UNPUBLISHED_REVIEW_RETENTION_DAYS = 90;

export async function purgeReviewData(app: FastifyInstance, now = new Date()): Promise<{ invites: number; reviews: number }> {
  const inviteCutoff = new Date(now.getTime() - INVITE_RETENTION_DAYS * 86_400_000);
  const invites = (await app.prisma.testimonialInvite.deleteMany({ where: { OR: [{ usedAt: { lt: inviteCutoff } }, { expiresAt: { lt: inviteCutoff } }] } })).count;
  const reviewCutoff = new Date(now.getTime() - UNPUBLISHED_REVIEW_RETENTION_DAYS * 86_400_000);
  const stale = await app.prisma.testimonial.findMany({
    where: { anonymizedAt: null, OR: [{ status: "pending", createdAt: { lt: reviewCutoff } }, { status: "rejected", moderatedAt: { lt: reviewCutoff } }] },
    select: { id: true },
  });
  for (const row of stale) await app.prisma.testimonial.update({ where: { id: row.id }, data: anonymizedTestimonialData(now) });
  return { invites, reviews: stale.length };
}
