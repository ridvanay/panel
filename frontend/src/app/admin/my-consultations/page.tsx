"use client";

import { MyConsultationsPanel } from "@/components/admin/service-desk/my-consultations-panel";

/** Paket AI İş 3 - `/admin/my-consultations`: koordinatörün bugünkü ve yaklaşan görüşmeleri (EDITOR dahil; `isServiceCoordinator`). */
export default function AdminMyConsultationsPage() {
  return <MyConsultationsPanel />;
}
