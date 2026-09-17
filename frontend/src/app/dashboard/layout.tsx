"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { Spinner } from "@/components/ui/spinner";
import type { SiteRole } from "@/lib/api/types";

/** `post-login-destination.ts::resolvePostLoginPath`teki AYNI panel-rolü küme — bkz. o dosyadaki
 * döngüsel import gerekçesi (`lib/` → `components/` yönünde bağımlılık kurulmaz, bu dosya da AYNI
 * gerekçeyle `admin-shell.tsx`'i import ETMEZ). */
const ROLES_PANEL = new Set<SiteRole>(["ADMIN", "MANAGER", "EDITOR"]);

/**
 * `/dashboard` görev: 2026-09-17 — post-login iniş noktası olarak EMEKLİYE AYRILDI
 * (`post-login-destination.ts`). Eski/manuel bir bağlantıyla (ör. tarayıcı geçmişi, yer imi) bu
 * rotaya (ve `/dashboard/[orgId]/**` alt rotalarına — o kod SİLİNMEDİ, aynen duruyor) düşen HER
 * girişli kullanıcı, `resolvePostLoginPath`in kullandığı AYNI rol mantığıyla (burada `next` YOK —
 * kullanıcı zaten `/dashboard`a gelmiş) doğru role SESSİZCE (toast/hata mesajı OLMADAN — bu bir
 * yetkisizlik hatası değil, sadece eski bir landing sayfası) yönlendirilir; bu layout artık
 * `children`ı HİÇBİR rol için render ETMEZ (`ADMIN`/`MANAGER`/`EDITOR` → `/admin`, doktor →
 * `/doctor`, `CUSTOMER`/`USER` → `/patient/appointments`).
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Bu layout `children`ı HİÇBİR rol için render ETMEZ (bkz. dosya başı yorumu) — parametre yine
  // de Next.js'in `LayoutProps` sözleşmesi gereği KABUL EDİLMEK ZORUNDADIR.
  void children;
  const { status, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, router, pathname]);

  useEffect(() => {
    if (status !== "authenticated" || !user) return;
    if (user.doctorProfileId !== null) {
      router.replace("/doctor");
      return;
    }
    if (ROLES_PANEL.has(user.role)) {
      router.replace("/admin");
      return;
    }
    router.replace("/patient/appointments");
  }, [status, user, router]);

  // Bu layout altındaki hiçbir rota HİÇBİR rol için render edilmez — yukarıdaki effect'ler
  // devreye girene kadar (ve girdikten sonra da, `router.replace` bir sonraki render'a kadar
  // `pathname`'i değiştirmediği için) her zaman bir spinner gösterilir.
  return (
    <main className="flex min-h-screen items-center justify-center">
      <Spinner className="h-6 w-6 text-primary" />
    </main>
  );
}
