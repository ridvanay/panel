"use client";

import { useOrg } from "@/context/org-context";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { MembershipRole } from "@/lib/api/types";

const roleLabels: Record<MembershipRole, string> = { OWNER: "Sahip", ADMIN: "Yönetici", MEMBER: "Üye" };
const roleTones: Record<MembershipRole, "primary" | "success" | "neutral"> = {
  OWNER: "primary",
  ADMIN: "success",
  MEMBER: "neutral",
};

export default function OrgOverviewPage() {
  const { organization, role } = useOrg();

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Organizasyon bilgileri</h2>
          <p className="mt-1 text-sm text-foreground/60">Kısa ad (slug): {organization.slug}</p>
        </div>
        <Badge tone={roleTones[role]}>{roleLabels[role]}</Badge>
      </div>

      <dl className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-foreground/50">Oluşturulma tarihi</dt>
          <dd className="mt-1 text-sm text-foreground">
            {new Date(organization.createdAt).toLocaleDateString("tr-TR")}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
