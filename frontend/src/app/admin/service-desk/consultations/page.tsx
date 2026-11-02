"use client";

import { DeskRoleGate } from "@/components/admin/service-desk/desk-role-gate";
import { ConsultationsManager } from "@/components/admin/service-desk/consultations-manager";

/** `/admin/service-desk/consultations`: hizmet görüşmeleri listesi, detay ve iptal (ADMIN/MANAGER). */
export default function AdminServiceDeskConsultationsPage() {
  return (
    <DeskRoleGate>
      <ConsultationsManager />
    </DeskRoleGate>
  );
}
