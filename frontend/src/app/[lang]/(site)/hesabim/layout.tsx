import type { ReactNode } from "react";
import { isModuleEnabledServer } from "@/lib/api/server-modules";
import { HesabimShell } from "@/components/site/hesabim/hesabim-shell";

/**
 * §customer-portal §4.1/§4.3 — `/hesabim` sekmeli kabuğun TEK yeri. Modül durumu SUNUCUDA
 * `isModuleEnabledServer("products")` ile çözülür (`(site)/products/layout.tsx` ile AYNI
 * desen) — istemcide flaş/yanıp sönme OLMAZ. Auth guard'ı (unauthenticated → `/login?next=…`)
 * ve sekme UI'ı `HesabimShell` (client) içindedir çünkü oturum durumu yalnızca istemcide
 * bilinir (access token bellekte, bkz. `context/auth-context.tsx`).
 */
export default async function HesabimLayout({ children }: { children: ReactNode }) {
  const productsModuleEnabled = await isModuleEnabledServer("products");

  return <HesabimShell productsModuleEnabled={productsModuleEnabled}>{children}</HesabimShell>;
}
