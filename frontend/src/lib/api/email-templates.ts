import { apiFetch } from "./client";
import type {
  CreateEmailTemplateRequest,
  EmailTemplate,
  EmailTemplatePurpose,
  EmailTemplateSummary,
  EmailVariableDefinition,
  PreviewEmailTemplateRequest,
  PreviewEmailTemplateResponse,
  TestSendEmailTemplateRequest,
  TestSendEmailTemplateResponse,
  UpdateEmailTemplateRequest,
} from "./types";

/**
 * §10.16.6 — BREAKING: `{key}` adreslemesi `{templateId}` (uuid) ile değiştirildi.
 * `/admin/notifications/templates` uçları.
 */
const BASE = "/admin/notifications/templates";

export interface ListTemplatesParams {
  purpose?: EmailTemplatePurpose;
  isActive?: boolean;
}

export function listTemplates(params: ListTemplatesParams = {}) {
  return apiFetch<EmailTemplateSummary[]>(BASE, { query: { purpose: params.purpose, isActive: params.isActive } });
}

export function createTemplate(input: CreateEmailTemplateRequest) {
  return apiFetch<EmailTemplate>(BASE, { method: "POST", body: input });
}

/** Şablon HENÜZ OLUŞTURULMADAN (yeni şablon sihirbazı) — registry'den beslenir, DB tablosu DEĞİLDİR. */
export function listVariablesForPurpose(purpose: EmailTemplatePurpose) {
  return apiFetch<EmailVariableDefinition[]>(`${BASE}/variables`, { query: { purpose } });
}

/** Durumsuz (stateless) taslak önizleme — kaydedilmemiş editör durumunu render eder, DB'ye YAZMAZ. */
export function previewTemplate(input: PreviewEmailTemplateRequest) {
  return apiFetch<PreviewEmailTemplateResponse>(`${BASE}/preview`, { method: "POST", body: input });
}

export function getTemplate(templateId: string) {
  return apiFetch<EmailTemplate>(`${BASE}/${templateId}`);
}

export function updateTemplate(templateId: string, input: UpdateEmailTemplateRequest) {
  return apiFetch<EmailTemplate>(`${BASE}/${templateId}`, { method: "PATCH", body: input });
}

/** `isSystem` → 403. `isActive` → 409 (önce başka bir şablon aktifleştirilmeli). */
export function deleteTemplate(templateId: string) {
  return apiFetch<void>(`${BASE}/${templateId}`, { method: "DELETE" });
}

export function activateTemplate(templateId: string) {
  return apiFetch<EmailTemplate>(`${BASE}/${templateId}/activate`, { method: "POST" });
}

export function duplicateTemplate(templateId: string) {
  return apiFetch<EmailTemplate>(`${BASE}/${templateId}/duplicate`, { method: "POST" });
}

/**
 * KAYDEDİLMİŞ şablonu örnek verilerle admin'in KENDİ adresine gönderir — gövde `to` alanı
 * KABUL ETMEZ (§10.16.6, bağlayıcı güvenlik kararı). Rate limit: 3/dakika.
 */
export function testSendTemplate(templateId: string, input: TestSendEmailTemplateRequest = {}) {
  return apiFetch<TestSendEmailTemplateResponse>(`${BASE}/${templateId}/test-send`, { method: "POST", body: input });
}
