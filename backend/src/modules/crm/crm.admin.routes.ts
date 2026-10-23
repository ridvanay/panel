import type { FastifyInstance } from "fastify";
import { authenticate } from "../../middleware/authenticate";
import { requirePanelAccess } from "../../middleware/panel-access";
import { ok } from "../../lib/envelope";
import { logAudit } from "../../lib/audit";
import { CACHE_TAGS, triggerTagRevalidation } from "../../lib/revalidate";
import { ValidationError } from "../../lib/errors";
import { requireCrmAccess } from "./crm.access";
import { registerCrmLeadRoutes } from "./crm.leads.routes";
import { registerCrmAnalyticsRoutes } from "./crm.analytics.routes";
import {
  applyCrmSettingsPatch,
  readCrmSettings,
  toCrmSettingsDto,
  UpdateCrmSettingsRequestSchema,
  writeCrmSettings,
} from "./crm.settings";

/**
 * Paket N — `/admin/crm/*`. Bütün uçlar: kimlik doğrulama → panel kapısı → ADMIN + 2FA (`requireCrmAccess`).
 * Alt uç grupları (talepler, analitik, Google) kendi dosyalarında, bu plugin'e kayıtlıdır.
 */
export async function crmAdminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requirePanelAccess());
  app.addHook("preHandler", requireCrmAccess());

  await registerCrmLeadRoutes(app);
  await registerCrmAnalyticsRoutes(app);

  app.get("/settings", async (_request, reply) => {
    const settings = await readCrmSettings(app.prisma);
    return reply.send(ok(toCrmSettingsDto(settings)));
  });

  app.patch("/settings", async (request, reply) => {
    const parsed = UpdateCrmSettingsRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const details: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "body";
        (details[key] ??= []).push(issue.message);
      }
      throw new ValidationError("Ayarlar geçersiz.", details);
    }
    const before = await readCrmSettings(app.prisma);
    const after = applyCrmSettingsPatch(before, parsed.data);
    await writeCrmSettings(app.prisma, after, request.user!.id);
    await logAudit(app, {
      actorId: request.user!.id,
      actorEmail: request.user!.email,
      action: "crm.settings.update",
      targetType: "CrmSettings",
      metadata: { fields: Object.keys(parsed.data), trackingEnabled: after.trackingEnabled, ipMode: after.ipMode },
      ipAddress: request.ip,
    });
    await triggerTagRevalidation(app, [CACHE_TAGS.crmConfig]);
    return reply.send(ok(toCrmSettingsDto(after)));
  });
}
