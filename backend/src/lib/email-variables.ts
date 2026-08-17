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
