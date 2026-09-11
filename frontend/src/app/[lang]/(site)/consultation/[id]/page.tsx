import type { Metadata } from "next";
import { ConsultationRoom } from "@/components/site/telehealth/consultation-room";

/**
 * `.claude/architect-scope-telehealth-template.md` §5.2/§9.5 — LiveKit odası, geri sayım,
 * bekleme odası, `?t=` misafir erişim token'ı. `noindex, nofollow` seo-agent tarafından eklendi
 * (§9.5 bağlayıcı: "`/consultation/[id]` `noindex` OLMALIDIR") — bir randevu görüşme odası
 * arama sonuçlarında görünmemeli/takip edilmemeli (PII/randevu kimliği taşır). Modül kapalıysa/
 * `telehealth` devre dışıysa `consultation/layout.tsx` zaten 404 döner.
 */
interface ConsultationPageProps {
  params: Promise<{ lang: string; id: string }>;
  searchParams: Promise<{ t?: string }>;
}

export function generateMetadata(): Metadata {
  return {
    robots: { index: false, follow: false },
  };
}

export default async function ConsultationPage({ params, searchParams }: ConsultationPageProps) {
  const { id } = await params;
  const { t } = await searchParams;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <ConsultationRoom appointmentId={id} accessToken={t} />
    </div>
  );
}
