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
    // `.claude/architect-scope-telehealth-template.md` §2.6/§9.6 — dar tadilat: şablonun
    // `requiredModules`'ündeki anahtarlar YALNIZCA bu AÇIK opt-in ile açılabilir. Varsayılan
    // `false` — sessiz kill-switch çevirme YOK ([DTI] §3.2 yasağının gerekçesi).
    enableRequiredModules: z.boolean().default(false),
  })
  .strict("Bilinmeyen alan gönderildi.");
export type ImportDemoTemplateRequest = z.infer<typeof ImportDemoTemplateRequestSchema>;
