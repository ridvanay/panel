"use client";

import { DeskRoleGate } from "@/components/admin/service-desk/desk-role-gate";
import { CoordinatorsManager } from "@/components/admin/service-desk/coordinators-manager";

/** `/admin/service-desk/coordinators`: koordinatör atama, görünen ad, diller, aktif/pasif (ADMIN/MANAGER). */
export default function AdminServiceDeskCoordinatorsPage() {
  return (
    <DeskRoleGate>
      <CoordinatorsManager />
    </DeskRoleGate>
  );
}
