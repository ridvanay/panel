import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { hashToken } from "../../src/lib/tokens";
import { DEFAULT_CRM_SETTINGS, readCrmSettings, writeCrmSettings } from "../../src/modules/crm/crm.settings";
import { buildServiceAccountJwt, formatIstanbulDateTime, syncSearchConsole, type FetchLike } from "../../src/modules/crm/crm.google";
import { istanbulDate, shiftDate } from "../../src/modules/crm/crm.rollup";

/**
 * Paket N4 — Google entegrasyonları: Search Console (şifreli kimlik, JWT, mock'lu senkron, Anahtar
 * Kelimeler raporu) ve Google Ads dosya akışı (offline dönüşüm CSV biçimi, lead form CSV içe aktarma).
 */
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const SERVICE_ACCOUNT = JSON.stringify({
  type: "service_account",
  project_id: "wm-test",
  private_key_id: "abc",
  private_key: PRIVATE_PEM,
  client_email: "crm-reader@wm-test.iam.gserviceaccount.com",
  token_uri: "https://oauth2.googleapis.com/token",
});

describe("CRM N4 — Google", () => {
  let app: FastifyInstance;
  let token: string;
  const auth = () => ({ authorization: `Bearer ${token}` });

  async function login(role: "ADMIN" | "MANAGER") {
    const { hashPassword } = await import("../../src/lib/password");
    const user = await app.prisma.user.create({
      data: { email: `crm-g-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`, name: role, passwordHash: await hashPassword("Sifre12345!"), role, status: "ACTIVE", emailVerifiedAt: new Date() },
    });
    const t = (await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email: user.email, password: "Sifre12345!" } })).json().data.tokens.accessToken as string;
    await app.prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
    return t;
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    token = await login("ADMIN");
  });

  beforeEach(async () => {
    await app.prisma.crmSearchConsoleRow.deleteMany();
    await app.prisma.crmLead.deleteMany();
    await app.prisma.crmAttribution.deleteMany();
    await app.prisma.appointmentBooking.deleteMany();
    await app.prisma.auditLog.deleteMany();
    await writeCrmSettings(app.prisma, { ...DEFAULT_CRM_SETTINGS }, null);
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("servis hesabı JWT'si RS256 ile imzalanır ve doğru iddiaları taşır", () => {
    const jwt = buildServiceAccountJwt({ client_email: "a@b.iam.gserviceaccount.com", private_key: PRIVATE_PEM }, 1_700_000_000);
    const [header, claims, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toMatchObject({
      iss: "a@b.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      aud: "https://oauth2.googleapis.com/token",
      exp: 1_700_003_600,
    });
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(`${header}.${claims}`);
    expect(verifier.verify(publicKey, Buffer.from(signature!, "base64url"))).toBe(true);
  });

  it("bağlama: kimlik şifreli saklanır, yanıtta asla dönmez; geçersiz JSON/mülk 422; MANAGER 403", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/v1/admin/crm/search-console/connect", headers: auth(), payload: { propertyUrl: "sc-domain:ornek.com", credentialsJson: JSON.stringify({ type: "user", foo: "x".repeat(60) }) } });
    expect(bad.statusCode).toBe(422);
    const badProp = await app.inject({ method: "POST", url: "/api/v1/admin/crm/search-console/connect", headers: auth(), payload: { propertyUrl: "ornek.com", credentialsJson: SERVICE_ACCOUNT } });
    expect(badProp.statusCode).toBe(422);
    const manager = await login("MANAGER");
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/crm/keywords?from=2026-10-01&to=2026-10-02", headers: { authorization: `Bearer ${manager}` } })).statusCode).toBe(403);

    const res = await app.inject({ method: "POST", url: "/api/v1/admin/crm/search-console/connect", headers: auth(), payload: { propertyUrl: "sc-domain:ornek.com", credentialsJson: SERVICE_ACCOUNT } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.searchConsole).toMatchObject({ connected: true, propertyUrl: "sc-domain:ornek.com", clientEmailMasked: "crm*******@wm-test.iam.gserviceaccount.com" });
    expect(res.body).not.toContain("PRIVATE KEY");
    expect(res.body).not.toContain("credentialsCiphertext");

    const row = await app.prisma.siteModule.findUniqueOrThrow({ where: { key: "crm" } });
    const raw = JSON.stringify(row.settings);
    expect(raw).not.toContain("PRIVATE KEY");
    expect(raw).not.toContain("BEGIN");
    const settings = (await app.inject({ method: "GET", url: "/api/v1/admin/crm/settings", headers: auth() })).body;
    expect(settings).not.toContain("PRIVATE KEY");
    expect(await app.prisma.auditLog.count({ where: { action: "crm.search_console.connect" } })).toBe(1);

    const off = await app.inject({ method: "DELETE", url: "/api/v1/admin/crm/search-console/connect", headers: auth() });
    expect(off.json().data.searchConsole.connected).toBe(false);
    expect((await app.inject({ method: "POST", url: "/api/v1/admin/crm/search-console/sync", headers: auth() })).statusCode).toBe(409);
  });

  it("senkron (mock): ilk seferde 90 gün, sonra 3 gün; satırlar idempotent; 403 hatası kaydedilir", async () => {
    await app.inject({ method: "POST", url: "/api/v1/admin/crm/search-console/connect", headers: auth(), payload: { propertyUrl: "https://ornek.com/", credentialsJson: SERVICE_ACCOUNT } });
    const calls: { url: string; body: string }[] = [];
    const yesterday = shiftDate(istanbulDate(), -1);
    let queryStatus = 200;
    const mockFetch: FetchLike = async (url, init) => {
      calls.push({ url, body: init.body });
      if (url.includes("oauth2")) return { ok: true, status: 200, json: async () => ({ access_token: "tok-123" }) };
      if (queryStatus !== 200) return { ok: false, status: queryStatus, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          rows: [
            { keys: [yesterday, "obezite ameliyatı", "https://ornek.com/tr/doctors/a"], clicks: 12, impressions: 300, ctr: 0.04, position: 2.4 },
            { keys: [yesterday, "gastric sleeve turkey", "https://ornek.com/en/doctors/a"], clicks: 3, impressions: 900, ctr: 0.0033, position: 14.2 },
          ],
        }),
      };
    };

    const first = await syncSearchConsole(app, mockFetch);
    expect(first).toMatchObject({ ok: true, to: yesterday, from: shiftDate(yesterday, -89), rows: 2 });
    expect(calls[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0]!.body).toContain("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer");
    expect(calls[1]!.url).toBe("https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fornek.com%2F/searchAnalytics/query");
    expect(JSON.parse(calls[1]!.body)).toMatchObject({ dimensions: ["date", "query", "page"], endDate: yesterday });
    expect((await readCrmSettings(app.prisma)).searchConsole).toMatchObject({ initialSyncDone: true, lastSyncError: null });

    const second = await syncSearchConsole(app, mockFetch);
    expect(second.from).toBe(shiftDate(yesterday, -2));
    expect(await app.prisma.crmSearchConsoleRow.count()).toBe(2);

    queryStatus = 403;
    const failed = await syncSearchConsole(app, mockFetch);
    expect(failed.ok).toBe(false);
    expect((await readCrmSettings(app.prisma)).searchConsole.lastSyncError).toMatch(/erişimi yok/);
    expect(await app.prisma.crmSearchConsoleRow.count()).toBe(2);
  });

  it("Anahtar Kelimeler: ağırlıklı sıra, değişim, TO, en iyi sayfa, 1–3/4–10/11–20/21+ grupları", async () => {
    const row = (date: string, query: string, page: string, clicks: number, impressions: number, position: number) => ({
      date: new Date(`${date}T00:00:00.000Z`),
      rowKey: crypto.createHash("md5").update(`${query}|${page}`).digest("hex"),
      query,
      page,
      clicks,
      impressions,
      ctr: impressions ? clicks / impressions : 0,
      position,
    });
    await app.prisma.crmSearchConsoleRow.createMany({
      data: [
        row("2026-10-10", "obezite", "/tr/a", 10, 100, 3),
        row("2026-10-11", "obezite", "/tr/b", 30, 100, 1),
        row("2026-10-11", "diz protezi", "/tr/c", 1, 200, 8),
        row("2026-10-11", "rhinoplasty", "/en/d", 0, 50, 15),
        row("2026-10-11", "hair transplant", "/en/e", 0, 40, 33),
        // önceki dönem (2026-10-08..09)
        row("2026-10-09", "obezite", "/tr/a", 5, 100, 6),
        row("2026-10-08", "diz protezi", "/tr/c", 0, 100, 5),
      ],
    });
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/crm/keywords?from=2026-10-10&to=2026-10-11", headers: auth() });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.connection.connected).toBe(false);
    expect(data.previousRange).toEqual({ from: "2026-10-08", to: "2026-10-09" });
    expect(data.groups).toEqual({ "1-3": 1, "4-10": 1, "11-20": 1, "21+": 1 });
    const obezite = data.rows.find((r: { query: string }) => r.query === "obezite");
    expect(obezite).toMatchObject({ position: 2, change: 4, clicks: 40, impressions: 200, ctr: 20, bestPage: "/tr/b", group: "1-3" });
    expect(data.rows.find((r: { query: string }) => r.query === "diz protezi")).toMatchObject({ position: 8, change: -3, group: "4-10" });
    expect(data.rows.find((r: { query: string }) => r.query === "rhinoplasty").change).toBeNull();

    const top = (await app.inject({ method: "GET", url: "/api/v1/admin/crm/keywords?from=2026-10-10&to=2026-10-11&group=21%2B", headers: auth() })).json().data;
    expect(top.rows.map((r: { query: string }) => r.query)).toEqual(["hair transplant"]);
  });

  it("Ads dönüşüm dosyası: Google şablonu, ödenen randevu + Tedavi Oldu; geçersiz/olmayan gclid ve braid hariç; audit", async () => {
    const doctor = await app.prisma.doctorProfile.create({
      data: { title: "Dr.", fullName: "Ads", slug: `ads-${crypto.randomUUID().slice(0, 6)}`, bio: "x", languages: ["tr"], sessionPriceCents: 1, currency: "EUR", isActive: true },
    });
    const paidAt = new Date("2026-10-15T09:30:00.000Z");
    const mk = async (gclid: string | null, gbraid: string | null, cents: number) => {
      const b = await app.prisma.appointmentBooking.create({
        data: {
          bookingNumber: `B-${crypto.randomUUID().slice(0, 8)}`,
          doctorId: doctor.id,
          patientName: "P",
          patientEmail: "p@example.com",
          slotCount: 1,
          unitPriceCents: cents,
          subtotalCents: cents,
          totalCents: cents,
          currency: "EUR",
          paymentStatus: "PAID",
          paidAt,
          expiresAt: new Date(),
          meetingRoomName: `room_${crypto.randomBytes(16).toString("hex")}`,
          accessTokenHash: hashToken(crypto.randomUUID()),
          consentAt: new Date(),
          consentVersion: "v",
        },
      });
      await app.prisma.crmAttribution.create({ data: { bookingId: b.id, lastSource: "google", lastMedium: "cpc", gclid, gbraid } });
    };
    await mk("Cj0KCQjwValid_gclid-123", null, 15000);
    await mk(null, "GBRAID-1", 9000);
    await mk("=HYPERLINK(1)", null, 1000);
    await app.prisma.crmLead.create({ data: { channel: "ADS_IMPORT", status: "TREATED", statusChangedAt: new Date("2026-10-16T12:00:00.000Z"), gclid: "EAIaIQobChMI_lead-9" } });

    const res = await app.inject({ method: "GET", url: "/api/v1/admin/crm/ads/conversions?from=2026-10-15&to=2026-10-16", headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    const lines = res.body.trim().split("\r\n");
    expect(lines[0]).toBe("Parameters:TimeZone=Europe/Istanbul");
    expect(lines[1]).toBe("Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency");
    expect(lines).toContain("Cj0KCQjwValid_gclid-123,Ödenen randevu,2026-10-15 12:30:00,150.00,EUR");
    expect(lines).toContain("EAIaIQobChMI_lead-9,Tedavi oldu,2026-10-16 15:00:00,,");
    expect(lines).toHaveLength(4);
    expect(res.body).not.toContain("HYPERLINK");
    expect(res.headers["x-crm-skipped-braid"]).toBe("1");
    expect(await app.prisma.auditLog.count({ where: { action: "crm.export" } })).toBe(1);
    expect(formatIstanbulDateTime(new Date("2026-01-01T21:00:00.000Z"))).toBe("2026-01-02 00:00:00");
  });

  it("Ads lead CSV içe aktarma: esnek başlıklar, tekrar içe aktarmada çift kayıt yok, eksik satır raporlanır", async () => {
    const csv = [
      "Lead ID,Full Name,User Email,Phone Number,Campaign Name,Submission Time,GCL_ID",
      "L-1,Hans Müller,HANS@example.de,+49 151 2345678,Obezite DE,2026-10-20T10:00:00Z,Cj0KCQ_ads_lead_1",
      'L-2,"Smith, Jane",jane@example.com,,Hair UK,2026-10-20T11:00:00Z,',
      "L-3,,,,Boş,2026-10-20T12:00:00Z,",
    ].join("\n");
    const first = await app.inject({ method: "POST", url: "/api/v1/admin/crm/ads/import-leads", headers: auth(), payload: { csv } });
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toMatchObject({ created: 2 });
    expect(first.json().data.errors[0]).toMatch(/Satır 4/);
    const hans = await app.prisma.crmLead.findFirstOrThrow({ where: { sourceRefId: "L-1" } });
    expect(hans).toMatchObject({ channel: "ADS_IMPORT", name: "Hans Müller", email: "hans@example.de", phone: "+491512345678", campaign: "obezite de", source: "google", medium: "cpc", gclid: "Cj0KCQ_ads_lead_1" });
    expect((await app.prisma.crmLead.findFirstOrThrow({ where: { sourceRefId: "L-2" } })).name).toBe("Smith, Jane");

    const again = await app.inject({ method: "POST", url: "/api/v1/admin/crm/ads/import-leads", headers: auth(), payload: { csv } });
    expect(again.json().data.created).toBe(0);
    expect(await app.prisma.crmLead.count()).toBe(2);
    expect(await app.prisma.auditLog.count({ where: { action: "crm.lead.import" } })).toBe(2);
  });
});
