import type { FastifyInstance } from "fastify";
import { env } from "../../config/env";
import { CRM_HEARTBEAT_SECONDS } from "./crm.collect";
import { readCrmSettings } from "./crm.settings";
import { anonymizeExpiredLeads, CRM_LEAD_INGEST_INTERVAL_MS, runLeadIngest } from "./crm.leads";
import { pruneSearchConsoleRows, syncSearchConsole } from "./crm.google";

/**
 * Paket N1 — günlük özet (`crm_daily_rollups`) ve saklama süresi temizliği.
 *
 * Gün sınırı Europe/Istanbul (UTC+3, yaz saati yok). Özet işi her 15 dakikada BUGÜN ve DÜN için yeniden
 * hesaplanır (gün satırları silinip yeniden yazılır → idempotent); açılışta son 3 gün. Panel bu tablodan
 * okur; "Şu an sitede" ve ziyaretçi detayı/ısı haritası ham tablodan okur.
 */
export const CRM_ROLLUP_INTERVAL_MS = 15 * 60 * 1000;
export const CRM_RETENTION_INTERVAL_MS = 60 * 60 * 1000;
/** Kişisel veri içermeyen özetlerin saklama süresi. */
export const CRM_ROLLUP_RETENTION_DAYS = 730;
/** Onay kayıtları (ispat yükümlülüğü) — 3 yıl. */
export const CRM_CONSENT_RETENTION_DAYS = 1095;
/** gclid/gbraid/wbraid — Google Ads çevrimdışı dönüşüm penceresi. */
export const CRM_AD_CLICK_ID_RETENTION_DAYS = 90;

