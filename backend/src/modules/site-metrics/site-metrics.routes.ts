import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { SITE_METRICS_RATE_LIMIT } from "../../lib/rate-limit";
import { COORDINATOR_ROLES, SERVICE_DESK_ID } from "../service-consultations/service-desk";

/**
 * Paket AK (K2) - ana sayfa sayac seridi icin canli sayilar. Kisisel veri YOK; yalniz toplamlar.
 * Hesaplanamayan kalem `null` doner (istemci o ogeyi gostermez). 60 sn onbellek.
 */
export const SiteMetricsSchema = z.object({
  activeServices: z.number().int().nullable(),
  visitorLanguages: z.number().int().nullable(),
  activeCoordinators: z.number().int().nullable(),
  consultationMinutes: z.number().int().nullable(),
});
export type SiteMetricsDto = z.infer<typeof SiteMetricsSchema>;

const positiveOrNull = (n: number | null | undefined): number | null => (typeof n === "number" && n > 0 ? n : null);

export async function computeSiteMetrics(app: FastifyInstance): Promise<SiteMetricsDto> {
  const [activeServices, locales, activeCoordinators, desk] = await Promise.all([
    // Aktif UST hizmet: parentId null + aktif (alt hizmetler sayilmaz).
    app.prisma.specialty.count({ where: { isActive: true, parentId: null } }),
    // Ziyaretci dilleri: etkin site dilleri; Turkce ziyaretciye kapali oldugu icin `tr` sayilmaz.
    app.prisma.locale.count({ where: { enabled: true, code: { not: "tr" } } }),
    // Uygun koordinator (AI3 kurali): profil aktif + kullanici ACTIVE + doktor profili yok + EDITOR/MANAGER.
    app.prisma.coordinatorProfile.count({ where: { isActive: true, user: { status: "ACTIVE", doctorProfile: null, role: { in: [...COORDINATOR_ROLES] } } } }),
    app.prisma.serviceDesk.findUnique({ where: { id: SERVICE_DESK_ID }, select: { durationMin: true } }),
  ]);
  return {
    activeServices: positiveOrNull(activeServices),
    visitorLanguages: positiveOrNull(locales),
    activeCoordinators: positiveOrNull(activeCoordinators),
    consultationMinutes: positiveOrNull(desk?.durationMin),
  };
}

const CACHE_TTL_MS = 60_000;
let cached: { at: number; value: SiteMetricsDto } | null = null;

/** Test yardimcisi: modul duzeyindeki 60 sn bellek ici onbellegi sifirlar. */
export function resetSiteMetricsCache(): void {
  cached = null;
}

/** Tek degerlik 60 sn bellek ici onbellek (DB'ye her istekte sayim yapilmaz). */
async function getSiteMetricsCached(app: FastifyInstance): Promise<SiteMetricsDto> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;
  const value = await computeSiteMetrics(app);
  cached = { at: now, value };
  return value;
}

/** `/public/site-metrics` prefix'i altinda baglanir - herkese acik. */
export async function publicSiteMetricsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.get("/", { config: { rateLimit: SITE_METRICS_RATE_LIMIT }, schema: { response: { 200: ApiSuccessSchema(SiteMetricsSchema) } } }, async (_request, reply) => {
    const data = await getSiteMetricsCached(app);
    reply.header("Cache-Control", "public, max-age=60, s-maxage=60");
    return reply.send(ok(data));
  });
}
