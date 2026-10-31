import type { FastifyInstance } from "fastify";
import type { Appointment, AppointmentBooking, EmailTemplatePurpose } from "@prisma/client";
import { env } from "../../../config/env";
import { getLocaleSet } from "../../../lib/localization";
import { generateOpaqueToken, hashToken } from "../../../lib/tokens";
import { NotFoundError } from "../../../lib/errors";
import { sendBrandedMail } from "../../../lib/branded-mail";
import { renderTemplate } from "../../../lib/template-render";
import { sendTemplateEmail } from "../../email-templates/email-templates.service";
import { formatDoctorSlots, formatPatientRanges } from "../../../lib/dual-time";
import { doctorDisplayName } from "../../../lib/doctor-display-name";

/**
 * 2026-09-19 (kullanıcı talebi) — `sendTemplateEmail`'in `APPOINTMENT_CONFIRMATION` için
 * `NotFoundError` fırlattığı TEK durumda (DB'de `isActive:true` bir satır YOK — bkz.
 * `prisma/seed.ts::APPOINTMENT_CONFIRMATION`, kök neden GENELLİKLE `npm run seed`'in bu ortamda
 * hiç/güncel şablonla çalıştırılmamış olmasıdır) devreye giren, koda GÖMÜLÜ tek seferlik yedek
 * içerik. BİLİNÇLİ OLARAK SADECE bu şablon için ve SADECE `NotFoundError` için (SMTP/ağ hatası
 * gibi BAŞKA bir sebeple gönderim başarısız olursa fallback DENENMEZ, olduğu gibi loglanıp
 * yutulur — `catch` bloğuna bkz.): ödenmiş bir randevunun onay e-postası + görüşme linki, DB
 * yapılandırma eksikliği yüzünden hastaya HİÇ ULAŞMAMALI. `sendTemplateEmail`'in KENDİSİNE (TÜM
 * amaçlar için genel bir fallback) DEĞİL yalnızca bu tetikleyiciye eklenmesinin nedeni: diğer 10+
 * sistem e-postası (WELCOME/PASSWORD_RESET vb.) için "sessizce yutmuyoruz" (§10.16.3) ilkesi
 * AYNEN korunur — yalnızca bu tek, ödeme-sonrası kritik akış için dayanıklılık eklenir. Asıl DB
 * satırı hâlâ EKSİK sayılır ve `app.log.error` HER ZAMAN (fallback başarılı olsa DA) çağrılır ki
 * ops bunu fark edip gerçek düzeltmeyi (seed) uygulasın — bu yüzden "sessiz" bir fallback DEĞİL.
 */
export const FALLBACK_APPOINTMENT_CONFIRMATION_SUBJECT = "Your appointment is confirmed";
export const FALLBACK_APPOINTMENT_CONFIRMATION_BODY_HTML =
  '<p>Hello {{patient_name}},</p><p>{{status_message}}</p><p>Booking Number: <strong>{{booking_number}}</strong></p><p>Appointment time(s): {{slots_summary}}</p><p>Total: {{total_formatted}}</p><p><a href="{{join_link}}">Join Consultation</a></p><p>You can also use the link below to view your booking details:</p><p><a href="{{magic_link}}">View My Booking</a></p>';
export const FALLBACK_APPOINTMENT_CONFIRMATION_KEYS = [
  "patient_name",
  "status_message",
  "booking_number",
  "slots_summary",
  "total_formatted",
  "magic_link",
  "join_link",
];

/**
 * Bug-fix turu (2026-09-21, kullanıcı talebi) — `sessionPriceCents: null` (ücretsiz/bilgi-alınız)
 * doktorlarda `booking.totalCents === 0`dır; "Ödemenizi aldık" ifadesi bu durumda YANLIŞ/kafa
 * karıştırıcıdır (hiçbir ödeme YAPILMADI/ALINMADI — `confirmBookingPayment`'ın `paidBy: "free"`
 * dalı, bkz. `telehealth.routes.ts`). Bu yüzden durum cümlesi `total`e göre İKİ FARKLI metinle
 * değişken olarak (`{{status_message}}`) geçirilir — şablonun KENDİSİ koşullu blok DESTEKLEMEZ
 * (`lib/template-render.ts` dosya başı notu), bu yüzden koşul BURADA (tetikleyicide) çözülür.
 */
