import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * `contact-retention.test.ts` İLE AYNI desen — gerçek DB'ye BAĞLANMAZ, `app.prisma` çağrılarını
 * mock'lar. `purgeRecordingFile`/`telehealthRecordingStorage` (FAZ A çıktıları) TAMAMEN mock'lanır
 * — bu dosya `purgeRecordingFile`'ın KENDİ davranışını DEĞİL, `runRecordingRetentionSweep`'in
 * doğru satırları/cutoff'u seçip seçmediğini ve idempotency'yi test eder.
 */

const purgeRecordingFileMock = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/telehealth-recording-archive", () => ({
  purgeRecordingFile: purgeRecordingFileMock,
}));

const storageMocks = vi.hoisted(() => ({
  listStaging: vi.fn(async () => [] as { key: string }[]),
  remove: vi.fn(async () => undefined),
}));
// Süpürücü artık çağırmadan önce yapılandırma kontrolü yapıyor (qa-agent bulgusu — gerçek
// depo yokken gürültülü ERROR loglamayı önler) — varsayılan `true` (depo yapılandırılmış),
// "yapılandırılmamış" testi kendi içinde `false`'a çevirip sonunda geri alır.
const isRecordingStorageConfiguredMock = vi.hoisted(() => vi.fn(() => true));
vi.mock("../../src/lib/telehealth-recording-storage", () => ({
  telehealthRecordingStorage: storageMocks,
  isRecordingStorageConfigured: isRecordingStorageConfiguredMock,
}));

import { RECORDING_RETENTION_MS, runRecordingRetentionSweep } from "../../src/lib/recording-retention";

interface FakeDbRecording {
  id: string;
  endsAt: Date;
  deletedAt: Date | null;
  storagePath: string | null;
}

function buildFakeApp(records: FakeDbRecording[]) {
  const auditCreate = vi.fn().mockResolvedValue({});

  const findMany = vi.fn(async (args: { where: { appointment: { endsAt: { lt: Date } } } }) => {
    const cutoff = args.where.appointment.endsAt.lt;
    return records
      .filter((r) => r.deletedAt === null && r.storagePath !== null && r.endsAt.getTime() < cutoff.getTime())
      .map((r) => ({ id: r.id }));
  });

  const app = {
    log: { error: vi.fn() },
    prisma: {
      consultationRecording: { findMany },
      auditLog: { create: auditCreate },
    },
  } as unknown as FastifyInstance;

  return { app, findMany, auditCreate };
}

describe("runRecordingRetentionSweep", () => {
  // Her `it` kendi diziyi atar; `beforeEach`'teki `mockImplementation` kapanışından (closure) erişilir.
  let records: FakeDbRecording[] = [];

  beforeEach(() => {
    purgeRecordingFileMock.mockReset();
    purgeRecordingFileMock.mockImplementation(async (_app: unknown, recordingId: string) => {
      const record = records.find((r) => r.id === recordingId);
      if (record) {
        record.deletedAt = new Date();
        record.storagePath = null;
      }
    });
    storageMocks.listStaging.mockReset().mockResolvedValue([]);
    storageMocks.remove.mockReset().mockResolvedValue(undefined);
    isRecordingStorageConfiguredMock.mockReset().mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("idempotency — ikinci art arda çağrı 0 satır siler (ilk çağrı zaten purge/deletedAt işaretledi)", async () => {
    records = [
      { id: "rec-1", endsAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), deletedAt: null, storagePath: "final/rec-1.mp4.enc" },
    ];
    const { app } = buildFakeApp(records);

    const first = await runRecordingRetentionSweep(app);
    expect(first.deletedRecordings).toBe(1);
    expect(purgeRecordingFileMock).toHaveBeenCalledTimes(1);
    expect(purgeRecordingFileMock).toHaveBeenCalledWith(app, "rec-1");

    const second = await runRecordingRetentionSweep(app);
    expect(second.deletedRecordings).toBe(0);
    // İkinci turda TEKRAR çağrılmadı (satır zaten `deletedAt` ile işaretli, `where` filtresi dışında).
    expect(purgeRecordingFileMock).toHaveBeenCalledTimes(1);
  });

  it("cutoff — randevunun KENDİ `endsAt`'inden TAM 30 gün önce silinmez (sınır dahil değil, `lt`)", async () => {
    const now = new Date("2026-09-13T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const exactlyCutoff = new Date(now.getTime() - RECORDING_RETENTION_MS); // tam 30 gün önce
    const oneDayPastCutoff = new Date(now.getTime() - RECORDING_RETENTION_MS - 24 * 60 * 60 * 1000); // 31 gün önce
    const oneDayBeforeCutoff = new Date(now.getTime() - RECORDING_RETENTION_MS + 24 * 60 * 60 * 1000); // 29 gün önce

    records = [
      { id: "rec-exact-30", endsAt: exactlyCutoff, deletedAt: null, storagePath: "final/rec-exact-30.mp4.enc" },
      { id: "rec-31-days", endsAt: oneDayPastCutoff, deletedAt: null, storagePath: "final/rec-31-days.mp4.enc" },
      { id: "rec-29-days", endsAt: oneDayBeforeCutoff, deletedAt: null, storagePath: "final/rec-29-days.mp4.enc" },
    ];
    const { app } = buildFakeApp(records);

    const result = await runRecordingRetentionSweep(app);

    expect(result.deletedRecordings).toBe(1);
    expect(purgeRecordingFileMock).toHaveBeenCalledTimes(1);
    expect(purgeRecordingFileMock).toHaveBeenCalledWith(app, "rec-31-days");
  });

  it("hiç uygun satır yoksa audit YAZILMAZ, `purgeRecordingFile` hiç çağrılmaz", async () => {
    records = [
      { id: "rec-recent", endsAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), deletedAt: null, storagePath: "final/rec-recent.mp4.enc" },
    ];
    const { app, auditCreate } = buildFakeApp(records);

    const result = await runRecordingRetentionSweep(app);

    expect(result.deletedRecordings).toBe(0);
    expect(purgeRecordingFileMock).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("yetim staging nesneleri (6 saatten eski) best-effort temizlenir", async () => {
    records = [];
    const { app } = buildFakeApp(records);
    storageMocks.listStaging.mockResolvedValueOnce([{ key: "telehealth-recordings-staging/orphan-1.mp4" }]);

    const result = await runRecordingRetentionSweep(app);

    expect(result.deletedStagingObjects).toBe(1);
    expect(storageMocks.remove).toHaveBeenCalledWith("telehealth-recordings-staging/orphan-1.mp4");
  });

  it("depo yapılandırılmamışken (ör. STORAGE_DRIVER=local) DB/depo hiç sorgulanmadan sessizce atlanır", async () => {
    isRecordingStorageConfiguredMock.mockReturnValue(false);
    records = [
      { id: "rec-1", endsAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), deletedAt: null, storagePath: "final/rec-1.mp4.enc" },
    ];
    const { app, findMany, auditCreate } = buildFakeApp(records);

    const result = await runRecordingRetentionSweep(app);

    expect(result).toEqual({ deletedRecordings: 0, deletedStagingObjects: 0 });
    expect(findMany).not.toHaveBeenCalled();
    expect(purgeRecordingFileMock).not.toHaveBeenCalled();
    expect(storageMocks.listStaging).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
