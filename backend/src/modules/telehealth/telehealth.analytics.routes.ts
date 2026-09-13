import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { authenticate } from "../../middleware/authenticate";
import { requireSiteRole } from "../../middleware/site-rbac";
import { requireModuleEnabled } from "../../middleware/module-guard";
import { ROLES_ADMIN_MANAGER } from "../../lib/site-roles";
import { ok } from "../../lib/envelope";
import { ApiSuccessSchema } from "../../schemas/common";
import { TelehealthOverviewSchema } from "../../schemas/entities";
import { resolveStatsRange, type DateRange } from "../../lib/stats-query";
import { addUtcDays, bucketDateKey, startOfUtcMonth, startOfUtcWeek, toDateKey, type StatsGranularity } from "../../lib/date";
import { env } from "../../config/env";
import { TelehealthOverviewQuerySchema } from "./telehealth.schemas";

/**
 * [TCT] §9.7.7 KARAR K10a — `range.from/to/toExclusive` UTC gece yarısına yuvarlanmıştır (bkz.
 * `resolveStatsRange`); `series` boş bucket'ları SIFIRLA doldurmak için ihtiyaç duyulan TÜM
 * bucket anahtarlarını (granularity'ye göre) baştan sona ÜRETİR — `getViewsSeries`'in yalnızca
 * `day` için yaptığını `week`/`month` için de yapar (bkz. lib/stats-query.ts::getViewsSeries).
 */
function enumerateBucketKeys(range: DateRange, granularity: StatsGranularity): string[] {
  if (granularity === "day") {
    const keys: string[] = [];
    for (let i = 0; i < range.days; i++) {
      keys.push(toDateKey(addUtcDays(range.from, i)));
    }
    return keys;
  }

  if (granularity === "week") {
    const keys: string[] = [];
    let cursor = startOfUtcWeek(range.from);
    const endKey = bucketDateKey(range.to, "week");
    // Üst sınır 366 gün (`STATS_MAX_RANGE_DAYS`) — en fazla ~53 haftalık bucket, sonsuz döngü riski YOK.
    while (true) {
      const key = toDateKey(cursor);
      keys.push(key);
      if (key === endKey) break;
      cursor = addUtcDays(cursor, 7);
    }
    return keys;
  }

  const keys: string[] = [];
  let cursor = startOfUtcMonth(range.from);
  const endKey = bucketDateKey(range.to, "month");
  // Üst sınır 366 gün — en fazla ~13 aylık bucket.
  while (true) {
    const key = toDateKey(cursor);
    keys.push(key);
    if (key === endKey) break;
    const next = new Date(cursor);
    next.setUTCMonth(next.getUTCMonth() + 1);
    cursor = next;
  }
  return keys;
}

interface CurrencyRevenueRow {
  currency: string;
  count: bigint;
  gross_cents: bigint;
  commission_cents: bigint;
}

interface SeriesRow {
  bucket: Date;
  completed_count: bigint;
  cancelled_count: bigint;
  gross_cents: bigint;
  commission_cents: bigint;
}

interface DoctorRow {
  doctor_id: string;
  title: string;
  full_name: string;
  slug: string;
  completed_count: bigint;
  cancelled_count: bigint;
  gross_cents: bigint;
  commission_cents: bigint;
}

/**
 * `/admin/telehealth/analytics` prefix'i altında bağlanır (bkz. app.ts) — YENİ YÜZEY, YENİ DOSYA
 * deseni (`telehealth.livekit.routes.ts`/`telehealth.checkout.routes.ts` İLE AYNI disiplin,
 * `telehealth.admin.routes.ts`'e DOKUNULMAZ). Salt-okunur, hasta PII'si TAŞIMAZ (yalnızca
 * toplulaştırılmış sayı/tutar) ama yine de `adminTelehealthAppointmentsRoutes` İLE AYNI eşik
 * (ADMIN+MANAGER, EDITOR dışlanır) — mali/iş verisi.
 */
export async function adminTelehealthAnalyticsRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  server.addHook("preHandler", requireModuleEnabled("telehealth"));
  server.addHook("preHandler", authenticate);
  server.addHook("preHandler", requireSiteRole(...ROLES_ADMIN_MANAGER));

  server.get(
    "/overview",
    {
      schema: {
        querystring: TelehealthOverviewQuerySchema,
        response: { 200: ApiSuccessSchema(TelehealthOverviewSchema) },
      },
    },
    async (request, reply) => {
      const { granularity } = request.query;
      // `resolveStatsRange` `days`'i DE kabul eder ama bu uç yalnızca `from`/`to` sunar — `days`
      // parametresi HİÇ geçirilmez, varsayılan (son 30 gün) devreye girer.
      const range = resolveStatsRange({ from: request.query.from, to: request.query.to });
      const rate = env.PLATFORM_COMMISSION_RATE_PERCENT;

      const [statusRows, bookingRows, currencyRows, seriesRows, doctorRows] = await Promise.all([
        app.prisma.appointment.groupBy({
          by: ["status"],
          where: { startsAt: { gte: range.from, lt: range.toExclusive } },
          _count: { _all: true },
        }),
        app.prisma.appointmentBooking.groupBy({
          by: ["paymentStatus"],
          where: { createdAt: { gte: range.from, lt: range.toExclusive } },
          _count: { _all: true },
        }),
        // Aralıktaki COMPLETED randevuların para birimi dağılımı + toplam gross/commission —
        // §10.8.10 disiplini: in-memory toplama YASAK, satır bazında yuvarlama Postgres `round()`
        // ile yapılır (`splitCommission` İLE AYNI tanım, bkz. lib/commission.ts).
        app.prisma.$queryRaw<CurrencyRevenueRow[]>`
          SELECT currency,
                 COUNT(*)::bigint AS count,
                 COALESCE(SUM("priceCents"), 0)::bigint AS gross_cents,
                 COALESCE(SUM(round("priceCents" * ${rate}::numeric / 100)), 0)::bigint AS commission_cents
          FROM "appointments"
          WHERE status = 'COMPLETED' AND "startsAt" >= ${range.from} AND "startsAt" < ${range.toExclusive}
          GROUP BY currency
        `,
        app.prisma.$queryRaw<SeriesRow[]>`
          SELECT date_trunc(${granularity}, "startsAt") AS bucket,
                 COUNT(*) FILTER (WHERE status = 'COMPLETED')::bigint AS completed_count,
                 COUNT(*) FILTER (WHERE status = 'CANCELLED')::bigint AS cancelled_count,
                 COALESCE(SUM("priceCents") FILTER (WHERE status = 'COMPLETED'), 0)::bigint AS gross_cents,
                 COALESCE(SUM(round("priceCents" * ${rate}::numeric / 100)) FILTER (WHERE status = 'COMPLETED'), 0)::bigint AS commission_cents
          FROM "appointments"
          WHERE "startsAt" >= ${range.from} AND "startsAt" < ${range.toExclusive}
          GROUP BY bucket
          ORDER BY bucket ASC
        `,
        app.prisma.$queryRaw<DoctorRow[]>`
          SELECT a."doctorId" AS doctor_id, d.title AS title, d."fullName" AS full_name, d.slug AS slug,
                 COUNT(*) FILTER (WHERE a.status = 'COMPLETED')::bigint AS completed_count,
                 COUNT(*) FILTER (WHERE a.status = 'CANCELLED')::bigint AS cancelled_count,
                 COALESCE(SUM(a."priceCents") FILTER (WHERE a.status = 'COMPLETED'), 0)::bigint AS gross_cents,
                 COALESCE(SUM(round(a."priceCents" * ${rate}::numeric / 100)) FILTER (WHERE a.status = 'COMPLETED'), 0)::bigint AS commission_cents
          FROM "appointments" a
          JOIN "doctor_profiles" d ON d.id = a."doctorId"
          WHERE a."startsAt" >= ${range.from} AND a."startsAt" < ${range.toExclusive}
          GROUP BY a."doctorId", d.title, d."fullName", d.slug
        `,
      ]);

      // ---- appointments (her status AYRI sayılır, gruplama YOK — sunum kararı frontend'e ait) ----
      const appointments = {
        total: 0,
        pendingPayment: 0,
        scheduled: 0,
        inProgress: 0,
        completed: 0,
        cancelled: 0,
        noShow: 0,
      };
      for (const row of statusRows) {
        const count = row._count._all;
        appointments.total += count;
        switch (row.status) {
          case "PENDING_PAYMENT":
            appointments.pendingPayment += count;
            break;
          case "SCHEDULED":
            appointments.scheduled += count;
            break;
          case "IN_PROGRESS":
            appointments.inProgress += count;
            break;
          case "COMPLETED":
            appointments.completed += count;
            break;
          case "CANCELLED":
            appointments.cancelled += count;
            break;
          case "NO_SHOW":
            appointments.noShow += count;
            break;
        }
      }

      // ---- bookings (`failed` = FAILED + EXPIRED toplamı) ----
      const bookings = { total: 0, paid: 0, pending: 0, failed: 0, refunded: 0 };
      for (const row of bookingRows) {
        const count = row._count._all;
        bookings.total += count;
        switch (row.paymentStatus) {
          case "PAID":
            bookings.paid += count;
            break;
          case "PENDING":
            bookings.pending += count;
            break;
          case "FAILED":
          case "EXPIRED":
            bookings.failed += count;
            break;
          case "REFUNDED":
            bookings.refunded += count;
            break;
        }
      }

      // ---- currency / mixedCurrency / revenue ----
      let currency = "TRY";
      let mixedCurrency = false;
      let grossCents = 0;
      let commissionCents = 0;
      let completedSessionCount = 0;
      if (currencyRows.length > 0) {
        mixedCurrency = currencyRows.length > 1;
        // Birden fazla para birimi varsa deterministik bir varsayılan gerekir — alfabetik
        // olarak İLK kod seçilir (frontend zaten `mixedCurrency: true` ile UYARILIR).
        currency = [...currencyRows].map((r) => r.currency).sort((a, b) => a.localeCompare(b))[0]!;
        for (const row of currencyRows) {
          grossCents += Number(row.gross_cents);
          commissionCents += Number(row.commission_cents);
          completedSessionCount += Number(row.count);
        }
      }
      const netCents = grossCents - commissionCents;

      // ---- series (boş bucket'lar SIFIRLA doldurulur) ----
      const bucketByKey = new Map<string, { completedCount: number; cancelledCount: number; grossCents: number; commissionCents: number }>();
      for (const key of enumerateBucketKeys(range, granularity)) {
        bucketByKey.set(key, { completedCount: 0, cancelledCount: 0, grossCents: 0, commissionCents: 0 });
      }
      for (const row of seriesRows) {
        const key = bucketDateKey(new Date(row.bucket), granularity);
        const bucket = bucketByKey.get(key) ?? { completedCount: 0, cancelledCount: 0, grossCents: 0, commissionCents: 0 };
        bucket.completedCount += Number(row.completed_count);
        bucket.cancelledCount += Number(row.cancelled_count);
        bucket.grossCents += Number(row.gross_cents);
        bucket.commissionCents += Number(row.commission_cents);
        bucketByKey.set(key, bucket);
      }
      const series = Array.from(bucketByKey.entries())
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([date, bucket]) => ({
          date,
          completedCount: bucket.completedCount,
          cancelledCount: bucket.cancelledCount,
          grossCents: bucket.grossCents,
          commissionCents: bucket.commissionCents,
          netCents: bucket.grossCents - bucket.commissionCents,
        }));

      // ---- doctors (netCents DESC, en fazla 20 satır) ----
      const doctors = doctorRows
        .map((row) => {
          const rowGrossCents = Number(row.gross_cents);
          const rowCommissionCents = Number(row.commission_cents);
          return {
            doctorId: row.doctor_id,
            title: row.title,
            fullName: row.full_name,
            slug: row.slug,
            completedCount: Number(row.completed_count),
            cancelledCount: Number(row.cancelled_count),
            grossCents: rowGrossCents,
            commissionCents: rowCommissionCents,
            netCents: rowGrossCents - rowCommissionCents,
          };
        })
        .sort((a, b) => b.netCents - a.netCents)
        .slice(0, 20);

      return reply.send(
        ok({
          from: toDateKey(range.from),
          to: toDateKey(range.to),
          granularity,
          currency,
          mixedCurrency,
          commissionRatePercent: rate,
          appointments,
          bookings,
          revenue: { grossCents, commissionCents, netCents, completedSessionCount },
          series,
          doctors,
        })
      );
    }
  );
}
