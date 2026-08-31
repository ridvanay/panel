import { z } from "zod";

/** openapi.yaml `DemoTemplateKey` parametresi — statik registry anahtarı, uuid DEĞİL. */
export const DemoTemplateKeyParamSchema = z.object({
  templateKey: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Geçersiz şablon anahtarı."),
});

/**
 * `POST /admin/demo-templates/{templateKey}/import` gövdesi — openapi.yaml
 * `ImportDemoTemplateRequest` ile BİREBİR. `confirm` `true` OLMAK ZORUNDADIR (§6.4, çift kapı —
 * onay diyaloğu TEK BAŞINA yeterli sayılmaz). `.strict()` — `UpdateSiteAppearanceRequestSchema`
 * ile AYNI "bilinmeyen alan sessizce yutulmaz, 422 döner" kararı.
 */
export const ImportDemoTemplateRequestSchema = z
  .object({
    // Eksik/`false` → 422 (Zod'un standart "Invalid literal value" mesajıyla) — §6.4 çift kapı.
    confirm: z.literal(true),
    force: z.boolean().default(false),
    setAsHomePage: z.boolean().default(true),
  })
  .strict("Bilinmeyen alan gönderildi.");
export type ImportDemoTemplateRequest = z.infer<typeof ImportDemoTemplateRequestSchema>;
