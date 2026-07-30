"use client";

import { use, useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import * as organizationsApi from "@/lib/api/organizations";
import { OrgProvider } from "@/context/org-context";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import type { Organization } from "@/lib/api/types";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const tabs = [
  { href: "", label: "Özet" },
  { href: "/members", label: "Üyeler" },
  { href: "/billing", label: "Faturalandırma" },
];

export default function OrgLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = use(params);
  const { memberships } = useAuth();
  const pathname = usePathname();

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const org = await organizationsApi.getOrganization(orgId);
      setOrganization(org);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, [orgId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const membership = memberships.find((m) => m.organizationId === orgId);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <Alert variant="error">{error}</Alert>
        <Link href="/dashboard" className="mt-4 inline-block text-sm text-primary hover:underline">
          Organizasyonlara dön
        </Link>
      </div>
    );
  }

  if (!organization || !membership) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  const basePath = `/dashboard/${orgId}`;

  return (
    <OrgProvider value={{ organization, role: membership.role, refreshOrganization: load }}>
      <div className="mx-auto max-w-5xl px-4 pt-8 sm:px-6">
        <Link href="/dashboard" className="text-sm text-foreground/50 hover:text-foreground">
          ← Organizasyonlar
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">{organization.name}</h1>

        <nav className="mt-6 flex gap-1 border-b border-border" aria-label="Organizasyon sekmeleri">
          {tabs.map((tab) => {
            const href = `${basePath}${tab.href}`;
            const active = pathname === href;
            return (
              <Link
                key={tab.href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  active ? "border-primary text-primary" : "border-transparent text-foreground/60 hover:text-foreground"
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</div>
    </OrgProvider>
  );
}
