"use client";

import { useEffect, useState } from "react";
import { takeTokenFromLocation, type TakeTokenOptions } from "@/lib/access-token-url";

export interface LocationTokenState {
  /** Adres okundu mu (sunucu render'ında ve ilk çizimde `false`). */
  ready: boolean;
  token: string | null;
}

/**
 * Paket AP — `#` parçasındaki (ya da geçiş süresince eski biçimdeki) token'ı tarayıcıda bir kez okur ve adresi
 * temizler. `#` parçası sunucuya gitmediği için okuma ancak mount sonrası yapılabilir.
 */
export function useLocationToken(options: TakeTokenOptions): LocationTokenState {
  const [state, setState] = useState<LocationTokenState>({ ready: false, token: null });
  const { hashKey, legacyQueryKey, legacyPathToken, cleanPath, storageKey } = options;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- `#` parçası yalnızca tarayıcıda okunabilir; mount'ta bir kez
    setState({ ready: true, token: takeTokenFromLocation({ hashKey, legacyQueryKey, legacyPathToken, cleanPath, storageKey }) });
  }, [hashKey, legacyQueryKey, legacyPathToken, cleanPath, storageKey]);
  return state;
}
