"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import * as organizationsApi from "@/lib/api/organizations";
import { useAuth } from "@/context/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import type { Organization } from "@/lib/api/types";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

export default function DashboardHomePage() {
  const { refreshSession } = useAuth();
  const [orgs, setOrgs] = useState<Organization[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadOrgs = useCallback(async () => {
    try {
      const page = await organizationsApi.listOrganizations();
      setOrgs(page.items);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await loadOrgs();
    })();
  }, [loadOrgs]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      await organizationsApi.createOrganization({ name });
      setName("");
      // Yeni org, JWT dışında tutulan üyelik listesine de eklenmeli (bkz. backend/README.md RBAC notu).
      await Promise.all([loadOrgs(), refreshSession()]);
    } catch (err) {
      setCreateError(friendlyErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold text-foreground">Organizasyonlarınız</h1>
      <p className="mt-1 text-sm text-foreground/60">
        Devam etmek için bir organizasyon seçin ya da yeni bir tane oluşturun.
      </p>

      {loadError && (
        <Alert variant="error" className="mt-6">
          {loadError}
        </Alert>
      )}

      {orgs === null ? (
        <div className="mt-8 flex justify-center">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {orgs.map((org) => (
            <li key={org.id}>
              <Link href={`/dashboard/${org.id}`}>
                <Card className="transition-colors hover:border-primary">
                  <span className="font-medium text-foreground">{org.name}</span>
                </Card>
              </Link>
            </li>
          ))}
          {orgs.length === 0 && (
            <li className="rounded-md border border-dashed border-border p-6 text-center text-sm text-foreground/60">
              Henüz bir organizasyonunuz yok.
            </li>
          )}
        </ul>
      )}

      <Card className="mt-8">
        <h2 className="text-base font-semibold text-foreground">Yeni organizasyon oluştur</h2>
        {createError && (
          <Alert variant="error" className="mt-4">
            {createError}
          </Alert>
        )}
        <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={handleCreate} noValidate>
          <div className="flex-1">
            <Field id="org-name" label="Organizasyon adı" required>
              {(inputProps) => (
                <Input {...inputProps} required value={name} onChange={(e) => setName(e.target.value)} />
              )}
            </Field>
          </div>
          <Button type="submit" loading={creating}>
            Oluştur
          </Button>
        </form>
      </Card>
    </div>
  );
}
