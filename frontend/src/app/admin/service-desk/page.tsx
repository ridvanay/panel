"use client";

import { DeskRoleGate } from "@/components/admin/service-desk/desk-role-gate";
import { ServiceDeskOverviewPage } from "@/components/admin/service-desk/desk-overview";

/** Paket AI İş 3 - `/admin/service-desk`: genel anahtar, masa ayarları, çalışma saatleri, tatil günleri (ADMIN/MANAGER). */
export default function AdminServiceDeskPage() {
  return (
    <DeskRoleGate>
      <ServiceDeskOverviewPage />
    </DeskRoleGate>
  );
}
