/**
 * §10.16.5 Değişken (variable) sistemi — `lib/permissions-matrix.ts`/`lib/module-registry.ts`
 * ile AYNI statik-registry deseni. Frontend değişken listesini HARDCODE ETMEZ, API'den okur
 * (bkz. `GET /admin/notifications/templates/variables`, `EmailTemplate.variables`).
 *
 * MİMAR HAKEMLİĞİ (ARCHITECTURE.md §10.16.1) — SİSTEM değişkenlerinin anahtarları İngilizce
 * snake_case KALIR (`user_name`, `reset_link`, …): `prisma/seed.ts`teki 5 RAW şablon ve
 * `email-templates.service.ts`'teki TÜM çağrı yerleri bugün bu anahtarları üretiyor; anahtarı
 * değiştirmek üretimdeki PASSWORD_RESET/WELCOME/ORDER_CONFIRMATION/ORG_INVITATION akışlarını
 * SESSİZCE bozar (allow-list dışı kalan `{{...}}` OLDUĞU GİBİ basılır, bkz. lib/template-render.ts).
 */
import type { FastifyInstance } from "fastify";
import type { EmailTemplatePurpose } from "@prisma/client";
import { ValidationError } from "./errors";

export interface EmailVariableDefinition {
  key: string;
  label: string;
  sampleValue: string;
  source: "system" | "custom" | "contact-field";
}

export interface EmailCustomVariable {
  key: string;
  label: string;
  sampleValue: string;
}

/** Özel değişken + iletişim formu alanı anahtarı doğrulaması — ARCHITECTURE.md §10.16.1/§10.16.5. */
export const CUSTOM_VARIABLE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/** Şablon başına en fazla kaç özel (custom) değişken kabul edilir — §10.16.5. */
export const MAX_CUSTOM_VARIABLES = 20;

/** Her amaçta (`CUSTOM` dahil) geçerli — tüm çağrılarda otomatik enjekte edilir (§10.16.5). */
const GLOBAL_VARIABLES: EmailVariableDefinition[] = [
  { key: "site_name", label: "Site Adı", sampleValue: "Örnek Site", source: "system" },
  { key: "site_url", label: "Site Adresi", sampleValue: "https://example.com", source: "system" },
];

/**
 * Amaca göre sistem değişkenleri — ARCHITECTURE.md §10.16.5 tablosuyla BAĞLAYICI olarak bire
 * bir eşleşir (mevcut `prisma/seed.ts` + çağrı yerleriyle uyum ZORUNLU).
 */
