/** PageView günlük bucket'ı için: bugünün UTC gece yarısı. */
export function startOfUtcDay(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}
