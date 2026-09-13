/**
 * qa-agent — "Global TeleHealth & Clinic" (`telehealth` modülü + `telehealth-clinic` demo şablonu)
 * E2E fixture yardımcıları. Kaynak kontrat: `.claude/architect-scope-telehealth-template.md`
 * (bağlayıcı) + `docs/architecture/openapi.yaml` `TeleHealth` tag'i. `support/api.ts` /
 * `support/demo-templates-fixtures.ts` İLE AYNI desen: gerçek backend'e (`saas_e2e`) doğrudan
 * `fetch` ile konuşur, UI akışından BAĞIMSIZ kurulum/doğrulama sağlar.
 *
 * Bilinçli tasarım kararı (kod yorumuna değer, bkz. final qa-agent raporu) — bu dosya
 * `ecommerce-pro-fixtures.ts`'teki `purgeKnownEcommerceProContent` benzeri bir "bilinen içeriği
 * SİL" fonksiyonu KASITLI OLARAK içermez: `DoctorProfile`/`Specialty` silme uçları var olsa da,
 * `Appointment.doctor` `onDelete: Restrict` olduğundan (schema.prisma) bir doktorun GERÇEK bir
 * randevusu varsa (bu suite'in rezervasyon testleri tam olarak bunu üretir) silme isteği `409`
 * ile başarısız olur. İdempotency işareti (`demo_template_imports` satırı,
 * `resetDemoTemplateImportRow` ile sıfırlanır, bkz. `demo-templates-fixtures.ts`) SIFIRLANDIĞI
 * sürece `importer.ts::resolveSlugPlan` her koşumda çakışan slug'ları `-2`/`-3` ile OTOMATİK
 * benzersizleştirir (mevcut, kanıtlanmış davranış — `ecommerce-pro-template-import.spec.ts`
 * "SKU-benzersizleştirme" testi) — yani leftover doktor/uzmanlık satırları sonraki koşumları
 * BOZMAZ. Testler bu yüzden "sil ve yeniden oluştur" yerine "önce/sonra KÜME FARKI al" desenini
 * kullanır (`admin-rbac-5tier-critical-flows.spec.ts::ordersBefore/ordersAfter` İLE AYNI ilke) —
 * bu hem FK kısıtına çarpmaz hem de paralel/tekrarlanan koşumlara karşı sağlamdır. `User` tablosu
 * için AYNI "paylaşımlı DB'de kalıcı biriken fixture satırı" felsefesi zaten
 * `admin-users-fixtures.ts` başlığında belgelenmiştir.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import crypto from "node:crypto";
import { tmpdir } from "node:os";
import { writeFileSync, unlinkSync } from "node:fs";
import { API_BASE_URL, getSiteModules, patchSiteModule } from "./api";
import { importDemoTemplateRaw } from "./demo-templates-fixtures";

export const TELEHEALTH_TEMPLATE_KEY = "telehealth-clinic";

/** `templates/telehealth-clinic.ts::SPECIALTIES/DOCTORS` — BİREBİR (bağlayıcı). */
export const EXPECTED_TELEHEALTH_COUNTS = { specialties: 6, doctors: 4, availabilityWindows: 20 };
export const KNOWN_SPECIALTY_NAMES = ["Kardiyoloji", "Dermatoloji", "Nöroloji", "Psikiyatri", "Aile Hekimliği", "Çocuk Sağlığı"];
export const KNOWN_DOCTOR_FULL_NAMES = ["Elif Aydemir", "James Whitfield", "Laura Bennett", "Felix Braun"];

