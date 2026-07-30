import type { DeviceType } from "@prisma/client";

/** User-Agent string'inden kaba (ama bağımlılıksız/hızlı) cihaz sınıflandırması yapar. */
export function detectDeviceType(userAgent: string | undefined): DeviceType {
  if (!userAgent) return "UNKNOWN";
  if (/iPad|Tablet(?!.*Mobile)/i.test(userAgent)) return "TABLET";
  if (/Mobi|Android|iPhone/i.test(userAgent)) return "MOBILE";
  return "DESKTOP";
}
