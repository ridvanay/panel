import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeDeskSlots } from "../../src/modules/service-consultations/service-slots";
import { pickCoordinator, type ActiveCoordinator } from "../../src/modules/service-consultations/service-desk";
import { SERVICE_CONSULTATION_EMAIL, buildPatientServiceEmail, buildStaffServiceEmail } from "../../src/modules/service-consultations/service-consultation-email";
import { MANAGE_TOKEN_REGEX, buildManageLink, generateManageToken } from "../../src/modules/service-consultations/service-consultation-tokens";
import { normalizeGuestName } from "../../src/modules/meetings/meeting-guest-name";
import { hashToken } from "../../src/lib/tokens";

const base = {
  timeZone: "Europe/Istanbul",
  durationMin: 30,
  minNoticeMin: 120,
  horizonDays: 30,
  closureDates: new Set<string>(),
  coordinatorIds: ["a"],
  busy: new Map(),
};
const allDay = (d: number) => ({ dayOfWeek: d, startMinute: 9 * 60, endMinute: 11 * 60 });

describe("computeDeskSlots (saf)", () => {
  it("saat, sure ve ISO gun: Carsamba 09:00-11:00 / 30 dk = 4 slot (Istanbul UTC+3)", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    const r = computeDeskSlots({ ...base, hours: [allDay(3)], from: "2026-11-04", to: "2026-11-04", now });
    expect(r.slots.map((s) => s.startsAt.toISOString())).toEqual(["2026-11-04T06:00:00.000Z", "2026-11-04T06:30:00.000Z", "2026-11-04T07:00:00.000Z", "2026-11-04T07:30:00.000Z"]);
    expect(r.days).toEqual([{ date: "2026-11-04", status: "available" }]);
  });

  it("en erken (2 saat) ve ufuk (30 gun) siniri", () => {
    const now = new Date("2026-11-04T05:00:00Z"); // 08:00 Istanbul
    const r = computeDeskSlots({ ...base, hours: [allDay(3)], from: "2026-11-04", to: "2026-11-04", now });
    // 06:00Z (09:00) < 07:00Z: elenir; 07:00Z dahil
    expect(r.slots.map((s) => s.startsAt.toISOString())).toEqual(["2026-11-04T07:00:00.000Z", "2026-11-04T07:30:00.000Z"]);
    const far = computeDeskSlots({ ...base, hours: [allDay(1)], from: "2026-12-14", to: "2026-12-14", now: new Date("2026-11-01T00:00:00Z") });
    expect(far.slots).toHaveLength(0);
    expect(far.days[0]!.status).toBe("closed");
  });

  it("tatil gunu: slot yok, gun closed; dolu gun: full", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    const closed = computeDeskSlots({ ...base, hours: [allDay(3)], closureDates: new Set(["2026-11-04"]), from: "2026-11-04", to: "2026-11-04", now });
    expect(closed.slots).toHaveLength(0);
    expect(closed.days[0]!.status).toBe("closed");
    const busy = new Map([["a", [{ start: new Date("2026-11-04T05:00:00Z"), end: new Date("2026-11-04T09:00:00Z") }]]]);
    const full = computeDeskSlots({ ...base, hours: [allDay(3)], busy, from: "2026-11-04", to: "2026-11-04", now });
    expect(full.slots).toHaveLength(0);
    expect(full.days[0]!.status).toBe("full");
  });

  it("iki uye: biri mesgulse slot acik, ikisi de mesgulse kapali; yaniti serbest uye listesi sunucu icinde", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    const one = new Map([["a", [{ start: new Date("2026-11-04T06:00:00Z"), end: new Date("2026-11-04T06:30:00Z") }]]]);
    const r1 = computeDeskSlots({ ...base, coordinatorIds: ["a", "b"], busy: one, hours: [allDay(3)], from: "2026-11-04", to: "2026-11-04", now });
    expect(r1.slots[0]!.freeCoordinatorIds).toEqual(["b"]);
    const both = new Map([...one, ["b", [{ start: new Date("2026-11-04T06:00:00Z"), end: new Date("2026-11-04T06:30:00Z") }]]]);
    const r2 = computeDeskSlots({ ...base, coordinatorIds: ["a", "b"], busy: both, hours: [allDay(3)], from: "2026-11-04", to: "2026-11-04", now });
    expect(r2.slots[0]!.startsAt.toISOString()).toBe("2026-11-04T06:30:00.000Z");
  });

  it("DST: Istanbul sabit UTC+3 kalir; Berlin dilimli masada sonbahar gecisi haftasi duvar saati korunur (UTC kayar)", () => {
    const now = new Date("2026-10-01T00:00:00Z");
    const berlin = { ...base, timeZone: "Europe/Berlin", hours: [{ dayOfWeek: 7, startMinute: 600, endMinute: 630 }] };
    // 2026-10-25 Pazar: Berlin DST biter (03:00 -> 02:00). 10:00 yerel = 09:00Z (UTC+1); onceki pazar 10:00 yerel = 08:00Z (UTC+2).
    const after = computeDeskSlots({ ...berlin, from: "2026-10-25", to: "2026-10-25", now });
    const before = computeDeskSlots({ ...berlin, from: "2026-10-18", to: "2026-10-18", now });
    expect(after.slots[0]!.startsAt.toISOString()).toBe("2026-10-25T09:00:00.000Z");
    expect(before.slots[0]!.startsAt.toISOString()).toBe("2026-10-18T08:00:00.000Z");
  });

  it("DST ilkbahar boslugu: var olmayan duvar saati slot uretmez (Berlin 2026-03-29 02:00-03:00)", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    const r = computeDeskSlots({ ...base, timeZone: "Europe/Berlin", horizonDays: 90, hours: [{ dayOfWeek: 7, startMinute: 120, endMinute: 240 }], from: "2026-03-29", to: "2026-03-29", now });
    const hours = r.slots.map((s) => s.startsAt.toISOString());
    expect(hours).not.toContain("2026-03-29T01:00:00.000Z".replace("01", "00")); // 02:00 yerel yok
    expect(r.slots.every((s) => s.startsAt.getUTCHours() >= 1)).toBe(true);
  });
});

