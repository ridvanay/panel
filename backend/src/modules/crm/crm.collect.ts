import type { FastifyInstance } from "fastify";
import type { CrmEventType, Prisma } from "@prisma/client";
import geoip from "geoip-lite";
import { z } from "zod";
import { env } from "../../config/env";
import { readCrmSettings, type CrmSettings } from "./crm.settings";
import { classifySource } from "./crm.source";
import { computeVisitorScore } from "./crm.score";
import { ipMatchesList, isBotUserAgent, isExcludedPath, isSafeSitePath, maskIp, normalizePath, parseUserAgent, sanitizeText, stripLocale } from "./crm.privacy";

/**
 * Paket N1 — `POST /crm/collect` gövdesi. İstemci `navigator.sendBeacon` ile `text/plain` gönderir
 * (CORS ön uçuşu olmadan); gövde burada elle JSON'a çevrilip zod ile KATI doğrulanır. Bilinmeyen alan
 * = 400. Metin alanları ayrıca `sanitizeText` ile temizlenir/kesilir.
 */
export const CRM_CLIENT_ID = /^[A-Za-z0-9_-]{16,40}$/;
export const CRM_REF_CODE = /^[A-HJ-NP-Z2-9]{6}$/;
export const CRM_MAX_EVENTS_PER_BATCH = 50;
/** Heartbeat aralığı (istemciyle aynı) — okuma süresi hesabı. */
export const CRM_HEARTBEAT_SECONDS = 15;

const EVENT_TYPES = {
  pageview: "PAGEVIEW",
  heartbeat: "HEARTBEAT",
  click: "CLICK",
  scroll: "SCROLL",
  whatsapp_click: "WHATSAPP_CLICK",
  phone_click: "PHONE_CLICK",
  email_click: "EMAIL_CLICK",
  form_submit: "FORM_SUBMIT",
  booking_step: "BOOKING_STEP",
  custom: "CUSTOM",
} as const satisfies Record<string, CrmEventType>;

const pct = z.number().finite().min(0).max(100);
const dim = z.number().int().min(0).max(200_000);

const CollectEventSchema = z
  .object({
    t: z.enum(Object.keys(EVENT_TYPES) as [keyof typeof EVENT_TYPES, ...(keyof typeof EVENT_TYPES)[]]),
    ts: z.number().int().nonnegative(),
    p: z.string().min(1).max(500).refine(isSafeSitePath, "Geçersiz yol."),
    ti: z.string().max(300).optional(),
    sel: z.string().max(400).optional(),
    tx: z.string().max(300).optional(),
    hr: z.string().max(1000).optional(),
    n: z.string().max(100).optional(),
    pr: z
      .record(z.string().max(40), z.union([z.string().max(100), z.number().finite(), z.boolean()]))
      .refine((value) => Object.keys(value).length <= 10, "En fazla 10 özellik.")
      .optional(),
    x: pct.optional(),
    y: pct.optional(),
    ex: pct.optional(),
    ey: pct.optional(),
    vw: dim.optional(),
    vh: dim.optional(),
    dh: dim.optional(),
    sc: z.number().int().min(0).max(100).optional(),
    st: z.number().int().min(1).max(10).optional(),
    rg: z.boolean().optional(),
    dd: z.boolean().optional(),
  })
  .strict();

export const CollectPayloadSchema = z
  .object({
    v: z.literal(1),
    vid: z.string().regex(CRM_CLIENT_ID),
    sid: z.string().regex(CRM_CLIENT_ID),
    cv: z.string().max(40),
    /** Pazarlama onayı — yoksa gclid/gbraid/wbraid YOK SAYILIR. */
    mk: z.boolean(),
    ref: z.string().regex(CRM_REF_CODE).optional(),
    ctx: z
      .object({
        lang: z.string().max(20).optional(),
        tz: z.string().max(60).optional(),
        rf: z.string().max(1000).optional(),
        us: z.string().max(150).optional(),
        um: z.string().max(150).optional(),
        uc: z.string().max(150).optional(),
        ut: z.string().max(150).optional(),
        ucn: z.string().max(150).optional(),
        gclid: z.string().max(200).optional(),
        gbraid: z.string().max(200).optional(),
        wbraid: z.string().max(200).optional(),
      })
      .strict()
      .optional(),
    events: z.array(CollectEventSchema).min(1).max(CRM_MAX_EVENTS_PER_BATCH),
  })
  .strict();

