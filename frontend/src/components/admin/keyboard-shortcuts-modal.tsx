"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ShortcutEntry {
  keys: string[];
  description: string;
}

/**
 * Bu listedeki her kısayol gerçekten aşağıdaki `keydown` dinleyicisinde (veya
 * `command-palette.tsx`'te) uygulanmıştır. Çalışmayan/uydurma bir kısayol
 * buraya EKLENMEMELİDİR.
 */
const shortcuts: ShortcutEntry[] = [
  { keys: ["Ctrl/Cmd", "K"], description: "Hızlı arama (komut menüsünü aç)" },
  { keys: ["?"], description: "Bu kısayol kılavuzunu aç" },
  { keys: ["G", "D"], description: "Genel Bakış sayfasına git" },
  { keys: ["G", "U"], description: "Kullanıcılar sayfasına git" },
  { keys: ["G", "B"], description: "Blog sayfasına git" },
];

/**
 * Kullanıcı bir metin girişine (input/textarea/contentEditable) yazı
 * yazıyorsa global kısayolların tetiklenmemesi için koruma.
 */
function isTypingTarget(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

const G_SEQUENCE_TIMEOUT_MS = 800;

export function KeyboardShortcutsModal() {
  const [open, setOpen] = useState(false);
  const [gPending, setGPending] = useState(false);
  const gTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  useEffect(() => {
    function clearGPending() {
      if (gTimeoutRef.current) {
        clearTimeout(gTimeoutRef.current);
        gTimeoutRef.current = null;
      }
      setGPending(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget()) return;
      // Ctrl/Cmd/Alt ile kombinasyonlarda tarayıcı/komut paleti kısayollarıyla
      // çakışmamak için devreye girmez.
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (gPending) {
        const key = event.key.toLowerCase();
        clearGPending();
        if (key === "d") {
          event.preventDefault();
          router.push("/admin");
        } else if (key === "u") {
          event.preventDefault();
          router.push("/admin/users");
        } else if (key === "b") {
          event.preventDefault();
          router.push("/admin/blog");
        }
        return;
      }

      if (event.key === "g" || event.key === "G") {
        setGPending(true);
        gTimeoutRef.current = setTimeout(() => setGPending(false), G_SEQUENCE_TIMEOUT_MS);
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (gTimeoutRef.current) clearTimeout(gTimeoutRef.current);
    };
  }, [gPending, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Klavye Kısayolları</DialogTitle>
          <DialogDescription>Panelde kullanabileceğiniz kısayolların listesi.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2.5">
          {shortcuts.map((shortcut) => (
            <li
              key={shortcut.description}
              className="flex items-center justify-between gap-4 text-sm text-foreground/80"
            >
              <span>{shortcut.description}</span>
              <span className="flex shrink-0 items-center gap-1">
                {shortcut.keys.map((key, index) => (
                  <span key={key} className="flex items-center gap-1">
                    {index > 0 && <span className="text-xs text-foreground/40">sonra</span>}
                    <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-foreground">
                      {key}
                    </kbd>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