describe("pickCoordinator (otomatik atama)", () => {
  const mk = (id: string, languages: string[], lastAssignedAt: Date | null): ActiveCoordinator => ({ id, userId: `u-${id}`, displayName: id, languages, lastAssignedAt, email: `${id}@x.com` });
  const zero = () => 0;

  it("dil uyumu once", () => {
    const pick = pickCoordinator({ candidates: [mk("a", ["en"], null), mk("b", ["ar"], null)], languages: ["ar"], loadByCoordinator: new Map(), random: zero });
    expect(pick.id).toBe("b");
  });
  it("dil esitse o gun en az gorusme", () => {
    const pick = pickCoordinator({ candidates: [mk("a", ["en"], null), mk("b", ["en"], null)], languages: ["en"], loadByCoordinator: new Map([["a", 3], ["b", 1]]), random: zero });
    expect(pick.id).toBe("b");
  });
  it("yuk esitse en eski lastAssignedAt (hic atanmamis en eski)", () => {
    const pick = pickCoordinator({
      candidates: [mk("a", [], new Date("2026-01-02")), mk("b", [], new Date("2026-01-01")), mk("c", [], new Date("2026-01-03"))],
      languages: [],
      loadByCoordinator: new Map(),
      random: zero,
    });
    expect(pick.id).toBe("b");
    expect(pickCoordinator({ candidates: [mk("a", [], new Date()), mk("n", [], null)], languages: [], loadByCoordinator: new Map(), random: zero }).id).toBe("n");
  });
  it("tam esitlikte rastgele; dil eslesmesi yoksa tum aday havuzu; tercih edilen aday dogrudan", () => {
    const cands = [mk("a", [], null), mk("b", [], null)];
    expect(pickCoordinator({ candidates: cands, languages: ["fr"], loadByCoordinator: new Map(), random: () => 1 }).id).toBe("b");
    expect(pickCoordinator({ candidates: cands, languages: [], loadByCoordinator: new Map([["b", 5]]), preferredId: "b", random: zero }).id).toBe("b");
  });
});

