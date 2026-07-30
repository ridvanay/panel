import type { Metadata } from "next";
import { Navbar } from "@/components/marketing/navbar";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";
import { fetchPlansServer } from "@/lib/api/server-plans";

export const metadata: Metadata = { title: "Fiyatlandırma" };

const limitLabels: Record<string, string> = {
  maxMembers: "Üye",
  maxProjects: "Proje",
};

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency }).format(cents / 100);
}

export default async function PricingPage() {
  const plans = await fetchPlansServer();

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />

      <main className="flex-1">
        <section className="mx-auto max-w-5xl px-4 py-20 sm:px-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-foreground">Fiyatlandırma</h1>
            <p className="mt-2 text-foreground/60">İhtiyacınıza uygun planı seçin, istediğiniz zaman değiştirin.</p>
          </div>

          {plans.length === 0 ? (
            <p className="mt-12 text-center text-sm text-foreground/60">
              Planlar şu anda yüklenemedi, lütfen daha sonra tekrar deneyin.
            </p>
          ) : (
            <div className="mt-12 grid gap-6 sm:grid-cols-2">
              {plans.map((plan) => (
                <Card key={plan.id} className="flex flex-col">
                  <h2 className="text-lg font-semibold text-foreground">{plan.name}</h2>
                  <p className="mt-4 text-3xl font-bold text-foreground">
                    {formatPrice(plan.priceMonthlyCents, plan.currency)}
                    <span className="text-sm font-normal text-foreground/60"> /ay</span>
                  </p>
                  <p className="text-sm text-foreground/60">veya {formatPrice(plan.priceYearlyCents, plan.currency)} /yıl</p>

                  <ul className="mt-6 space-y-2 text-sm text-foreground/70">
                    {Object.entries(plan.limits).map(([key, value]) => (
                      <li key={key} className="flex items-center gap-2">
                        <span aria-hidden="true" className="text-success">
                          ✓
                        </span>
                        {value} {limitLabels[key] ?? key}
                      </li>
                    ))}
                  </ul>

                  <LinkButton href="/register" className="mt-auto justify-center pt-6">
                    Başla
                  </LinkButton>
                </Card>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
