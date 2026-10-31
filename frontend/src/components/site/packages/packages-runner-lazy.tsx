"use client";

import { useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import type { PackageCardData, PackageCategory } from "@/lib/api/types";
import { isPackagesRunnerHiddenPath, readRunnerDismissed } from "./runner-visibility";

/**
 * Paket X — yan paneli tembel yükler: hariç tutulan yollarda ya da oturumda kapatılmışsa panel paketi HİÇ indirilmez;
 * `ssr: false` olduğundan ilk boyamayı/hidrasyonu etkilemez. Panel `fixed` olduğundan düzeni itmez (CLS yok).
 */
const PackagesRunner = dynamic(() => import("./packages-runner"), { ssr: false });

export function PackagesRunnerLazy({ featured, items, categories }: { featured: PackageCardData[]; items: PackageCardData[]; categories: PackageCategory[] }) {
  const pathname = usePathname();
  const [closed, setClosed] = useState(false);
  // Sunucuda/ilk hidrasyonda çizme; istemcide sessionStorage'daki "kapattım" bilgisine bak.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  if (!mounted || closed || readRunnerDismissed() || isPackagesRunnerHiddenPath(pathname)) return null;
  return <PackagesRunner featured={featured} items={items} categories={categories} onDismiss={() => setClosed(true)} />;
}