function authHeadersNoBody(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function safeJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export interface FixtureSpecialty {
  id: string;
  slug: string;
  name: string;
}

export interface FixtureDoctor {
  id: string;
  slug: string;
  fullName: string;
  title: string;
  userId: string | null;
  timeZone: string;
  sessionDurationMin: number;
  specialty: { slug: string; name: string } | null;
  /** Görev tanımı — currency/avatar doğrulaması (bu turda eklendi). API zaten `DoctorProfile`'ın
   * TAMAMINI döner; bu alanlar önceden bu dar arayüze YANSITILMAMIŞTI. */
  sessionPriceCents?: number;
  currency?: string;
  avatarMediaId?: string | null;
  isVerified?: boolean;
}

/** `GET /admin/telehealth/specialties` — panel kapısı (ADMIN/MANAGER/EDITOR), sayfalanmaz (küçük liste). */
export async function listAllAdminSpecialties(token: string): Promise<FixtureSpecialty[]> {
  const res = await fetch(`${API_BASE_URL}/admin/telehealth/specialties`, { headers: authHeadersNoBody(token) });
  const body = (await safeJson(res)) as { data?: FixtureSpecialty[] };
  return body.data ?? [];
}

/** `GET /admin/telehealth/doctors` — cursor sayfalı, `admin-users-fixtures.ts::adminGetUserByEmail` İLE AYNI tam-tarama deseni. */
export async function listAllAdminDoctors(token: string): Promise<FixtureDoctor[]> {
  const out: FixtureDoctor[] = [];
  let cursor: string | undefined;
  while (true) {
    const url = new URL(`${API_BASE_URL}/admin/telehealth/doctors`);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: authHeadersNoBody(token) });
    const body = (await safeJson(res)) as { data?: FixtureDoctor[]; meta?: { nextCursor?: string | null } };
    out.push(...(body.data ?? []));
    if (!body.meta?.nextCursor) break;
    cursor = body.meta.nextCursor;
  }
  return out;
}

/**
 * `telehealth-public-booking.spec.ts`/`telehealth-consultation.spec.ts`/`telehealth-rbac.spec.ts`'in
 * PAYLAŞTIĞI kurulum — `telehealth` modülünün AÇIK olduğunu VE en az bir doktorun var olduğunu
 * garanti eder. Bu dosyalar `telehealth-template-import.spec.ts`'ten TAMAMEN BAĞIMSIZ (herhangi bir
 * sırada/tek başına) koşabilmelidir (qa-agent görev talimatı, `playwright.config.ts` — dosyalar
 * arası çalıştırma sırası garantisi yoktur), bu yüzden mock DEĞİL GERÇEK importer'ı kullanır ([DTI]
 * "mock yok" kısıtı).
 *
 * İdempotent: `demo_template_imports` işareti bu anahtar için DAHA ÖNCE set edilmişse (başka bir
 * dosya/koşum tarafından) ikinci bir `force:false` çağrısı `409` döner — bu durumda YENİ veri
 * ÜRETİLMEZ, yalnızca modül `PATCH /admin/modules/telehealth` ile açılır (idempotency işareti
 * `resetDemoTemplateImportRow` ile sıfırlanmadığı sürece kalıcıdır, bkz. dosya başlığı).
 */
export async function ensureTelehealthModuleWithDoctors(adminToken: string): Promise<void> {
  const modules = await getSiteModules(adminToken);
  const alreadyEnabled = modules.find((m) => m.key === "telehealth")?.enabled ?? false;
  if (!alreadyEnabled) {
    const res = await importDemoTemplateRaw(adminToken, TELEHEALTH_TEMPLATE_KEY, {
      confirm: true,
      force: false,
      enableRequiredModules: true,
    });
    if (res.status === 409) {
      // Şablon başka bir dosya/koşumda ZATEN uygulanmış — yalnızca modülü aç, yeni veri ÜRETME.
      await patchSiteModule(adminToken, "telehealth", true);
    } else if (res.status !== 201) {
      throw new Error(`telehealth-clinic şablonu hazırlanamadı: ${res.status} ${JSON.stringify(res.error)}`);
    }
  }

  const doctors = await listAllAdminDoctors(adminToken);
  if (doctors.length === 0) {
    // Beklenmeyen durum (modül açık ama doktor yok) — `force:true` ile yeniden dener.
    const res = await importDemoTemplateRaw(adminToken, TELEHEALTH_TEMPLATE_KEY, {
      confirm: true,
      force: true,
      enableRequiredModules: true,
    });
    if (res.status !== 201) {
      throw new Error(`telehealth-clinic şablonu (force) hazırlanamadı: ${res.status} ${JSON.stringify(res.error)}`);
    }
  }
}

