"use client";

import { notFound } from "next/navigation";
import { MeetingsManager } from "@/components/meetings/meetings-manager";
import { EXTERNAL_MEETINGS_ENABLED } from "@/lib/feature-flags";

/**
 * Paket AG İş 3 — `/admin/meetings`: harici görüntülü toplantılar (ADMIN/MANAGER/EDITOR; yetkiyi sunucu doğrular).
 * AI İş 3 hızlı sürüm: `EXTERNAL_MEETINGS_ENABLED` kapalıyken sayfa yoktur (`notFound`).
 */
export default function AdminMeetingsPage() {
  if (!EXTERNAL_MEETINGS_ENABLED) notFound();
  return (
    <div className="space-y-6">
      <MeetingsManager variant="admin" />
    </div>
  );
}
