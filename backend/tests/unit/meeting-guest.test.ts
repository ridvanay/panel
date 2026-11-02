import { describe, expect, it } from "vitest";
import { normalizeGuestName } from "../../src/modules/meetings/meeting-guest-name";
import {
  GUEST_TOKEN_REGEX,
  buildGuestLink,
  extractGuestToken,
  generateGuestToken,
  issueGuestSession,
  verifyGuestSession,
  verifyGuestToken,
} from "../../src/modules/meetings/meeting-tokens";
import { hashToken } from "../../src/lib/tokens";
import { canHostMeetings, isMeetingHostEligible } from "../../src/lib/meeting-host";
import { buildMeetingInviteEmail } from "../../src/modules/telehealth/lib/meeting-invite-email";

describe("misafir adı doğrulaması", () => {
  it.each(["Zeynep Kaya", "José María", "محمد", "O'Brien", "Anne-Marie", "Ali 2", "Dr. Ayşe", "Marko Petrović"])("kabul: %s", (input) => {
    const result = normalizeGuestName(input);
    expect(result.ok).toBe(true);
  });

  it.each([
    ["1 karakter", "A"],
    ["41 karakter", "A".repeat(41)],
    ["script", "<script>alert(1)</script>"],
    ["html", "Ali <b>"],
    ["bidi geçersiz kılma", "Ali‮evil"],
    ["bidi izolasyon", "Ali⁦x⁩"],
    ["sıfır genişlikli boşluk", "Ali​Kaya"],
    ["sıfır genişlikli birleştirici", "Al‍i"],
    ["kontrol karakteri", "Ali\u0007"],
    ["yeni satır", "Ali\nKaya"],
    ["rezerve önek meet-host", "meet-host:x"],
    ["rezerve önek meet-", "Meet-Ali"],
    ["rezerve önek doctor", "doctor:1"],
    ["rezerve önek patient", "patient:ali"],
    ["rezerve önek interpreter", "interpreter:ali"],
    ["rezerve önek qa-listener", "qa-listener-1"],
    ["rakamla başlar", "1Ali"],
    ["yalnız boşluk", "    "],
    ["ters eğik çizgi", "Ali\\Kaya"],
    ["çift tırnak", 'Ali "Kaya"'],
    ["iki nokta", "Ali: Kaya"],
  ])("red: %s", (_label, input) => {
    expect(normalizeGuestName(input).ok).toBe(false);
  });

  it("sonuç NFC; boşluklar kırpılır ve teke iner", () => {
    const decomposed = "José   María ";
    const result = normalizeGuestName(decomposed);
    expect(result).toEqual({ ok: true, name: "José María" });
    if (result.ok) expect(result.name).toBe(result.name.normalize("NFC"));
  });
});

describe("misafir bağlantısı ve oturum belirteçleri", () => {
  it("mg_ + 43 karakter; DB için yalnızca SHA-256 özeti", () => {
    const { token, hash } = generateGuestToken();
    expect(token).toMatch(GUEST_TOKEN_REGEX);
    expect(hash).toBe(hashToken(token));
    expect(hash).not.toContain(token);
    expect(generateGuestToken().token).not.toBe(token);
  });

  it("verifyGuestToken: doğru özet true; yanlış / null false", () => {
    const { token, hash } = generateGuestToken();
    expect(verifyGuestToken(token, hash)).toBe(true);
    expect(verifyGuestToken(token, hashToken("mg_baska"))).toBe(false);
    expect(verifyGuestToken(token, null)).toBe(false);
  });

  it("bağlantı belirteci URL parçasında (#) taşınır; extractGuestToken parçayı veya çıplak belirteci okur", () => {
    const { token } = generateGuestToken();
    const link = buildGuestLink(token, "tr");
    expect(link).toMatch(/\/tr\/meet\/join#mg_/);
    expect(new URL(link).search).toBe("");
    expect(extractGuestToken(link)).toBe(token);
    expect(extractGuestToken(token)).toBe(token);
    expect(extractGuestToken("https://x.test/tr/meet/join#bozuk")).toBeNull();
  });

  it("oturum belirteci: geçerli; kurcalanmış, başka toplantı, süresi dolmuş, bozuk → null", () => {
    const endsAt = new Date(Date.now() + 30 * 60_000);
    const session = issueGuestSession("guest-1", "meeting-1", endsAt);
    expect(verifyGuestSession(session, "meeting-1")).toEqual({ guestId: "guest-1" });
    expect(verifyGuestSession(session, "meeting-2")).toBeNull();
    expect(verifyGuestSession(session.replace("guest-1", "guest-2"), "meeting-1")).toBeNull();
    expect(verifyGuestSession(session.slice(0, -2) + "xx", "meeting-1")).toBeNull();
    expect(verifyGuestSession("gs_v1.a.b.c", "meeting-1")).toBeNull();
    expect(verifyGuestSession("p_v1.a.b.1.admin.x", "meeting-1")).toBeNull();
    // endsAt + 10 dk sonrası geçersiz
    expect(verifyGuestSession(session, "meeting-1", endsAt.getTime() + 10 * 60_000 + 1000)).toBeNull();
  });
});

describe("yetki türetmesi (canHostMeetings)", () => {
  const granted = new Date();
  it("ADMIN her zaman yetkili", () => expect(canHostMeetings({ role: "ADMIN", meetingHostGrantedAt: null })).toBe(true));
  it("panel rolü + yetki → true; yetkisiz → false", () => {
    expect(canHostMeetings({ role: "EDITOR", meetingHostGrantedAt: granted })).toBe(true);
    expect(canHostMeetings({ role: "MANAGER", meetingHostGrantedAt: null })).toBe(false);
  });
  it("doktor profili bağlı USER uygun; diğer roller değil", () => {
    expect(isMeetingHostEligible({ role: "USER", doctorProfile: { id: "d" } })).toBe(true);
    expect(isMeetingHostEligible({ role: "USER", doctorProfile: null })).toBe(false);
    expect(isMeetingHostEligible({ role: "CUSTOMER" })).toBe(false);
    expect(isMeetingHostEligible({ role: "INTERPRETER" })).toBe(false);
  });
  it("rolü düşürülmüş kullanıcıda eski yetki işlemez", () => {
    expect(canHostMeetings({ role: "USER", meetingHostGrantedAt: granted, doctorProfile: null })).toBe(false);
  });
});

describe("davet e-postası içeriği (PII yok)", () => {
  const data = {
    title: "Weekly <call>",
    hostName: "Op. Dr. M. Demir",
    startsAt: new Date("2026-11-12T10:30:00Z"),
    endsAt: new Date("2026-11-12T11:00:00Z"),
    joinUrl: "https://example.com/en/meet/join#mg_sample",
  };
  it.each(["en", "tr", "de", "es", "fr", "ar", "ru", "ro", "sr-latn"])("%s: başlık kaçırılır, bağlantı düğmede, saat yer alır", (locale) => {
    const mail = buildMeetingInviteEmail({ ...data, locale });
    expect(mail.bodyHtml).toContain("Weekly &lt;call&gt;");
    expect(mail.bodyHtml).not.toContain("<call>");
    expect(mail.bodyHtml).toContain("13:30");
    expect(mail.cta.url).toBe(data.joinUrl);
    expect(mail.subject.length).toBeGreaterThan(10);
  });
});
