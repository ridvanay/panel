import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TokenVerifier } from "livekit-server-sdk";
import {
  MEETING_END_GRACE_MS,
  MEETING_GUEST_IDENTITY_PREFIX,
  MEETING_HOST_IDENTITY_PREFIX,
  computeMeetingTokenTtlSec,
  isCountedParticipantState,
  createMeetingGuestToken,
  createMeetingHostToken,
  ensureMeetingRoom,
  generateMeetingRoomName,
  kickAllMeetingParticipants,
  removeMeetingParticipant,
} from "../../src/modules/telehealth/lib/meeting-livekit";
import { createMeetingToken, type LiveKitConfig } from "../../src/modules/telehealth/lib/livekit";

const CONFIG: LiveKitConfig = {
  url: "wss://test-project.livekit.cloud",
  apiKey: "test-api-key",
  apiSecret: "test-api-secret-value-should-never-leak",
  tokenTtlMin: 180,
  roomEmptyTimeoutSec: 300,
  roomDepartureTimeoutSec: 60,
  internalUrl: "",
};

async function decode(token: string) {
  return new TokenVerifier(CONFIG.apiKey, CONFIG.apiSecret).verify(token);
}

const ROOM = generateMeetingRoomName();
const FORBIDDEN_GRANTS = ["roomAdmin", "roomRecord", "roomCreate", "roomList", "hidden", "recorder", "ingressAdmin"] as const;

describe("meeting-livekit — token grant'ları", () => {
  it("oda adı meet_ + 32 hex (room_ ile çakışmaz)", () => {
    expect(ROOM).toMatch(/^meet_[0-9a-f]{32}$/);
    expect(generateMeetingRoomName()).not.toBe(ROOM);
  });

  it("ev sahibi: kamera, mikrofon, ekran paylaşımı (+ses); veri kanalı ve metadata değişikliği kapalı; yönetici grant'ı yok", async () => {
    const endsAt = new Date(Date.now() + 60 * 60_000);
    const result = await createMeetingHostToken({ roomName: ROOM, userId: "user-1", displayName: "Op. Dr. M. Demir", endsAt }, CONFIG);
    const claims = await decode(result.token);
    expect(claims.sub).toBe(`${MEETING_HOST_IDENTITY_PREFIX}user-1`);
    expect(claims.name).toBe("Op. Dr. M. Demir");
    expect(JSON.parse(claims.metadata ?? "{}")).toEqual({ role: "meeting_host" });
    const video = claims.video as Record<string, unknown>;
    expect(video.room).toBe(ROOM);
    expect(String(video.room).startsWith("meet_")).toBe(true);
    expect(video.roomJoin).toBe(true);
    expect(video.canSubscribe).toBe(true);
    expect(video.canPublish).toBe(true);
    expect(video.canPublishData).toBe(false);
    expect(video.canUpdateOwnMetadata).toBe(false);
    expect([...(video.canPublishSources as string[])].sort()).toEqual(["camera", "microphone", "screen_share", "screen_share_audio"]);
    for (const grant of FORBIDDEN_GRANTS) expect(video[grant]).toBeUndefined();
    expect(result.serverUrl).toBe(CONFIG.url);
  });

  it("misafir: yalnızca kamera + mikrofon (ekran paylaşımı YOK); veri kanalı ve metadata değişikliği kapalı; yönetici grant'ı yok", async () => {
    const endsAt = new Date(Date.now() + 60 * 60_000);
    const result = await createMeetingGuestToken({ roomName: ROOM, guestId: "guest-1", displayName: "Zeynep Kaya", endsAt }, CONFIG);
    const claims = await decode(result.token);
    expect(claims.sub).toBe(`${MEETING_GUEST_IDENTITY_PREFIX}guest-1`);
    expect(claims.name).toBe("Zeynep Kaya");
    expect(JSON.parse(claims.metadata ?? "{}")).toEqual({ role: "meeting_guest" });
    const video = claims.video as Record<string, unknown>;
    expect(video.room).toBe(ROOM);
    expect([...(video.canPublishSources as string[])].sort()).toEqual(["camera", "microphone"]);
    expect(video.canPublishData).toBe(false);
    expect(video.canUpdateOwnMetadata).toBe(false);
    for (const grant of FORBIDDEN_GRANTS) expect(video[grant]).toBeUndefined();
  });

  it("TTL: min(endsAt + 10 dk - şimdi, LIVEKIT_TOKEN_TTL_MIN), alt sınır 60 sn", () => {
    const now = Date.now();
    expect(computeMeetingTokenTtlSec(new Date(now + 30 * 60_000), CONFIG, now)).toBe(30 * 60 + MEETING_END_GRACE_MS / 1000);
    expect(computeMeetingTokenTtlSec(new Date(now + 10 * 60 * 60_000), CONFIG, now)).toBe(CONFIG.tokenTtlMin * 60);
    expect(computeMeetingTokenTtlSec(new Date(now - 60 * 60_000), CONFIG, now)).toBe(60);
  });

  it("token süresi (exp) endsAt + grace değerini ve tavanı aşmaz", async () => {
    const endsAt = new Date(Date.now() + 20 * 60_000);
    const result = await createMeetingGuestToken({ roomName: ROOM, guestId: "g", displayName: "Ada", endsAt }, CONFIG);
    const claims = await decode(result.token);
    expect(claims.exp! * 1000).toBeLessThanOrEqual(endsAt.getTime() + MEETING_END_GRACE_MS + 2000);
    expect(claims.exp! * 1000).toBeLessThanOrEqual(Date.now() + CONFIG.tokenTtlMin * 60_000 + 2000);
    expect(Date.parse(result.expiresAt)).toBeLessThanOrEqual(endsAt.getTime() + MEETING_END_GRACE_MS + 2000);
  });

  it("meet_ olmayan oda için token üretilmez", async () => {
    await expect(createMeetingHostToken({ roomName: "room_abc", userId: "u", displayName: "x", endsAt: new Date(Date.now() + 60_000) }, CONFIG)).rejects.toThrow();
    await expect(createMeetingGuestToken({ roomName: "room_abc", guestId: "g", displayName: "x", endsAt: new Date(Date.now() + 60_000) }, CONFIG)).rejects.toThrow();
    await expect(ensureMeetingRoom("room_abc", 4, { ...CONFIG, internalUrl: "http://x" })).rejects.toThrow();
  });

  it("REGRESYON: createMeetingToken (hasta/doktor) grant'ı değişmedi — veri kanalı AÇIK, kaynak kısıtı yok", async () => {
    const result = await createMeetingToken({ roomName: "room_abc", participant: { kind: "patient", id: "appt-1" } }, CONFIG);
    const video = (await decode(result.token)).video as Record<string, unknown>;
    expect(video.canPublishData).toBe(true);
    expect(video.canPublishSources).toBeUndefined();
    expect(video.canUpdateOwnMetadata).toBeUndefined();
  });
});

