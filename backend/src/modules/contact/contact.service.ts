/**
 * §10.16.7/§10.16.8 İletişim formu — public gönderim (submit) iş mantığı. Admin CRUD (form
 * yapılandırması/alan yönetimi/gönderim listeleme) `contact.routes.ts`'te doğrudan yazılır (basit
 * CRUD, ayrı bir servis katmanı gerektirmez); BU dosya yalnızca `POST /contact/submissions`'ın
 * (honeypot + doğrulama + kayıt + best-effort bildirim) daha karmaşık akışını taşır.
 */
import type { FastifyInstance } from "fastify";
import type { ContactForm, ContactFormField, ContactSubmission, Prisma } from "@prisma/client";
import { NotFoundError, PayloadTooLargeError, ValidationError } from "../../lib/errors";
import { env } from "../../config/env";
import { sendEmailUsingTemplateRow } from "../email-templates/email-templates.service";
import { CONTACT_FORM_ID, CONTACT_SUBMISSION_VALUES_MAX_BYTES } from "./contact.constants";

const EMAIL_FORMAT_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SubmitContactFormInput {
  values: Record<string, string>;
  consent?: boolean;
  /** Honeypot — bkz. §10.16.9. Doluysa istek SPAM olarak işaretlenir, e-posta gönderilmez. */
  website?: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface SubmitContactFormResult {
  id: string;
  message: string;
}

type ContactFormWithFields = ContactForm & { fields: ContactFormField[] };

/**
 * Alan bazlı doğrulama — `required`/`maxLength`/`EMAIL` formatı/`SELECT` değeri `options` içinde
 * mi. Tanımsız anahtarlar (forma ait olmayan `key`ler) SESSİZCE ATILIR (§10.16.8) — kötü niyetli
 * bir istemci `data`'yı şişiremesin.
 */
function validateAndCollectFieldValues(fields: ContactFormField[], rawValues: Record<string, string>): Record<string, string> {
  const data: Record<string, string> = {};
  const errors: string[] = [];

  for (const field of fields) {
    const raw = rawValues[field.key];
    const trimmed = typeof raw === "string" ? raw.trim() : "";

    if (!trimmed) {
      if (field.required) errors.push(`'${field.label}' zorunludur.`);
      continue;
    }

    if (field.maxLength && trimmed.length > field.maxLength) {
      errors.push(`'${field.label}' en fazla ${field.maxLength} karakter olabilir.`);
      continue;
    }
    if (field.type === "EMAIL" && !EMAIL_FORMAT_PATTERN.test(trimmed)) {
      errors.push(`'${field.label}' geçerli bir e-posta adresi olmalıdır.`);
      continue;
    }
    if (field.type === "SELECT") {
      const options = (field.options as { value: string }[] | null) ?? [];
      if (!options.some((option) => option.value === trimmed)) {
        errors.push(`'${field.label}' geçerli bir seçenek olmalıdır.`);
        continue;
      }
    }

    data[field.key] = trimmed;
  }

  if (errors.length > 0) {
    throw new ValidationError("Form doğrulaması başarısız.", { values: errors });
  }

  return data;
}

/** Honeypot tetiklendiğinde — bota "başarısız oldum" sinyali VERİLMEZ, sıkı doğrulama ATLANIR (§10.16.9). */
function collectSpamValues(fields: ContactFormField[], rawValues: Record<string, string>): Record<string, string> {
  const data: Record<string, string> = {};
  for (const field of fields) {
    const raw = rawValues[field.key];
    if (typeof raw === "string") data[field.key] = raw.slice(0, 5000);
  }
  return data;
}

/** `ContactForm.notificationTemplateId` verilmişse O SATIR kullanılır; yoksa amacın AKTİF şablonu (§10.16.7). */
async function resolveNotificationTemplate(app: FastifyInstance, form: ContactForm) {
  if (form.notificationTemplateId) {
    const explicit = await app.prisma.emailTemplate.findUnique({ where: { id: form.notificationTemplateId } });
    if (explicit) return explicit;
  }
  return app.prisma.emailTemplate.findFirst({ where: { purpose: "CONTACT_FORM_NOTIFICATION", isActive: true } });
}

/**
 * §10.16.8 madde 6 — bildirim gönderimi BEST-EFFORT'tur: SMTP/şablon hatası isteği DÜŞÜRMEZ,
 * `notificationError` doldurulur ve `app.log.error` ile loglanır. `notifyEmail` boşsa (bildirim
 * kapalı) sessizce atlanır — bu bir HATA DEĞİLDİR.
 */
async function sendNotificationBestEffort(app: FastifyInstance, form: ContactForm, submission: ContactSubmission): Promise<void> {
  if (!form.notifyEmail) return;

  try {
    const template = await resolveNotificationTemplate(app, form);
    if (!template) {
      throw new Error("purpose=CONTACT_FORM_NOTIFICATION için aktif bir şablon bulunamadı.");
    }

    const values: Record<string, string> = {
      ...(submission.data as Record<string, string>),
      form_title: form.title,
      submitted_at: submission.createdAt.toLocaleString("tr-TR"),
      submission_url: `${env.FRONTEND_URL}/admin/contact/submissions/${submission.id}`,
    };

    await sendEmailUsingTemplateRow(app, template, form.notifyEmail, values);

    await app.prisma.contactSubmission.update({
      where: { id: submission.id },
      data: { notifiedAt: new Date(), notificationError: null },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bilinmeyen hata.";
    app.log.error({ err, submissionId: submission.id }, "İletişim formu bildirim e-postası gönderilemedi");
    await app.prisma.contactSubmission
      .update({ where: { id: submission.id }, data: { notificationError: message } })
      .catch((updateErr) => app.log.error({ err: updateErr, submissionId: submission.id }, "notificationError yazılamadı"));
  }
}

/**
 * §10.16.8 davranış sırası (BAĞLAYICI): (1) form kapalıysa 404 · (2) gövde boyutu > 32 KB ise 413
 * · (3) honeypot doluysa 201 (sahte başarı) + SPAM + e-posta YOK · (4) `consentRequired &&
 * consent !== true` → 422 · (5) alan bazlı doğrulama · (6) kayıt yazılır · (7) bildirim best-effort
 * gönderilir (hata isteği DÜŞÜRMEZ).
 */
export async function submitContactForm(app: FastifyInstance, input: SubmitContactFormInput): Promise<SubmitContactFormResult> {
  const form = (await app.prisma.contactForm.findUnique({
    where: { id: CONTACT_FORM_ID },
    include: { fields: { orderBy: { order: "asc" } } },
  })) as ContactFormWithFields | null;

  if (!form || !form.isEnabled) {
    throw new NotFoundError("İletişim formu bulunamadı.");
  }

  const serializedSize = Buffer.byteLength(JSON.stringify(input.values ?? {}), "utf8");
  if (serializedSize > CONTACT_SUBMISSION_VALUES_MAX_BYTES) {
    throw new PayloadTooLargeError("İstek gövdesi çok büyük.", { values: ["values alanı en fazla 32 KB olabilir."] });
  }

  const isSpam = typeof input.website === "string" && input.website.trim().length > 0;

  let data: Record<string, string>;
  if (isSpam) {
    data = collectSpamValues(form.fields, input.values ?? {});
  } else {
    if (form.consentRequired && input.consent !== true) {
      throw new ValidationError("Onay metni kabul edilmelidir.", { consent: ["Devam etmek için onay metnini kabul etmelisiniz."] });
    }
    data = validateAndCollectFieldValues(form.fields, input.values ?? {});
  }

  const submission = await app.prisma.contactSubmission.create({
    data: {
      formId: form.id,
      name: data.name ?? "",
      email: data.email ?? "",
      data: data as Prisma.InputJsonValue,
      status: isSpam ? "SPAM" : "NEW",
      consentAt: !isSpam && form.consentRequired ? new Date() : null,
      consentTextSnapshot: !isSpam && form.consentRequired ? form.consentText : null,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    },
  });

  if (!isSpam) {
    await sendNotificationBestEffort(app, form, submission);
  }

  return { id: submission.id, message: form.successMessage };
}
