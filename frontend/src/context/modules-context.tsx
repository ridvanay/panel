"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import * as modulesApi from "@/lib/api/modules";
import type { SiteModule } from "@/lib/api/types";

interface ModulesContextValue {
  modules: SiteModule[];
  loading: boolean;
  /**
   * Registry'de KAYITLI OLMAYAN bir key için `true` döner (bilinmeyen/henüz tanımlanmamış
   * modüller varsayılan olarak engellenmez) — sidebar filtresi SADECE registry'de bulunan ve
   * `enabled: false` olan modülleri gizler, `module` alanı olmayan/kayıtsız item'lar hep görünür.
   */
  isModuleEnabled: (key: string) => boolean;
  refetch: () => Promise<void>;
}

const ModulesContext = createContext<ModulesContextValue | null>(null);

export function ModulesProvider({ children }: { children: ReactNode }) {
  const [modules, setModules] = useState<SiteModule[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const list = await modulesApi.listModules();
      setModules(list);
    } catch {
      // Sessizce yut — sidebar filtresi/modül sayfası bu durumda "kayıtsız key" davranışına
      // (her şey görünür) düşer, tüm admin paneli bir tek uç yüzünden kilitlenmesin.
      setModules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refetch();
    })();
  }, [refetch]);

  function isModuleEnabled(key: string): boolean {
    const found = modules.find((mod) => mod.key === key);
    if (!found) return true;
    return found.enabled;
  }

  const value: ModulesContextValue = { modules, loading, isModuleEnabled, refetch };

  return <ModulesContext value={value}>{children}</ModulesContext>;
}

export function useModules(): ModulesContextValue {
  const ctx = useContext(ModulesContext);
  if (!ctx) throw new Error("useModules, <ModulesProvider> içinde kullanılmalıdır.");
  return ctx;
}
