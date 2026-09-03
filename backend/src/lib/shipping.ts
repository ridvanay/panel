/**
 * Kargo hesabı — TEK yer (bkz. `.claude/architect-scope-ecommerce-pro-template.md` §3.3,
 * bağlayıcı karar). Üç tüketici: sepet DTO'su (`cart.routes.ts`), checkout (integration-agent,
 * taze okuma) ve `Order.shippingCents` snapshot'ı. Frontend para matematiğini TEKRARLAMAZ —
 * "ücretsiz kargoya son X TL" metni `remainingCents`'ten üretilir, kendisi hesaplamaz.
 */

export interface ShippingSettingsInput {
  /** `SiteSettings.shippingFlatFeeCents` — `null` = kargo HİÇ hesaplanmaz, hiçbir yerde gösterilmez. */
  shippingFlatFeeCents: number | null;
  /** `SiteSettings.freeShippingThresholdCents` — `null` = eşik yok, bedel HER ZAMAN uygulanır. */
  freeShippingThresholdCents: number | null;
}

export interface ComputedShipping {
  /** `false` ise `shippingFlatFeeCents` ayarlanmamıştır — arayüz kargo satırı/çubuğu GÖSTERMEZ. */
  configured: boolean;
  /** Uygulanacak kargo bedeli (kuruş). Eşik aşıldıysa veya kargo yapılandırılmamışsa 0. */
  feeCents: number;
  thresholdCents: number | null;
  /** Ücretsiz kargoya kalan tutar (kuruş). Eşik aşıldıysa 0, eşik tanımsızsa ya da kargo
   * yapılandırılmamışsa `null`. */
  remainingCents: number | null;
  isFree: boolean;
}

/**
 * `subtotalCents` üzerinden kargo bedelini hesaplar. `shippingFlatFeeCents === null` ise
 * bugünkü (bu alanlardan ÖNCEKİ) davranışın BİREBİR aynısı korunur: kargo hiç hesaplanmaz.
 * Eşik `null` iken bedel HER ZAMAN uygulanır; eşik doluyken `subtotalCents >= thresholdCents`
 * ise bedel 0'a düşer (EŞİT dahil — "eşiğin tam üstü" ile "eşiğe eşit" AYNI muameleyi görür).
 */
export function computeShipping(subtotalCents: number, settings: ShippingSettingsInput): ComputedShipping {
  if (settings.shippingFlatFeeCents === null) {
    return { configured: false, feeCents: 0, thresholdCents: null, remainingCents: null, isFree: false };
  }

  const thresholdCents = settings.freeShippingThresholdCents ?? null;
  const thresholdReached = thresholdCents !== null && subtotalCents >= thresholdCents;
  const feeCents = thresholdReached ? 0 : settings.shippingFlatFeeCents;
  const remainingCents = thresholdCents === null ? null : Math.max(thresholdCents - subtotalCents, 0);

  return {
    configured: true,
    feeCents,
    thresholdCents,
    remainingCents,
    isFree: feeCents === 0,
  };
}
