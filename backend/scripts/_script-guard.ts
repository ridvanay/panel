/**
 * Paket AH - veri script'leri icin ortak guvenlik yardimcilari.
 *  - `printTargetDb()`: hedef veritabanini (host:port/db, PAROLASIZ) yazdirir - yanlis DB'ye yazmayi gozle yakalamak icin.
 *  - `assertProdWriteAllowed()`: `NODE_ENV=production` iken YAZMA modu ek `--i-know-this-is-prod` bayragi ister.
 */
export function describeTargetDb(raw: string | undefined = process.env.DATABASE_URL): string {
  if (!raw) return "(DATABASE_URL tanımlı değil)";
  try {
    const url = new URL(raw);
    return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
  } catch {
    return "(DATABASE_URL çözümlenemedi)";
  }
}

export function printTargetDb(): void {
  console.log(`[hedef DB] ${describeTargetDb()} (NODE_ENV=${process.env.NODE_ENV ?? "tanımsız"})`);
}

export function assertProdWriteAllowed(write: boolean, argv: string[]): void {
  if (write && process.env.NODE_ENV === "production" && !argv.includes("--i-know-this-is-prod")) {
    throw new Error("NODE_ENV=production iken yazma modu için ek bayrak gerekir: --i-know-this-is-prod (hedef DB'yi yukarıdaki [hedef DB] satırından doğrulayın).");
  }
}
