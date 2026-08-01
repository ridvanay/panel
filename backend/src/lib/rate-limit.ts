/**
 * Şifre doğrulaması gerektiren hassas uçlar (brute-force hedefi olabilir) için paylaşılan
 * route-level rate limit sabiti. `env.RATE_LIMIT_MAX` (global limit, admin gezinme trafiğini
 * karşılayacak şekilde gevşetildi) tek başına yeterli değil — bu yüzden `auth.routes.ts::AUTH_RATE_LIMIT`
 * ile aynı pattern (route-level `config.rateLimit`) burada da uygulanır.
 *
 * Kullanan uçlar: `security.routes.ts` (2FA disable/backup-codes regenerate),
 * `users.routes.ts` (`POST /me/change-password`).
 */
export const SENSITIVE_ACTION_RATE_LIMIT = { max: 5, timeWindow: "1 minute" };
