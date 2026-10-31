import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { resetDatabase } from "../helpers/reset-db";

/**
 * Paket Y — zengin hekim profili ve hasta yorumları. Testler YALNIZCA fixture verisi kullanır (uydurma
 * yorum seed'i yoktur). Kapsam: davet token'ı (tek kullanımlık, süreli), "Deneyiminizi paylaşın"
 * süpürücüsü (24 saat, hastanın dili, çift gönderim yok), pending görünmez, admin metni düzenleyemez,
 * maskeleme audit'e, 3'ten az onaylıda ortalama yok, hasta portalı + "Yorumumu sil", tercüman/doktor
 * yorum yazamaz/moderasyon göremez, video/before-after kuralları, randevuda hastanın dili.
 */
let ipCounter = 0;
const nextIp = () => `10.70.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const ORIGIN = { origin: "http://localhost:3000" };

const mailSpy = vi.fn();
vi.mock("../../src/lib/mail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/mail")>();
  return { ...actual, sendMail: (...args: unknown[]) => (mailSpy(...args), Promise.resolve({ messageId: "test" })) };
});

describe("Paket Y — hekim profili ve hasta yorumları", () => {
  let app: FastifyInstance;
  let admin: { id: string; email: string; token: string };
  let manager: { id: string; email: string; token: string };

  async function user(role: "ADMIN" | "MANAGER" | "USER" | "INTERPRETER", twoFactor = true) {
    const { hashPassword } = await import("../../src/lib/password");
    const { signAccessToken } = await import("../../src/lib/jwt");
    const u = await app.prisma.user.create({
      data: { email: `y-${role.toLowerCase()}-${crypto.randomUUID()}@example.com`, name: `Y ${role}`, passwordHash: await hashPassword("Sifre12345!"), role, status: "ACTIVE", emailVerifiedAt: new Date(), twoFactorEnabled: twoFactor },
    });
    return { id: u.id, email: u.email, token: signAccessToken({ sub: u.id, email: u.email }).token };
  }

  async function doctor(opts: { isFounder?: boolean } = {}) {
    const specialty = await app.prisma.specialty.create({ data: { name: `S ${crypto.randomUUID()}`, slug: `s-${crypto.randomUUID()}`, icon: "Heart" } });
    return app.prisma.doctorProfile.create({
      data: {
        title: "Op. Dr.",
        fullName: "Mehmet DEMİR",
        bio: "Test.",
        slug: `y-${crypto.randomUUID().slice(0, 8)}`,
        languages: ["tr", "en"],
        timeZone: "Europe/Istanbul",
        specialtyId: specialty.id,
        sessionDurationMin: 30,
        sessionPriceCents: 50000,
        currency: "EUR",
        isActive: true,
        isFounder: opts.isFounder ?? false,
      },
    });
  }

  async function completedBooking(opts: { doctorId: string; endedMinutesAgo?: number; locale?: string | null; patientUserId?: string | null; status?: "COMPLETED" | "SCHEDULED"; birthDate?: Date; patientEmail?: string }) {
    const { generateOpaqueToken, hashToken } = await import("../../src/lib/tokens");
    const ended = new Date(Date.now() - (opts.endedMinutesAgo ?? 25 * 60) * 60_000);
    const b = await app.prisma.appointmentBooking.create({
      data: {
        bookingNumber: `B-${crypto.randomUUID().slice(0, 8)}`,
        doctorId: opts.doctorId,
        patientName: "Ayşe Yılmaz",
        patientEmail: opts.patientEmail ?? `hasta-${crypto.randomUUID()}@example.com`,
        patientBirthDate: opts.birthDate ?? null,
        slotCount: 1,
        unitPriceCents: 50000,
        subtotalCents: 50000,
        totalCents: 50000,
        currency: "EUR",
        paymentStatus: "PAID",
        expiresAt: new Date(Date.now() + 3600_000),
        meetingRoomName: `room_${crypto.randomBytes(12).toString("hex")}`,
        accessTokenHash: hashToken(generateOpaqueToken()),
        patientUserId: opts.patientUserId ?? null,
        identityCountryCode: "DE",
        locale: opts.locale === undefined ? "de" : opts.locale,
        consentAt: new Date(),
        consentVersion: "v1",
      },
    });
    const appointment = await app.prisma.appointment.create({
      data: {
        doctorId: opts.doctorId,
        bookingId: b.id,
        patientName: "Ayşe Yılmaz",
        patientEmail: b.patientEmail,
        startsAt: new Date(ended.getTime() - 30 * 60_000),
        endsAt: ended,
        endedAt: opts.status === "SCHEDULED" ? null : ended,
        priceCents: 50000,
        currency: "EUR",
        meetingRoomName: `${b.meetingRoomName}-a`,
        accessTokenHash: hashToken(generateOpaqueToken()),
        status: opts.status ?? "COMPLETED",
      },
    });
    return { booking: b, appointment };
  }

  const reviewBody = (over: Record<string, unknown> = {}) => ({
    rating: 5,
    title: "Çok memnun kaldım",
    body: "Görüşme zamanında başladı, sorularıma sabırla ve anlaşılır biçimde yanıt verildi. Teşekkürler.",
    displayMode: "initials",
    publishConsent: true,
    consentTextVersion: "2026-11-review-v1",
    ...over,
  });

  async function inviteToken(bookingId: string) {
    const { createReviewInvite } = await import("../../src/modules/reviews/reviews.service");
    return (await createReviewInvite(app, bookingId))!;
  }

  async function approve(id: string) {
    return app.inject({ method: "POST", url: `/api/v1/admin/testimonials/${id}/status`, headers: auth(admin.token), payload: { status: "approved" } });
  }

  beforeAll(async () => {
    const { buildApp } = await import("../../src/app");
    app = await buildApp();
    await app.ready();
    await resetDatabase(app.prisma);
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
    admin = await user("ADMIN");
    manager = await user("MANAGER");
  });

  beforeEach(() => mailSpy.mockClear());

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
    vi.resetModules();
  });

  describe("yorum daveti ve form", () => {
    it("24 saat sonra hastaya kendi dilinde (DE) tek davet; 7 günden eski ve tamamlanmamış görüşmeye yok; ikinci tur tekrar göndermez", async () => {
      const d = await doctor();
      const due = await completedBooking({ doctorId: d.id, endedMinutesAgo: 25 * 60, locale: "de" });
      const fresh = await completedBooking({ doctorId: d.id, endedMinutesAgo: 60 });
      const old = await completedBooking({ doctorId: d.id, endedMinutesAgo: 9 * 24 * 60 });
      const notDone = await completedBooking({ doctorId: d.id, endedMinutesAgo: 25 * 60, status: "SCHEDULED" });
      const noLocale = await completedBooking({ doctorId: d.id, endedMinutesAgo: 26 * 60, locale: null });
      const { runReviewRequestSweep } = await import("../../src/lib/review-requests");
      const first = await runReviewRequestSweep(app);
      expect(first.sent).toBe(2);
      const recipients = mailSpy.mock.calls.map((c) => (c[1] as { to: string }).to);
      expect(recipients.sort()).toEqual([due.booking.patientEmail, noLocale.booking.patientEmail].sort());
      for (const b of [fresh, old, notDone]) expect(recipients).not.toContain(b.booking.patientEmail);
      const de = mailSpy.mock.calls.find((c) => (c[1] as { to: string }).to === due.booking.patientEmail)![1] as { subject: string; html: string; text: string };
      // Konu nötr: hekim adı yok (gövdede var); her e-postada "bir daha gönderme" bağlantısı.
      expect(de.subject).toBe("Wie war Ihre Beratung?");
      expect(de.html).toContain("Op. Dr. M. Demir");
      expect(de.html).toContain("?optout=1");
      expect(de.html).toContain('<html lang="de"');
      expect(de.html).toContain("/de/review/");
      expect(de.html).toContain("Ayşe Yılmaz");
      const tr = mailSpy.mock.calls.find((c) => (c[1] as { to: string }).to === noLocale.booking.patientEmail)![1] as { subject: string; html: string };
      expect(tr.subject).toBe("Görüşmenizi değerlendirir misiniz?");
      expect(tr.html).toContain("/tr/review/");
      mailSpy.mockClear();
      expect((await runReviewRequestSweep(app)).sent).toBe(0);
      expect(mailSpy).not.toHaveBeenCalled();
    });

    it("token tek kullanımlık ve süreli; yorum pending başlar ve herkese açık listede görünmez", async () => {
      const d = await doctor();
      const { booking } = await completedBooking({ doctorId: d.id });
      const token = await inviteToken(booking.id);
      expect((await app.inject({ method: "GET", url: `/api/v1/reviews/invite/${token}`, remoteAddress: nextIp() })).json().data.doctorName).toBe("Op. Dr. M. Demir");
      // Yayın onayı zorunlu; metin en az 30 karakter.
      expect((await app.inject({ method: "POST", url: `/api/v1/reviews/invite/${token}`, headers: ORIGIN, payload: reviewBody({ publishConsent: false }), remoteAddress: nextIp() })).statusCode).toBe(422);
      expect((await app.inject({ method: "POST", url: `/api/v1/reviews/invite/${token}`, headers: ORIGIN, payload: reviewBody({ body: "kısa" }), remoteAddress: nextIp() })).statusCode).toBe(422);
      const res = await app.inject({ method: "POST", url: `/api/v1/reviews/invite/${token}`, headers: ORIGIN, payload: reviewBody(), remoteAddress: nextIp() });
      expect(res.statusCode).toBe(201);
      expect(res.json().data.status).toBe("pending");
      const row = await app.prisma.testimonial.findUniqueOrThrow({ where: { id: res.json().data.id } });
      // Ülke kimlik belgesinden alınmaz; hasta seçmediyse boş. Rıza metni sürümü kaydedilir.
      expect([row.source, row.authorDisplay, row.country, row.language, row.consentTextVersion]).toEqual(["verified_booking", "A. Y.", null, "de", "2026-11-review-v1"]);
      // İkinci kullanım reddedilir.
      expect((await app.inject({ method: "POST", url: `/api/v1/reviews/invite/${token}`, headers: ORIGIN, payload: reviewBody(), remoteAddress: nextIp() })).statusCode).toBe(404);
      // Pending görünmez.
      const list = (await app.inject({ method: "GET", url: `/api/v1/doctors/${d.slug}/reviews`, remoteAddress: nextIp() })).json().data;
      expect([list.total, list.summary.count]).toEqual([0, 0]);
      // Süresi dolmuş token.
      const b2 = await completedBooking({ doctorId: d.id });
      const t2 = await inviteToken(b2.booking.id);
      await app.prisma.testimonialInvite.update({ where: { bookingId: b2.booking.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await app.inject({ method: "GET", url: `/api/v1/reviews/invite/${t2}`, remoteAddress: nextIp() })).statusCode).toBe(404);
      // Yabancı origin.
      expect((await app.inject({ method: "POST", url: `/api/v1/reviews/invite/${t2}`, headers: { origin: "https://evil.example" }, payload: reviewBody(), remoteAddress: nextIp() })).statusCode).toBe(403);
    });
  });

  describe("moderasyon ve görünüm", () => {
    it("admin metni düzenleyemez; maskeleme yalnızca parçayı karartır ve audit'e içeriksiz yazılır; 3'ten az onaylıda ortalama yok", async () => {
      const d = await doctor();
      const ids: string[] = [];
      for (const rating of [5, 4]) {
        const { booking } = await completedBooking({ doctorId: d.id });
        const token = await inviteToken(booking.id);
        ids.push((await app.inject({ method: "POST", url: `/api/v1/reviews/invite/${token}`, headers: ORIGIN, payload: reviewBody({ rating, body: "Dr. bana Parol yazdı, Ahmet Bey de çok yardımcı oldu, her şey için teşekkürler." }), remoteAddress: nextIp() })).json().data.id);
      }
      // Metin düzenleme alanı yok.
      expect((await app.inject({ method: "PATCH", url: `/api/v1/admin/testimonials/${ids[0]}`, headers: auth(admin.token), payload: { body: "değiştirilmiş" } })).statusCode).toBe(422);
      // Önce bir yönetici çevirisi eklenir — maskeleme çeviriyi de kapsar.
      await app.inject({ method: "PATCH", url: `/api/v1/admin/testimonials/${ids[0]}`, headers: auth(admin.token), payload: { translations: { en: { title: "", body: "The doctor prescribed me Parol, thanks." } } } });
      const redact = await app.inject({ method: "POST", url: `/api/v1/admin/testimonials/${ids[0]}/redact`, headers: auth(admin.token), payload: { field: "body", snippet: "Parol" } });
      expect(redact.statusCode).toBe(200);
      expect(redact.json().data.body).toBe("Dr. bana █████ yazdı, Ahmet Bey de çok yardımcı oldu, her şey için teşekkürler.");
      expect(redact.json().data.translations.en.body).toBe("The doctor prescribed me █████, thanks.");
      const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: "testimonial.redacted", targetId: ids[0] } });
      expect(audit.metadata).toEqual({ field: "body", maskedLength: 5, occurrences: 1, translationOccurrences: 1 });
      expect(JSON.stringify(audit.metadata)).not.toContain("Parol");
      // Onay → görünür; 2 onaylıda ortalama/dağılım yok.
      for (const id of ids) expect((await approve(id)).statusCode).toBe(200);
      let list = (await app.inject({ method: "GET", url: `/api/v1/doctors/${d.slug}/reviews`, remoteAddress: nextIp() })).json().data;
      expect(list.total).toBe(2);
      expect(list.summary).toEqual({ count: 2, average: null, distribution: null });
      expect(list.items[0].verified).toBe(true);
      // Üçüncü onaylıyla ortalama görünür.
      const { booking } = await completedBooking({ doctorId: d.id });
      const third = (await app.inject({ method: "POST", url: `/api/v1/reviews/invite/${await inviteToken(booking.id)}`, headers: ORIGIN, payload: reviewBody({ rating: 3 }), remoteAddress: nextIp() })).json().data.id;
      await approve(third);
      list = (await app.inject({ method: "GET", url: `/api/v1/doctors/${d.slug}/reviews?sort=highest`, remoteAddress: nextIp() })).json().data;
      expect(list.summary).toMatchObject({ count: 3, average: 4, distribution: { "5": 1, "4": 1, "3": 1, "2": 0, "1": 0 } });
      expect(list.items.map((i: { rating: number }) => i.rating)).toEqual([5, 4, 3]);
      // Audit: onay işlemleri.
      expect(await app.prisma.auditLog.count({ where: { action: "testimonial.approved" } })).toBeGreaterThanOrEqual(3);
    });

    it("manuel yorum: kanıt notu zorunlu, doğrulanmış rozeti yok; anasayfada yalnızca onaylı + öne çıkarılan; kaldırma anonimleştirir", async () => {
      const d = await doctor();
      const base = { doctorId: d.id, authorDisplay: "M. K., Germany", language: "en", rating: 5, title: "Great care", body: "Everything was explained clearly and the team was very kind to us.", source: "manual_with_consent" };
      expect((await app.inject({ method: "POST", url: "/api/v1/admin/testimonials", headers: auth(admin.token), payload: base })).statusCode).toBe(422);
      const created = await app.inject({ method: "POST", url: "/api/v1/admin/testimonials", headers: auth(admin.token), payload: { ...base, consentEvidenceNote: "E-posta ile yazılı onay, 2026-10-01" } });
      expect(created.statusCode).toBe(201);
      const id = created.json().data.id;
      expect(created.json().data).toMatchObject({ status: "pending", verified: false });
      // Onaysız yorum öne çıkarılamaz.
      expect((await app.inject({ method: "PATCH", url: `/api/v1/admin/testimonials/${id}`, headers: auth(admin.token), payload: { featuredOnHome: true } })).statusCode).toBe(422);
      await approve(id);
      await app.inject({ method: "PATCH", url: `/api/v1/admin/testimonials/${id}`, headers: auth(admin.token), payload: { featuredOnHome: true, translations: { tr: { title: "Harika", body: "Her şey açıkça anlatıldı." } } } });
      const featured = (await app.inject({ method: "GET", url: "/api/v1/reviews/featured?locale=tr", remoteAddress: nextIp() })).json().data;
      const item = featured.items.find((i: { id: string }) => i.id === id);
      expect(item).toMatchObject({ verified: false, translation: { title: "Harika" }, doctor: { name: "Op. Dr. M. Demir" } });
      // Kaldırma: anonimleştirilir, listeden düşer, yeniden onaylanamaz.
      expect((await app.inject({ method: "POST", url: `/api/v1/admin/testimonials/${id}/remove`, headers: auth(admin.token) })).json().data).toMatchObject({ status: "hidden", body: "", authorDisplay: "" });
      expect((await approve(id)).statusCode).toBe(409);
      expect((await app.inject({ method: "GET", url: "/api/v1/reviews/featured", remoteAddress: nextIp() })).json().data.items.find((i: { id: string }) => i.id === id)).toBeUndefined();
    });
  });

  describe("hasta portalı ve erişim", () => {
    it("hasta kendi tamamlanmış randevusuna yorum yazar ve silebilir; tercüman/doktor/başka hasta yazamaz ve moderasyonu göremez", async () => {
      const d = await doctor();
      const patient = await user("USER", false);
      const other = await user("USER", false);
      const interp = await user("INTERPRETER");
      const { booking } = await completedBooking({ doctorId: d.id, patientUserId: patient.id });
      const url = `/api/v1/patient/bookings/${booking.id}/review`;
      expect((await app.inject({ method: "GET", url, headers: auth(patient.token) })).json().data).toEqual({ eligible: true, review: null });
      for (const t of [other.token, interp.token, admin.token]) {
        expect((await app.inject({ method: "POST", url, headers: { ...auth(t), ...ORIGIN }, payload: reviewBody() })).statusCode).toBe(404);
      }
      // HTML reddedilir; görünmez yön karakterleri temizlenir.
      expect((await app.inject({ method: "POST", url, headers: { ...auth(patient.token), ...ORIGIN }, payload: reviewBody({ title: "<script>x</script> başlık" }) })).statusCode).toBe(422);
      const res = await app.inject({ method: "POST", url, headers: { ...auth(patient.token), ...ORIGIN }, payload: reviewBody({ displayMode: "first_initial", country: "nl", title: "Teşekkürler\u202E doktor" }) });
      expect(res.statusCode).toBe(201);
      const saved = await app.prisma.testimonial.findUniqueOrThrow({ where: { id: res.json().data.id } });
      expect([saved.authorDisplay, saved.country, saved.title]).toEqual(["Ayşe Y.", "NL", "Teşekkürler doktor"]);
      expect((await app.inject({ method: "POST", url, headers: { ...auth(patient.token), ...ORIGIN }, payload: reviewBody() })).statusCode).toBe(409);
      // Tercüman ve doktor moderasyon listesini göremez.
      expect((await app.inject({ method: "GET", url: "/api/v1/admin/testimonials", headers: auth(interp.token) })).statusCode).toBe(403);
      expect((await app.inject({ method: "GET", url: "/api/v1/admin/testimonials", headers: auth(manager.token) })).statusCode).toBe(200);
      // "Yorumumu sil" — başkası silemez.
      expect((await app.inject({ method: "DELETE", url: `/api/v1/patient/reviews/${res.json().data.id}`, headers: { ...auth(other.token), ...ORIGIN } })).statusCode).toBe(404);
      expect((await app.inject({ method: "DELETE", url: `/api/v1/patient/reviews/${res.json().data.id}`, headers: { ...auth(patient.token), ...ORIGIN } })).statusCode).toBe(204);
      const row = await app.prisma.testimonial.findUniqueOrThrow({ where: { id: res.json().data.id } });
      // Metin ve kimlik izleri silinir; booking bağı iç kayıt olarak kalır → aynı randevuya yeniden yorum yok.
      expect([row.status, row.body, row.title, row.authorDisplay, row.country, row.anonymizedAt instanceof Date]).toEqual(["hidden", "", "", "", null, true]);
      expect((await app.inject({ method: "GET", url, headers: auth(patient.token) })).json().data).toEqual({ eligible: false, review: null });
      expect((await app.inject({ method: "POST", url, headers: { ...auth(patient.token), ...ORIGIN }, payload: reviewBody() })).statusCode).toBe(409);
    });

    it("tamamlanmamış randevuya yorum yazılamaz", async () => {
      const d = await doctor();
      const patient = await user("USER", false);
      const { booking } = await completedBooking({ doctorId: d.id, patientUserId: patient.id, status: "SCHEDULED" });
      expect((await app.inject({ method: "GET", url: `/api/v1/patient/bookings/${booking.id}/review`, headers: auth(patient.token) })).json().data.eligible).toBe(false);
      expect((await app.inject({ method: "POST", url: `/api/v1/patient/bookings/${booking.id}/review`, headers: { ...auth(patient.token), ...ORIGIN }, payload: reviewBody() })).statusCode).toBe(422);
    });
  });

  describe("vitrin: işlemler, foto/video, before-after", () => {
    it("video kimliği doğrulanır; before-after onaysız yayınlanamaz ve ayar kapalıyken hiç görünmez; youtube-nocookie gömme", async () => {
      const d = await doctor();
      const base = `/api/v1/admin/telehealth/doctors/${d.id}`;
      const video = (over: Record<string, unknown>) => ({ kind: "video", videoProvider: "youtube", videoId: "dQw4w9WgXcQ", category: "interview", translations: { tr: { title: "Röportaj", description: "", alt: "" } }, isPublished: true, ...over });
      expect((await app.inject({ method: "POST", url: `${base}/media`, headers: auth(admin.token), payload: video({ videoId: "kötü" }) })).statusCode).toBe(422);
      expect((await app.inject({ method: "POST", url: `${base}/media`, headers: auth(admin.token), payload: video({}) })).statusCode).toBe(201);
      // before-after: onaysız yayın 422; onaylı + not ile 201.
      expect((await app.inject({ method: "POST", url: `${base}/media`, headers: auth(admin.token), payload: video({ category: "before-after" }) })).statusCode).toBe(422);
      expect((await app.inject({ method: "POST", url: `${base}/media`, headers: auth(admin.token), payload: video({ category: "procedure", showsPatient: true }) })).statusCode).toBe(422);
      expect((await app.inject({ method: "POST", url: `${base}/media`, headers: auth(admin.token), payload: video({ category: "before-after", patientConsentConfirmed: true }) })).statusCode).toBe(422);
      expect((await app.inject({ method: "POST", url: `${base}/media`, headers: auth(admin.token), payload: video({ category: "before-after", patientConsentConfirmed: true, consentNote: "Yazılı onay formu 12.10.2026", videoId: "aaaaaaaaaaa" }) })).statusCode).toBe(201);
      // İşlem (fiyat yok).
      expect((await app.inject({ method: "POST", url: `${base}/procedures`, headers: auth(admin.token), payload: { translations: { tr: { title: "Laparoskopik kolesistektomi", duration: "1 saat" } }, isPublished: true } })).statusCode).toBe(201);
      expect((await app.inject({ method: "POST", url: `${base}/procedures`, headers: auth(admin.token), payload: { translations: { tr: { title: "x", price: 100 } } } })).statusCode).toBe(422);
      const show = async () => (await app.inject({ method: "GET", url: `/api/v1/doctors/${d.slug}/showcase?locale=tr`, remoteAddress: nextIp() })).json().data;
      let data = await show();
      expect(data.procedures.map((p: { title: string }) => p.title)).toEqual(["Laparoskopik kolesistektomi"]);
      expect(data.media.map((m: { category: string }) => m.category)).toEqual(["interview"]);
      expect(data.media[0].embedUrl).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0");
      // Küçük resim indirilemediyse (bu testte ağ yok) yer tutucu: sağlayıcı adresi ASLA dönmez.
      expect(data.media[0].thumbnailUrl === null || !/ytimg|youtube|vimeo/.test(data.media[0].thumbnailUrl)).toBe(true);
      // Ayar: varsayılan kapalı; MANAGER açamaz; ADMIN açınca görünür.
      expect((await app.inject({ method: "GET", url: "/api/v1/admin/telehealth/settings/doctor-media", headers: auth(manager.token) })).json().data).toEqual({ beforeAfterEnabled: false });
      expect((await app.inject({ method: "PUT", url: "/api/v1/admin/telehealth/settings/doctor-media", headers: auth(manager.token), payload: { beforeAfterEnabled: true } })).statusCode).toBe(403);
      expect((await app.inject({ method: "PUT", url: "/api/v1/admin/telehealth/settings/doctor-media", headers: auth(admin.token), payload: { beforeAfterEnabled: true } })).statusCode).toBe(200);
      data = await show();
      expect(data.media.map((m: { category: string }) => m.category).sort()).toEqual(["before-after", "interview"]);
      // Savunma: veritabanında onaysız yayına alınmış hasta içeriği de gösterilmez.
      await app.prisma.doctorMedia.updateMany({ where: { doctorId: d.id, category: "before-after" }, data: { patientConsentConfirmed: false } });
      expect((await show()).media.map((m: { category: string }) => m.category)).toEqual(["interview"]);
      await app.inject({ method: "PUT", url: "/api/v1/admin/telehealth/settings/doctor-media", headers: auth(admin.token), payload: { beforeAfterEnabled: false } });
    });

    it("hastane ve SSS hekim kaydına yazılır; SSS çevirisi istenen dilde döner; HTML reddedilir", async () => {
      const d = await doctor();
      const patch = (payload: Record<string, unknown>) => app.inject({ method: "PATCH", url: `/api/v1/admin/telehealth/doctors/${d.id}`, headers: auth(admin.token), payload });
      expect((await patch({ faq: [{ question: "<b>x</b>", answer: "y" }] })).statusCode).toBe(422);
      expect((await patch({ hospitalName: "Örnek Hastanesi", faq: [{ question: "Online görüşme mümkün mü?", answer: "Evet." }] })).statusCode).toBe(200);
      await app.prisma.doctorProfile.update({ where: { id: d.id }, data: { translations: { en: { faq: [{ question: "Is an online consultation possible?", answer: "Yes." }] } } } });
      const tr = (await app.inject({ method: "GET", url: `/api/v1/doctors/${d.slug}`, remoteAddress: nextIp() })).json().data;
      expect([tr.hospitalName, tr.faq[0].question]).toEqual(["Örnek Hastanesi", "Online görüşme mümkün mü?"]);
      const en = (await app.inject({ method: "GET", url: `/api/v1/doctors/${d.slug}?locale=en`, remoteAddress: nextIp() })).json().data;
      expect(en.faq[0].question).toBe("Is an online consultation possible?");
      // Görünen ad kuralı korunur (kurucu değilse kısaltılmış).
      expect(tr.fullName).toBe("M. Demir");
    });
  });

  describe("randevuda hastanın dili", () => {
    it("onay e-postası hastanın dilinde (bağlantılar /de/), dil yoksa TR", async () => {
      const d = await doctor();
      const { triggerAppointmentConfirmationEmail } = await import("../../src/modules/telehealth/lib/notifications");
      const { booking, appointment } = await completedBooking({ doctorId: d.id, locale: "de" });
      await triggerAppointmentConfirmationEmail(app, { booking, appointments: [appointment], rawAccessToken: "raw-token-de" });
      const sent = mailSpy.mock.calls.at(-1)![1] as { html: string };
      expect(sent.html).toContain("/de/patient/bookings/");
      expect(sent.html).toContain('<html lang="de"');
      const noLocale = await completedBooking({ doctorId: d.id, locale: null });
      await triggerAppointmentConfirmationEmail(app, { booking: noLocale.booking, appointments: [noLocale.appointment], rawAccessToken: "raw-token-tr" });
      expect((mailSpy.mock.calls.at(-1)![1] as { html: string }).html).toContain("/tr/patient/bookings/");
    });
  });

  describe("KVKK incelemesi", () => {
    it("'bir daha gönderme' (geçersiz token da 204), reşit olmayana davet yok, saklama temizliği, risk bayrakları", async () => {
      const d = await doctor();
      const email = `optout-${crypto.randomUUID()}@example.com`;
      const first = await completedBooking({ doctorId: d.id, patientEmail: email });
      const token = await inviteToken(first.booking.id);
      expect((await app.inject({ method: "POST", url: `/api/v1/reviews/invite/${token}/opt-out`, headers: ORIGIN, remoteAddress: nextIp() })).statusCode).toBe(204);
      expect((await app.inject({ method: "POST", url: `/api/v1/reviews/invite/${"x".repeat(43)}/opt-out`, headers: ORIGIN, remoteAddress: nextIp() })).statusCode).toBe(204);
      expect(await app.prisma.reviewRequestOptOut.count()).toBeGreaterThanOrEqual(1);
      const { sendReviewInvite, purgeReviewData } = await import("../../src/modules/reviews/reviews.service");
      const second = await completedBooking({ doctorId: d.id, patientEmail: email.toUpperCase() });
      mailSpy.mockClear();
      expect(await sendReviewInvite(app, second.booking.id)).toBe(false);
      const minor = await completedBooking({ doctorId: d.id, birthDate: new Date(Date.now() - 15 * 365 * 86_400_000) });
      expect(await sendReviewInvite(app, minor.booking.id)).toBe(false);
      expect(mailSpy).not.toHaveBeenCalled();

      // Saklama: 31 gün önce kullanılmış davet silinir; 91 günlük bekleyen yorum anonimleşir.
      await app.prisma.testimonialInvite.update({ where: { bookingId: first.booking.id }, data: { usedAt: new Date(Date.now() - 31 * 86_400_000) } });
      const stale = await app.prisma.testimonial.create({
        data: { doctorId: d.id, authorDisplay: "X. Y.", language: "tr", rating: 4, title: "Eski", body: "Doksan günden eski ve hiç yayınlanmamış bir yorum metni burada.", source: "verified_booking", consentAt: new Date(), createdAt: new Date(Date.now() - 91 * 86_400_000) },
      });
      const result = await purgeReviewData(app);
      expect(result.invites).toBeGreaterThanOrEqual(1);
      expect(await app.prisma.testimonialInvite.findUnique({ where: { bookingId: first.booking.id } })).toBeNull();
      expect((await app.prisma.testimonial.findUniqueOrThrow({ where: { id: stale.id } })).anonymizedAt).toBeInstanceOf(Date);

      // Moderatöre uyarı bayrakları.
      const flagged = await app.inject({
        method: "POST",
        url: "/api/v1/admin/testimonials",
        headers: auth(admin.token),
        payload: { authorDisplay: "A. B.", language: "tr", rating: 5, title: "Teşekkürler", body: "Bana ali@example.com ya da +90 532 123 45 67 ile ulaşın, www.ornek.com", source: "imported", consentEvidenceNote: "Eski sitedeki onaylı yorum" },
      });
      expect(flagged.json().data.riskFlags).toEqual(["email", "phone", "url"]);
    });

    it("hasta görünen medya: onayı kaydeden admin ve zaman yazılır; onay kaldırılınca boşalır", async () => {
      const d = await doctor();
      const base = `/api/v1/admin/telehealth/doctors/${d.id}/media`;
      const body = { kind: "video", videoProvider: "vimeo", videoId: "123456789", category: "before-after", translations: { tr: { title: "Önce/sonra", description: "", alt: "" } }, patientConsentConfirmed: true, consentNote: "Yazılı onay formu, dosya no 42", isPublished: false };
      const created = await app.inject({ method: "POST", url: base, headers: auth(admin.token), payload: body });
      expect(created.statusCode).toBe(201);
      expect(created.json().data).toMatchObject({ consentRecordedById: admin.id });
      const off = await app.inject({ method: "PUT", url: `${base}/${created.json().data.id}`, headers: auth(admin.token), payload: { ...body, patientConsentConfirmed: false, consentNote: null } });
      expect(off.json().data).toMatchObject({ consentRecordedAt: null, consentRecordedById: null });
    });
  });

  describe("video küçük resmi — yerel kopya ve SSRF koruması", () => {
    // Geçerli en küçük JPEG imzası (FF D8 FF) + dolgu; boyut okunamazsa width/height null kalır.
    const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(64).fill(0)]);
    const imageResponse = () => new Response(jpeg(), { status: 200, headers: { "content-type": "image/jpeg" } });

    it("izinli alandan bir kez indirilir, Media'ya kaydedilir; sitede yalnızca yerel kopya döner", async () => {
      const calls: string[] = [];
      vi.stubGlobal("fetch", async (url: string) => {
        // Önbellek yenileme (frontend /api/revalidate) çağrısı sayılmaz; yalnızca dış alanlar.
        if (!url.includes("/api/revalidate")) calls.push(url);
        return url.includes("/api/revalidate") ? new Response(null, { status: 200 }) : imageResponse();
      });
      try {
        const d = await doctor();
        const res = await app.inject({
          method: "POST",
          url: `/api/v1/admin/telehealth/doctors/${d.id}/media`,
          headers: auth(admin.token),
          payload: { kind: "video", videoProvider: "youtube", videoId: "aqz-KE-bpKQ", category: "interview", translations: { tr: { title: "Röportaj", description: "", alt: "" } }, isPublished: true },
        });
        expect(res.statusCode).toBe(201);
        expect(calls).toEqual(["https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg"]);
        const thumbId = res.json().data.thumbnailMediaId as string;
        expect((await app.prisma.media.findUniqueOrThrow({ where: { id: thumbId } })).mimeType).toBe("image/jpeg");
        const show = (await app.inject({ method: "GET", url: `/api/v1/doctors/${d.slug}/showcase?locale=tr`, remoteAddress: nextIp() })).json().data;
        expect(show.media[0].thumbnailUrl).toMatch(/\/uploads\//);
        expect(JSON.stringify(show.media.map((m: { thumbnailUrl: string }) => m.thumbnailUrl))).not.toMatch(/ytimg|youtube|vimeo/);
        // Aynı videoyla güncelleme yeniden indirmez.
        await app.inject({
          method: "PUT",
          url: `/api/v1/admin/telehealth/doctors/${d.id}/media/${res.json().data.id}`,
          headers: auth(admin.token),
          payload: { kind: "video", videoProvider: "youtube", videoId: "aqz-KE-bpKQ", category: "interview", translations: { tr: { title: "Yeni başlık", description: "", alt: "" } }, isPublished: true },
        });
        expect(calls).toHaveLength(1);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("izin listesi dışına yönlendirme izlenmez; indirme başarısızsa yer tutucu (thumbnailUrl null)", async () => {
      const { importVideoThumbnail, isAllowedUrl } = await import("../../src/lib/video-thumbnail");
      const hosts = new Set(["i.ytimg.com"]);
      expect(isAllowedUrl("https://i.ytimg.com/vi/x/hqdefault.jpg", hosts)).toBe(true);
      for (const bad of ["http://i.ytimg.com/a.jpg", "https://evil.example/a.jpg", "https://i.ytimg.com:8443/a.jpg", "https://u:p@i.ytimg.com/a.jpg", "https://169.254.169.254/latest"]) {
        expect(isAllowedUrl(bad, hosts), bad).toBe(false);
      }
      const calls: string[] = [];
      const redirecting = async (url: string) => {
        calls.push(url);
        return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
      };
      expect(await importVideoThumbnail(app, "youtube", "aqz-KE-bpKQ", redirecting)).toBeNull();
      expect(calls).toHaveLength(1);
      // SVG ya da HTML içerik kabul edilmez.
      const svg = async () => new Response("<svg xmlns='http://www.w3.org/2000/svg'></svg>", { status: 200, headers: { "content-type": "image/jpeg" } });
      expect(await importVideoThumbnail(app, "youtube", "aqz-KE-bpKQ", svg)).toBeNull();
      // Geçersiz kimlik için hiç istek atılmaz.
      const never = vi.fn();
      expect(await importVideoThumbnail(app, "youtube", "kötü-kimlik", never)).toBeNull();
      expect(never).not.toHaveBeenCalled();

      // Admin kaydı başarısız indirmede de başarılı olur; sitede yer tutucu.
      vi.stubGlobal("fetch", async () => new Response("yok", { status: 404 }));
      try {
        const d = await doctor();
        const res = await app.inject({
          method: "POST",
          url: `/api/v1/admin/telehealth/doctors/${d.id}/media`,
          headers: auth(admin.token),
          payload: { kind: "video", videoProvider: "youtube", videoId: "aqz-KE-bpKQ", category: "clinic", translations: { tr: { title: "Klinik", description: "", alt: "" } }, isPublished: true },
        });
        expect([res.statusCode, res.json().data.thumbnailMediaId]).toEqual([201, null]);
        const show = (await app.inject({ method: "GET", url: `/api/v1/doctors/${d.slug}/showcase`, remoteAddress: nextIp() })).json().data;
        expect(show.media[0].thumbnailUrl).toBeNull();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("Vimeo: oEmbed'in döndürdüğü küçük resim adresi izin listesinde değilse yok sayılır, statik adrese düşülür", async () => {
      const { importVideoThumbnail } = await import("../../src/lib/video-thumbnail");
      const calls: string[] = [];
      const fake = async (url: string) => {
        calls.push(url);
        if (url.startsWith("https://vimeo.com/api/oembed.json")) return new Response(JSON.stringify({ thumbnail_url: "https://evil.example/t.jpg" }), { status: 200 });
        return imageResponse();
      };
      expect(await importVideoThumbnail(app, "vimeo", "123456789", fake)).toEqual(expect.any(String));
      expect(calls).toEqual([expect.stringMatching(/^https:\/\/vimeo\.com\/api\/oembed\.json/), "https://vumbnail.com/123456789.jpg"]);
    });
  });
});
