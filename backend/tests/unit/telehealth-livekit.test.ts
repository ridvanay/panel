import { describe, expect, it } from "vitest";
import { TokenVerifier } from "livekit-server-sdk";
import { buildParticipantIdentity, createMeetingToken, getLiveKitConfig, isLiveKitConfigured, type LiveKitConfig } from "../../src/modules/telehealth/lib/livekit";

/**
 * `.claude/architect-scope-telehealth-template.md` §4.4/§8 — integration-agent'ın SAHASI.
 * `env`'e dokunmadan test edilebilmesi için `LiveKitConfig` fonksiyonlara PARAMETRE olarak
 * enjekte edilir (bkz. livekit.ts::createMeetingToken imzası) — gerçek `LIVEKIT_API_SECRET`
 * hiçbir zaman testte dahi loglanmaz/serileştirilmez.
 */

const TEST_CONFIG: LiveKitConfig = {
  url: "wss://test-project.livekit.cloud",
  apiKey: "test-api-key",
  apiSecret: "test-api-secret-value-should-never-leak",
  tokenTtlMin: 15,
};

describe("modules/telehealth/lib/livekit", () => {
  describe("isLiveKitConfigured", () => {
    it("üç değişkenin HEPSİ doluyken true döner", () => {
      expect(isLiveKitConfigured(TEST_CONFIG)).toBe(true);
    });

    it("herhangi biri boşken false döner", () => {
      expect(isLiveKitConfigured({ ...TEST_CONFIG, url: "" })).toBe(false);
      expect(isLiveKitConfigured({ ...TEST_CONFIG, apiKey: "" })).toBe(false);
      expect(isLiveKitConfigured({ ...TEST_CONFIG, apiSecret: "" })).toBe(false);
    });

    it("gerçek `env` çağrıldığında (test ortamında LIVEKIT_* tanımsız) false döner", () => {
      // §4.4 madde 3 — varsayılan davranış "yapılandırılmamış"tır; `.env.test` bu değişkenleri
      // KASITLI OLARAK tanımlamaz (devops-agent notu).
      expect(isLiveKitConfigured(getLiveKitConfig())).toBe(false);
    });
  });

  describe("buildParticipantIdentity — §8 madde 1 (PII İÇERMEZ)", () => {
    it("hasta identity'si `patient:<appointmentId>` biçimindedir", () => {
      expect(buildParticipantIdentity({ kind: "patient", id: "appt-123" })).toBe("patient:appt-123");
    });

    it("doktor identity'si `doctor:<doctorId>` biçimindedir", () => {
      expect(buildParticipantIdentity({ kind: "doctor", id: "doc-456" })).toBe("doctor:doc-456");
    });
  });

  describe("createMeetingToken — §8 (grant kapsamı/TTL/identity denetimi)", () => {
    it("token YALNIZCA roomJoin+room grant'ı taşır; roomCreate/roomAdmin/roomList/ingressAdmin YOK", async () => {
      const result = await createMeetingToken(
        { roomName: "room_deadbeef", participant: { kind: "patient", id: "appt-abc" } },
        TEST_CONFIG
      );

      expect(result.serverUrl).toBe(TEST_CONFIG.url);
      expect(result.roomName).toBe("room_deadbeef");
      expect(typeof result.token).toBe("string");

      const verifier = new TokenVerifier(TEST_CONFIG.apiKey, TEST_CONFIG.apiSecret);
      const claims = await verifier.verify(result.token);

      expect(claims.video?.roomJoin).toBe(true);
      expect(claims.video?.room).toBe("room_deadbeef");
      expect(claims.video?.canPublish).toBe(true);
      expect(claims.video?.canSubscribe).toBe(true);
      expect(claims.video?.roomCreate).toBeFalsy();
      expect(claims.video?.roomAdmin).toBeFalsy();
      expect(claims.video?.roomList).toBeFalsy();
      expect(claims.video?.ingressAdmin).toBeFalsy();
    });

    it("identity KİŞİSEL VERİ İÇERMEZ (e-posta/ad formatına uymaz)", async () => {
      const result = await createMeetingToken(
        { roomName: "room_deadbeef", participant: { kind: "doctor", id: "doctor-uuid-1" } },
        TEST_CONFIG
      );
      const verifier = new TokenVerifier(TEST_CONFIG.apiKey, TEST_CONFIG.apiSecret);
      const claims = await verifier.verify(result.token);

      expect(claims.sub).toBe("doctor:doctor-uuid-1");
      expect(claims.sub).not.toMatch(/@/);
      expect(claims.name).toBeUndefined();
    });

    it("TTL `tokenTtlMin`'e eşittir (`exp - iat` saniye cinsinden)", async () => {
      const before = Math.floor(Date.now() / 1000);
      const result = await createMeetingToken(
        { roomName: "room_ttl", participant: { kind: "patient", id: "appt-ttl" } },
        TEST_CONFIG
      );
      const verifier = new TokenVerifier(TEST_CONFIG.apiKey, TEST_CONFIG.apiSecret);
      const claims = await verifier.verify(result.token);

      expect(claims.exp).toBeDefined();
      const ttlSeconds = (claims.exp as number) - before;
      // Küçük yürütme gecikmesi payı — tam TTL (15dk = 900sn) civarında olmalı, ASLA aşmamalı.
      expect(ttlSeconds).toBeLessThanOrEqual(TEST_CONFIG.tokenTtlMin * 60);
      expect(ttlSeconds).toBeGreaterThan(TEST_CONFIG.tokenTtlMin * 60 - 5);

      const expiresAtMs = new Date(result.expiresAt).getTime();
      expect(expiresAtMs).toBeGreaterThan(Date.now());
    });

    it("üretilen JWT hiçbir yerde `apiSecret`'in HAM değerini TAŞIMAZ", async () => {
      const result = await createMeetingToken(
        { roomName: "room_secret_check", participant: { kind: "patient", id: "appt-secret" } },
        TEST_CONFIG
      );
      expect(result.token).not.toContain(TEST_CONFIG.apiSecret);
      expect(JSON.stringify(result)).not.toContain(TEST_CONFIG.apiSecret);
    });
  });
});