export interface RawApiResult<T> {
  status: number;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

/** `GET /admin/telehealth/appointments` — RBAC ADMIN+MANAGER (§8.4). */
export async function listAdminAppointmentsRaw(
  token: string,
  params: { doctorId?: string; limit?: number } = {}
): Promise<RawApiResult<Record<string, unknown>[]>> {
  const url = new URL(`${API_BASE_URL}/admin/telehealth/appointments`);
  url.searchParams.set("limit", String(params.limit ?? 100));
  if (params.doctorId) url.searchParams.set("doctorId", params.doctorId);
  const res = await fetch(url, { headers: authHeadersNoBody(token) });
  const body = await safeJson(res);
  return { status: res.status, data: body.data as Record<string, unknown>[] | undefined, error: body.error as RawApiResult<unknown>["error"] };
}

/** `GET /doctors` — PUBLIC, kimlik doğrulama YOK. Modül kapalıyken `404` döner (§8.6). */
export async function getPublicDoctorsRaw(
  params: { specialtySlug?: string; language?: string; search?: string } = {}
): Promise<RawApiResult<FixtureDoctor[]>> {
  const url = new URL(`${API_BASE_URL}/doctors`);
  url.searchParams.set("limit", "100");
  if (params.specialtySlug) url.searchParams.set("specialtySlug", params.specialtySlug);
  if (params.language) url.searchParams.set("language", params.language);
  if (params.search) url.searchParams.set("search", params.search);
  const res = await fetch(url);
  const body = await safeJson(res);
  return { status: res.status, data: body.data as FixtureDoctor[] | undefined, error: body.error as RawApiResult<unknown>["error"] };
}

export interface FixtureAvailabilitySlot {
  startsAt: string;
  endsAt: string;
  available: boolean;
}

/** `GET /doctors/{slug}/slots?from=&to=` — PUBLIC. `from`/`to` YYYY-MM-DD (§4.2, en fazla 31 gün). */
export async function getPublicDoctorSlotsRaw(slug: string, from: string, to: string): Promise<RawApiResult<FixtureAvailabilitySlot[]>> {
  const res = await fetch(`${API_BASE_URL}/doctors/${encodeURIComponent(slug)}/slots?from=${from}&to=${to}`);
  const body = await safeJson(res);
  return { status: res.status, data: body.data as FixtureAvailabilitySlot[] | undefined, error: body.error as RawApiResult<unknown>["error"] };
}

/** `doctors/[slug]/page.tsx::defaultSlotRange()` İLE AYNI pencere (bugünden +N gün). */
export function defaultSlotRangeISODates(daysAhead = 30): { from: string; to: string } {
  const from = new Date();
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + daysAhead);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export interface CreateDoctorFixtureInput {
  title: string;
  fullName: string;
  slug?: string;
  bio: string;
  languages: string[];
  timeZone: string;
  sessionDurationMin: number;
  sessionPriceCents: number;
  currency?: string;
  avatarMediaId?: string | null;
  isVerified?: boolean;
  isActive?: boolean;
}

export interface CreatedFixtureDoctor extends FixtureDoctor {
  currency: string;
  sessionPriceCents: number;
  avatarMediaId: string | null;
}

/**
 * `POST /admin/telehealth/doctors` — görev tanımı doğrulaması (admin doktor listesi/detay
 * sayfasının para birimi/süre/saat dilimi/avatar-yoksa-monogram davranışı GERÇEK, doktor bazında
 * BAĞIMSIZ alanlardır, sabit/hardcode DEĞİL) için `telehealth-clinic` demo şablonundan BAĞIMSIZ,
 * bilinçli olarak FARKLI `sessionDurationMin`/`currency` değerleriyle kurulan bir fixture doktor
 * oluşturur. Demo şablonun 4 doktorunun HEPSİ `sessionDurationMin: 30` taşıdığı için (bkz.
 * `telehealth-clinic.ts` DOCTORS dizisi — yalnızca `currency`/`timeZone` doktor bazında değişir),
 * "süre doktor doktor GERÇEKTEN farklılaşıyor" iddiası yalnızca demo verisiyle KANITLANAMAZ.
 * `avatarMediaId` verilmezse `null` kalır — public detay sayfasında monogram fallback'i GERÇEK
 * (mock DEĞİL) bir doktor üzerinden tetiklemek için kullanılır.
 */
export async function createAdminDoctorFixture(token: string, input: CreateDoctorFixtureInput): Promise<CreatedFixtureDoctor> {
  const res = await fetch(`${API_BASE_URL}/admin/telehealth/doctors`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...input, languages: input.languages }),
  });
  const body = (await safeJson(res)) as { data?: CreatedFixtureDoctor; error?: { code: string; message: string } };
  if (res.status !== 201 || !body.data) {
    throw new Error(`Fixture doktor oluşturulamadı: ${res.status} ${JSON.stringify(body.error)}`);
  }
  return body.data;
}

