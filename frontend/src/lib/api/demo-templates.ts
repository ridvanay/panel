import { apiFetch } from "./client";
import type { DemoTemplateImportResult, DemoTemplateSummary, ImportDemoTemplateRequest } from "./types";

/**
 * `GET /admin/demo-templates` — panel kapısı (ADMIN/MANAGER/EDITOR). Yanıt kod içi statik bir
 * registry + DB'deki uygulanmışlık işaretidir (bkz. `.claude/architect-scope-demo-template-import.md`
 * §6.3) — sıfır kullanıcı verisi taşır.
 */
export function fetchDemoTemplates(): Promise<DemoTemplateSummary[]> {
  return apiFetch<DemoTemplateSummary[]>("/admin/demo-templates");
}

/**
 * `POST /admin/demo-templates/{templateKey}/import` — yalnızca ADMIN. `confirm: true` ZORUNLU
 * (eksikse `422`); şablon daha önce uygulanmışsa `force: false` (varsayılan) ile `409` döner
 * (`error.details`: `templateKey`/`importedAt`/`importedBy`/`version`/`pageId`).
 */
export function importDemoTemplate(templateKey: string, body: ImportDemoTemplateRequest): Promise<DemoTemplateImportResult> {
  return apiFetch<DemoTemplateImportResult>(`/admin/demo-templates/${templateKey}/import`, { method: "POST", body });
}
