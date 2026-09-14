import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { LoginForm } from "@/components/auth/login-form";
import { Spinner } from "@/components/ui/spinner";

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

export default function DoctorLoginPage() {
  return (
    <AuthPageShell title="Hekim Girişi" subtitle="Doktor portalına erişmek için hesap bilgilerinizi girin.">
      <Suspense fallback={<Spinner className="h-5 w-5 text-primary" />}>
        <LoginForm variant="doctor" />
      </Suspense>
    </AuthPageShell>
  );
}