/** `DELETE /admin/telehealth/doctors/{doctorId}` — kalıcı silme. Bu fixture'ların hiçbir GERÇEK
 * randevusu olmadığından (`Appointment.doctor` `onDelete: Restrict`) her zaman başarılı olmalıdır;
 * yine de `blog-fixtures.ts` başlığındaki bulgu gereği durum kodu SESSİZCE YUTULMAZ. */
export async function deleteAdminDoctorFixture(token: string, doctorId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/admin/telehealth/doctors/${doctorId}`, {
    method: "DELETE",
    headers: authHeadersNoBody(token),
  });
  if (res.status !== 204 && res.status !== 200 && res.status !== 404) {
    throw new Error(`Fixture doktor silinemedi: ${res.status}`);
  }
}

/**
 * `PUT /admin/telehealth/doctors/{id}/availability` — haftalık ızgaranın TAMAMINI değiştirir
 * (bkz. `telehealth.schemas.ts::SetDoctorAvailabilityRequestSchema`). qa-agent kullanımı
 * (bu turda eklendi) — `createAdminDoctorFixture` BAŞLI BAŞINA hiçbir `DoctorAvailability`
 * satırı üretmez (yalnızca `telehealth-clinic` demo şablonunun 4 doktoru üretir); saat
 * grid'inin gruplama/aynı-görsel-dil/onay şeridi davranışını demo şablondan BAĞIMSIZ, kendi
 * kontrollü bir pencereyle doğrulamak için kullanılır.
 */
export async function setDoctorAvailabilityRaw(
  token: string,
  doctorId: string,
  rules: { dayOfWeek: 1 | 2 | 3 | 4 | 5 | 6 | 7; startMinute: number; endMinute: number }[]
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/admin/telehealth/doctors/${doctorId}/availability`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ rules }),
  });
  if (res.status !== 200) {
    const body = await safeJson(res);
    throw new Error(`Fixture doktor müsaitliği ayarlanamadı: ${res.status} ${JSON.stringify(body)}`);
  }
}

export interface CreatedAppointment {
  id: string;
  doctorSlug: string;
  startsAt: string;
  endsAt: string;
  status: string;
  priceCents: number;
  currency: string;
  accessToken: string;
}

