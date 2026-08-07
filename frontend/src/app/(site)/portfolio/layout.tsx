import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isModuleEnabledServer } from "@/lib/api/server-modules";

/**
 * `portfolio` modülü kapalıysa TÜM `/portfolio/*` rotaları 404 döner — backend'in
 * `requireModuleEnabled("portfolio")` guard'ıyla (bkz. portfolio.routes.ts) BİREBİR aynı davranış,
 * burada yalnızca istemci/gezinme tarafında tekrarlanır (bkz. (site)/products/layout.tsx — AYNI patern).
 */
export default async function PortfolioLayout({ children }: { children: ReactNode }) {
  const enabled = await isModuleEnabledServer("portfolio");
  if (!enabled) notFound();

  return <>{children}</>;
}
