import { TOTP_STEP_MS } from "../../src/lib/totp";

/**
 * Paket G — otplib penceresi 0 (yalnızca o anki 30 sn'lik adım) olduğu için test içinde üretilen kod
 * adım sınırında geçersizleşebilir. Sınıra 4 sn'den az kaldıysa bir sonraki adımı bekler.
 */
export async function awaitFreshTotpStep(): Promise<void> {
  const remaining = TOTP_STEP_MS - (Date.now() % TOTP_STEP_MS);
  if (remaining < 4000) await new Promise((r) => setTimeout(r, remaining + 50));
}
