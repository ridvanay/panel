import { useEffect, useRef, useState } from "react";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

const AUTOSAVE_DEBOUNCE_MS = 3000;

export interface UseAutosaveOptions {
  /** İzlenecek değerler — herhangi biri değiştiğinde debounce sıfırlanır. */
  values: unknown[];
  /** Debounce süresi dolduğunda çağrılır. */
  save: () => Promise<unknown>;
  /** `false` iken debounce/kaydetme tamamen devre dışıdır (ör. yeni oluşturma akışı, henüz bir ID yok). */
  enabled: boolean;
  /** Testlerde gerçek 3sn'yi beklememek için — üretimde varsayılan `3000`. */
  debounceMs?: number;
}

/**
 * Genel amaçlı, sessiz "crash/kapatma-kurtarma" autosave hook'u — mevcut "Kaydet" butonunun/
 * `hasUnsavedChanges` akışının YERİNİ ALMAZ, sadece arka planda periyodik bir taslak
 * kaydeder (bkz. `admin/blog/[postId]/page.tsx`, `admin/pages/[pageId]/page.tsx`).
 *
 * `values` her değiştiğinde bekleyen zamanlayıcı iptal edilip yeniden başlatılır (debounce);
 * `debounceMs` (varsayılan 3sn) boyunca yeni bir değişiklik gelmezse `save()` çağrılır.
 * Hata durumunda `status: "error"` set edilir ama kullanıcı akışı KESİLMEZ — bir sonraki
 * debounce turunda (state hâlâ "dirty" olduğu için) doğal olarak yeniden denenir.
 */
export function useAutosave({ values, save, enabled, debounceMs = AUTOSAVE_DEBOUNCE_MS }: UseAutosaveOptions) {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  // `save`/`values` her render'da yeni referanslar olabilir (inline callback/array literal) —
  // bunları ref'e alıp yalnızca debounce SÜRESİ değiştiğinde zamanlayıcıyı yeniden kurmak,
  // her tuşa basışta effect'in tamamen yeniden çalışmasını (ve timer'ın gereksiz sıfırlanmasını) önler.
  // Ref render SIRASINDA değil, effect içinde güncellenir (React "refs during render" kuralı).
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  // Component unmount olduğunda ya da bir sonraki debounce turu tetiklendiğinde bu bayrak
  // devredeki async `save()` çağrısının artık stale olduğunu işaretler — geç dönen bir yanıt
  // unmount sonrası state güncellemesi yapmasın diye.
  const isActiveRef = useRef(true);
  useEffect(() => {
    isActiveRef.current = true;
    return () => {
      isActiveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const timer = setTimeout(() => {
      setStatus("saving");
      saveRef
        .current()
        .then(() => {
          if (!isActiveRef.current) return;
          setStatus("saved");
          setLastSavedAt(new Date().toISOString());
        })
        .catch(() => {
          if (!isActiveRef.current) return;
          setStatus("error");
        });
    }, debounceMs);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, debounceMs, ...values]);

  return { status, lastSavedAt };
}
