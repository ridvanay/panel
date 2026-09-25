/**
 * `POST /api/revalidate`'in paylaşılan sırrı (backend `REVALIDATE_SECRET` ile BİREBİR aynı olmalı).
 * Çalışma zamanında okunur (`NEXT_PUBLIC_` DEĞİL, imaja gömülmez — `frontend/.env.local` env_file).
 *
 * Tanımsız, yalnızca boşluk veya `.env.local.example`'daki herkesin bildiği yer tutucu → `null`:
 * uç her isteği 401 ile reddeder (fail-closed). Yer tutucu kabul edilseydi, örnek dosyayı olduğu
 * gibi kopyalayan bir kurulumda sırrı herkes bilirdi.
 */
const PLACEHOLDER_SECRETS = new Set(["change-me-in-production"]);

export function getRevalidateSecret(): string | null {
  const value = process.env.REVALIDATE_SECRET?.trim();
  return value && !PLACEHOLDER_SECRETS.has(value) ? value : null;
}
