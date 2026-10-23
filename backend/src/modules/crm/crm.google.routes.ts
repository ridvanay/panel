import type { FastifyInstance } from "fastify";
import { ok } from "../../lib/envelope";
import { logAudit } from "../../lib/audit";
import { ConflictError, ValidationError } from "../../lib/errors";
import { parseOr422 } from "./crm.validate";
import { maskEmail, readCrmSettings, toCrmSettingsDto } from "./crm.settings";
import {
  AdsConversionsQuerySchema,
  AdsImportSchema,
  buildAdsConversionsCsv,
  ConnectSearchConsoleSchema,
  connectSearchConsole,
  disconnectSearchConsole,
  importAdsLeads,
  KeywordsQuerySchema,
  keywordsReport,
  syncSearchConsole,
} from "./crm.google";

/** Paket N4 — `/admin/crm/search-console/*`, `/admin/crm/keywords`, `/admin/crm/ads/*` (ADMIN + 2FA). */
export async function registerCrmGoogleRoutes(app: FastifyInstance) {
  app.post("/search-console/connect", { bodyLimit: 64 * 1024 }, async (request, reply) => {
    const input = parseOr422(ConnectSearchConsoleSchema, request.body);
    const settings = await connectSearchConsole(app, input, request.user!.id);
    if (!settings) {
      throw new ValidationError("Servis hesabı JSON'u geçersiz.", { credentialsJson: ["Google Cloud'dan indirilen servis hesabı anahtarı (type: service_account) olmalı."] });
    }
    await logAudit(app, {
      actorId: request.user!.id,
      actorEmail: request.user!.email,
      action: "crm.search_console.connect",
      targetType: "CrmSettings",
      metadata: { propertyUrl: input.propertyUrl, clientEmail: maskEmail(settings.searchConsole.clientEmail ?? "") },
      ipAddress: request.ip,
    });
    return reply.send(ok(toCrmSettingsDto(settings)));
  });

  app.delete("/search-console/connect", async (request, reply) => {
    const settings = await disconnectSearchConsole(app, request.user!.id);
    await logAudit(app, { actorId: request.user!.id, actorEmail: request.user!.email, action: "crm.search_console.disconnect", targetType: "CrmSettings", ipAddress: request.ip });
    return reply.send(ok(toCrmSettingsDto(settings)));
  });

  app.post("/search-console/sync", async (_request, reply) => {
    const settings = await readCrmSettings(app.prisma);
    if (!settings.searchConsole.credentialsCiphertext) throw new ConflictError("Search Console bağlı değil.");
    return reply.send(ok(await syncSearchConsole(app)));
  });

  app.get("/keywords", async (request, reply) => {
    const query = parseOr422(KeywordsQuerySchema, request.query);
    if (query.from > query.to) throw new ValidationError("Başlangıç tarihi bitişten sonra olamaz.", { from: ["Geçersiz aralık."] });
    const settings = await readCrmSettings(app.prisma);
    const sc = settings.searchConsole;
    return reply.send(
      ok({
        connection: { connected: Boolean(sc.credentialsCiphertext), propertyUrl: sc.propertyUrl, lastSyncAt: sc.lastSyncAt, lastSyncError: sc.lastSyncError },
        ...(await keywordsReport(app, query)),
      })
    );
  });

  app.get("/ads/conversions", async (request, reply) => {
    const query = parseOr422(AdsConversionsQuerySchema, request.query);
    const { csv, rows, skippedBraid } = await buildAdsConversionsCsv(app, query);
    await logAudit(app, {
      actorId: request.user!.id,
      actorEmail: request.user!.email,
      action: "crm.export",
      targetType: "AdsConversions",
      metadata: { kind: "ads_conversions", rows, skippedBraid, from: query.from, to: query.to },
      ipAddress: request.ip,
    });
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="google-ads-donusumler-${query.from}_${query.to}.csv"`)
      .header("x-crm-rows", String(rows))
      .header("x-crm-skipped-braid", String(skippedBraid))
      .header("cache-control", "no-store")
      .send(csv);
  });

  app.post("/ads/import-leads", { bodyLimit: 3 * 1024 * 1024 }, async (request, reply) => {
    const input = parseOr422(AdsImportSchema, request.body);
    const result = await importAdsLeads(app, input.csv);
    await logAudit(app, {
      actorId: request.user!.id,
      actorEmail: request.user!.email,
      action: "crm.lead.import",
      targetType: "CrmLead",
      metadata: { created: result.created, skipped: result.skipped },
      ipAddress: request.ip,
    });
    return reply.send(ok(result));
  });
}
