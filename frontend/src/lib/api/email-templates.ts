import { apiFetch } from "./client";
import type {
  EmailTemplate,
  EmailTemplateKey,
  UpdateEmailTemplateRequest,
  PreviewEmailTemplateResponse,
} from "./types";

const BASE = "/admin/notifications/templates";

export function listTemplates() {
  return apiFetch<EmailTemplate[]>(BASE);
}

export function getTemplate(key: EmailTemplateKey) {
  return apiFetch<EmailTemplate>(`${BASE}/${key}`);
}

export function updateTemplate(key: EmailTemplateKey, input: UpdateEmailTemplateRequest) {
  return apiFetch<EmailTemplate>(`${BASE}/${key}`, { method: "PATCH", body: input });
}

export function previewTemplate(key: EmailTemplateKey, sampleValues: Record<string, string>) {
  return apiFetch<PreviewEmailTemplateResponse>(`${BASE}/${key}/preview`, {
    method: "POST",
    body: { sampleValues },
  });
}
