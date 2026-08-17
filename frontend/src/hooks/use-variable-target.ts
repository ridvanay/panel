import { useCallback, useRef, useState } from "react";

export interface VariableTargetField {
  /** `{{key}}` token'ını hedefin imleç konumuna ekler. */
  insert: (token: string) => void;
}

export interface VariableTarget {
  /** Bir alan odaklandığında kendini "son hedef" olarak kaydeder — bkz. ARCHITECTURE.md §10.16.11. */
  setTarget: (field: VariableTargetField | null) => void;
  /** Değişken panelinden çağrılır — `{{key}}`'i son kaydedilen hedefe ekler. */
  insertVariable: (key: string) => void;
  /** Hiç hedef yokken değişken paneli TÜM satırları disabled yapar (sessizce yanlış yere ekleme yasak). */
  hasTarget: boolean;
  /** Bir alan blur olurken (ör. panele tıklarken) hedefi TEMİZLEMEZ — yalnızca açık `clearTarget()` ile temizlenir. */
  clearTarget: () => void;
}

/**
 * `useVariableTarget()` — değişken kabul eden HER alan (konu input'u, `heading.text`,
 * `button.label`, `button.href`, `footer.text`, `text` bloğunun TipTap editörü) odaklandığında
 * kendini kaydeder. Değişken paneli `insertVariable(key)` çağırır; hedef bir TipTap editörüyse
 * `editor.commands.insertContent`, düz bir input/textarea ise `selectionStart` konumuna metin
 * eklenir ve imleç eklenen metnin sonuna taşınır. Hiç hedef yoksa panel `disabled` olur.
 */
export function useVariableTarget(): VariableTarget {
  const [hasTarget, setHasTarget] = useState(false);
  const fieldRef = useRef<VariableTargetField | null>(null);

  const setTarget = useCallback((field: VariableTargetField | null) => {
    fieldRef.current = field;
    setHasTarget(field !== null);
  }, []);

  const clearTarget = useCallback(() => {
    fieldRef.current = null;
    setHasTarget(false);
  }, []);

  const insertVariable = useCallback((key: string) => {
    fieldRef.current?.insert(`{{${key}}}`);
  }, []);

  return { setTarget, insertVariable, hasTarget, clearTarget };
}
