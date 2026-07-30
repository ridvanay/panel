"use client";

import { useCallback, useEffect, useState } from "react";
import { useOrg } from "@/context/org-context";
import * as billingApi from "@/lib/api/billing";
import * as plansApi from "@/lib/api/plans";
import { ApiClientError } from "@/lib/api/error";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import type { Plan, Subscription, SubscriptionStatus } from "@/lib/api/types";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const statusLabels: Record<SubscriptionStatus, string> = {
  TRIALING: "Deneme sürümü",
  ACTIVE: "Aktif",
  PAST_DUE: "Ödeme gecikti",
  CANCELED: "İptal edildi",
  INCOMPLETE: "Tamamlanmadı",
};

const statusTones: Record<SubscriptionStatus, "primary" | "success" | "danger" | "neutral"> = {
  TRIALING: "primary",
  ACTIVE: "success",
  PAST_DUE: "danger",
  CANCELED: "neutral",
  INCOMPLETE: "neutral",
};

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency }).format(cents / 100);
}

export default function BillingPage() {
  const { organization, role } = useOrg();
  const canManageBilling = role === "OWNER";

  const [subscription, setSubscription] = useState<Subscription | null | undefined>(undefined);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [redirectingId, setRedirectingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const sub = await billingApi.getSubscription(organization.id);
      setSubscription(sub);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "NOT_FOUND") {
        setSubscription(null);
      } else {
        setError(friendlyErrorMessage(err));
        setSubscription(null);
      }
    }
  }, [organization.id]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  useEffect(() => {
    if (subscription === null && canManageBilling) {
      plansApi.listPlans().then(setPlans).catch(() => setPlans([]));
    }
  }, [subscription, canManageBilling]);

  async function handleCheckout(planId: string) {
    setError(null);
    setRedirectingId(planId);
    try {
      const returnBase = `${window.location.origin}/dashboard/${organization.id}/billing`;
      const { checkoutUrl } = await billingApi.createCheckoutSession(organization.id, {
        planId,
        billingCycle: "monthly",
        successUrl: `${returnBase}?checkout=success`,
        cancelUrl: `${returnBase}?checkout=cancel`,
      });
      window.location.assign(checkoutUrl);
    } catch (err) {
      setError(friendlyErrorMessage(err));
      setRedirectingId(null);
    }
  }

  async function handlePortal() {
    setError(null);
    setRedirectingId("portal");
    try {
      const { portalUrl } = await billingApi.createPortalSession(organization.id);
      window.location.assign(portalUrl);
    } catch (err) {
      setError(friendlyErrorMessage(err));
      setRedirectingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {error && <Alert variant="error">{error}</Alert>}

      <Card>
        <h2 className="text-base font-semibold text-foreground">Abonelik</h2>

        {subscription === undefined ? (
          <div className="mt-6 flex justify-center">
            <Spinner className="h-5 w-5 text-primary" />
          </div>
        ) : subscription === null ? (
          <div className="mt-4">
            <p className="text-sm text-foreground/60">Bu organizasyonun aktif bir aboneliği yok.</p>

            {!canManageBilling ? (
              <p className="mt-4 text-xs text-foreground/50">Faturalandırmayı yalnızca organizasyon sahibi yönetebilir.</p>
            ) : plans.length === 0 ? (
              <div className="mt-4 flex justify-center">
                <Spinner className="h-5 w-5 text-primary" />
              </div>
            ) : (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {plans.map((plan) => (
                  <div key={plan.id} className="rounded-lg border border-border p-4">
                    <p className="font-medium text-foreground">{plan.name}</p>
                    <p className="mt-1 text-sm text-foreground/60">
                      {formatPrice(plan.priceMonthlyCents, plan.currency)} /ay
                    </p>
                    <Button
                      size="sm"
                      className="mt-3"
                      loading={redirectingId === plan.id}
                      onClick={() => handleCheckout(plan.id)}
                    >
                      Bu planla başla
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-foreground">{subscription.plan.name}</p>
                <p className="text-sm text-foreground/60">
                  {formatPrice(subscription.plan.priceMonthlyCents, subscription.plan.currency)} /ay
                </p>
              </div>
              <Badge tone={statusTones[subscription.status]}>{statusLabels[subscription.status]}</Badge>
            </div>

            <p className="text-sm text-foreground/60">
              {subscription.cancelAtPeriodEnd ? "Dönem sonunda iptal edilecek" : "Sonraki yenileme"}:{" "}
              {new Date(subscription.currentPeriodEnd).toLocaleDateString("tr-TR")}
            </p>

            {canManageBilling ? (
              <Button variant="secondary" loading={redirectingId === "portal"} onClick={handlePortal}>
                Fatura portalını aç
              </Button>
            ) : (
              <p className="text-xs text-foreground/50">Faturalandırmayı yalnızca organizasyon sahibi yönetebilir.</p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
