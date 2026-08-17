import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { resetDatabase } from "../helpers/reset-db";

/**
 * devops-agent bulgusu (2026-08-17, lokal docker-compose deploy) — `app.ts`'in `onReady` hook'u
 * ÖNCEDEN 8 ayrı `await`/senkron çağrıyı (import/export/scheduled-publish/cart/webhook kurtarma
 * + scheduler'ları) HİÇ try/catch OLMADAN art arda çalıştırıyordu. Bunlardan HERHANGİ biri
 * (ör. migration henüz uygulanmadan container ayağa kalkarsa `recoverStuckImportJobs`) hata
 * fırlatırsa `onReady` reddedilir → `server.ts`'teki `await app.listen()` reddedilir →
 * `process.exit(1)` çağrılır — TAMAMEN ilgisiz 7 alt sistem + TÜM route'lar dahil backend'in
 * TAMAMI ayağa kalkamadan ölürdü. Bu test, `app.ts`'teki her mantıksal grubun (bkz. app.ts
 * içindeki try/catch blokları) KENDİ hatasıyla İZOLE olduğunu, sunucunun yine de açıldığını VE
 * hatanın sessizce yutulmayıp `app.log.error` ile loglandığını kanıtlar.
 */
const recoverStuckImportJobsMock = vi.hoisted(() =>
  vi.fn<() => Promise<void>>(async () => {
    throw new Error("simulated: relation \"ImportJob\" does not exist (migration henüz uygulanmamış)");
  }),
);

vi.mock("../../src/modules/import/import.worker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/modules/import/import.worker")>();
  return {
    ...actual,
    recoverStuckImportJobs: recoverStuckImportJobsMock,
  };
});

describe("app.ts — onReady hook hata izolasyonu (devops-agent bulgusu, 2026-08-17)", () => {
  let prisma: PrismaClient;
  let app: FastifyInstance | undefined;

  beforeEach(async () => {
    vi.resetModules();
    recoverStuckImportJobsMock.mockClear();
    prisma = new PrismaClient();
    await resetDatabase(prisma);
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    await prisma.$disconnect();
  });

  it("import kurtarma grubu hata fırlatsa bile sunucu açılır, hata loglanır ve SONRAKİ bağımsız gruplar (export kurtarma dahil) normal şekilde çalışmaya devam eder", async () => {
    // `onReady`'de import grubundan SONRA çalışan export kurtarma grubunun hâlâ çalıştığını
    // kanıtlamak için önceden PROCESSING'de asılı bir ExportJob oluşturuyoruz.
    const stuckExport = await prisma.exportJob.create({
      data: { type: "USERS", format: "CSV", status: "PROCESSING" },
    });

    const { buildApp } = await import("../../src/app");
    app = buildApp();

    const errorLogSpy = vi.spyOn(app.log, "error");

    // ÖNCEDEN: import grubundaki hata `onReady`'yi reddedip `app.ready()`'yi reddederdi
    // (server.ts'te process.exit(1) tetiklenirdi). ARTIK: hata izole edilir, `app.ready()`
    // başarıyla tamamlanır.
    await expect(app.ready()).resolves.not.toThrow();

    // Mocklanan import kurtarma fonksiyonu gerçekten çağrıldı ve hata fırlattı...
    expect(recoverStuckImportJobsMock).toHaveBeenCalledTimes(1);
    // ...ama bu hata SESSİZCE yutulmadı — `app.log.error` ile loglandı (observability-agent'ın
    // yakalayabilmesi için `error` seviyesinde).
    expect(errorLogSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining("İçe aktarma"),
    );

    // Import grubundaki hataya RAĞMEN sonraki bağımsız grup (export kurtarma) normal şekilde
    // çalıştı: PROCESSING'de asılı kalmış iş FAILED'e çevrildi.
    const stuckExportAfter = await app.prisma.exportJob.findUniqueOrThrow({ where: { id: stuckExport.id } });
    expect(stuckExportAfter.status).toBe("FAILED");
  });

  it("hiçbir grup hata fırlatmadığında davranış ÖNCEKİYLE AYNI kalır: tüm gruplar çalışır, sunucu normal açılır", async () => {
    recoverStuckImportJobsMock.mockImplementationOnce(async () => {});

    const { buildApp } = await import("../../src/app");
    app = buildApp();

    const errorLogSpy = vi.spyOn(app.log, "error");

    await expect(app.ready()).resolves.not.toThrow();

    expect(recoverStuckImportJobsMock).toHaveBeenCalledTimes(1);
    expect(errorLogSpy).not.toHaveBeenCalled();
  });
});
