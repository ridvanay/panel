import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { parse as parseCsv } from "csv-parse/sync";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "../../lib/crypto";
import { readCrmSettings, writeCrmSettings, type CrmSettings } from "./crm.settings";
import { istanbulDate, istanbulDayRange, shiftDate } from "./crm.rollup";
import { normalizeEmail, normalizePhone, notifyNewLeads } from "./crm.leads";
import { sanitizeText } from "./crm.privacy";

/**
 * Paket N4 — Google entegrasyonları (altyapı; hesaplar henüz yok).
 *
 * Search Console: servis hesabı JSON'u admin Ayarlar'dan yüklenir, `lib/crypto.ts::encryptSecret`
 * (AES-256-GCM, `.env` `ENCRYPTION_KEY`) ile ŞİFRELİ saklanır; yanıtlarda yalnızca maskeli servis hesabı
 * e-postası döner. Token, servis hesabı JWT'si (RS256, Node `crypto`) ile alınır — yeni paket YOK. Günlük
 * senkron son 3 gün, ilk bağlantıda bir kerelik son 90 gün.
 *
 * Google Ads: API bağlantısı YOK, yalnızca dosya akışı — offline dönüşüm CSV'si (ödenen randevular +
 * "Tedavi Oldu" talepleri, yalnızca pazarlama onaylı gclid) ve lead form CSV içe aktarma.
 */

// --- Search Console: kimlik bilgisi ------------------------------------------------------------

export const ServiceAccountSchema = z
  .object({
    type: z.literal("service_account"),
    client_email: z.string().email().max(300),
    private_key: z.string().min(100).max(10_000).includes("PRIVATE KEY"),
    token_uri: z.string().url().optional(),
  })
  .passthrough();

export const ConnectSearchConsoleSchema = z
  .object({
    propertyUrl: z
      .string()
      .trim()
      .max(300)
      .regex(/^(sc-domain:[a-z0-9.-]+|https?:\/\/[^\s]+\/)$/i, "Mülk 'sc-domain:ornek.com' ya da 'https://ornek.com/' biçiminde olmalı."),
    credentialsJson: z.string().min(50).max(20_000),
  })
  .strict();