export type CollectPayload = z.infer<typeof CollectPayloadSchema>;

export interface CollectRequestMeta {
  ip: string | undefined;
  userAgent: string | undefined;
  now?: Date;
}

export type CollectOutcome =
  | { accepted: number }
  | { accepted: 0; dropped: "disabled" | "bot" | "excluded_ip" | "excluded_path" | "rate" | "session_mismatch" };

// --- İstemci başına olay hızı (süreç içi, kayan pencere) -----------------------------------------
/** 10 saniyede bundan fazla olay gönderen oturum bot sayılır ve işaretlenir. */
export const CRM_FLOOD_MAX_EVENTS = 60;
const FLOOD_WINDOW_MS = 10_000;
const floodWindows = new Map<string, number[]>();

export function registerFloodHit(sessionId: string, count: number, now: number): boolean {
  const recent = (floodWindows.get(sessionId) ?? []).filter((t) => now - t < FLOOD_WINDOW_MS);
  for (let i = 0; i < count; i++) recent.push(now);
  floodWindows.set(sessionId, recent);
  if (floodWindows.size > 50_000) {
    for (const [key, times] of floodWindows) if (times.every((t) => now - t >= FLOOD_WINDOW_MS)) floodWindows.delete(key);
  }
  return recent.length > CRM_FLOOD_MAX_EVENTS;
}

export function resetFloodWindows(): void {
  floodWindows.clear();
}

export function ownHosts(): string[] {
  const hosts = new Set<string>();
  for (const url of [env.FRONTEND_URL, env.DOCTOR_FRONTEND_URL, env.PUBLIC_URL]) {
    if (!url) continue;
    try {
      hosts.add(new URL(url).hostname.replace(/^www\./, ""));
    } catch {
      // geçersiz URL — atlanır
    }
  }
  return [...hosts];
}

function referrerHostOf(referrer: string | undefined): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.toLowerCase().slice(0, 200) || null;
  } catch {
    return null;
  }
}

const CONTACT_TYPES = new Set<CrmEventType>(["WHATSAPP_CLICK", "PHONE_CLICK", "EMAIL_CLICK"]);

function isDoctorOrSpecialtyPath(path: string): boolean {
  return /^\/(doctors|specialties)\/[^/]+/.test(stripLocale(path));
}

function clampTimestamp(ts: number, now: number): Date {
  // İstemci saati güvenilmez: 10 dk geçmiş / 1 dk gelecek dışındaki değerler sunucu saatine çekilir.
  return new Date(ts < now - 10 * 60_000 || ts > now + 60_000 ? now : ts);
}

/**
 * Olay paketini işler. Onay istemci tarafında zorunlu tutulur (script onaysız YÜKLENMEZ); sunucu ayrıca
 * takip kapalıyken, bot/hariç IP'de, hariç yollarda ve aşırı olay hızında hiçbir şey YAZMAZ.
 */
export async function ingestCollect(app: FastifyInstance, payload: CollectPayload, meta: CollectRequestMeta): Promise<CollectOutcome> {
  const settings = await readCrmSettings(app.prisma);
  if (!settings.trackingEnabled) return { accepted: 0, dropped: "disabled" };
  if (isBotUserAgent(meta.userAgent)) return { accepted: 0, dropped: "bot" };
  if (ipMatchesList(meta.ip, settings.excludedIps)) return { accepted: 0, dropped: "excluded_ip" };

  const nowDate = meta.now ?? new Date();
  const now = nowDate.getTime();

  // Hariç-yol kontrolü SAKLANACAK (normalize edilmiş) yol üzerinde — `//admin`, `/en//admin` atlatamaz.
  const events = payload.events.filter((event) => !isExcludedPath(normalizePath(event.p), settings.excludedPaths));
  if (events.length === 0) return { accepted: 0, dropped: "excluded_path" };

  if (registerFloodHit(payload.sid, events.length, now)) {
    await app.prisma.crmSession.updateMany({ where: { id: payload.sid }, data: { botFlagged: true } });
    await app.prisma.crmVisitor.updateMany({ where: { id: payload.vid }, data: { botFlagged: true } });
    return { accepted: 0, dropped: "rate" };
  }

  return app.prisma.$transaction(async (tx) => ingestInTransaction(tx, payload, events, settings, meta, now));
}

