import type { FastifyInstance } from "fastify";
import type { AppointmentBooking } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { hashPassword } from "../../../lib/password";
import { issueVerificationCode } from "../../../lib/otp";
import { sendAccountActivationEmail } from "../../email-templates/email-templates.service";
import { logAudit } from "../../../lib/audit";
import crypto from "node:crypto";

/**
 * `.claude/architect-scope-guest-account-otp.md` §5 (bağlayıcı) + `.claude/security-review-
 * guest-account-otp.md` KARAR 2/3/4 (Vektör 1/2/4 — onaylandı/sıkılaştırıldı) — Özellik B:
 * misafir randevu ödemesinden hesap sağlama (provisioning).
 *
 * **Nerede çağrılır (§5.1, bağlayıcı):** `lib/booking.ts::confirmBookingPayment`in
 * `runSerializable(...)` DÖNDÜKTEN SONRA, transaction DIŞINDA, best-effort (try/catch + kendi
 * içinde, çağıran taraf sadece `app.log.error` ile karşılaşır — ödeme onayı ASLA bozulmaz). ÜÇ
 * ödeme-başarı yolunun (Stripe webhook / demo-pay / admin mark-paid) ÜÇÜ de bu fonksiyonu,
 * `triggerAppointmentConfirmationEmail`'in HEMEN yanında çağırır.
 *
 * **Neden transaction DIŞINDA (bağlayıcı):** argon2 parola hash'i (~100ms CPU) + bir SMTP
 * gidiş-dönüşü, Serializable bir transaction'ın içine konursa modülün en sıcak yazma yolunda
 * çakışma penceresini büyütür; e-posta gönderimi geri alınamaz (rollback edilen bir
 * transaction'dan e-posta çıkması kabul edilemez).
 */
export async function provisionPatientAccountForBooking(app: FastifyInstance, booking: AppointmentBooking): Promise<void> {
  try {
    await provisionInternal(app, booking);
  } catch (err) {
    app.log.error({ err, bookingId: booking.id }, "Misafir randevu ödemesinden hesap sağlama başarısız oldu (best-effort, ödeme onayı ETKİLENMEDİ)");
  }
}