export function parseServiceAccount(json: string) {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = ServiceAccountSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function connectSearchConsole(app: FastifyInstance, input: z.infer<typeof ConnectSearchConsoleSchema>, actorId: string): Promise<CrmSettings | null> {
  const account = parseServiceAccount(input.credentialsJson);
  if (!account) return null;
  const settings = await readCrmSettings(app.prisma);
  const next: CrmSettings = {
    ...settings,
    searchConsole: {
      propertyUrl: input.propertyUrl,
      credentialsCiphertext: encryptSecret(JSON.stringify({ client_email: account.client_email, private_key: account.private_key, token_uri: account.token_uri })),
      clientEmail: account.client_email,
      lastSyncAt: null,
      lastSyncError: null,
      initialSyncDone: false,
    },
  };
  return writeCrmSettings(app.prisma, next, actorId);
}

export async function disconnectSearchConsole(app: FastifyInstance, actorId: string): Promise<CrmSettings> {
  const settings = await readCrmSettings(app.prisma);
  return writeCrmSettings(
    app.prisma,
    { ...settings, searchConsole: { propertyUrl: settings.searchConsole.propertyUrl, credentialsCiphertext: null, clientEmail: null, lastSyncAt: null, lastSyncError: null, initialSyncDone: false } },
    actorId
  );
}

// --- Search Console: senkron -------------------------------------------------------------------

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const ROW_LIMIT = 25_000;

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/** Servis hesabı JWT'si (RS256) — Google OAuth "jwt-bearer" akışı. */
export function buildServiceAccountJwt(account: { client_email: string; private_key: string }, now = Math.floor(Date.now() / 1000)): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${signer.sign(account.private_key).toString("base64url")}`;
}

interface GscRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

export interface SearchConsoleSyncResult {
  ok: boolean;
  from: string | null;
  to: string | null;
  rows: number;
  error: string | null;
}

/**
 * İlk bağlantıda son 90 gün, sonra son 3 gün (Google verisi 2–3 gün gecikmeli gelir). Aralıktaki günlerin
 * satırları silinip yeniden yazılır (idempotent). Hata durumunda kısa mesaj `lastSyncError`'a yazılır.
 */
export async function syncSearchConsole(app: FastifyInstance, fetchImpl: FetchLike = fetch as unknown as FetchLike, now = new Date()): Promise<SearchConsoleSyncResult> {
  const settings = await readCrmSettings(app.prisma);
  const sc = settings.searchConsole;
  if (!sc.credentialsCiphertext || !sc.propertyUrl) return { ok: false, from: null, to: null, rows: 0, error: "Search Console bağlı değil." };

  const to = shiftDate(istanbulDate(now), -1);
  const from = shiftDate(to, sc.initialSyncDone ? -2 : -89);
  const finish = async (patch: Partial<CrmSettings["searchConsole"]>) => {
    const latest = await readCrmSettings(app.prisma);
    await writeCrmSettings(app.prisma, { ...latest, searchConsole: { ...latest.searchConsole, ...patch } }, null);
  };

  try {
    const account = JSON.parse(decryptSecret(sc.credentialsCiphertext)) as { client_email: string; private_key: string; token_uri?: string };
    const tokenRes = await fetchImpl(account.token_uri || TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: buildServiceAccountJwt(account) }).toString(),
    });
    if (!tokenRes.ok) throw new Error(`Google yetkilendirme hatası (HTTP ${tokenRes.status}). Servis hesabı anahtarını kontrol edin.`);
    const accessToken = ((await tokenRes.json()) as { access_token?: string }).access_token;
    if (!accessToken) throw new Error("Google erişim belirteci alınamadı.");

    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(sc.propertyUrl)}/searchAnalytics/query`;
    const collected: Prisma.CrmSearchConsoleRowCreateManyInput[] = [];
    for (let startRow = 0; startRow < 500_000; startRow += ROW_LIMIT) {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ startDate: from, endDate: to, dimensions: ["date", "query", "page"], rowLimit: ROW_LIMIT, startRow, dataState: "final" }),
      });
      if (res.status === 403) throw new Error("Servis hesabının bu Search Console mülküne erişimi yok (mülke kullanıcı olarak ekleyin).");
      if (!res.ok) throw new Error(`Search Console sorgusu başarısız (HTTP ${res.status}).`);
      const rows = (((await res.json()) as { rows?: GscRow[] }).rows ?? []).filter((r) => Array.isArray(r.keys) && r.keys.length === 3);
      for (const r of rows) {
        const [date, query, page] = r.keys as [string, string, string];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        const q = sanitizeText(query, 500);
        const p = sanitizeText(page, 1000);
        collected.push({
          date: new Date(`${date}T00:00:00.000Z`),
          rowKey: crypto.createHash("md5").update(`${q}|${p}`).digest("hex"),
          query: q,
          page: p,
          clicks: Math.max(0, Math.round(r.clicks ?? 0)),
          impressions: Math.max(0, Math.round(r.impressions ?? 0)),
          ctr: Number.isFinite(r.ctr) ? r.ctr! : 0,
          position: Number.isFinite(r.position) ? r.position! : 0,
        });
      }
      if (rows.length < ROW_LIMIT) break;
    }

    await app.prisma.$transaction(async (tx) => {
      await tx.crmSearchConsoleRow.deleteMany({ where: { date: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) } } });
      for (let i = 0; i < collected.length; i += 5000) {
        await tx.crmSearchConsoleRow.createMany({ data: collected.slice(i, i + 5000), skipDuplicates: true });
      }
    }, { timeout: 120_000 });
    await finish({ lastSyncAt: new Date().toISOString(), lastSyncError: null, initialSyncDone: true });
    return { ok: true, from, to, rows: collected.length, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 400) : "Bilinmeyen hata.";
    await finish({ lastSyncError: message });
    app.log.warn({ err: message }, "Search Console senkronu başarısız");
    return { ok: false, from, to, rows: 0, error: message };
  }
}

