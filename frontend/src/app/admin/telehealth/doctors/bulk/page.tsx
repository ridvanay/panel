"use client";

import { CalendarClock } from "lucide-react";
import { PageHeading } from "@/components/admin/page-heading";
import { LinkButton } from "@/components/ui/link-button";
import { BulkAvailabilityPanel } from "@/components/admin/telehealth/bulk-availability/bulk-availability-panel";

/** Paket Q — doktor çalışma saatleri ve izinleri için toplu giriş (yalnızca ADMIN). */
export default function AdminTelehealthBulkAvailabilityPage() {
  return (
    <div className="space-y-6">
      <PageHeading
        icon={CalendarClock}
        title="Toplu çalışma saatleri / izin"
        description="Excel (CSV) şablonuyla ya da birden çok doktoru seçerek haftalık saatleri ve izinleri tek seferde girin. Her işlem önizlenir ve geri alınabilir."
        actions={
          <LinkButton href="/admin/telehealth/doctors" variant="outline">
            Doktorlar
          </LinkButton>
        }
      />
      <BulkAvailabilityPanel />
    </div>
  );
}
