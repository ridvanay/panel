import { Navbar } from "@/components/marketing/navbar";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";

const features = [
  {
    title: "Organizasyon ve takım yönetimi",
    description: "Sınırsız üye, rol bazlı yetkilendirme (Sahip / Yönetici / Üye) ve e-posta ile davet akışı.",
  },
  {
    title: "Güvenli kimlik doğrulama",
    description: "Rotasyonlu refresh token, argon2 şifre hash'leme ve oturum güvenliği kutudan çıkar.",
  },
  {
    title: "Esnek faturalandırma",
    description: "Stripe ile aylık/yıllık planlar, self-servis fatura portalı ve otomatik abonelik senkronizasyonu.",
  },
];

/**
 * CMS'te bir "Ana Sayfa" seçilmemişse (veya seçilen sayfa yayında değilse) `/` rotasında
 * gösterilen varsayılan içerik. Bkz. app/page.tsx.
 */
export function FallbackHome() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />

      <main className="flex-1">
        <section className="mx-auto max-w-4xl px-4 py-24 text-center sm:px-6">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Ekibiniz için modern bir temel
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-foreground/60">
            Organizasyonları, üyeleri ve faturalandırmayı tek bir yerden yönetin. Dakikalar içinde başlayın, kredi kartı
            gerekmez.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <LinkButton href="/register">Ücretsiz başla</LinkButton>
            <LinkButton href="/pricing" variant="secondary">
              Fiyatlandırmayı gör
            </LinkButton>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <div className="grid gap-6 sm:grid-cols-3">
            {features.map((feature) => (
              <Card key={feature.title}>
                <h2 className="text-base font-semibold text-foreground">{feature.title}</h2>
                <p className="mt-2 text-sm text-foreground/60">{feature.description}</p>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8 text-center text-sm text-foreground/50">
        © {new Date().getFullYear()} SaaS Platform. Tüm hakları saklıdır.
      </footer>
    </div>
  );
}