// --- Anahtar Kelimeler -------------------------------------------------------------------------

export const KeywordsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  group: z.enum(["all", "1-3", "4-10", "11-20", "21+"]).default("all"),
  q: z.string().trim().max(100).optional(),
});

interface KeywordAgg {
  query: string;
  clicks: number;
  impressions: number;
  weighted_position: number;
}

function positionGroup(position: number): "1-3" | "4-10" | "11-20" | "21+" {
  if (position <= 3.5) return "1-3";
  if (position <= 10.5) return "4-10";
  if (position <= 20.5) return "11-20";
  return "21+";
}

async function aggregateKeywords(app: FastifyInstance, from: string, to: string) {
  return app.prisma.$queryRaw<KeywordAgg[]>`
    SELECT "query",
      SUM("clicks")::int AS clicks,
      SUM("impressions")::int AS impressions,
      (SUM("position" * "impressions") / NULLIF(SUM("impressions"), 0))::float AS weighted_position
    FROM "crm_search_console_rows"
    WHERE "date" >= ${from}::date AND "date" <= ${to}::date
    GROUP BY "query"`;
}

/**
 * Sorgu bazında sıra (gösterim ağırlıklı ortalama konum), değişim (önceki eşit uzunluktaki döneme göre;
 * pozitif = yükseldi), gösterim, tıklama, TO ve en iyi sayfa; 1–3 / 4–10 / 11–20 / 21+ grupları.
 */
export async function keywordsReport(app: FastifyInstance, query: z.infer<typeof KeywordsQuerySchema>) {
  const days = Math.round((Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) / 86_400_000) + 1;
  const prevTo = shiftDate(query.from, -1);
  const prevFrom = shiftDate(prevTo, -(days - 1));
  const [current, previous, bestPages] = await Promise.all([
    aggregateKeywords(app, query.from, query.to),
    aggregateKeywords(app, prevFrom, prevTo),
    app.prisma.$queryRaw<{ query: string; page: string }[]>`
      SELECT DISTINCT ON ("query") "query", "page"
      FROM (
        SELECT "query", "page", SUM("clicks") AS c, SUM("impressions") AS i
        FROM "crm_search_console_rows"
        WHERE "date" >= ${query.from}::date AND "date" <= ${query.to}::date
        GROUP BY "query", "page"
      ) t
      ORDER BY "query", c DESC, i DESC`,
  ]);
  const prevMap = new Map(previous.map((p) => [p.query, p.weighted_position]));
  const pageMap = new Map(bestPages.map((b) => [b.query, b.page]));
  const rows = current
    .filter((r) => r.impressions > 0 && r.weighted_position !== null)
    .map((r) => {
      const position = Math.round(r.weighted_position * 10) / 10;
      const prev = prevMap.get(r.query);
      return {
        query: r.query,
        position,
        change: prev !== undefined && prev !== null ? Math.round((prev - r.weighted_position) * 10) / 10 : null,
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: Math.round((r.clicks / r.impressions) * 1000) / 10,
        bestPage: pageMap.get(r.query) ?? null,
        group: positionGroup(r.weighted_position),
      };
    });
  const groups = { "1-3": 0, "4-10": 0, "11-20": 0, "21+": 0 } as Record<"1-3" | "4-10" | "11-20" | "21+", number>;
  for (const r of rows) groups[r.group]++;
  const filtered = rows
    .filter((r) => query.group === "all" || r.group === query.group)
    .filter((r) => !query.q || r.query.toLowerCase().includes(query.q.toLowerCase()))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 1000);
  return { rows: filtered, groups, total: rows.length, previousRange: { from: prevFrom, to: prevTo } };
}

// --- Google Ads: offline dönüşüm dosyası ---------------------------------------------------------