function buildConfirmationStatusMessage(totalCents: number): string {
  return totalCents === 0
    ? "Your appointment has been successfully created and confirmed."
    : "We have received your payment and your appointment is confirmed.";
}

/**
 * [TCT] §9.7.8 (bağlayıcı) — bildirim TETİKLEYİCİSİ. Şablonun İÇERİĞİ (`EmailTemplate` satırı,
 * konu/gövde — bkz. `prisma/seed.ts::APPOINTMENT_CONFIRMATION`) **notification-agent'ın sahasıdır**
 * — bu dosya "booking ÖDENDİĞİNDE hangi verilerle hangi `purpose` tetiklenir" HOOK'unu sağlar
 * (görev notu, backend-agent DOKUNMAZ listesi: "e-posta şablonu içeriği"). `lib/email-variables.ts
 * ::SYSTEM_VARIABLES_BY_PURPOSE.APPOINTMENT_CONFIRMATION` ile BİREBİR aynı anahtar seti kullanılır.
 *
 * **Bağlayıcı sızma yasağı (§9.7.5 madde 8 + §9.7.8):** doktorun uzmanlık adı, şikâyet notu veya
 * belge adı burada ASLA YER ALMAZ — yalnızca booking numarası, slot saatleri, toplam tutar ve
 * magic-link.
 *
 * Best-effort'tur (mevcut `ORDER_CONFIRMATION` deseniyle AYNI, bkz.
 * `modules/webhooks/stripe.routes.ts::handleCheckoutCompleted`): e-posta gönderimi başarısız
 * olsa da ÇAĞIRAN akışı (ödeme onayı/booking PAID geçişi) ASLA bozmaz — hata yalnızca loglanır
 * (kural: "sessiz başarısızlık olmaz" — `app.log.error` HER zaman çağrılır, yutulmaz).
 */
