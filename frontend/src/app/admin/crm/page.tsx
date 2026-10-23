"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import * as crmApi from "@/lib/api/crm";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

/** Paket N1 — CRM giriş ekranı: takip durumu. (N3'te tam Genel Bakış panosu ile değiştirilir.) */
export default function CrmHomePage() {
  const settings = useQuery({ queryKey: ["crm-settings"], queryFn: crmApi.getCrmSettings });
  if (settings.isPending) return <Skeleton className="h-28 w-full" />;
  if (settings.isError) return <Alert variant="error">{friendlyErrorMessage(settings.error)}</Alert>;
  return (
    <Card className="space-y-2">
      <p className="text-sm font-medium">Takip durumu: {settings.data.trackingEnabled ? "Açık" : "Kapalı"}</p>
      <p className="text-sm text-foreground/70">
        Takip varsayılan olarak kapalıdır. Açmak ve gizlilik ayarlarını yapmak için{" "}
        <Link href="/admin/crm/settings" className="font-medium text-primary underline">
          CRM Ayarları
        </Link>
        &apos;na gidin.
      </p>
    </Card>
  );
}