/** gclid yalnızca bu karakterlerle kabul edilir — CSV formül enjeksiyonunu da olanaksız kılar. */
const GCLID = /^[A-Za-z0-9_-]{10,200}$/;

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** `yyyy-MM-dd HH:mm:ss` (Europe/Istanbul) — dosyanın ilk satırındaki `TimeZone` parametresiyle uyumlu. */
export function formatIstanbulDateTime(at: Date): string {
  return new Date(at.getTime() + 3 * 3_600_000).toISOString().replace("T", " ").slice(0, 19);
}

export const AdsConversionsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Google Ads "çevrimdışı dönüşüm içe aktarma" CSV'si:
 *   Parameters:TimeZone=Europe/Istanbul
 *   Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency
 * Satırlar: aralıkta ÖDENEN randevular (atfında gclid olan) + aralıkta "Tedavi Oldu"ya geçen talepler
 * (gclid olan). gclid yalnızca pazarlama onayıyla saklandığı için onaysız ziyaretçi dosyaya giremez.
 * gbraid/wbraid satırları bu şablonla yüklenemediği için dosyaya alınmaz (sayısı yanıtta bildirilir).
 */
export async function buildAdsConversionsCsv(app: FastifyInstance, query: z.infer<typeof AdsConversionsQuerySchema>) {
  const settings = await readCrmSettings(app.prisma);
  const start = istanbulDayRange(query.from).start;
  const end = istanbulDayRange(query.to).end;
  const paid = await app.prisma.$queryRaw<{ gclid: string | null; gbraid: string | null; wbraid: string | null; paidAt: Date; totalCents: number; currency: string }[]>`
    SELECT a."gclid", a."gbraid", a."wbraid", b."paidAt", b."totalCents", b."currency"
    FROM "crm_attributions" a
    JOIN "appointment_bookings" b ON b."id" = a."bookingId"
    WHERE b."paymentStatus" = 'PAID' AND b."archivedAt" IS NULL AND b."paidAt" >= ${start} AND b."paidAt" < ${end}`;
  const treated = await app.prisma.crmLead.findMany({
    where: { status: "TREATED", statusChangedAt: { gte: start, lt: end }, gclid: { not: null } },
    select: { gclid: true, statusChangedAt: true },
  });

  const lines = ["Parameters:TimeZone=Europe/Istanbul", "Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency"];
  let rows = 0;
  let skippedBraid = 0;
  for (const p of paid) {
    if (!p.gclid || !GCLID.test(p.gclid)) {
      if (p.gbraid || p.wbraid) skippedBraid++;
      continue;
    }
    lines.push([p.gclid, csvField(settings.adsConversionName), formatIstanbulDateTime(p.paidAt), (p.totalCents / 100).toFixed(2), p.currency].join(","));
    rows++;
  }
  for (const l of treated) {
    if (!l.gclid || !GCLID.test(l.gclid)) continue;
    lines.push([l.gclid, csvField(settings.adsLeadConversionName), formatIstanbulDateTime(l.statusChangedAt), "", ""].join(","));
    rows++;
  }
  return { csv: `${lines.join("\r\n")}\r\n`, rows, skippedBraid };
}

// --- Google Ads: lead form CSV içe aktarma -------------------------------------------------------

export const AdsImportSchema = z.object({ csv: z.string().min(1).max(2_000_000) }).strict();

const HEADER_ALIASES: Record<string, string[]> = {
  name: ["full name", "full_name", "name", "ad soyad", "isim"],
  firstName: ["first name", "first_name", "ad"],
  lastName: ["last name", "last_name", "soyad"],
  email: ["email", "user email", "user_email", "e-mail", "e-posta", "eposta"],
  phone: ["phone number", "phone_number", "phone", "telefon", "user phone"],
  leadId: ["lead id", "lead_id", "leadid", "id"],
  campaign: ["campaign name", "campaign_name", "campaign", "kampanya"],
  gclid: ["gcl_id", "gclid", "google click id"],
  submittedAt: ["submission time", "lead_submit_time", "submit time", "date", "created", "created time"],
  country: ["country", "ülke"],
};

