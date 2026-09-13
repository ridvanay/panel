/**
 * [TCT] §9.7.7 KARAR K10a (bağlayıcı) — komisyon bölüştürme, `GET /doctor/earnings`
 * (telehealth.portal.routes.ts) VE `GET /admin/telehealth/analytics/overview`
 * (telehealth.analytics.routes.ts) arasında PAYLAŞILAN TEK yardımcı. İki uç aynı sayıyı FARKLI
 * biçimde hesaplarsa (ör. biri satır bazında yuvarlar, diğeri toplamı yuvarlar) doktor ile admin
 * panelinin kazanç rakamları TUTARSIZLAŞIR — bu yüzden mantık BURADA, TEK yerde yaşar.
 *
 * `commissionCents = round(priceCents * ratePercent / 100)` — Postgres `round(numeric)` pozitif
 * girdilerde JS `Math.round` ile EŞDEĞERDİR (bkz. tests/unit/telehealth-commission-parity.test.ts).
 */
export interface CommissionSplit {
  grossCents: number;
  commissionCents: number;
  netCents: number;
}

export function splitCommission(priceCents: number, ratePercent: number): CommissionSplit {
  const commissionCents = Math.round((priceCents * ratePercent) / 100);
  return {
    grossCents: priceCents,
    commissionCents,
    netCents: priceCents - commissionCents,
  };
}
