import { isDemoPaymentsEnabled } from "../config/env";

/**
 * `.claude/security-review-demo-payment-toggle.md` Madde 2 + architect "Ek Karar B"
 * (`.claude/architect-scope-demo-payment-doctor-counters.md`, "EK KARAR — 2026-09-15") —
 * demo ödeme NİHAİ bayrağının TEK hesaplandığı yer. "VE" — "VEYA" DEĞİL:
 *
 *   isDemoPaymentsEnabledFinal = isDemoPaymentsEnabled (env, config/env.ts, DEĞİŞMEZ)
 *                                && dbValue (SiteSettings.demoPaymentsEnabled, admin toggle'ı)
 *
 * DB bayrağı yalnızca KISITLAYICIDIR — env `false` iken bu fonksiyon `dbValue` ne olursa
 * olsun HER ZAMAN `false` döner (üretimde `isDemoPaymentsEnabled` matematiksel olarak asla
 * `true` olamaz, bkz. `config/env.ts` boot-time fail-closed koruması). Bu fonksiyon İKİ
 * çağrı yerinde de (mapper + fallback/DEFAULTS yolu) kullanılmalıdır — tek bir kaçırılmış
 * çağrı, hiç `PATCH` edilmemiş taze bir prod kurulumunda `GET /settings`in yanlışlıkla
 * `demoPaymentsEnabled: true` sızdırmasına yol açar (architect "Ek Karar B").
 */
export function computeDemoPaymentsEnabled(dbValue: boolean): boolean {
  return isDemoPaymentsEnabled && dbValue;
}