const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` (İstanbul takvim günü). */
export function istanbulDate(at: Date = new Date()): string {
  return new Date(at.getTime() + ISTANBUL_OFFSET_MS).toISOString().slice(0, 10);
}

/** İstanbul gününün UTC aralığı `[start, end)`. */
export function istanbulDayRange(date: string): { start: Date; end: Date } {
  const start = new Date(Date.parse(`${date}T00:00:00.000Z`) - ISTANBUL_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

interface DimensionDef {
  name: string;
  /** Olay satırı (`e`) + oturum (`s`) üzerinden anahtar. NULL anahtarlı satırlar atılır. */
  keyExpr: string;
  /** Giriş (açılış) sayısının anahtarı — oturum (`s`) üzerinden; `null` = giriş hesaplanmaz. */
  entryKeyExpr: string | null;
}

const DIMENSIONS: DimensionDef[] = [
  { name: "total", keyExpr: `''`, entryKeyExpr: `''` },
  {
    name: "source",
    keyExpr: `s."source" || '|' || s."medium" || '|' || COALESCE(s."campaign", '')`,
    entryKeyExpr: `s."source" || '|' || s."medium" || '|' || COALESCE(s."campaign", '')`,
  },
  { name: "page", keyExpr: `e."path"`, entryKeyExpr: `s."landingPath"` },
  { name: "country", keyExpr: `COALESCE(s."country", 'UNKNOWN')`, entryKeyExpr: `COALESCE(s."country", 'UNKNOWN')` },
  {
    name: "language",
    keyExpr: `COALESCE(NULLIF(lower(split_part(s."language", '-', 1)), ''), 'unknown')`,
    entryKeyExpr: `COALESCE(NULLIF(lower(split_part(s."language", '-', 1)), ''), 'unknown')`,
  },
  { name: "timezone", keyExpr: `COALESCE(s."timezone", 'unknown')`, entryKeyExpr: `COALESCE(s."timezone", 'unknown')` },
  { name: "device", keyExpr: `s."deviceType"::text`, entryKeyExpr: `s."deviceType"::text` },
  // Paket T — dil öneki `/tr` ya da `/sr-latn` olabilir.
  { name: "doctor", keyExpr: `substring(e."path" from '^(?:/[a-z]{2}(?:-[a-z]{4})?)?/doctors/([^/]+)')`, entryKeyExpr: null },
  { name: "specialty", keyExpr: `substring(e."path" from '^(?:/[a-z]{2}(?:-[a-z]{4})?)?/specialties/([^/]+)')`, entryKeyExpr: null },
];

const METRICS_SELECT = `
  COUNT(DISTINCT e."visitorId")::int,
  COUNT(DISTINCT e."sessionId")::int,
  (COUNT(*) FILTER (WHERE e."type" = 'PAGEVIEW'))::int,
  COALESCE(MAX(en."entries"), 0)::int,
  ((COUNT(*) FILTER (WHERE e."type" = 'HEARTBEAT')) * ${CRM_HEARTBEAT_SECONDS})::int,
  COALESCE(SUM(e."scrollPct") FILTER (WHERE e."type" = 'SCROLL'), 0)::int,
  (COUNT(*) FILTER (WHERE e."type" = 'SCROLL' AND e."scrollPct" IS NOT NULL))::int,
  (COUNT(*) FILTER (WHERE e."type" = 'CLICK'))::int,
  (COUNT(*) FILTER (WHERE e."type" = 'WHATSAPP_CLICK'))::int,
  (COUNT(*) FILTER (WHERE e."type" = 'PHONE_CLICK'))::int,
  (COUNT(*) FILTER (WHERE e."type" = 'EMAIL_CLICK'))::int,
  (COUNT(*) FILTER (WHERE e."type" IN ('WHATSAPP_CLICK', 'PHONE_CLICK', 'EMAIL_CLICK')))::int,
  (COUNT(DISTINCT e."sessionId") FILTER (WHERE e."type" = 'BOOKING_STEP'))::int`;

const INSERT_COLUMNS = `("id", "date", "dimension", "key", "label", "visitors", "sessions", "pageviews", "entries", "engagedSeconds",
  "scrollSum", "scrollCount", "clicks", "whatsappClicks", "phoneClicks", "emailClicks", "contacts", "bookingsStarted")`;

function dimensionSql(def: DimensionDef): string {
  const entriesJoin = def.entryKeyExpr
    ? `LEFT JOIN (
         SELECT LEFT((${def.entryKeyExpr}), 300) AS k, COUNT(*) AS "entries"
         FROM "crm_sessions" s
         WHERE NOT s."botFlagged" AND s."startedAt" >= $2::timestamp AND s."startedAt" < $3::timestamp
         GROUP BY 1
       ) en ON en.k = e.k`
    : `LEFT JOIN (SELECT NULL::text AS k, 0 AS "entries") en ON FALSE`;
  return `
    INSERT INTO "crm_daily_rollups" ${INSERT_COLUMNS}
    SELECT gen_random_uuid(), $1::date, '${def.name}', LEFT(e.k, 300), NULL, ${METRICS_SELECT}
    FROM (
      SELECT LEFT((${def.keyExpr}), 300) AS k, e.*
      FROM "crm_events" e
      JOIN "crm_sessions" s ON s."id" = e."sessionId"
      WHERE NOT s."botFlagged" AND e."occurredAt" >= $2::timestamp AND e."occurredAt" < $3::timestamp
    ) e
    ${entriesJoin}
    WHERE e.k IS NOT NULL
    GROUP BY e.k`;
}

/** Temastan (WhatsApp/telefon/e-posta) önce aynı oturumda okunan sayfalar. */
const PRE_CONTACT_SQL = `
  INSERT INTO "crm_daily_rollups" ${INSERT_COLUMNS}
  SELECT gen_random_uuid(), $1::date, 'prePage', LEFT(e."path", 300), NULL,
    COUNT(DISTINCT e."visitorId")::int, COUNT(DISTINCT e."sessionId")::int, COUNT(*)::int, 0, 0, 0, 0, 0, 0, 0, 0,
    COUNT(DISTINCT e."sessionId")::int, 0
  FROM "crm_events" e
  JOIN (
    SELECT c."sessionId", MIN(c."occurredAt") AS t
    FROM "crm_events" c
    JOIN "crm_sessions" s ON s."id" = c."sessionId"
    WHERE NOT s."botFlagged" AND c."type" IN ('WHATSAPP_CLICK', 'PHONE_CLICK', 'EMAIL_CLICK')
      AND c."occurredAt" >= $2::timestamp AND c."occurredAt" < $3::timestamp
    GROUP BY c."sessionId"
  ) fc ON fc."sessionId" = e."sessionId"
  WHERE e."type" = 'PAGEVIEW' AND e."occurredAt" <= fc.t
  GROUP BY e."path"`;

/** Tıklanan öğeler: yol + seçici + metin + hedef birlikte anahtar (md5), ayrıntı `label` JSON'unda. */
const CLICK_SQL = `
  INSERT INTO "crm_daily_rollups" ${INSERT_COLUMNS}
  SELECT gen_random_uuid(), $1::date, 'click',
    md5(e."path" || '|' || COALESCE(e."selector", '') || '|' || COALESCE(e."text", '') || '|' || COALESCE(e."target", '')),
    json_build_object('path', e."path", 'selector', e."selector", 'text', e."text", 'target', e."target")::text,
    COUNT(DISTINCT e."visitorId")::int, COUNT(DISTINCT e."sessionId")::int, 0, 0, 0, 0, 0,
    COUNT(*)::int,
    (COUNT(*) FILTER (WHERE e."type" = 'WHATSAPP_CLICK'))::int,
    (COUNT(*) FILTER (WHERE e."type" = 'PHONE_CLICK'))::int,
    (COUNT(*) FILTER (WHERE e."type" = 'EMAIL_CLICK'))::int,
    (COUNT(*) FILTER (WHERE e."type" IN ('WHATSAPP_CLICK', 'PHONE_CLICK', 'EMAIL_CLICK')))::int,
    0
  FROM "crm_events" e
  JOIN "crm_sessions" s ON s."id" = e."sessionId"
  WHERE NOT s."botFlagged" AND e."type" IN ('CLICK', 'WHATSAPP_CLICK', 'PHONE_CLICK', 'EMAIL_CLICK')
    AND e."occurredAt" >= $2::timestamp AND e."occurredAt" < $3::timestamp
  GROUP BY e."path", e."selector", e."text", e."target"`;

/** Bir İstanbul gününün bütün özet satırlarını yeniden hesaplar (sil + yaz, tek transaction). */
export async function runCrmRollupForDate(app: FastifyInstance, date: string): Promise<number> {
  const { start, end } = istanbulDayRange(date);
  return app.prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`DELETE FROM "crm_daily_rollups" WHERE "date" = ${date}::date`;
      let inserted = 0;
      // Zaman parametreleri ISO metni + `::timestamp` — veritabanı oturum saat diliminden bağımsız (kolonlar UTC, tz'siz).
      const [s, e] = [start.toISOString(), end.toISOString()];
      for (const def of DIMENSIONS) inserted += await tx.$executeRawUnsafe(dimensionSql(def), date, s, e);
      inserted += await tx.$executeRawUnsafe(PRE_CONTACT_SQL, date, s, e);
      inserted += await tx.$executeRawUnsafe(CLICK_SQL, date, s, e);
      return inserted;
    },
    { timeout: 60_000 }
  );
}

export interface CrmRetentionResult {
  deletedVisitors: number;
  deletedSessions: number;
  deletedEvents: number;
  deletedRollups: number;
  deletedConsents: number;
  deletedAttributions: number;
}

/** Saklama süresi: ham ziyaret verisi `retentionDays`, özet 730 gün, onay 3 yıl, atıf `leadRetentionDays`. */
export async function runCrmRetentionSweep(app: FastifyInstance, now: Date = new Date()): Promise<CrmRetentionResult> {
  const settings = await readCrmSettings(app.prisma);
  const rawCutoff = new Date(now.getTime() - settings.retentionDays * DAY_MS);
  const visitors = await app.prisma.crmVisitor.deleteMany({ where: { lastSeenAt: { lt: rawCutoff } } });
  const sessions = await app.prisma.crmSession.deleteMany({ where: { startedAt: { lt: rawCutoff } } });
  // Olaylar 10.000'lik parçalar hâlinde silinir (saklama süresi kısaltıldığında tek dev transaction olmasın).
  let deletedEvents = 0;
  for (;;) {
    const n = await app.prisma.$executeRaw`DELETE FROM "crm_events" WHERE "id" IN (SELECT "id" FROM "crm_events" WHERE "occurredAt" < ${rawCutoff.toISOString()}::timestamp LIMIT 10000)`;
    deletedEvents += n;
    if (n < 10000) break;
  }
  const rollups = await app.prisma.crmDailyRollup.deleteMany({
    where: { date: { lt: new Date(now.getTime() - CRM_ROLLUP_RETENTION_DAYS * DAY_MS) } },
  });
  const consents = await app.prisma.crmConsent.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - CRM_CONSENT_RETENTION_DAYS * DAY_MS) } },
  });
  const attributions = await app.prisma.crmAttribution.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - settings.leadRetentionDays * DAY_MS) } },
  });
  // Reklam tıklama kimlikleri 90 gün sonra boşaltılır (Google Ads çevrimdışı dönüşüm penceresi bu kadar).
  const adCutoff = new Date(now.getTime() - CRM_AD_CLICK_ID_RETENTION_DAYS * DAY_MS);
  const adIds = { gclid: null, gbraid: null, wbraid: null };
  const hasAdId = [{ gclid: { not: null } }, { gbraid: { not: null } }, { wbraid: { not: null } }];
  await app.prisma.crmSession.updateMany({ where: { startedAt: { lt: adCutoff }, OR: hasAdId }, data: adIds });
  await app.prisma.crmAttribution.updateMany({ where: { createdAt: { lt: adCutoff }, OR: hasAdId }, data: adIds });
  await app.prisma.crmLead.updateMany({ where: { createdAt: { lt: adCutoff }, gclid: { not: null } }, data: { gclid: null } });
  return {
    deletedVisitors: visitors.count,
    deletedSessions: sessions.count,
    deletedEvents,
    deletedRollups: rollups.count,
    deletedConsents: consents.count,
    deletedAttributions: attributions.count,
  };
}

/** Ek temizlik adımları (N2 talep anonimleştirme vb.) buraya kaydolur — tek zamanlayıcı. */
const extraRetentionSteps: ((app: FastifyInstance, now: Date) => Promise<unknown>)[] = [];
export function registerCrmRetentionStep(step: (app: FastifyInstance, now: Date) => Promise<unknown>): void {
  extraRetentionSteps.push(step);
}

/**
 * Süreç içi zamanlayıcılar (`support-retention.ts` deseni). Test ortamında KURULMAZ: arka plandaki
 * yeniden hesaplama, testlerin `TRUNCATE`'i ile çakışıp kilitlenme üretebilir; testler fonksiyonları
 * doğrudan çağırır.
 */
export function registerCrmSchedulers(app: FastifyInstance): void {
  if (env.NODE_ENV === "test") return;

  const rollup = (days: number) => {
    const today = istanbulDate();
    const dates = Array.from({ length: days }, (_, i) => shiftDate(today, -i));
    (async () => {
      for (const date of dates) await runCrmRollupForDate(app, date);
    })().catch((err) => app.log.error({ err }, "CRM günlük özet hesaplaması başarısız oldu"));
  };
  const retention = () => {
    (async () => {
      await runCrmRetentionSweep(app);
      await anonymizeExpiredLeads(app);
      await pruneSearchConsoleRows(app);
      for (const step of extraRetentionSteps) await step(app, new Date());
    })().catch((err) => app.log.error({ err }, "CRM saklama süresi temizliği başarısız oldu"));
  };

  const leadIngest = () => {
    runLeadIngest(app).catch((err) => app.log.error({ err }, "CRM talep içe alma başarısız oldu"));
  };

  // Search Console: bağlıysa ve son senkron 20 saatten eskiyse (6 saatte bir kontrol) — günde bir senkron.
  const searchConsole = () => {
    (async () => {
      const sc = (await readCrmSettings(app.prisma)).searchConsole;
      if (!sc.credentialsCiphertext) return;
      if (sc.lastSyncAt && Date.now() - Date.parse(sc.lastSyncAt) < 20 * 3_600_000) return;
      await syncSearchConsole(app);
    })().catch((err) => app.log.error({ err }, "Search Console zamanlanmış senkronu başarısız oldu"));
  };

  rollup(3);
  retention();
  leadIngest();
  searchConsole();
  const rollupTimer = setInterval(() => rollup(2), CRM_ROLLUP_INTERVAL_MS);
  const retentionTimer = setInterval(retention, CRM_RETENTION_INTERVAL_MS);
  const leadTimer = setInterval(leadIngest, CRM_LEAD_INGEST_INTERVAL_MS);
  leadTimer.unref();
  const searchConsoleTimer = setInterval(searchConsole, 6 * 3_600_000);
  searchConsoleTimer.unref();
  rollupTimer.unref();
  retentionTimer.unref();
  app.addHook("onClose", () => {
    clearInterval(rollupTimer);
    clearInterval(retentionTimer);
    clearInterval(leadTimer);
    clearInterval(searchConsoleTimer);
  });
}