describe("meeting-livekit — atma kapısı", () => {
  it("removeMeetingParticipant yalnızca meet_ odası + meet-* kimliği kabul eder", async () => {
    await expect(removeMeetingParticipant("room_abc", "meet-guest:1")).rejects.toThrow();
    await expect(removeMeetingParticipant(ROOM, "patient:1")).rejects.toThrow();
    await expect(removeMeetingParticipant(ROOM, "doctor:1")).rejects.toThrow();
    await expect(removeMeetingParticipant(ROOM, "qa-listener-1")).rejects.toThrow();
  });

  it("kickAllMeetingParticipants yalnızca meet-host:/meet-guest: kimliklerini atar", async () => {
    const removeParticipant = vi.fn(async () => true);
    const listParticipants = vi.fn(async () => ["meet-host:1", "meet-guest:2", "patient:3", "doctor:4", "qa-listener-5"]);
    const outcome = await kickAllMeetingParticipants(ROOM, { listParticipants, removeParticipant });
    expect(outcome).toEqual({ removed: 2, unavailable: false });
    expect(removeParticipant.mock.calls.map((c) => (c as unknown as [string, string])[1]).sort()).toEqual(["meet-guest:2", "meet-host:1"]);
  });

  it("room_ odası boşaltılamaz; Server API yoksa unavailable", async () => {
    const deps = { listParticipants: vi.fn(async () => null), removeParticipant: vi.fn(async () => true) };
    await expect(kickAllMeetingParticipants("room_abc", deps)).rejects.toThrow();
    expect(deps.listParticipants).not.toHaveBeenCalled();
    expect(await kickAllMeetingParticipants(ROOM, deps)).toEqual({ removed: 0, unavailable: true });
  });
});

describe("kırmızı çizgi — statik güvence", () => {
  const SRC = join(__dirname, "../../src");
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
    });
  }
  const files = walk(SRC).map((full) => ({ rel: relative(SRC, full).replace(/\\/g, "/"), code: readFileSync(full, "utf8").replace(/\r\n/g, "\n") }));
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("`startRoomCompositeRecording(` çağrısı yalnızca telehealth.recording.routes.ts içinde (tanım livekit-egress.ts)", () => {
    const callers = files.filter((f) => /startRoomCompositeRecording\(/.test(strip(f.code))).map((f) => f.rel).sort();
    expect(callers).toEqual(["modules/telehealth/lib/livekit-egress.ts", "modules/telehealth/telehealth.recording.routes.ts"]);
  });

  it("toplantı dosyaları egress / kayıt modüllerini içe aktarmaz", () => {
    const meetingFiles = files.filter((f) => f.rel.startsWith("modules/meetings/") || /telehealth\/lib\/meeting-/.test(f.rel));
    expect(meetingFiles.length).toBeGreaterThanOrEqual(8);
    for (const f of meetingFiles) {
      expect(strip(f.code), f.rel).not.toMatch(/livekit-egress|recording|EgressClient/);
    }
  });

  it("toplantı kodu mevcut token üreticilerini (createMeetingToken/QaListener/Interpreter/ensureRoomConfigured) çağırmaz", () => {
    const meetingFiles = files.filter((f) => f.rel.startsWith("modules/meetings/") || /telehealth\/lib\/meeting-/.test(f.rel));
    for (const f of meetingFiles) {
      expect(strip(f.code), f.rel).not.toMatch(/\b(createMeetingToken|createQaListenerToken|createInterpreterToken|ensureRoomConfigured)\b/);
    }
  });
});

describe("Paket AM: kapasiteye sayılan katılımcı durumları", () => {
  it("yalnız JOINED(1) ve ACTIVE(2) sayılır; JOINING(0) ve DISCONNECTED(3) sayılmaz", () => {
    expect([0, 1, 2, 3].map(isCountedParticipantState)).toEqual([false, true, true, false]);
  });
});
