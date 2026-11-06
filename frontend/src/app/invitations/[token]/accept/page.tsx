"use client";

import { use } from "react";
import { AcceptInvitationView } from "@/components/dashboard/accept-invitation-view";

/** Eski davet bağlantısı (token yol parçasında) — Paket AP geçiş süresince; adres `/invitations/accept`'e çevrilir. */
export default function LegacyAcceptInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <AcceptInvitationView legacyPathToken={token} />;
}
