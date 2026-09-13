import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { splitCommission } from "../../src/modules/telehealth/lib/commission";

/**
 * [TCT] §9.7.7 KARAR K10a (ZORUNLU) — `GET /admin/telehealth/analytics/overview`, `commission.ts::
 * splitCommission`'ın JS'te satır bazında yaptığı yuvarlamayı Postgres'te
 * `round(priceCents * rate / 100)` raw SQL'i ile TOPLU (aggregate) olarak yeniden üretir
 * (bkz. telehealth.analytics.routes.ts). Bu test o iki yolun AYNI sayıyı ürettiğini — yani
 * Postgres `round(numeric)`'in JS `Math.round`'la (pozitif girdilerde) EŞDEĞER olduğunu —
 * sabit bir fiyat/oran kümesi üzerinde doğrular. Gerçek bir `Appointment` satırına İHTİYAÇ
 * YOKTUR; doğrudan `SELECT round(...)` çalıştırılır (`app.prisma` yalnızca DB bağlantısı içindir).
 */
describe("modules/telehealth/lib/commission — splitCommission ~ Postgres round() PARİTESİ", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const FIXTURE_PRICES_CENTS = [0, 1, 50, 99, 100, 12345, 50000, 100000, 333333, 999999, 1000000];
  const FIXTURE_RATES_PERCENT = [0, 5, 10, 12.5, 15, 20, 33.33, 50, 99.99, 100];

  it("her (priceCents, ratePercent) çifti için commissionCents JS (splitCommission) ile Postgres round() arasında BİREBİR eşleşir", async () => {
    for (const priceCents of FIXTURE_PRICES_CENTS) {
      for (const rate of FIXTURE_RATES_PERCENT) {
        const jsResult = splitCommission(priceCents, rate);

        const rows = await app.prisma.$queryRaw<{ commission_cents: bigint }[]>`
          SELECT round(${priceCents}::numeric * ${rate}::numeric / 100)::bigint AS commission_cents
        `;
        const sqlCommissionCents = Number(rows[0]!.commission_cents);

        expect(sqlCommissionCents).toBe(jsResult.commissionCents);
        expect(jsResult.grossCents).toBe(priceCents);
        expect(jsResult.netCents).toBe(priceCents - sqlCommissionCents);
      }
    }
  });

  it("SUM(round(...)) — çoklu satırın Postgres'te TOPLANMASI, satır bazında splitCommission TOPLAMIYLA eşleşir (aggregate parite)", async () => {
    const rows = FIXTURE_PRICES_CENTS.map((priceCents) => ({ priceCents, rate: 15 }));
    const expectedTotal = rows.reduce((sum, row) => sum + splitCommission(row.priceCents, row.rate).commissionCents, 0);

    // `telehealth.analytics.routes.ts`'teki `SUM(round(a."priceCents" * rate::numeric / 100))`
    // İLE AYNI şekil — VALUES ile geçici bir satır kümesi kurup aynı ifadeyi TOPLAR.
    const priceList = rows.map((row) => row.priceCents);
    const sumRows = await app.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COALESCE(SUM(round(v.price::numeric * 15::numeric / 100)), 0)::bigint AS total
      FROM unnest(${priceList}::int[]) AS v(price)
    `;
    const sqlTotal = Number(sumRows[0]!.total);

    expect(sqlTotal).toBe(expectedTotal);
  });
});