function formatMoney(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

/**
 * Paket P (2026-10-26) — hastaya giden saatler İKİ dilimde birlikte: hastanın randevu anındaki
 * dilimi (`AppointmentBooking.patientTimeZone`, adı + GMT farkı) ve Türkiye saati. Hasta dilimi
 * bilinmiyorsa ya da Türkiye ile aynıysa yalnızca Türkiye saati. Doktora giden e-postalarda
 * doktorun kendi dilimi + "Patient: Berlin …". Biçim `lib/dual-time.ts`'te (yaz saati `Intl` ile).
 */
// Paket R — başlangıç–bitiş aralığı, ardışık slotlar birleştirilir, hastanın saati bölgesine göre 12/24 saat.
function formatSlotsSummary(appointments: readonly { startsAt: Date; endsAt?: Date | null }[], patientTimeZone: string | null): string {
  return formatPatientRanges(appointments, patientTimeZone);
}

/**
 * Paket Y (kullanıcı kararı) — hastaya giden randevu e-postalarının dili: randevu anında kaydedilen
 * `AppointmentBooking.locale`; yoksa (eski kayıt / booking'siz randevu) TR. Bağlantıların dil
 * segmenti ve kurumsal kabuğun (footer, yön) dili budur; şablon gövdesi admin'in yazdığı dildedir.
 */
export const PATIENT_EMAIL_FALLBACK_LOCALE = "tr";
export function patientEmailLocale(booking: { locale?: string | null } | null | undefined): string {
  return booking?.locale || PATIENT_EMAIL_FALLBACK_LOCALE;
}

/** Hastanın kendi rezervasyon bağlantısı — hastanın dil segmentiyle. */
async function buildMagicLink(app: FastifyInstance, bookingId: string, rawAccessToken: string, locale: string): Promise<string> {
  return `${env.FRONTEND_URL}/${locale}/patient/bookings/${bookingId}?t=${rawAccessToken}`;
}

/**
 * 2026-09-18 (kullanıcı talebi) — `buildMagicLink` İLE AYNI dil-segmenti kaynağı, ama hedef
 * booking yönetim sayfası DEĞİL DOĞRUDAN görüşme odası (`/consultation/{appointmentId}`).
 * `?t=` aynı booking-seviyeli `rawAccessToken`'dır — `telehealth.routes.ts::assertBookingViewAccess`
 * randevunun KENDİ `accessTokenHash`'i YOKSA (silinmemiş normal akış) booking'in
 * `accessTokenHash`'ine düşer (bkz. o dosyanın başındaki yorum), yani AYNI token burada da geçerli.
 */
async function buildConsultationJoinLink(app: FastifyInstance, appointmentId: string, rawAccessToken: string, locale: string): Promise<string> {
  return `${env.FRONTEND_URL}/${locale}/consultation/${appointmentId}?t=${rawAccessToken}`;
}

export async function triggerAppointmentConfirmationEmail(
  app: FastifyInstance,
  input: { booking: AppointmentBooking; appointments: readonly Pick<Appointment, "id" | "startsAt">[]; rawAccessToken: string }
): Promise<void> {
  const { booking, appointments, rawAccessToken } = input;
  try {
    // En erken randevu (çağıran taraflarda HER ZAMAN `startsAt: "asc"` sıralı, bkz.
    // `confirmBookingPayment`/`resendBookingAccessLink`) — `JoinMeetingButton`'ın `firstAppointment`
    // seçimiyle AYNI kural (§ dosya başı yorum).
    const firstAppointment = appointments[0];
    const locale = patientEmailLocale(booking);

    const [magicLink, joinLink] = await Promise.all([
      buildMagicLink(app, booking.id, rawAccessToken, locale),
      firstAppointment ? buildConsultationJoinLink(app, firstAppointment.id, rawAccessToken, locale) : Promise.resolve(undefined),
    ]);

    const values: Record<string, string> = {
      booking_number: booking.bookingNumber,
      patient_name: booking.patientName,
      status_message: buildConfirmationStatusMessage(booking.totalCents),
      slots_summary: formatSlotsSummary(appointments, booking.patientTimeZone),
      total_formatted: formatMoney(booking.totalCents, booking.currency),
      magic_link: magicLink,
      ...(joinLink ? { join_link: joinLink } : {}),
    };

    try {
      await sendTemplateEmail(app, "APPOINTMENT_CONFIRMATION", booking.patientEmail, values, { locale });
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      // DB'de aktif APPOINTMENT_CONFIRMATION şablonu YOK — yukarıdaki sabit yorum, gerekçe.
      app.log.error(
        { bookingId: booking.id },
        "Aktif APPOINTMENT_CONFIRMATION e-posta şablonu bulunamadı (muhtemelen `npm run seed` bu ortamda çalıştırılmadı) — koda gömülü yedek şablonla gönderiliyor, DB satırı YİNE DE eksik sayılmalı."
      );
      // Paket AC — yedek gövde de kurumsal kabukla (logo, KVKK footer'ı, 112 notu, düz metin).
      await sendBrandedMail(app, {
        to: booking.patientEmail,
        subject: FALLBACK_APPOINTMENT_CONFIRMATION_SUBJECT,
        preheader: FALLBACK_APPOINTMENT_CONFIRMATION_SUBJECT,
        bodyHtml: renderTemplate(FALLBACK_APPOINTMENT_CONFIRMATION_BODY_HTML, values, FALLBACK_APPOINTMENT_CONFIRMATION_KEYS),
        locale,
        // Yedek metin İngilizcedir; gövde yönü ona göre (footer hastanın dilinde).
        bodyLocale: "en",
        audience: "patient",
      });
    }
  } catch (err) {
    app.log.error({ err, bookingId: booking.id }, "Randevu onay e-postası gönderilemedi");
  }
}

/**
 * NOT — 2026-09-15 (backend-agent, "Admin randevu yeniden planlama") — `PATCH
 * /admin/telehealth/appointments/{id}/reschedule` bildirim tetikleyicisi. `triggerAppointmentConfirmationEmail`
 * İLE AYNI best-effort disiplini: TEK try/catch, gönderim başarısız olsa da çağıran akış (reschedule
 * işlemi) ASLA bozulmaz — hata yalnızca loglanır.
 *
 * `lib/email-variables.ts::SYSTEM_VARIABLES_BY_PURPOSE.APPOINTMENT_RESCHEDULED` ile BİREBİR aynı
 * anahtar seti kullanılır: `recipient_name`/`booking_number`/`old_slot_summary`/`new_slot_summary`/
 * `reason`. `sendTemplateEmail` İKİ KEZ çağrılır: bir kez hastaya (booking'e bağlıysa
 * `booking.patientEmail`/`patientName`, deprecated tekil randevu akışında `appointment.patientEmail`/
 * `patientName`), bir kez — YALNIZCA doktorun bağlı bir `User` hesabı VARSA — doktora. Doktorun
 * `User`/e-postası YOKSA (DEMO doktorların çoğu) ikinci gönderim SESSİZCE ATLANIR (hata DEĞİL,
 * `DoctorProfile.userId` OPSİYONELDİR).
 *
 * `bookingNumber` — booking'e bağlı DEĞİLSE (deprecated tekil randevu akışı, `bookingId === null`)
 * `appointment.id`'nin kısa bir özeti ("APT-" + ilk 8 hex) kullanılır (gerçek bir `bookingNumber`
 * hiçbir zaman VAR OLMADI, sıfırdan uydurulmaz).
 */
export async function triggerAppointmentRescheduledEmail(
  app: FastifyInstance,
  input: {
    appointment: Pick<Appointment, "id" | "bookingId" | "doctorId" | "patientName" | "patientEmail">;
    doctorTimeZone: string;
    doctorFullName: string;
    doctorUserId: string | null;
    oldStartsAt: Date;
    newStartsAt: Date;
    /** Paket R — verilirse e-postada aralık (`16:00–16:30`) gösterilir. */
    oldEndsAt?: Date;
    newEndsAt?: Date;
    reason: string | null;
  }
): Promise<void> {
  const { appointment, doctorTimeZone, doctorFullName, doctorUserId, oldStartsAt, newStartsAt, oldEndsAt, newEndsAt, reason } = input;
  try {
    let bookingNumber: string;
    let patientName: string;
    let patientEmail: string;
    let patientTimeZone: string | null = null;
    let patientLocale = PATIENT_EMAIL_FALLBACK_LOCALE;

    if (appointment.bookingId) {
      const booking = await app.prisma.appointmentBooking.findUnique({ where: { id: appointment.bookingId } });
      // Şema zorunluluğu: `Appointment.bookingId` VARSA karşılık gelen `AppointmentBooking` satırı
      // da VAR OLMALIDIR (FK) — bu dal yalnızca savunma amaçlı, beklenmedik bir eşzamanlı silme
      // durumunda appointment'ın KENDİ PII snapshot'ına düşer.
      bookingNumber = booking?.bookingNumber ?? `APT-${appointment.id.slice(0, 8).toUpperCase()}`;
      patientName = booking?.patientName ?? appointment.patientName;
      patientEmail = booking?.patientEmail ?? appointment.patientEmail;
      patientTimeZone = booking?.patientTimeZone ?? null;
      patientLocale = patientEmailLocale(booking);
    } else {
      bookingNumber = `APT-${appointment.id.slice(0, 8).toUpperCase()}`;
      patientName = appointment.patientName;
      patientEmail = appointment.patientEmail;
    }

    const reasonValue = reason ?? "";

    await sendTemplateEmail(
      app,
      "APPOINTMENT_RESCHEDULED",
      patientEmail,
      {
        recipient_name: patientName,
        booking_number: bookingNumber,
        old_slot_summary: formatSlotsSummary([{ startsAt: oldStartsAt, endsAt: oldEndsAt }], patientTimeZone),
        new_slot_summary: formatSlotsSummary([{ startsAt: newStartsAt, endsAt: newEndsAt }], patientTimeZone),
        reason: reasonValue,
      },
      { locale: patientLocale }
    );

    if (doctorUserId) {
      const doctorUser = await app.prisma.user.findUnique({ where: { id: doctorUserId }, select: { email: true } });
      if (doctorUser) {
        await sendTemplateEmail(
          app,
          "APPOINTMENT_RESCHEDULED",
          doctorUser.email,
          {
            recipient_name: doctorFullName,
            booking_number: bookingNumber,
            old_slot_summary: formatDoctorSlots([oldStartsAt], doctorTimeZone, patientTimeZone),
            new_slot_summary: formatDoctorSlots([newStartsAt], doctorTimeZone, patientTimeZone),
            reason: reasonValue,
          },
          { audience: "staff" }
        );
      }
    }
  } catch (err) {
    app.log.error({ err, appointmentId: appointment.id }, "Randevu yeniden planlama e-postası gönderilemedi");
  }
}

/**
 * [ASD] §2.4 (bağlayıcı) — `lib/appointment-reminders.ts` sweeper'ının tetikleyicisi.
 * `triggerAppointmentRescheduledEmail` İLE AYNI best-effort disiplini: TEK try/catch, gönderim
 * başarısız olsa da çağıran akış (sweeper turu) ASLA bozulmaz — hata `app.log.error` ile
 * loglanır. `triggerAppointmentRescheduledEmail`'den FARKLI OLARAK bir `boolean` döner
 * (`true` = gönderim denemesi başarılı, `false` = hata) — sweeper bunu tur başına
 * `{reminded60m, reminded30m, failed}` sayaçları için kullanır (görev talimatı, bağlayıcı).
 *
 * `lib/email-variables.ts::SYSTEM_VARIABLES_BY_PURPOSE.APPOINTMENT_REMINDER_60M/_30M` ile
 * BİREBİR aynı anahtar seti: `recipient_name`/`booking_number`/`doctor_name`/`slot_summary` HER
 * İKİ amaçta da; `join_link` YALNIZCA `kind === "30m"`. Alıcılar
 * `triggerAppointmentRescheduledEmail` İLE AYNI kural: hasta HER ZAMAN, doktor YALNIZCA bağlı bir
 * `User`/e-postası VARSA (yoksa sessizce atlanır, hata DEĞİL).
 *
 * §2.5 (bağlayıcı) — `join_link` token ROTATE ETMEZ, token'sız derin bağlantıdır: hastaya
 * booking'e bağlıysa `/{lang}/patient/bookings/{bookingId}`, booking'siz (deprecated tekil
 * randevu) `/{lang}/patient/appointments`; doktora her zaman `/{lang}/doctor`. Dil segmenti
 * `getLocaleSet(app).default.code` ile çözülür (`buildMagicLink` İLE AYNI kaynak).
 *
 * **Sızma yasağı (§9.7.5 madde 8 + §2.4, bağlayıcı):** uzmanlık adı, şikâyet/intake notu,
 * epikriz, belge adı bu e-postalarda ASLA yer almaz.
 */
export async function triggerAppointmentReminderEmail(
  app: FastifyInstance,
  input: {
    appointment: Pick<Appointment, "id" | "bookingId" | "doctorId" | "patientName" | "patientEmail" | "startsAt"> & { endsAt?: Date };
    doctorTimeZone: string;
    doctorTitle: string;
    doctorFullName: string;
    /** Paket U — hastaya giden e-postada görünen ad (kurucu dışında "H. Sofu"); verilmezse kısaltılır. */
    doctorDisplayName?: string;
    doctorUserId: string | null;
    kind: "60m" | "30m";
  }
): Promise<boolean> {
  const { appointment, doctorTimeZone, doctorTitle, doctorFullName, doctorUserId, kind } = input;
  const patientFacingDoctorName = `${doctorTitle} ${input.doctorDisplayName ?? doctorDisplayName({ fullName: doctorFullName })}`.trim();
  try {
    let bookingNumber: string;
    let patientName: string;
    let patientEmail: string;
    let patientTimeZone: string | null = null;
    let patientLocale = PATIENT_EMAIL_FALLBACK_LOCALE;

    if (appointment.bookingId) {
      const booking = await app.prisma.appointmentBooking.findUnique({ where: { id: appointment.bookingId } });
      // Şema zorunluluğu: `Appointment.bookingId` VARSA karşılık gelen `AppointmentBooking` satırı
      // da VAR OLMALIDIR (FK) — bu dal yalnızca savunma amaçlı, beklenmedik bir eşzamanlı silme
      // durumunda appointment'ın KENDİ PII snapshot'ına düşer.
      bookingNumber = booking?.bookingNumber ?? `APT-${appointment.id.slice(0, 8).toUpperCase()}`;
      patientName = booking?.patientName ?? appointment.patientName;
      patientEmail = booking?.patientEmail ?? appointment.patientEmail;
      patientTimeZone = booking?.patientTimeZone ?? null;
      patientLocale = patientEmailLocale(booking);
    } else {
      bookingNumber = `APT-${appointment.id.slice(0, 8).toUpperCase()}`;
      patientName = appointment.patientName;
      patientEmail = appointment.patientEmail;
    }

    const slotSummary = formatSlotsSummary([{ startsAt: appointment.startsAt, endsAt: appointment.endsAt }], patientTimeZone);
    const doctorSlotSummary = formatDoctorSlots([appointment.startsAt], doctorTimeZone, patientTimeZone);
    const doctorNameFormatted = `${doctorTitle} ${doctorFullName}`.trim();
    const purpose: EmailTemplatePurpose = kind === "60m" ? "APPOINTMENT_REMINDER_60M" : "APPOINTMENT_REMINDER_30M";

    let patientJoinLink: string | undefined;
    let doctorJoinLink: string | undefined;
    if (kind === "30m") {
      const localeSet = await getLocaleSet(app);
      patientJoinLink = appointment.bookingId
        ? `${env.FRONTEND_URL}/${patientLocale}/patient/bookings/${appointment.bookingId}`
        : `${env.FRONTEND_URL}/${patientLocale}/patient/appointments`;
      doctorJoinLink = `${env.FRONTEND_URL}/${localeSet.default.code}/doctor`;
    }

    await sendTemplateEmail(
      app,
      purpose,
      patientEmail,
      {
        recipient_name: patientName,
        booking_number: bookingNumber,
        doctor_name: patientFacingDoctorName,
        slot_summary: slotSummary,
        ...(patientJoinLink ? { join_link: patientJoinLink } : {}),
      },
      { locale: patientLocale }
    );

    if (doctorUserId) {
      const doctorUser = await app.prisma.user.findUnique({ where: { id: doctorUserId }, select: { email: true } });
      if (doctorUser) {
        await sendTemplateEmail(
          app,
          purpose,
          doctorUser.email,
          {
            recipient_name: doctorFullName,
            booking_number: bookingNumber,
            doctor_name: doctorNameFormatted,
            slot_summary: doctorSlotSummary,
            ...(doctorJoinLink ? { join_link: doctorJoinLink } : {}),
          },
          { audience: "staff" }
        );
      }
    }

    return true;
  } catch (err) {
    app.log.error({ err, appointmentId: appointment.id, kind }, "Randevu hatırlatma e-postası gönderilemedi");
    return false;
  }
}

/**
 * `POST /appointments/bookings/{bookingId}/resend-link` (§9.7.10, notification-agent sahası) —
 * openapi.yaml (BAĞLAYICI kontrat) burada AÇIKÇA "yeni bir accessToken üretir" der: her çağrı
 * `accessTokenHash`'i ROTATE eder (eski bağlantı bu andan itibaren ÇALIŞMAZ) ve YALNIZCA kayıtlı
 * `patientEmail`'e gönderir — ham token YANITTA ASLA dönmez (route bu fonksiyonun dönüş değerini
 * kullanmaz, `void`).
 *
 * 2026-09-18 KRİTİK DÜZELTME (kullanıcı talebi) — booking `PAID` DEĞİLKEN bu fonksiyon KESİNLİKLE
 * hiçbir e-posta göndermez: ödeme tamamlanmadan/randevu kesinleşmeden hiçbir bildirim gitmemelidir
 * (gereksiz e-posta trafiği + kafa karıştırıcı UX). Bu turdan önce kısa bir süre bu davranış
 * "ödeme tamamlama linki" gönderecek şekilde genişletilmişti (bkz. git geçmişi) — kullanıcı
 * BİLİNÇLİ olarak bunu GERİ ALDI, tekrar EKLENMEMELİDİR. Varlık sızdırılmaz: booking yoksa VEYA
 * henüz `PAID` değilse SESSİZCE hiçbir şey yapmadan döner; çağıran route HER durumda `202` döner.
 * Rate limit (1 istek/dk, `BOOKING_RESEND_LINK_RATE_LIMIT`) route katmanındadır.
 */
export async function resendBookingAccessLink(app: FastifyInstance, bookingId: string): Promise<void> {
  const existing = await app.prisma.appointmentBooking.findUnique({ where: { id: bookingId } });
  if (!existing || existing.paymentStatus !== "PAID") return;

  const rawAccessToken = generateOpaqueToken();
  const accessTokenHash = hashToken(rawAccessToken);

  const booking = await app.prisma.appointmentBooking.update({
    where: { id: existing.id },
    data: { accessTokenHash },
  });

  const appointments = await app.prisma.appointment.findMany({
    where: { bookingId: booking.id },
    orderBy: { startsAt: "asc" },
    select: { id: true, startsAt: true },
  });

  await triggerAppointmentConfirmationEmail(app, { booking, appointments, rawAccessToken });
}
