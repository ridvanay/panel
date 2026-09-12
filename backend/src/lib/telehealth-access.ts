import { hashToken } from "./tokens";
import { timingSafeEqualHex } from "./api-key";
import { NotFoundError } from "./errors";

/**
 * `.claude/architect-scope-telehealth-template.md` §9.7.5 madde 7 (öneri 3, compliance-agent) —
 * booking/sağlık verisi yetki kümesi `ROLES_PANEL`/`ROLES_ADMIN_MANAGER`'DAN KASITLI OLARAK
 * KOPYALANMAZ (bunlar saf rol tabanlıdır; burası rol+İLİŞKİ karışımıdır — `doctor.userId`,
 * `patientUserId`, magic-link token). `telehealth.routes.ts::assertAppointmentAccess`
 * (tekil randevu, §8 madde 4) İLE AYNI IDOR disiplini: yetkisiz erişim HER ZAMAN `404`
 * (varlık sızdırılmaz), `403` DEĞİL.
 */

export interface BookingAccessSubject {
  patientUserId: string | null;
  accessTokenHash: string;
  doctor: { userId?: string | null };
  /**
   * TTL hesaplaması için gerekli minimum alan. security-agent kararı ([TCT] §9.7.7 madde 4 —
   * "geçerlilik: son `endsAt` + 30 gün", nihai süre security-agent'a bırakılmıştı): misafir
   * magic-link (`?t=`) erişimi süresizdir OLAMAZ — booking satırı (ve dolayısıyla
   * `accessTokenHash`) hiçbir süpürücü tarafından silinmediği için, TTL uygulanmazsa token
   * sonsuza kadar sağlık verisine erişim sağlardı. Oturumlu erişim (Bearer) bu TTL'e TABİ
   * DEĞİLDİR — yalnızca ham token yolunu sınırlar.
   */
  appointments: readonly { endsAt: Date }[];
}

export interface BookingAccessRequest {
  user?: { id: string; role: string } | undefined;
  providedToken?: string;
}

/** [TCT] §9.7.7 madde 4 (bağlayıcı, security-agent nihai kararı) — magic-link geçerlilik süresi. */
export const MAGIC_LINK_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Randevu satırı YOKSA (ör. hiç ödenmeden süresi dolmuş, `booking-expiry.ts` tarafından
 * hard-delete edilmiş booking) "son `endsAt`" TANIMSIZDIR — bu durumda TTL PENCERESİ henüz
 * BAŞLAMAMIŞ kabul edilir (erişim reddedilmez; booking zaten `EXPIRED` durumu ve kendi iş
 * kuralları — ör. `paymentStatus !== PENDING` — ile ayrıca korunur). Randevu VARSA, son
 * `endsAt`'ten `MAGIC_LINK_TOKEN_TTL_MS` sonrası kesin sınırdır.
 */
function isMagicLinkTokenExpired(booking: BookingAccessSubject): boolean {
  if (booking.appointments.length === 0) return false;
  const maxEndsAtMs = Math.max(...booking.appointments.map((a) => a.endsAt.getTime()));
  return Date.now() > maxEndsAtMs + MAGIC_LINK_TOKEN_TTL_MS;
}

function isRequestingPatient(booking: BookingAccessSubject, request: BookingAccessRequest): boolean {
  if (request.user && booking.patientUserId && booking.patientUserId === request.user.id) return true;
  if (
    request.providedToken &&
    timingSafeEqualHex(hashToken(request.providedToken), booking.accessTokenHash) &&
    !isMagicLinkTokenExpired(booking)
  ) {
    return true;
  }
  return false;
}

function isRequestingDoctor(booking: BookingAccessSubject, request: BookingAccessRequest): boolean {
  return Boolean(request.user && booking.doctor.userId && booking.doctor.userId === request.user.id);
}

/**
 * `GET /appointments/bookings/{bookingId}` erişimi (§9.7.10) — (a) doğru `?t=`/oturum sahibi
 * hasta, (b) booking'in doktoru, (c) `ADMIN`/`MANAGER`. Bu, §9.7.5'in DAHA DAR sağlık verisi
 * eşiğiyle KARIŞTIRILMAMALIDIR (`assertBookingHealthDataAccess` — MANAGER'ı HARİÇ TUTAR).
 */
export function assertBookingViewAccess(booking: BookingAccessSubject, request: BookingAccessRequest): void {
  if (request.user && (request.user.role === "ADMIN" || request.user.role === "MANAGER")) return;
  if (isRequestingDoctor(booking, request)) return;
  if (isRequestingPatient(booking, request)) return;
  throw new NotFoundError("Rezervasyon bulunamadı.");
}

/**
 * §9.7.5 madde 7 (ENGELLEYİCİ) — intake notu/belge İÇERİĞİ: (a) hasta, (b) YALNIZCA bu
 * booking'in doktoru, (c) `ADMIN` (destek). `MANAGER` İÇERİĞE ERİŞEMEZ, `EDITOR` hiç erişemez
 * (zaten `request.user` bu iki role ile buraya hiç ulaşmaz — bu fonksiyon yalnızca izin
 * VERMEZ, ayrıca engellemez).
 */
export function assertBookingHealthDataAccess(booking: BookingAccessSubject, request: BookingAccessRequest): void {
  if (request.user && request.user.role === "ADMIN") return;
  if (isRequestingDoctor(booking, request)) return;
  if (isRequestingPatient(booking, request)) return;
  throw new NotFoundError("Rezervasyon bulunamadı.");
}

/**
 * KVKK md.11 silme hakkı uçları (`DELETE .../intake`, `DELETE .../documents/{id}`) ve
 * `GET .../invoice`, `POST .../cancel` — yalnızca hasta (oturum/`?t=`) veya `ADMIN`. Doktor
 * DAHİL DEĞİLDİR (doktor bir hastanın verisini SİLEMEZ, §9.7.10).
 */
export function assertBookingPatientOrAdminAccess(booking: BookingAccessSubject, request: BookingAccessRequest): void {
  if (request.user && request.user.role === "ADMIN") return;
  if (isRequestingPatient(booking, request)) return;
  throw new NotFoundError("Rezervasyon bulunamadı.");
}

/**
 * `POST .../documents` (belge yükleme) ve `PUT .../intake` (not yazma) — YALNIZCA hasta
 * (oturum/`?t=`). Kendi sağlık verisini yalnızca kendisi ekler; doktor/ADMIN bir hasta adına
 * not/belge OLUŞTURAMAZ (yalnızca OKUYABİLİR/silebilir — bkz. yukarıdaki iki fonksiyon).
 */
export function assertBookingPatientOnlyAccess(booking: BookingAccessSubject, request: BookingAccessRequest): void {
  if (isRequestingPatient(booking, request)) return;
  throw new NotFoundError("Rezervasyon bulunamadı.");
}
