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
