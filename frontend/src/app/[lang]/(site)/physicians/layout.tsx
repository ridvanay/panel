import type { ReactNode } from "react";

/**
 * Paket AH — `/physicians*` ziyaretçiye kapalı; sayfalar kalıcı yönlendirme verir. Önceki telehealth
 * modül kapısı/tema sarmalayıcısı kaldırıldı (yönlendirme modül durumundan bağımsız çalışmalı).
 */
export default function PhysiciansLayout({ children }: { children: ReactNode }) {
  return children;
}