function normalizeHeader(h: string): string {
  return h.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Google Ads potansiyel müşteri formu CSV'si → `ADS_IMPORT` talepleri. Başlıklar esnek eşlenir (yukarıdaki
 * eş anlamlılar). `Lead ID` varsa `sourceRefId` olur (tekrar içe aktarma çift kayıt üretmez); yoksa satırın
 * içerik özeti kullanılır.
 */
export async function importAdsLeads(app: FastifyInstance, csvText: string) {
  let records: Record<string, string>[];
  try {
    records = parseCsv(csvText, { columns: (headers: string[]) => headers.map(normalizeHeader), skip_empty_lines: true, trim: true, relax_column_count: true, bom: true });
  } catch {
    return { created: 0, skipped: 0, errors: ["CSV okunamadı (biçim hatası)."] };
  }
  const pick = (row: Record<string, string>, key: keyof typeof HEADER_ALIASES) => {
    for (const alias of HEADER_ALIASES[key]!) if (row[alias]?.trim()) return row[alias]!.trim();
    return null;
  };
  const errors: string[] = [];
  const data: Prisma.CrmLeadCreateManyInput[] = [];
  records.slice(0, 5000).forEach((row, index) => {
    const name = pick(row, "name") ?? ([pick(row, "firstName"), pick(row, "lastName")].filter(Boolean).join(" ") || null);
    const email = normalizeEmail(pick(row, "email"));
    const phone = normalizePhone(pick(row, "phone"));
    if (!name && !email && !phone) {
      errors.push(`Satır ${index + 2}: ad, e-posta ya da telefon yok — atlandı.`);
      return;
    }
    const gclidRaw = pick(row, "gclid");
    const submitted = pick(row, "submittedAt");
    const submittedAt = submitted && !Number.isNaN(Date.parse(submitted)) ? new Date(submitted) : new Date();
    const leadId = pick(row, "leadId");
    const ref = leadId ? sanitizeText(leadId, 200) : crypto.createHash("sha256").update(`${name}|${email}|${phone}|${submitted}`).digest("hex").slice(0, 40);
    const country = pick(row, "country");
    data.push({
      channel: "ADS_IMPORT",
      sourceRefId: ref,
      name: name ? sanitizeText(name, 200) : null,
      email,
      phone,
      country: country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null,
      source: "google",
      medium: "cpc",
      campaign: pick(row, "campaign") ? sanitizeText(pick(row, "campaign"), 150).toLowerCase() : null,
      gclid: gclidRaw && GCLID.test(gclidRaw) ? gclidRaw : null,
      createdAt: submittedAt,
      statusChangedAt: submittedAt,
    });
  });
  if (records.length > 5000) errors.push("En fazla 5000 satır işlenir; kalanı atlandı.");

  const existing = new Set(
    (await app.prisma.crmLead.findMany({ where: { channel: "ADS_IMPORT", sourceRefId: { in: data.map((d) => d.sourceRefId!) } }, select: { sourceRefId: true } })).map((l) => l.sourceRefId)
  );
  const fresh = data.filter((d) => !existing.has(d.sourceRefId!));
  const result = fresh.length > 0 ? await app.prisma.crmLead.createMany({ data: fresh, skipDuplicates: true }) : { count: 0 };
  if (result.count > 0) {
    const created = await app.prisma.crmLead.findMany({ where: { channel: "ADS_IMPORT", sourceRefId: { in: fresh.map((f) => f.sourceRefId!) } }, select: { id: true, channel: true, candidate: true } });
    await notifyNewLeads(app, created);
  }
  return { created: result.count, skipped: records.length - result.count, errors: errors.slice(0, 50) };
}

/** Search Console satırlarının saklama süresi — Google'ın kendi tutma süresiyle aynı (16 ay). */
export const SEARCH_CONSOLE_RETENTION_DAYS = 480;

export async function pruneSearchConsoleRows(app: FastifyInstance, now = new Date()): Promise<number> {
  const result = await app.prisma.crmSearchConsoleRow.deleteMany({ where: { date: { lt: new Date(now.getTime() - SEARCH_CONSOLE_RETENTION_DAYS * 86_400_000) } } });
  return result.count;
}
