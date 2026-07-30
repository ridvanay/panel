"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { MembershipRole, Organization } from "@/lib/api/types";

interface OrgContextValue {
  organization: Organization;
  role: MembershipRole;
  /** Aynı organizasyon verisini yeniden çekmek için (ör. isim güncellemesi sonrası). */
  refreshOrganization: () => Promise<void>;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ value, children }: { value: OrgContextValue; children: ReactNode }) {
  return <OrgContext value={value}>{children}</OrgContext>;
}

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg, <OrgProvider> içinde (yani /dashboard/[orgId] altında) kullanılmalıdır.");
  return ctx;
}