const SYSTEM_VARIABLES_BY_PURPOSE: Record<EmailTemplatePurpose, EmailVariableDefinition[]> = {
  WELCOME: [
    { key: "user_name", label: "Kullanıcı Adı", sampleValue: "Ayşe Yılmaz", source: "system" },
    { key: "login_url", label: "Giriş Bağlantısı", sampleValue: "https://example.com/login", source: "system" },
  ],
  PASSWORD_RESET: [
    { key: "user_name", label: "Kullanıcı Adı", sampleValue: "Ayşe Yılmaz", source: "system" },
    { key: "reset_link", label: "Şifre Sıfırlama Bağlantısı", sampleValue: "https://example.com/reset?token=abc", source: "system" },
  ],
  SYSTEM_ANNOUNCEMENT: [
    { key: "user_name", label: "Kullanıcı Adı", sampleValue: "Ayşe Yılmaz", source: "system" },
    { key: "announcement_title", label: "Duyuru Başlığı", sampleValue: "Planlı Bakım Bildirimi", source: "system" },
    { key: "announcement_body", label: "Duyuru İçeriği", sampleValue: "Yarın 02:00-04:00 arası bakım yapılacaktır.", source: "system" },
  ],
  ORDER_CONFIRMATION: [
    { key: "order_number", label: "Sipariş Numarası", sampleValue: "ORD-1024", source: "system" },
    { key: "customer_name", label: "Müşteri Adı", sampleValue: "Ayşe Yılmaz", source: "system" },
    { key: "items_summary", label: "Sipariş İçeriği", sampleValue: "Ürün A x1, Ürün B x2", source: "system" },
    { key: "total_formatted", label: "Toplam Tutar", sampleValue: "₺1.250,00", source: "system" },
  ],
  ORDER_CANCELLATION: [
    { key: "order_number", label: "Sipariş Numarası", sampleValue: "ORD-1024", source: "system" },
    { key: "customer_name", label: "Müşteri Adı", sampleValue: "Ayşe Yılmaz", source: "system" },
    { key: "items_summary", label: "Sipariş İçeriği", sampleValue: "Ürün A x1, Ürün B (Antrasit / L) x2", source: "system" },
    { key: "total_formatted", label: "Toplam Tutar", sampleValue: "₺1.250,00", source: "system" },
    { key: "cancellation_reason", label: "İptal Nedeni", sampleValue: "Stok tükendi", source: "system" },
  ],
  ORG_INVITATION: [
    { key: "inviter_name", label: "Davet Eden", sampleValue: "Ayşe Yılmaz", source: "system" },
    { key: "organization_name", label: "Organizasyon Adı", sampleValue: "Örnek Organizasyon", source: "system" },
    { key: "accept_url", label: "Daveti Kabul Bağlantısı", sampleValue: "https://example.com/invitations/abc/accept", source: "system" },
  ],
  CONTACT_FORM_NOTIFICATION: [
    { key: "form_title", label: "Form Başlığı", sampleValue: "İletişim", source: "system" },
    { key: "submitted_at", label: "Gönderim Tarihi", sampleValue: "17.08.2026 14:30", source: "system" },
    { key: "submission_url", label: "Yönetim Paneli Bağlantısı", sampleValue: "https://example.com/admin/contact/submissions/abc", source: "system" },
  ],
  /**
   * [TCT] §9.7.8 (bağlayıcı) — YALNIZCA ödeme onaylandığında hastaya. **Bağlayıcı sızma
   * yasağı:** doktorun uzmanlık adı, şikâyet notu veya belge adı bu değişken setine ASLA
   * EKLENMEZ (uzmanlık adı çıkarımsal sağlık verisidir, §7.1) — konu satırı nötr olmalıdır
   * ("Randevunuz onaylandı"), şablonun kendi İÇERİĞİ notification-agent'ındır
   * (bkz. `modules/telehealth/lib/booking.ts::triggerAppointmentConfirmationEmail`, backend-agent
   * yalnızca BU registry girdisini ve tetikleyici çağrıyı bırakır).
   */
  APPOINTMENT_CONFIRMATION: [
    { key: "booking_number", label: "Rezervasyon Numarası", sampleValue: "BKG-L4K2J1-A1B2", source: "system" },
    { key: "patient_name", label: "Hasta Adı", sampleValue: "Ayşe Yılmaz", source: "system" },
    { key: "slots_summary", label: "Randevu Saatleri", sampleValue: "06.01.2025 09:00, 06.01.2025 09:30", source: "system" },
    { key: "total_formatted", label: "Toplam Tutar", sampleValue: "750.00 TRY", source: "system" },
    { key: "magic_link", label: "Rezervasyon Bağlantısı", sampleValue: "https://example.com/tr/patient/bookings/abc?t=xyz", source: "system" },
    // 2026-09-18 (kullanıcı talebi) — `magic_link`in aksine DOĞRUDAN görüşme odasına gider
    // (`/consultation/{appointmentId}?t=...`, en erken randevuya). `APPOINTMENT_REMINDER_30M`in
    // `join_link`inden FARKLI hedef (o, `/patient/bookings/{id}` — burada BİLİNÇLİ olarak DOĞRUDAN
    // konsültasyon linki, kullanıcı talebiyle).
    { key: "join_link", label: "Görüşmeye Katıl Bağlantısı", sampleValue: "https://example.com/tr/consultation/xyz?t=abc", source: "system" },
  ],
  /**
   * NOT — 2026-09-15 (backend-agent, "Admin randevu yeniden planlama") — ADMIN bir randevuyu
   * yeniden planladığında hastaya (ve doktorun bağlı bir `User`/e-postası VARSA doktora) gönderilir.
   * `APPOINTMENT_CONFIRMATION` İLE AYNI bağlayıcı sızma yasağı GEÇERLİDİR: uzmanlık adı/şikâyet
   * notu/belge adı bu değişken setine ASLA EKLENMEZ (bkz.
   * `modules/telehealth/lib/notifications.ts::triggerAppointmentRescheduledEmail`, şablonun
   * İÇERİĞİ notification-agent'ındır).
   */
  APPOINTMENT_RESCHEDULED: [
    { key: "recipient_name", label: "Alıcı Adı", sampleValue: "Ayşe Yılmaz", source: "system" },
    { key: "booking_number", label: "Rezervasyon Numarası", sampleValue: "BKG-L4K2J1-A1B2", source: "system" },
    { key: "old_slot_summary", label: "Eski Randevu Saati", sampleValue: "06.01.2025 09:00", source: "system" },
    { key: "new_slot_summary", label: "Yeni Randevu Saati", sampleValue: "08.01.2025 10:00", source: "system" },
    { key: "reason", label: "Değişiklik Notu", sampleValue: "Doktorun programı nedeniyle", source: "system" },
  ],
  /**
   * [ASD] §2.4 (bağlayıcı) — `startsAt`e ~1 saat kala, süpürücü tetikler
   * (`lib/appointment-reminders.ts`). `APPOINTMENT_CONFIRMATION` İLE AYNI bağlayıcı sızma
   * yasağı: uzmanlık adı/şikâyet notu/belge adı bu değişken setine ASLA EKLENMEZ. `join_link`
   * BİLİNÇLİ OLARAK YOK (yalnızca 30 dk şablonunda vardır, §2.5) — 1 saat kala hasta henüz
   * katılmaya hazır olmayabilir, katılım bağlantısı onay e-postasında zaten mevcuttur.
   */
  APPOINTMENT_REMINDER_60M: [
    { key: "recipient_name", label: "Alıcı Adı", sampleValue: "Ayşe Yılmaz", source: "system" },
    { key: "booking_number", label: "Rezervasyon Numarası", sampleValue: "BKG-L4K2J1-A1B2", source: "system" },
    { key: "doctor_name", label: "Doktor Adı", sampleValue: "Dr. Mehmet Demir", source: "system" },
    { key: "slot_summary", label: "Randevu Saati", sampleValue: "06.01.2025 09:00", source: "system" },
  ],
  /**
   * [ASD] §2.4/§2.5 (bağlayıcı) — `startsAt`e ~30 dakika kala. `APPOINTMENT_REMINDER_60M` İLE
   * AYNI sızma yasağı + EK olarak `join_link`: token'sız derin bağlantı (`/patient/bookings/
   * {bookingId}` veya doktora `/doctor`) — token ROTATE EDİLMEZ, onay e-postasındaki bağlantı
   * bozulmaz (bkz. `modules/telehealth/lib/notifications.ts::triggerAppointmentReminderEmail`).
   */
  APPOINTMENT_REMINDER_30M: [
    { key: "recipient_name", label: "Alıcı Adı", sampleValue: "Ayşe Yılmaz", source: "system" },
    { key: "booking_number", label: "Rezervasyon Numarası", sampleValue: "BKG-L4K2J1-A1B2", source: "system" },
    { key: "doctor_name", label: "Doktor Adı", sampleValue: "Dr. Mehmet Demir", source: "system" },
    { key: "slot_summary", label: "Randevu Saati", sampleValue: "06.01.2025 09:00", source: "system" },
    { key: "join_link", label: "Katılım Bağlantısı", sampleValue: "https://example.com/tr/patient/bookings/abc", source: "system" },
  ],
  /**
   * `.claude/architect-scope-guest-account-otp.md` §7.3 (bağlayıcı) — `POST /auth/register`
   * sonrası gönderilen 6 haneli doğrulama kodu. `verification_code` DÜZ METİN olarak taşınır
   * (kod zaten kullanıcıya OKUNMASI için gönderiliyor — DB'deki HMAC hash'iyle KARIŞTIRILMAZ,
   * bkz. lib/otp.ts). Sağlık verisi/randevu bağlamı YOKTUR (kayıt akışı, telehealth'ten bağımsız).
   */
  EMAIL_VERIFICATION: [
    { key: "user_name", label: "Kullanıcı Adı", sampleValue: "Ayşe Yılmaz", source: "system" },
    { key: "verification_code", label: "Doğrulama Kodu", sampleValue: "048213", source: "system" },
    { key: "expires_in_minutes", label: "Geçerlilik Süresi (dk)", sampleValue: "10", source: "system" },
  ],
  /**
   * §7.3 (bağlayıcı) — misafir randevu ödemesiyle açılan hesabın aktivasyon e-postası.
   * **Bağlayıcı sızma yasağı (§9.7.5 madde 8 ile AYNI disiplin, §7.3):** doktor adı, uzmanlık,
   * şikâyet notu veya slot saatleri bu değişken setine ASLA EKLENMEZ — yalnızca `booking_number`
   * yer alır (alıcı e-postanın nedenini anlasın diye; aynı adrese zaten randevu onayı da gitmiştir).
   * `activation_url` KODU TAŞIMAZ (`${FRONTEND_URL}/{lang}/activate-account?email=...`) — kodun
   * URL'ye konması onu referer/proxy loglarına sızdırır ve deneme sayacını anlamsızlaştırır.
   */
  ACCOUNT_ACTIVATION: [
    { key: "user_name", label: "Kullanıcı Adı", sampleValue: "Ayşe Yılmaz", source: "system" },
    { key: "verification_code", label: "Doğrulama Kodu", sampleValue: "048213", source: "system" },
    { key: "expires_in_hours", label: "Geçerlilik Süresi (saat)", sampleValue: "24", source: "system" },
    { key: "activation_url", label: "Hesap Aktivasyon Bağlantısı", sampleValue: "https://example.com/tr/activate-account?email=ayse%40example.com", source: "system" },
    { key: "booking_number", label: "Rezervasyon Numarası", sampleValue: "BKG-L4K2J1-A1B2", source: "system" },
  ],
  /**
   * KULLANILMIYOR (2026-09-18) — bu amaç kısa bir süre "ödeme öncesi hatırlatma" e-postası için
   * eklenmişti, kullanıcı BİLİNÇLİ olarak GERİ ALDI: ödeme tamamlanmadan/randevu kesinleşmeden
   * HİÇBİR e-posta gönderilmemelidir (bkz. `lib/notifications.ts::resendBookingAccessLink` dosya
   * başı yorumu). Hiçbir çağrı yeri `sendTemplateEmail(app, "BOOKING_PAYMENT_PENDING", ...)`
   * ÇAĞIRMAZ ve `prisma/seed.ts` artık bu amaç için bir şablon OLUŞTURMAZ. Bu girdi yalnızca
   * `Record<EmailTemplatePurpose, ...>` tip zorunluluğu (Prisma `EmailTemplatePurpose` enum'undan
   * bir değer `ALTER TYPE ... DROP VALUE` desteklenmediği için GERİ ALINAMAZ) yüzünden burada
   * durur — YENİDEN AKTİFLEŞTİRİLMEMELİDİR.
   */
  BOOKING_PAYMENT_PENDING: [],
  CUSTOM: [],
};