async function provisionInternal(app: FastifyInstance, booking: AppointmentBooking): Promise<void> {
  // §5.5 — idempotency: oturum açmış hastanın randevusu (veya bu fonksiyonun daha önce zaten
  // çalıştığı bir tekrar çağrı) için no-op.
  if (booking.patientUserId !== null) return;

  // §5.2 — e-posta normalizasyonu ZORUNLU (trim + lowercase), `User.email` ile TUTARLI olsun.
  const email = booking.patientEmail.trim().toLowerCase();

  const existingUser = await app.prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    await linkBookingToUser(app, booking, existingUser.id, { newAccount: false });
    return;
  }

  // §5.2 (bağlayıcı) — rastgele, KULLANILAMAZ parola. Hiçbir yere yazılmaz/loglanmaz/dönülmez
  // (security-review KARAR 2, bağlayıcı ek koşul) — yalnızca `hashPassword`'a girer ve bu
  // fonksiyonun yerel kapsamından asla çıkmaz.
  const randomPassword = crypto.randomBytes(32).toString("base64url");
  const passwordHash = await hashPassword(randomPassword);

  let newUserId: string;
  try {
    const created = await app.prisma.user.create({
      data: {
        email,
        passwordHash,
        name: booking.patientName,
        // §5.4 (KRİTİK, bağlayıcı) — `auth.service.ts::register`'ın "sıfırdan kurulmuş bir
        // ortamda ilk kullanıcı otomatik ADMIN olur" kuralı BURAYA KASITLI OLARAK
        // KOPYALANMAMIŞTIR. Bu, misafir bir randevu ödemesiyle (doğrulanmamış, anonim bir
        // ziyaretçi girdisinden) sağlanan bir hesaptır — sıfırdan kurulmuş, henüz hiç
        // kullanıcısı olmayan bir sitede İLK misafir randevu ödemesi bu satır `ADMIN` olsaydı
        // anonim bir ziyaretçiye tam ADMIN hesabı açardı. `role` HER ZAMAN sabit `"USER"`dır —
        // `app.prisma.user.count()` burada ASLA çağrılmaz.
        role: "USER",
        status: "ACTIVE",
        // `emailVerifiedAt: null` — giriş kapısını kapatan alan (§2.3): bu hesap
        // `POST /auth/activate-account` çağrılana kadar `login()`den token ALAMAZ.
        emailVerifiedAt: null,
      },
    });
    newUserId = created.id;
  } catch (err) {
    // §5.5 — yarış durumu: aynı e-postayla iki ödeme eşzamanlı onaylanırsa `User.email` üzerinde
    // P2002 oluşabilir. Yakala, kullanıcıyı YENİDEN OKU, bağla — YENİ hesap AÇMA, ikinci
    // aktivasyon e-postası GİTMEZ.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const racedUser = await app.prisma.user.findUnique({ where: { email } });
      if (racedUser) {
        await linkBookingToUser(app, booking, racedUser.id, { newAccount: false });
        return;
      }
    }
    throw err;
  }

  await linkBookingToUser(app, booking, newUserId, { newAccount: true });

  // §5.2 — YENİ hesapta aktivasyon kodu üretilir + e-postası gönderilir. Var olan hesaba
  // bağlanan dalda (yukarıda `return` edildi) BU KISIM HİÇ ÇALIŞMAZ (§5.3 — "aktivasyon
  // e-postası GÖNDERİLMEZ").
  const issued = await issueVerificationCode(app, newUserId, "ACCOUNT_ACTIVATION");
  if (!issued) {
    // Taze oluşturulmuş bir kullanıcı için bu satıra pratikte ASLA ulaşılmaz (hiçbir önceki
    // kod satırı olamaz, dolayısıyla cooldown/tavan kontrolü doğası gereği geçer) — savunma
    // amaçlı, sessizce log'lanır (kullanıcı hâlâ `forgot-password` ile kurtarılabilir, §5.6).
    app.log.error({ userId: newUserId, bookingId: booking.id }, "Yeni sağlanan hesap için aktivasyon kodu üretilemedi (beklenmedik durum).");
    return;
  }

  await sendAccountActivationEmail(app, { email, name: booking.patientName }, issued.code, issued.expiresAt, booking.bookingNumber);
}

async function linkBookingToUser(
  app: FastifyInstance,
  booking: AppointmentBooking,
  userId: string,
  info: { newAccount: boolean }
): Promise<void> {
  // §5.5 (bağlayıcı) — booking VE ona bağlı randevu satırları AYNI anda bağlanır (`/patient/
  // appointments` ve `/patient/bookings` farklı alanlara bakar, yarısı bağlanmış bir durum
  // portalda tutarsız görünürdü).
  await app.prisma.$transaction([
    app.prisma.appointmentBooking.update({
      where: { id: booking.id },
      data: { patientUserId: userId },
    }),
    app.prisma.appointment.updateMany({
      where: { bookingId: booking.id },
      data: { patientUserId: userId },
    }),
  ]);

  if (!info.newAccount) {
    // `.claude/compliance-notes-guest-account-otp.md` §2 (bağlayıcı olmayan güçlü öneri) —
    // saldırganın/üçüncü bir kişinin girdiği randevu verisinin, kurbanın PASİF bir hesabına
    // otomatik/sessizce bağlandığı anları destek ekibinin "kullanıcı kendi eylemiyle bağladı"
    // senaryosundan AYIRT edebilmesi için sessiz bir audit izi — `patientName` gibi PII
    // metadata'ya YAZILMAZ (yalnızca ilişkiyi kaydeder, içeriği sızdırmaz).
    await logAudit(app, {
      actorId: null,
      actorEmail: null,
      action: "telehealth.booking.autoLinkedToExistingAccount",
      targetType: "AppointmentBooking",
      targetId: booking.id,
      metadata: { bookingId: booking.id, userId },
    });
  }
}
