import { useRef, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { VariableTarget } from "@/hooks/use-variable-target";

/**
 * §10.16.11 — "değişken ekleme (imleç konumuna)" — değişken kabul eden düz `<input>/<textarea>`
 * alanları için `useVariableTarget`'a kayıt olan ince sarmalayıcılar. Odaklandığında kendini
 * "son hedef" yapar; değişken paneli `{{key}}`'i `selectionStart` konumuna ekler ve imleci
 * eklenen metnin sonuna taşır. Güncel metin, render sırasında ref güncellemesi GEREKMEDEN
 * doğrudan DOM elemanının `.value`'sundan okunur (controlled input'un DOM değeri son render'la
 * senkron kalır) — React "refs during render" kuralına uymak için ayrı bir "değer ref'i" YOK.
 */
export function VariableInput({
  target,
  value,
  onChange,
  ...props
}: Omit<ComponentProps<typeof Input>, "onChange"> & {
  target: VariableTarget;
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  function handleFocus() {
    target.setTarget({
      insert(token: string) {
        const el = ref.current;
        const current = el?.value ?? value;
        const start = el?.selectionStart ?? current.length;
        const end = el?.selectionEnd ?? current.length;
        const next = current.slice(0, start) + token + current.slice(end);
        onChange(next);
        requestAnimationFrame(() => {
          const pos = start + token.length;
          el?.focus();
          el?.setSelectionRange(pos, pos);
        });
      },
    });
  }

  return (
    <Input
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={handleFocus}
      {...props}
    />
  );
}

export function VariableTextarea({
  target,
  value,
  onChange,
  ...props
}: Omit<ComponentProps<typeof Textarea>, "onChange"> & {
  target: VariableTarget;
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function handleFocus() {
    target.setTarget({
      insert(token: string) {
        const el = ref.current;
        const current = el?.value ?? value;
        const start = el?.selectionStart ?? current.length;
        const end = el?.selectionEnd ?? current.length;
        const next = current.slice(0, start) + token + current.slice(end);
        onChange(next);
        requestAnimationFrame(() => {
          const pos = start + token.length;
          el?.focus();
          el?.setSelectionRange(pos, pos);
        });
      },
    });
  }

  return (
    <Textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={handleFocus}
      {...props}
    />
  );
}