export function getSystemVariablesForPurpose(purpose: EmailTemplatePurpose): EmailVariableDefinition[] {
  return [...GLOBAL_VARIABLES, ...SYSTEM_VARIABLES_BY_PURPOSE[purpose]];
}

/** `ContactFormField` tipine göre makul bir örnek değer üretir (yalnızca önizleme/test amaçlı). */
function sampleValueForFieldType(type: string): string {
  switch (type) {
    case "EMAIL":
      return "ornek@example.com";
    case "PHONE":
      return "+90 555 123 45 67";
    case "TEXTAREA":
      return "Örnek mesaj metni.";
    case "CHECKBOX":
      return "Evet";
    case "SELECT":
      return "Seçenek 1";
    default:
      return "Örnek değer";
  }
}

interface ContactFieldLike {
  key: string;
  label: string;
  type: string;
}

/**
 * §10.16.5 — iletişim formu alanları OTOMATİK değişken olur. Admin forma "telefon" alanı
 * eklediğinde `{{telefon}}` hiçbir ek işlem olmadan değişken panelinde belirir.
 */
export function getContactFieldVariables(fields: ContactFieldLike[]): EmailVariableDefinition[] {
  return fields.map((field) => ({
    key: field.key,
    label: field.label,
    sampleValue: sampleValueForFieldType(field.type),
    source: "contact-field" as const,
  }));
}

