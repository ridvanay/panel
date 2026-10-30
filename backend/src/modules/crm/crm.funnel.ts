import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { istanbulDayRange } from "./crm.rollup";

/**
 * Paket N2 — hasta yolculuğu hunisi:
 *   ziyaret → doktor/uzmanlık sayfası → randevu sihirbazı başladı → randevu oluştu → ödendi → görüşme yapıldı
 *
 * İlk üç aşama `crm_sessions` (oturumun başladığı gün aralığa göre), son üç aşama `crm_attributions`
 * (randevunun oturum düzeyindeki anlık atfı) + `appointment_bookings` (ödeme durumu ve tutarı) +
 * `appointments` (COMPLETED) üzerinden hesaplanır. Arşivlenmiş (test) randevular hariçtir. Ciro yalnızca
 * `paymentStatus = PAID` randevuların `totalCents` toplamıdır, para birimine göre ayrı tutulur.
 * İlk/son temas: oturum aşamalarında ziyaretçinin İLK kaynağı ya da oturumun kaynağı; randevu
 * aşamalarında atıftaki ilk (first) / son (last) kaynak alanları.
 */
export const FunnelQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  model: z.enum(["first", "last"]).default("last"),
  groupBy: z.enum(["none", "source", "campaign", "country", "language", "device", "doctor"]).default("source"),
});

export type FunnelQuery = z.infer<typeof FunnelQuerySchema>;

export interface FunnelRow {
  key: string;
  label: string;
  visits: number;
  doctorPage: number;
  bookingStarted: number;
  bookings: number;
  paid: number;
  consulted: number;
  revenue: Record<string, number>;
  conversionRate: number;
}

function sessionKey(groupBy: FunnelQuery["groupBy"], model: FunnelQuery["model"]): string {
  const src = model === "first" ? `COALESCE(v."firstSource", s."source")` : `s."source"`;
  const med = model === "first" ? `COALESCE(v."firstMedium", s."medium")` : `s."medium"`;
  const camp = model === "first" ? `v."firstCampaign"` : `s."campaign"`;
  switch (groupBy) {
    case "none":
      return `'all'`;
    case "source":
      return `${src} || ' / ' || ${med}`;
    case "campaign":
      return `COALESCE(${camp}, '(kampanya yok)')`;
    case "country":
      return `COALESCE(s."country", 'UNKNOWN')`;
    case "language":
      return `COALESCE(NULLIF(lower(split_part(s."language", '-', 1)), ''), 'unknown')`;
    case "device":
      return `s."deviceType"::text`;
    default:
      return `'all'`;
  }
}

function attributionKey(groupBy: FunnelQuery["groupBy"], model: FunnelQuery["model"]): string {
  const src = model === "first" ? `COALESCE(a."firstSource", a."lastSource")` : `a."lastSource"`;
  const med = model === "first" ? `COALESCE(a."firstMedium", a."lastMedium")` : `a."lastMedium"`;
  const camp = model === "first" ? `a."firstCampaign"` : `a."lastCampaign"`;
  switch (groupBy) {
    case "none":
      return `'all'`;
    case "source":
      return `${src} || ' / ' || ${med}`;
    case "campaign":
      return `COALESCE(${camp}, '(kampanya yok)')`;
    case "country":
      return `COALESCE(a."country", 'UNKNOWN')`;
    case "language":
      return `COALESCE(NULLIF(lower(split_part(a."language", '-', 1)), ''), 'unknown')`;
    case "device":
      return `a."deviceType"::text`;
    case "doctor":
      return `d."slug"`;
  }
}

interface SessionAgg {
  k: string | null;
  visits: number;
  doctor_page: number;
  booking_started: number;
}

interface BookingAgg {
  k: string | null;
  currency: string;
  bookings: number;
  paid: number;
  consulted: number;
  revenue: number;
}

