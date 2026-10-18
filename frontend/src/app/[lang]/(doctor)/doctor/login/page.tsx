import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { LoginForm } from "@/components/auth/login-form";
import { Spinner } from "@/components/ui/spinner";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";

/**
 * `.claude/architect-scope-doctor-subdomain.md` §4 — hekim girişi İÇİN gerçek, kanonik bir rota.
 * Doktor host'unda `/login` proxy tarafından buraya `rewrite` edilir (§3.1 [7]); ana host'ta
 * subdomain modu kapalıyken doğrudan `/doctor/login` olarak da çalışır (geriye dönük uyumluluk).
 *
 * Paylaşılan `LoginForm`, `variant="doctor"` ile: kayıt-ol bağlantısı YOK (hekimler kendi kendine
 * kayıt olmaz), `doctorProfileId === null` durumunda sessizce portala düşürülmek yerine açık bir
 * hata + ana siteye dönüş bağlantısı gösterir (bkz. `components/auth/login-form.tsx`).
 *
 * `noindex, nofollow` — `/doctor/**` İLE AYNI desen (seo-agent kararı, §9.7.9), portal `noindex`.
 */
export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false } };
}

export default async function DoctorLoginPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const { portal } = await getSiteDictionary(lang);
  return (
    <AuthPageShell title={portal.doctorPortal.loginTitle} subtitle={portal.doctorPortal.loginSubtitle}>
      <Suspense fallback={<Spinner className="h-5 w-5 text-primary" />}>
        <LoginForm variant="doctor" />
      </Suspense>
    </AuthPageShell>
  );
}