function toCustomVariableDefinitions(customVariables: EmailCustomVariable[]): EmailVariableDefinition[] {
  return customVariables.map((v) => ({ ...v, source: "custom" as const }));
}

/**
 * Bir şablonun (kaydedilmiş ya da taslak) TAM değişken listesi — değişken panelinin TEK veri
 * kaynağı (ARCHITECTURE.md §10.16.5). `purpose = CONTACT_FORM_NOTIFICATION` ise iletişim
 * formunun (singleton) güncel alanları AYRICA okunur (tek ekstra sorgu, N+1 değil).
 */
export async function resolveTemplateVariables(
  app: FastifyInstance,
  purpose: EmailTemplatePurpose,
  customVariables: EmailCustomVariable[]
): Promise<EmailVariableDefinition[]> {
  const definitions = [...getSystemVariablesForPurpose(purpose), ...toCustomVariableDefinitions(customVariables)];

  if (purpose === "CONTACT_FORM_NOTIFICATION") {
    const fields = await app.prisma.contactFormField.findMany({
      where: { formId: "singleton" },
      orderBy: { order: "asc" },
      select: { key: true, label: true, type: true },
    });
    definitions.push(...getContactFieldVariables(fields));
  }

  return definitions;
}

/**
 * §10.16.5 — özel değişken anahtarı o şablonun SİSTEM değişkenleriyle çakışamaz (422
 * `VALIDATION_ERROR`, alan bazlı hata `details.customVariables`). Anahtar deseni zaten zod
 * şemasında (`^[a-z][a-z0-9_]{0,39}$`) doğrulanır — burada YALNIZCA çakışma/tekillik kontrolü var.
 */