describe("tokenlar ve e-postalar", () => {
  it("yonetim belirteci sc_ + 43 karakter; ozet SHA-256; baglanti # parcasinda ve tr -> en", () => {
    const { token, hash } = generateManageToken();
    expect(token).toMatch(MANAGE_TOKEN_REGEX);
    expect(hash).toBe(hashToken(token));
    const link = buildManageLink(token, "tr");
    expect(link).toContain("/en/book-consultation/manage#sc_");
    expect(new URL(link).search).toBe("");
  });

  it("8 dilin hepsinde tum anahtarlar dolu, Turkce metin yok; konu satirinda hizmet adi yok", () => {
    for (const [locale, s] of Object.entries(SERVICE_CONSULTATION_EMAIL)) {
      for (const [k, v] of Object.entries(s)) expect(v.trim().length, `${locale}.${k}`).toBeGreaterThan(0);
      for (const kind of ["confirmed", "rescheduled", "reminder24h", "reminder60m", "cancelled"] as const) {
        const mail = buildPatientServiceEmail({
          kind,
          locale,
          consultationNumber: "SVC-00042",
          startsAt: new Date("2026-11-20T11:00:00Z"),
          durationMin: 30,
          patientTimeZone: "Europe/Berlin",
          joinUrl: "https://x.test/en/meet/join#mg_abc",
          manageUrl: "https://x.test/en/book-consultation/manage#sc_abc",
          bookAgainUrl: "https://x.test/en/book-consultation",
        });
        expect(mail.subject).toContain("SVC-00042");
        expect(mail.subject).not.toContain("{no}");
        expect(mail.bodyHtml).not.toContain("{min}");
        expect(mail.bodyHtml).not.toMatch(/[ğüşıöçĞÜŞİÖÇ]{2}/); // Turkce harf kumesi (almanca ü/ö tek tek gecer)
      }
    }
    const tr = buildPatientServiceEmail({ kind: "confirmed", locale: "tr", consultationNumber: "SVC-00001", startsAt: new Date(), durationMin: 30, patientTimeZone: null });
    expect(tr.locale).toBe("en");
    expect(tr.subject).toBe("Your online consultation is confirmed - SVC-00001");
  });

  it("personel e-postasi kisisel veri tasimaz (girdi tipi ad/e-posta/telefon/mesaj icermez); koordinator CTA'si panel baglantisi", () => {
    const mail = buildStaffServiceEmail({
      event: "booked",
      audience: "coordinator",
      consultationNumber: "SVC-00042",
      serviceName: "Gastroenterology",
      startsAt: new Date("2026-11-20T11:00:00Z"),
      durationMin: 30,
      coordinatorName: "Ayşe K.",
      contactLanguage: "ar",
      needsInterpreter: true,
      interpreterLanguage: "ar",
      coordinatorSpeaksInterpreterLanguage: true,
      consultationId: "id-1",
      frontendUrl: "https://x.test",
    });
    expect(mail.subject).toBe("New online consultation assigned to you SVC-00042 - 2026-11-20 14:00 (Europe/Istanbul)");
    expect(mail.cta.url).toBe("https://x.test/admin/my-consultations");
    expect(mail.bodyHtml).toContain("coordinator speaks this language");
  });
});

describe("misafir adi taklit korumasi", () => {
  it("'Patient Coordinator ...' ve 'Coordinator ...' reddedilir; normal adlar gecer", () => {
    expect(normalizeGuestName("Patient Coordinator Ayşe").ok).toBe(false);
    expect(normalizeGuestName("coordinator bob").ok).toBe(false);
    expect(normalizeGuestName("Hans Mueller").ok).toBe(true);
  });
});

describe("migration ve kod taramasi", () => {
  const root = path.resolve(__dirname, "../..");
  it("migration yalnizca ekleme: DROP / RENAME / ALTER COLUMN yok; elle SQL kismi tekil indeks + CHECK var", () => {
    const sql = fs.readFileSync(path.join(root, "prisma/migrations/20261117090000_service_consultations/migration.sql"), "utf8");
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/\bRENAME\b/i);
    expect(sql).not.toMatch(/ALTER\s+COLUMN/i);
    expect(sql).toMatch(/CREATE UNIQUE INDEX "service_consultations_coordinator_active_start"[\s\S]*WHERE "status" IN \('SCHEDULED', 'PENDING_PAYMENT'\)/);
    expect(sql).toMatch(/CHECK \("endsAt" > "startsAt"\)/);
  });

  it("hicbir kod PENDING_PAYMENT yazmaz (service-consultations modulu)", () => {
    const dir = path.join(root, "src/modules/service-consultations");
    for (const f of fs.readdirSync(dir)) {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      expect(text, f).not.toMatch(/status:\s*"PENDING_PAYMENT"/);
      expect(text, f).not.toMatch(/data:[^\n]*PENDING_PAYMENT/);
    }
  });

  it("kayit/grant kirmizi cizgileri: hizmet modulu egress/kayit ve doktor token fonksiyonlarini iceri aktarmaz", () => {
    const dir = path.join(root, "src/modules/service-consultations");
    for (const f of fs.readdirSync(dir)) {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      expect(text, f).not.toMatch(/startRoomCompositeRecording|createMeetingToken\b|livekit-egress/);
    }
  });
});