export async function computeFunnel(app: FastifyInstance, query: FunnelQuery): Promise<{ rows: FunnelRow[]; total: FunnelRow }> {
  const start = istanbulDayRange(query.from).start;
  const end = istanbulDayRange(query.to).end;

  const sessionSql =
    query.groupBy === "doctor"
      ? `SELECT substring(e."path" from '/(?:physicians|doctors)/([^/]+)') AS k,
            COUNT(DISTINCT s."id")::int AS visits,
            COUNT(DISTINCT s."id")::int AS doctor_page,
            (COUNT(DISTINCT s."id") FILTER (WHERE s."bookingStarted"))::int AS booking_started
         FROM "crm_events" e
         JOIN "crm_sessions" s ON s."id" = e."sessionId"
         WHERE NOT s."botFlagged" AND e."type" = 'PAGEVIEW' AND e."path" ~ '/(physicians|doctors)/[^/]+'
           AND s."startedAt" >= $1::timestamp AND s."startedAt" < $2::timestamp
         GROUP BY 1`
      : `SELECT ${sessionKey(query.groupBy, query.model)} AS k,
            COUNT(*)::int AS visits,
            (COUNT(*) FILTER (WHERE s."reachedDoctorPage"))::int AS doctor_page,
            (COUNT(*) FILTER (WHERE s."bookingStarted"))::int AS booking_started
         FROM "crm_sessions" s
         JOIN "crm_visitors" v ON v."id" = s."visitorId"
         WHERE NOT s."botFlagged" AND s."startedAt" >= $1::timestamp AND s."startedAt" < $2::timestamp
         GROUP BY 1`;

  const bookingSql = `
    SELECT ${attributionKey(query.groupBy, query.model)} AS k,
      b."currency" AS currency,
      COUNT(*)::int AS bookings,
      (COUNT(*) FILTER (WHERE b."paymentStatus" = 'PAID'))::int AS paid,
      (COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM "appointments" ap WHERE ap."bookingId" = b."id" AND ap."status" = 'COMPLETED'
      )))::int AS consulted,
      COALESCE(SUM(b."totalCents") FILTER (WHERE b."paymentStatus" = 'PAID'), 0)::bigint AS revenue
    FROM "crm_attributions" a
    JOIN "appointment_bookings" b ON b."id" = a."bookingId"
    LEFT JOIN "doctor_profiles" d ON d."id" = b."doctorId"
    WHERE b."archivedAt" IS NULL AND a."createdAt" >= $1::timestamp AND a."createdAt" < $2::timestamp
    GROUP BY 1, 2`;

  const [sessionRows, bookingRows] = await Promise.all([
    app.prisma.$queryRawUnsafe<SessionAgg[]>(sessionSql, start.toISOString(), end.toISOString()),
    app.prisma.$queryRawUnsafe<BookingAgg[]>(bookingSql, start.toISOString(), end.toISOString()),
  ]);

  const rows = new Map<string, FunnelRow>();
  const ensure = (key: string): FunnelRow => {
    let row = rows.get(key);
    if (!row) {
      row = { key, label: key, visits: 0, doctorPage: 0, bookingStarted: 0, bookings: 0, paid: 0, consulted: 0, revenue: {}, conversionRate: 0 };
      rows.set(key, row);
    }
    return row;
  };
  for (const r of sessionRows) {
    const row = ensure(r.k ?? "(bilinmiyor)");
    row.visits += Number(r.visits);
    row.doctorPage += Number(r.doctor_page);
    row.bookingStarted += Number(r.booking_started);
  }
  for (const r of bookingRows) {
    const row = ensure(r.k ?? "(bilinmiyor)");
    row.bookings += Number(r.bookings);
    row.paid += Number(r.paid);
    row.consulted += Number(r.consulted);
    const revenue = Number(r.revenue);
    if (revenue > 0) row.revenue[r.currency] = (row.revenue[r.currency] ?? 0) + revenue;
  }

  if (query.groupBy === "doctor") {
    const slugs = [...rows.keys()];
    const doctors = await app.prisma.doctorProfile.findMany({ where: { slug: { in: slugs } }, select: { slug: true, title: true, fullName: true } });
    for (const d of doctors) rows.get(d.slug)!.label = `${d.title} ${d.fullName}`;
  }

  const total: FunnelRow = { key: "total", label: "Toplam", visits: 0, doctorPage: 0, bookingStarted: 0, bookings: 0, paid: 0, consulted: 0, revenue: {}, conversionRate: 0 };
  for (const row of rows.values()) {
    row.conversionRate = row.visits > 0 ? Math.round((row.paid / row.visits) * 10_000) / 100 : 0;
    total.visits += row.visits;
    total.doctorPage += row.doctorPage;
    total.bookingStarted += row.bookingStarted;
    total.bookings += row.bookings;
    total.paid += row.paid;
    total.consulted += row.consulted;
    for (const [currency, cents] of Object.entries(row.revenue)) total.revenue[currency] = (total.revenue[currency] ?? 0) + cents;
  }
  // Doktor kırılımında aynı oturum birden çok doktora bakmış olabilir — toplam "ziyaret" doktor sayfası görüntüleyen oturumların toplamıdır.
  total.conversionRate = total.visits > 0 ? Math.round((total.paid / total.visits) * 10_000) / 100 : 0;

  const sorted = [...rows.values()].sort((a, b) => b.paid - a.paid || b.bookings - a.bookings || b.visits - a.visits);
  return { rows: sorted, total };
}
