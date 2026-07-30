import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { authenticate } from "../../middleware/authenticate";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { SiteSettingsSchema } from "../../schemas/entities";
import { toSiteSettingsDto } from "../../mappers";
import { UpdateSiteSettingsRequestSchema } from "./settings.schemas";

const SETTINGS_ID = "singleton";
const DEFAULTS = { siteName: "Site", logoUrl: null as string | null };

async function readSettings(app: FastifyInstance) {
  const row = await app.prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID } });
  return row ? toSiteSettingsDto(row) : DEFAULTS;
}

/** `/settings` prefix'i altında bağlanır — herkese açık, site header/nav'ı bunu okur. */
export async function publicSettingsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get("/", { schema: { response: { 200: ApiSuccessSchema(SiteSettingsSchema) } } }, async (_request, reply) => {
    return reply.send(ok(await readSettings(app)));
  });
}

/** `/admin/settings` prefix'i altında bağlanır — authenticated. */
export async function adminSettingsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", authenticate);

  server.get("/", { schema: { response: { 200: ApiSuccessSchema(SiteSettingsSchema) } } }, async (_request, reply) => {
    return reply.send(ok(await readSettings(app)));
  });

  server.patch(
    "/",
    { schema: { body: UpdateSiteSettingsRequestSchema, response: { 200: ApiSuccessSchema(SiteSettingsSchema) } } },
    async (request, reply) => {
      const settings = await app.prisma.siteSettings.upsert({
        where: { id: SETTINGS_ID },
        create: { id: SETTINGS_ID, ...DEFAULTS, ...request.body },
        update: request.body,
      });
      return reply.send(ok(toSiteSettingsDto(settings)));
    }
  );
}
