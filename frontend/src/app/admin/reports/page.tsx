"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FileArchive, Plus, ShieldAlert } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeading } from "@/components/admin/page-heading";
import { CreateExportDialog } from "@/components/admin/reports/create-export-dialog";
import { ExportJobsTable } from "@/components/admin/reports/export-jobs-table";

/**
 * `/admin/reports` — Analitik Rapor Dışa Aktarma merkezi (bkz. ARCHITECTURE.md §10.8.10).
 * TÜM `/admin/reports/exports/*` uçları backend'de YALNIZCA ADMIN — bu sayfa `admin/import/page.tsx`
 * ile AYNI "rol uyuşmuyorsa erişim mesajı göster" desenini izler (backend zaten 403 döner, ama
 * UX için önceden gizlemek gerekir).
 */
export default function AdminReportsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [createOpen, setCreateOpen] = useState(false);

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeading icon={FileArchive} title="Raporlar" description="Analitik rapor dışa aktarma merkezi." />
        <EmptyState
          icon={ShieldAlert}
          title="Bu bölüme erişiminiz yok"
          description="Rapor dışa aktarma yalnızca Admin rolündeki kullanıcılara açıktır."
        />
      </div>
    );
  }

  function handleCreated() {
    toast.success("Dışa aktarma işi oluşturuldu — hazır olduğunda buradan indirebilirsiniz.");
  }

  return (
    <div className="space-y-6">
      <PageHeading
        icon={FileArchive}
        title="Raporlar"
        description="İstatistikleri CSV/PDF olarak dışa aktarın; işler arka planda hazırlanır."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Yeni Dışa Aktarma
          </Button>
        }
      />

      <ExportJobsTable />

      <CreateExportDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={handleCreated} />
    </div>
  );
}
