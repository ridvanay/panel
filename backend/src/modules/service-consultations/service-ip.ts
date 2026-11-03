import net from "node:net";

/**
 * Paket AI - oran siniri / gunluk tavan anahtari: IPv4 tam adres, IPv6 /64 oneki (bir abonenin /64'u icindeki adresler
 * tek kisi sayilir; adres degistirerek sinirdan kacilamaz). IPv4-eslemeli IPv6 (`::ffff:1.2.3.4`) IPv4 sayilir.
 */
export function ipRateKey(ip: string | undefined | null): string {
  const raw = (ip ?? "").trim().toLowerCase();
  if (!raw) return "unknown";
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw);
  if (mapped) return mapped[1]!;
  if (net.isIPv4(raw)) return raw;
  if (!net.isIPv6(raw)) return raw;
  const zone = raw.split("%")[0]!;
  const [head = "", tail = ""] = zone.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const missing = zone.includes("::") ? 8 - headParts.length - tailParts.length : 0;
  const groups = [...headParts, ...Array<string>(Math.max(missing, 0)).fill("0"), ...tailParts].map((g) => g.padStart(4, "0"));
  return `v6:${groups.slice(0, 4).join(":")}`;
}
