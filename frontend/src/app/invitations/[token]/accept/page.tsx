"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import * as invitationsApi from "@/lib/api/invitations";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

type AcceptState = "idle" | "accepting" | "error" | "done";

export default function AcceptInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { status } = useAuth();
  const router = useRouter();

  const [state, setState] = useState<AcceptState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);

  async function handleAccept() {
    setState("accepting");
    setError(null);
    try {
      const membership = await invitationsApi.acceptInvitation(token);
      setOrgId(membership.organizationId);
      setState("done");
    } catch (err) {
      setError(friendlyErrorMessage(err));
      setState("error");
    }
  }

  useEffect(() => {
    if (state !== "done" || !orgId) return;
    const timer = setTimeout(() => router.replace(`/dashboard/${orgId}`), 1200);
    return () => clearTimeout(timer);
  }, [state, orgId, router]);

  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner className="h-6 w-6 text-primary" />
      </main>
    );
  }

  if (status === "unauthenticated") {
    const next = `/invitations/${token}/accept`;
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-muted px-4">
        <Card className="max-w-sm text-center">
          <h1 className="text-lg font-semibold text-foreground">Daveti kabul etmek için giriş yapın</h1>
          <p className="mt-2 text-sm text-foreground/60">
            Bu davet e-postanıza gönderildi. Devam etmek için önce giriş yapın veya bir hesap oluşturun.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <LinkButton href={`/login?next=${encodeURIComponent(next)}`} variant="secondary">
              Giriş yap
            </LinkButton>
            <LinkButton href={`/register?next=${encodeURIComponent(next)}`}>Kayıt ol</LinkButton>
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-muted px-4">
      <Card className="max-w-sm text-center">
        {state === "done" ? (
          <Alert variant="success">Davet kabul edildi. Organizasyona yönlendiriliyorsunuz…</Alert>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-foreground">Organizasyon davetini kabul et</h1>
            <p className="mt-2 text-sm text-foreground/60">Bu daveti kabul ederek organizasyona üye olacaksınız.</p>
            {error && (
              <Alert variant="error" className="mt-4 text-left">
                {error}
              </Alert>
            )}
            <Button className="mt-6" onClick={handleAccept} loading={state === "accepting"}>
              Daveti kabul et
            </Button>
          </>
        )}
      </Card>
    </main>
  );
}
