import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isModuleEnabledServer } from "@/lib/api/server-modules";

/**
 * `products` modülü kapalıysa TÜM `/products/*` rotaları 404 döner — backend'in
 * `requireModuleEnabled("products")` guard'ıyla (bkz. products.routes.ts) BİREBİR aynı davranış,
 * burada yalnızca istemci/gezinme tarafında tekrarlanır (backend zaten kapalıyken 404 döner,
 * bu layout gereksiz bir sunucu isteğini/render'ı erkenden keser).
 */
export default async function ProductsLayout({ children }: { children: ReactNode }) {
  const enabled = await isModuleEnabledServer("products");
  if (!enabled) notFound();

  return <>{children}</>;
}