async function ingestInTransaction(
  tx: Prisma.TransactionClient,
  payload: CollectPayload,
  events: CollectPayload["events"],
  settings: CrmSettings,
  meta: CollectRequestMeta,
  now: number
): Promise<CollectOutcome> {
  const existingSession = await tx.crmSession.findUnique({ where: { id: payload.sid }, select: { visitorId: true, botFlagged: true } });
  if (existingSession && existingSession.visitorId !== payload.vid) return { accepted: 0, dropped: "session_mismatch" };
  if (existingSession?.botFlagged) return { accepted: 0, dropped: "rate" };

  const geo = meta.ip ? geoip.lookup(meta.ip.startsWith("::ffff:") ? meta.ip.slice(7) : meta.ip) : null;
  const country = geo?.country || null;
  const city = geo?.city ? sanitizeText(geo.city, 100) : null;
  const storedIp = settings.ipMode === "full" ? (meta.ip ?? null) : maskIp(meta.ip);
  const ua = parseUserAgent(meta.userAgent);
  const ctx = payload.ctx ?? {};
  const language = ctx.lang ? sanitizeText(ctx.lang, 20) : null;
  const timezone = ctx.tz ? sanitizeText(ctx.tz, 60) : null;
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const firstAt = clampTimestamp(sorted[0]!.ts, now);
  const lastAt = clampTimestamp(sorted[sorted.length - 1]!.ts, now);
  const firstPath = normalizePath(sorted[0]!.p);

  const visitor = await tx.crmVisitor.findUnique({ where: { id: payload.vid } });
  if (visitor?.botFlagged) return { accepted: 0, dropped: "rate" };

  let createdSession = false;
  if (!existingSession) {
    const referrerHost = referrerHostOf(ctx.rf);
    const hasAdClickId = payload.mk && Boolean(ctx.gclid || ctx.gbraid || ctx.wbraid);
    const classified = classifySource({
      utmSource: ctx.us,
      utmMedium: ctx.um,
      utmCampaign: ctx.uc,
      hasAdClickId,
      referrerHost,
      ownHosts: ownHosts(),
    });
    const ownReferrer = referrerHost && ownHosts().some((h) => referrerHost.replace(/^www\./, "") === h);
    if (!visitor) {
      await tx.crmVisitor.create({
        data: {
          id: payload.vid,
          firstSeenAt: firstAt,
          lastSeenAt: lastAt,
          firstSource: classified.source,
          firstMedium: classified.medium,
          firstCampaign: classified.campaign,
          firstReferrerHost: ownReferrer ? null : referrerHost,
          firstLandingPath: firstPath,
          country,
          language,
          timezone,
          deviceType: ua.deviceType,
          consentVersion: sanitizeText(payload.cv, 40) || null,
          refCode: payload.ref ?? null,
        },
      });
    }
    await tx.crmSession.create({
      data: {
        id: payload.sid,
        visitorId: payload.vid,
        startedAt: firstAt,
        lastSeenAt: lastAt,
        source: classified.source,
        medium: classified.medium,
        campaign: classified.campaign,
        term: ctx.ut ? sanitizeText(ctx.ut, 150).toLowerCase() : null,
        content: ctx.ucn ? sanitizeText(ctx.ucn, 150).toLowerCase() : null,
        referrerHost: ownReferrer ? null : referrerHost,
        landingPath: firstPath,
        country,
        city,
        ip: storedIp,
        deviceType: ua.deviceType,
        browser: ua.browser,
        os: ua.os,
        language,
        timezone,
        gclid: payload.mk && ctx.gclid ? sanitizeText(ctx.gclid, 200) : null,
        gbraid: payload.mk && ctx.gbraid ? sanitizeText(ctx.gbraid, 200) : null,
        wbraid: payload.mk && ctx.wbraid ? sanitizeText(ctx.wbraid, 200) : null,
      },
    });
    createdSession = true;
  }

  const rows: Prisma.CrmEventCreateManyInput[] = sorted.map((event) => {
    const type = EVENT_TYPES[event.t];
    const allowText = type === "CLICK" || CONTACT_TYPES.has(type);
    return {
      sessionId: payload.sid,
      visitorId: payload.vid,
      type,
      occurredAt: clampTimestamp(event.ts, now),
      path: normalizePath(event.p),
      title: event.ti ? sanitizeText(event.ti, 200) || null : null,
      selector: event.sel ? sanitizeText(event.sel, 300) || null : null,
      // Öğe metni yalnızca link/buton tıklamasında ve en fazla 80 karakter.
      text: allowText && event.tx ? sanitizeText(event.tx, 80) || null : null,
      target: event.hr ? sanitizeTarget(event.hr) : null,
      name: event.n ? sanitizeText(event.n, 100) || null : null,
      props: event.pr ? (sanitizeProps(event.pr) as Prisma.InputJsonValue) : undefined,
      xPct: event.x ?? null,
      yPct: event.y ?? null,
      elXPct: event.ex ?? null,
      elYPct: event.ey ?? null,
      viewportW: event.vw ?? null,
      viewportH: event.vh ?? null,
      docH: event.dh ?? null,
      scrollPct: event.sc ?? null,
      step: type === "BOOKING_STEP" ? (event.st ?? null) : null,
      deviceType: ua.deviceType,
      isRage: type === "CLICK" ? Boolean(event.rg) : false,
      isDead: type === "CLICK" ? Boolean(event.dd) : false,
    };
  });
  await tx.crmEvent.createMany({ data: rows });

  const pageviews = rows.filter((r) => r.type === "PAGEVIEW");
  const heartbeats = rows.filter((r) => r.type === "HEARTBEAT").length;
  const engaged = Math.min(heartbeats, 20) * CRM_HEARTBEAT_SECONDS;
  const contacts = rows.filter((r) => CONTACT_TYPES.has(r.type)).length;
  const bookingStep = rows.some((r) => r.type === "BOOKING_STEP");
  const doctorPage = pageviews.some((r) => isDoctorOrSpecialtyPath(r.path));
  const lastPath = rows[rows.length - 1]!.path;

  await tx.crmSession.update({
    where: { id: payload.sid },
    data: {
      lastSeenAt: lastAt,
      exitPath: pageviews.length > 0 ? pageviews[pageviews.length - 1]!.path : lastPath,
      pageCount: { increment: pageviews.length },
      durationSeconds: { increment: engaged },
      ...(doctorPage ? { reachedDoctorPage: true } : {}),
      ...(bookingStep ? { bookingStarted: true } : {}),
      ...(contacts > 0 ? { contactClicked: true } : {}),
    },
  });

  const updatedVisitor = await tx.crmVisitor.update({
    where: { id: payload.vid },
    data: {
      lastSeenAt: lastAt,
      ...(country ? { country } : {}),
      ...(language ? { language } : {}),
      ...(timezone ? { timezone } : {}),
      deviceType: ua.deviceType,
      consentVersion: sanitizeText(payload.cv, 40) || null,
      ...(payload.ref ? { refCode: payload.ref } : {}),
      ...(createdSession ? { sessionCount: { increment: 1 } } : {}),
      pageviewCount: { increment: pageviews.length },
      engagedSeconds: { increment: engaged },
      contactClicks: { increment: contacts },
      ...(bookingStep ? { reachedBooking: true } : {}),
    },
  });
  const score = computeVisitorScore(updatedVisitor, settings.scoreWeights);
  if (score !== updatedVisitor.score) await tx.crmVisitor.update({ where: { id: payload.vid }, data: { score } });

  return { accepted: rows.length };
}

/** Hedef bağlantı: yalnızca şema + host + yol; sorgu dizesi (e-posta/telefon metni vb.) ATILIR. */
export function sanitizeTarget(href: string): string | null {
  const value = sanitizeText(href, 1000);
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower.startsWith("tel:")) return sanitizeText(value.split("?")[0], 60);
  if (lower.startsWith("mailto:")) return sanitizeText(value.split("?")[0], 120);
  if (lower.startsWith("javascript:") || lower.startsWith("data:")) return null;
  try {
    const url = new URL(value, "https://placeholder.invalid");
    if (!/^https?:$/.test(url.protocol) && url.protocol !== "whatsapp:") return null;
    const host = url.hostname === "placeholder.invalid" ? "" : url.hostname;
    return sanitizeText(`${host}${url.pathname}`, 300) || null;
  } catch {
    return null;
  }
}

function sanitizeProps(props: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(props)) {
    const cleanKey = sanitizeText(key, 40);
    if (!cleanKey) continue;
    out[cleanKey] = typeof value === "string" ? sanitizeText(value, 100) : value;
  }
  return out;
}