export function assertCustomVariablesDoNotConflict(
  customVariables: EmailCustomVariable[],
  purpose: EmailTemplatePurpose
): void {
  const systemKeys = new Set(getSystemVariablesForPurpose(purpose).map((v) => v.key));
  const seen = new Set<string>();
  const conflicts: string[] = [];

  for (const variable of customVariables) {
    if (systemKeys.has(variable.key)) {
      conflicts.push(`'${variable.key}' bir sistem değişkeniyle çakışıyor.`);
    } else if (seen.has(variable.key)) {
      conflicts.push(`'${variable.key}' birden fazla kez tanımlanmış.`);
    }
    seen.add(variable.key);
  }

  if (conflicts.length > 0) {
    throw new ValidationError("Özel değişken anahtarları geçersiz.", { customVariables: conflicts });
  }
}

/**
 * Serbest metindeki TÜM `{{...}}` kalıplarını yakalar — `lib/template-render.ts::PLACEHOLDER_PATTERN`
 * (`/\{\{(\w+)\}\}/g`, ASCII `\w`) İLE AYNI DEĞİL: burada amaç "geçersiz/tanımsız bir değişken
 * kullanılmış mı" tespitidir, bu yüzden Türkçe karakterli/boşluklu içeriği de yakalayacak kadar
 * GENİŞTİR (aksi halde `{{çalışan_adı}}` gibi sessizce render edilmeyecek bir kalıp, "geçerli"
 * sanılıp gözden kaçardı).
 */
const RAW_PLACEHOLDER_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function extractPlaceholderKeys(text: string): string[] {
  const keys: string[] = [];
  for (const match of text.matchAll(RAW_PLACEHOLDER_PATTERN)) {
    keys.push(match[1]!);
  }
  return keys;
}

/**
 * Şablon metinlerindeki (`subject` + `blocks`'un değişken kabul eden alanları + `bodyHtml`)
 * TÜM `{{...}}` kalıplarını izinli değişken setine karşı doğrular. İzinli sette olmayan bir
 * anahtar varsa 422 fırlatır (`details.blocks`) — ARCHITECTURE.md §10.16.5: "Kaydetme anında
 * hata vermek bilinçli bir seçimdir" (allow-list dışı kalan kalıp `renderTemplate` tarafından
 * OLDUĞU GİBİ basılır, kullanıcı bunu ancak gerçek e-posta gittikten sonra fark ederdi).
 */
export function assertNoUndefinedVariables(texts: string[], allowedKeys: ReadonlySet<string>): void {
  const undefinedKeys = new Set<string>();
  for (const text of texts) {
    for (const key of extractPlaceholderKeys(text)) {
      if (!allowedKeys.has(key)) undefinedKeys.add(key);
    }
  }

  if (undefinedKeys.size > 0) {
    throw new ValidationError("Şablonda tanımsız değişken(ler) kullanılmış.", {
      blocks: [...undefinedKeys].map((key) => `Tanımsız değişken: {{${key}}}`),
    });
  }
}
