import { useRef, type MouseEvent, type RefObject } from "react";

interface UseMouseGlowResult<T extends HTMLElement> {
  /** Glow efektinin konumunu hesaplamak için ölçülecek elemana bağlanacak ref. */
  ref: RefObject<T | null>;
  /** İlgili elemanın `onMouseMove` prop'una verilecek handler. */
  onMouseMove: (event: MouseEvent<T>) => void;
}

/**
 * İmleç konumunu, re-render TETİKLEMEDEN (useState kullanmadan) doğrudan DOM'a
 * `--mouse-x` / `--mouse-y` CSS custom property'leri olarak yazan imperatif bir hook.
 *
 * Kullanım:
 *   const glow = useMouseGlow<HTMLDivElement>();
 *   <div ref={glow.ref} onMouseMove={glow.onMouseMove} style={{ background: "radial-gradient(circle at var(--mouse-x, 50%) var(--mouse-y, 50%), ...)" }} />
 */
export function useMouseGlow<T extends HTMLElement>(): UseMouseGlowResult<T> {
  const ref = useRef<T>(null);

  function onMouseMove(event: MouseEvent<T>) {
    const target = ref.current;
    if (!target) return;

    const rect = target.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;

    // useState/setState YOK: doğrudan DOM manipülasyonu ile her mousemove'da
    // React re-render'ı tetiklemeden style güncellenir.
    target.style.setProperty("--mouse-x", `${x}%`);
    target.style.setProperty("--mouse-y", `${y}%`);
  }

  return { ref, onMouseMove };
}