/** `POST /appointments` — PUBLIC, kimlik doğrulaması GEREKTİRMEZ (§4.3), hız sınırı 5/dk. */
export async function createAppointmentRaw(input: {
  doctorSlug: string;
  startsAt: string;
  patientName: string;
  patientEmail: string;
  consent?: boolean;
}): Promise<RawApiResult<CreatedAppointment>> {
  const res = await fetch(`${API_BASE_URL}/appointments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, consent: input.consent ?? true }),
  });
  const body = await safeJson(res);
  return { status: res.status, data: body.data as CreatedAppointment | undefined, error: body.error as RawApiResult<unknown>["error"] };
}

/** `GET /appointments/{id}?t=` — §8 madde 4 yetkilendirme (misafir: doğru token ZORUNLU). */
export async function getAppointmentRaw(id: string, token?: string): Promise<RawApiResult<Record<string, unknown>>> {
  const url = new URL(`${API_BASE_URL}/appointments/${id}`);
  if (token) url.searchParams.set("t", token);
  const res = await fetch(url);
  const body = await safeJson(res);
  return { status: res.status, data: body.data as Record<string, unknown> | undefined, error: body.error as RawApiResult<unknown>["error"] };
}

/** `POST /appointments/{id}/meeting-token?t=` — integration-agent'ın sahası (§4.4/§4.5/§8). */
export async function requestMeetingTokenRaw(id: string, token?: string): Promise<RawApiResult<Record<string, unknown>>> {
  const url = new URL(`${API_BASE_URL}/appointments/${id}/meeting-token`);
  if (token) url.searchParams.set("t", token);
  const res = await fetch(url, { method: "POST" });
  const body = await safeJson(res);
  return { status: res.status, data: body.data as Record<string, unknown> | undefined, error: body.error as RawApiResult<unknown>["error"] };
}

// ---------------------------------------------------------------------------
// qa-agent — `.claude/architect-scope-telehealth-template.md` §9.7.11 "QA kapsamı — §10'a EK"
// (bağlayıcı, madde 21-28). Çoklu-slot booking/ödeme/sağlık-verisi/portal fixture yardımcıları —
// yukarıdaki tekil-randevu (`POST /appointments`, DEPRECATED) yardımcılarından AYRI, `POST
// /appointments/bookings` (çoklu slot) akışı içindir.
// ---------------------------------------------------------------------------

export interface CreatedBookingAppointment {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
}

export interface CreatedBooking {
  bookingId: string;
  bookingNumber: string;
  doctorSlug: string;
  slotCount: number;
  unitPriceCents: number;
  subtotalCents: number;
  totalCents: number;
  currency: string;
  paymentStatus: string;
  expiresAt: string;
  appointments: CreatedBookingAppointment[];
  accessToken: string;
  paymentsConfigured: boolean;
  checkoutUrl: string | null;
}

/** `POST /appointments/bookings` — PUBLIC (opsiyonel Bearer), hız sınırı 5/dk, 1..4 slot. `totalCents`
 * İSTEMCİDEN gönderilmez/gönderilse de sunucu YOK SAYAR (§9.7.11 madde 14 — backend'in kendi
 * `tests/integration/telehealth-bookings.test.ts`'inde ZATEN doğrulanır); bu fixture yalnızca
 * kontrata uygun alanları gönderir. */
export async function createBookingRaw(
  input: { doctorSlug: string; slots: string[]; patientName: string; patientEmail: string; consent?: boolean; consentVersion?: string },
  bearerToken?: string
): Promise<RawApiResult<CreatedBooking>> {
  const res = await fetch(`${API_BASE_URL}/appointments/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}) },
    body: JSON.stringify({
      doctorSlug: input.doctorSlug,
      slots: input.slots,
      patientName: input.patientName,
      patientEmail: input.patientEmail,
      consent: input.consent ?? true,
      ...(input.consentVersion ? { consentVersion: input.consentVersion } : {}),
    }),
  });
  const body = await safeJson(res);
  return { status: res.status, data: body.data as CreatedBooking | undefined, error: body.error as RawApiResult<unknown>["error"] };
}

export interface FixtureBookingDetail {
  id: string;
  bookingNumber: string;
  paymentStatus: string;
  slotCount: number;
  totalCents: number;
  currency: string;
  joinableFrom: string | null;
  joinableUntil: string | null;
  hasIntakeNote: boolean;
  documentCount: number;
  appointments: CreatedBookingAppointment[];
}

/** `GET /appointments/bookings/{id}?t=` — misafir magic-link VEYA oturum (Bearer); ikisi BİRDEN verilmez normalde ama ikisi de opsiyonel parametredir. */
export async function getBookingRaw(
  bookingId: string,
  opts: { magicLinkToken?: string; bearerToken?: string } = {}
): Promise<RawApiResult<FixtureBookingDetail>> {
  const url = new URL(`${API_BASE_URL}/appointments/bookings/${bookingId}`);
  if (opts.magicLinkToken) url.searchParams.set("t", opts.magicLinkToken);
  const res = await fetch(url, { headers: opts.bearerToken ? { Authorization: `Bearer ${opts.bearerToken}` } : {} });
  const body = await safeJson(res);
  return { status: res.status, data: body.data as FixtureBookingDetail | undefined, error: body.error as RawApiResult<unknown>["error"] };
}

/** `PUT /appointments/bookings/{id}/intake` — §9.7.5 KARAR J, `healthDataConsent: true` ZORUNLU. */
export async function upsertBookingIntakeRaw(
  bookingId: string,
  body: { note?: string | null; healthDataConsent: boolean; consentVersion?: string },
  opts: { magicLinkToken?: string; bearerToken?: string } = {}
): Promise<RawApiResult<Record<string, unknown>>> {
  const url = new URL(`${API_BASE_URL}/appointments/bookings/${bookingId}/intake`);
  if (opts.magicLinkToken) url.searchParams.set("t", opts.magicLinkToken);
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(opts.bearerToken ? { Authorization: `Bearer ${opts.bearerToken}` } : {}) },
    body: JSON.stringify(body),
  });
  const responseBody = await safeJson(res);
  return { status: res.status, data: responseBody.data as Record<string, unknown> | undefined, error: responseBody.error as RawApiResult<unknown>["error"] };
}

export interface FixtureAppointmentDocument {
  id: string;
  bookingId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

/** `POST /appointments/bookings/{id}/documents` — multipart, istek başına 1 dosya. `uploadTestMedia()`
 * (`support/api.ts`) İLE AYNI `fetch` + `FormData`/`Blob` deseni (yeni bir HTTP paketi EKLENMEZ). */
export async function uploadBookingDocumentRaw(
  bookingId: string,
  file: { filename: string; mimeType: string; bytes: Buffer },
  opts: { magicLinkToken?: string; bearerToken?: string } = {}
): Promise<RawApiResult<FixtureAppointmentDocument>> {
  const url = new URL(`${API_BASE_URL}/appointments/bookings/${bookingId}/documents`);
  if (opts.magicLinkToken) url.searchParams.set("t", opts.magicLinkToken);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), file.filename);
  const res = await fetch(url, {
    method: "POST",
    headers: opts.bearerToken ? { Authorization: `Bearer ${opts.bearerToken}` } : {},
    body: form,
  });
  const body = await safeJson(res);
  return { status: res.status, data: body.data as FixtureAppointmentDocument | undefined, error: body.error as RawApiResult<unknown>["error"] };
}

export async function listBookingDocumentsRaw(
  bookingId: string,
  opts: { magicLinkToken?: string; bearerToken?: string } = {}
): Promise<RawApiResult<FixtureAppointmentDocument[]>> {
  const url = new URL(`${API_BASE_URL}/appointments/bookings/${bookingId}/documents`);
  if (opts.magicLinkToken) url.searchParams.set("t", opts.magicLinkToken);
  const res = await fetch(url, { headers: opts.bearerToken ? { Authorization: `Bearer ${opts.bearerToken}` } : {} });
  const body = await safeJson(res);
  return { status: res.status, data: body.data as FixtureAppointmentDocument[] | undefined, error: body.error as RawApiResult<unknown>["error"] };
}

/** `GET /appointments/documents/{documentId}/content` — §9.7.11 madde 25/26. Yalnızca `status`u
 * döner (içerik/blob testin ihtiyacı DEĞİL — yetki matrisi/sızıntı testleri sadece durum kodunu sorar). */
export async function getDocumentContentStatusRaw(
  documentId: string,
  opts: { magicLinkToken?: string; bearerToken?: string } = {}
): Promise<number> {
  const url = new URL(`${API_BASE_URL}/appointments/documents/${documentId}/content`);
  if (opts.magicLinkToken) url.searchParams.set("t", opts.magicLinkToken);
  const res = await fetch(url, { headers: opts.bearerToken ? { Authorization: `Bearer ${opts.bearerToken}` } : {} });
  return res.status;
}

/** `PATCH /admin/telehealth/doctors/{id}` `{ userId }` — bir `User`'ı doktor hesabına bağlar
 * (§9.7.7 KARAR K). `telehealth-livekit.test.ts`'in backend'deki AYNI deseni. */
export async function linkDoctorUserRaw(adminToken: string, doctorId: string, userId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/admin/telehealth/doctors/${doctorId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ userId }),
  });
  if (res.status !== 200) {
    const body = await safeJson(res);
    throw new Error(`Doktor hesabı bağlanamadı: ${res.status} ${JSON.stringify(body)}`);
  }
}

// ---------------------------------------------------------------------------
// `demo-templates-fixtures.ts::resetDemoTemplateImportRow`/`setRawPageBlocksDirectly` İLE AYNI
// `prisma db execute --stdin` deseni — burada YALNIZCA §4.5 katılım penceresi UI testi
// (`telehealth-consultation-access.spec.ts`) için, GERÇEKTEN rezervasyon akışından (§4.3, saf
// randevu-tamponu kuralı en az 2 saat ileri bir slot zorunlu kılar) geçerek oluşturulmuş bir
// randevunun zamanını "şimdi katılınabilir" pencereye KAYDIRMAK için kullanılır — randevunun
// KENDİSİ sahte DEĞİLDİR, yalnızca zamanlaması test edilebilir kılınır (§4.5 katılım penceresi
// mantığı `startsAt`/`endsAt` sütunlarına bakar, bu sütunların DIŞINDA hiçbir alana dokunulmaz).
// ---------------------------------------------------------------------------
const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/saas_e2e?schema=public";
const BACKEND_DIR = path.resolve(process.cwd(), "..", "backend");

export function shiftAppointmentIntoJoinWindowDirectly(appointmentId: string, startInSeconds = 60, durationMinutes = 30): void {
  const esc = (value: string) => value.replace(/'/g, "''");
  const sql = `UPDATE "appointments" SET "startsAt" = now() + interval '${startInSeconds} seconds', "endsAt" = now() + interval '${startInSeconds} seconds' + interval '${durationMinutes} minutes' WHERE id = '${esc(appointmentId)}';`;
  execFileSync("npx", ["prisma", "db", "execute", "--stdin", `--url=${E2E_DATABASE_URL}`], {
    cwd: BACKEND_DIR,
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
}

// ---------------------------------------------------------------------------
// qa-agent — §9.7.11 madde 25/27 için EK DB yardımcıları (yukarıdaki `E2E_DATABASE_URL`/
// `BACKEND_DIR` PAYLAŞILIR). `prisma db execute` SELECT sonucu DÖNDÜRMEZ (yalnızca DDL/DML için
// tasarlanmıştır — elle doğrulandı, `Script executed successfully.` dışında çıktı YOKTUR); bu
// yüzden OKUMA gereken tek fixture (`getAppointmentDocumentStoragePathDirectly`, madde 25 sızıntı
// testi için GERÇEK `storagePath` gerekir — API yanıtı bunu ASLA döndürmez, bkz.
// `mappers/index.ts::toAppointmentDocumentDto`) backend'in KENDİ `node_modules/@prisma/client`'ını
// (mutlak yolla, `require()`) kullanan geçici, bağımsız bir CommonJS betiğiyle yapılır —
// `backend/src` veya `backend/scripts` İÇİNE HİÇBİR ŞEY YAZILMAZ (ajan sınır ihlali OLMASIN diye,
// bkz. proje kökü CLAUDE.md), betik `os.tmpdir()`'a yazılıp işlem sonunda silinir.
// ---------------------------------------------------------------------------
const PRISMA_CLIENT_ABS_PATH = path.join(BACKEND_DIR, "node_modules", "@prisma", "client");

function runReadOnlyPrismaScript<T>(body: string, args: string[]): T {
  const scriptPath = path.join(tmpdir(), `qa-e2e-prisma-read-${crypto.randomUUID()}.cjs`);
  const script = `
const { PrismaClient } = require(${JSON.stringify(PRISMA_CLIENT_ABS_PATH)});
const prisma = new PrismaClient({ datasources: { db: { url: ${JSON.stringify(E2E_DATABASE_URL)} } } });
(async () => {
  ${body}
  await prisma.$disconnect();
})().catch(async (err) => { await prisma.$disconnect(); process.stderr.write(String(err && err.stack || err)); process.exit(1); });
`;
  writeFileSync(scriptPath, script, "utf-8");
  try {
    const stdout = execFileSync("node", [scriptPath, ...args], { encoding: "utf-8" });
    return JSON.parse(stdout) as T;
  } finally {
    unlinkSync(scriptPath);
  }
}

/** §9.7.11 madde 25 (ENGELLEYİCİ sızıntı testi) — yüklenen bir tıbbi belgenin GERÇEK, opak
 * `storagePath`'ini (API yanıtında ASLA dönmeyen bir alan) doğrudan DB'den okur — böylece test
 * "`/uploads/<gerçek-dosya-adı>` GERÇEKTEN erişilemiyor mu" sorusunu, tahmini/rastgele bir dosya
 * adıyla DEĞİL, GERÇEK depolanan adla sorabilir. */
export function getAppointmentDocumentStoragePathDirectly(documentId: string): string {
  const result = runReadOnlyPrismaScript<{ storagePath: string | null }>(
    `
    const doc = await prisma.appointmentDocument.findUnique({ where: { id: process.argv[2] }, select: { storagePath: true } });
    process.stdout.write(JSON.stringify(doc ?? { storagePath: null }));
    `,
    [documentId]
  );
  if (!result.storagePath) throw new Error(`Belge storagePath'i okunamadı (documentId=${documentId}).`);
  return result.storagePath;
}

// ---------------------------------------------------------------------------
// qa-agent — portal izolasyonu (Admin/Doktor/Hasta) + admin analitik e2e fixture'ları (bu turda
// eklendi). `E2E_DATABASE_URL`/`BACKEND_DIR` yukarıda TANIMLI (`shiftAppointmentIntoJoinWindowDirectly`
// İLE PAYLAŞILIR).
// ---------------------------------------------------------------------------

/** `appointment_bookings.paymentStatus`'u doğrudan `PAID` yapar — booking'in KENDİSİ (`POST
 * /appointments/bookings`) GERÇEK, herkese açık uçtan oluşturulur; ödeme/webhook akışı
 * `telehealth-multi-slot-booking.spec.ts`'te AYRICA kapsanır, burada TEKRAR test edilmez
 * (`doctor-panel-session-lifecycle.spec.ts::markFixtureBookingPaidWithAppointmentStatus` İLE
 * AYNI felsefe, farklı hedef veritabanı — `saas_e2e`). */
export function markBookingPaidDirectly(bookingId: string): void {
  const esc = (value: string) => value.replace(/'/g, "''");
  const sql = `UPDATE "appointment_bookings" SET "paymentStatus" = 'PAID', "paidAt" = now() WHERE id = '${esc(bookingId)}';`;
  execFileSync("npx", ["prisma", "db", "execute", "--stdin", `--url=${E2E_DATABASE_URL}`], {
    cwd: BACKEND_DIR,
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
}

/** Randevunun durumunu VE (isteğe bağlı) zamanlamasını doğrudan DB'de değiştirir —
 * `shiftAppointmentIntoJoinWindowDirectly` İLE AYNI "gerçek randevu, sahte olan yalnızca
 * durum/zamanlama" felsefesi. `daysAgo` verilirse `startsAt`/`endsAt` GEÇMİŞE kaydırılır (admin
 * analitik e2e fixture'ı — `/admin/telehealth/analytics/overview` varsayılan aralığı son 30 gün
 * olduğundan, bu aralık İÇİNDE bir `COMPLETED` seans garantilemek için); verilmezse zamanlama
 * DOKUNULMAZ (randevu GERÇEK rezervasyon akışından geçtiği ANDAKİ gelecekteki slotunu korur). */
export function setAppointmentStatusDirectly(
  appointmentId: string,
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW" | "IN_PROGRESS",
  opts: { daysAgo?: number; durationMinutes?: number } = {}
): void {
  const esc = (value: string) => value.replace(/'/g, "''");
  const timingSql =
    opts.daysAgo !== undefined
      ? `, "startsAt" = now() - interval '${opts.daysAgo} days', "endsAt" = now() - interval '${opts.daysAgo} days' + interval '${opts.durationMinutes ?? 30} minutes'`
      : "";
  const sql = `UPDATE "appointments" SET "status" = '${status}'${timingSql} WHERE id = '${esc(appointmentId)}';`;
  execFileSync("npx", ["prisma", "db", "execute", "--stdin", `--url=${E2E_DATABASE_URL}`], {
    cwd: BACKEND_DIR,
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
}

/** §9.7.11 madde 27 (2FA kapısı) — `User.twoFactorEnabled`'i doğrudan yazar (admin panelinde bir
 * kullanıcının 2FA'sını ZORLA açan bir uç YOKTUR — 2FA kendi kendine kayıt/etkinleştirmedir,
 * `hesabim` akışı TOTP sırrı üretip doğrulama ister; bu fixture o akışı ATLAYIP doğrudan bayrağı
 * yazar — `shiftAppointmentIntoJoinWindowDirectly` İLE AYNI "gerçek varlık, sahte olan yalnızca
 * zamanlama/bayrak" felsefesi). */
export function setUserTwoFactorEnabledDirectly(userId: string, enabled: boolean): void {
  const esc = (value: string) => value.replace(/'/g, "''");
  const sql = `UPDATE "users" SET "twoFactorEnabled" = ${enabled ? "true" : "false"} WHERE id = '${esc(userId)}';`;
  execFileSync("npx", ["prisma", "db", "execute", "--stdin", `--url=${E2E_DATABASE_URL}`], {
    cwd: BACKEND_DIR,
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
}
