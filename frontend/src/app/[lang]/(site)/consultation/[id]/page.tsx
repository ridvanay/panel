import type { Metadata } from "next";
import { ConsultationGate } from "@/components/site/telehealth/access-token-gates";

/**
 * `.claude/architect-scope-telehealth-template.md` §5.2/§9.5 — LiveKit odası, geri sayım,
 * bekleme odası, `#t=` misafir erişim token'ı (Paket AP; eski `?t=` geçiş süresince). `noindex, nofollow` seo-agent tarafından eklendi
 * (§9.5 bağlayıcı: "`/consultation/[id]` `noindex` OLMALIDIR") — bir randevu görüşme odası
 * arama sonuçlarında görünmemeli/takip edilmemeli (PII/randevu kimliği taşır). Modül kapalıysa/
 * `telehealth` devre dışıysa `consultation/layout.tsx` zaten 404 döner.
 */
interface ConsultationPageProps {
  params: Promise<{ lang: string; id: string }>;
}

export function generateMetadata(): Metadata {
  return {
    robots: { index: false, follow: false },
  };
}

export default async function ConsultationPage({ params }: ConsultationPageProps) {
  const { id } = await params;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <ConsultationGate appointmentId={id} />
    </div>
  );
}
