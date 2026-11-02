"use client";

import { MeetingsManager } from "@/components/meetings/meetings-manager";

/** Paket AG İş 3 — `/admin/meetings`: harici görüntülü toplantılar (ADMIN/MANAGER/EDITOR; yetkiyi sunucu doğrular). */
export default function AdminMeetingsPage() {
  return (
    <div className="space-y-6">
      <MeetingsManager variant="admin" />
    </div>
  );
}
