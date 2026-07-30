"use client";

import { HealthPanel } from "@/components/admin/system/health-panel";
import { PageHeading } from "@/components/admin/page-heading";
import { Activity } from "lucide-react";

export default function AdminSystemHealthPage() {
  return (
    <div className="space-y-6">
      <PageHeading
        icon={Activity}
        title="Sistem Sağlığı"
        description="Veritabanı, bellek ve depolama durumunu gerçek zamanlıya yakın izleyin."
      />

      <HealthPanel />
    </div>
  );
}
