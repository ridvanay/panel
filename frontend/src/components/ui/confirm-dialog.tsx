"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ConfirmDialogTone = "default" | "warning" | "danger";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  /**
   * @deprecated `tone="danger"` kullanın — geriye dönük uyumluluk için KORUNUR
   * (design-notes-i18n.md §6.3: mevcut çağrı yerleri KIRILMAZ).
   */
  destructive?: boolean;
  /** Silme (`danger`, kırmızı) ile önemli-ama-geri-alınabilir (`warning`, amber) işlemleri görsel olarak ayırır. */
  tone?: ConfirmDialogTone;
  loading?: boolean;
  onConfirm: () => void;
}

const TONE_ICON_CLASSES: Record<Exclude<ConfirmDialogTone, "default">, string> = {
  danger: "bg-destructive/10 text-destructive",
  warning: "bg-warning/10 text-warning",
};

const TONE_BUTTON_VARIANT: Record<ConfirmDialogTone, "default" | "destructive" | "warning"> = {
  default: "default",
  danger: "destructive",
  warning: "warning",
};

/**
 * `window.confirm(...)`'in yerini alan, uygulamanın görsel diline uyan onay diyaloğu.
 * `dialog.tsx` primitiflerinin üzerine kuruludur.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "Onayla",
  cancelText = "Vazgeç",
  destructive = false,
  tone,
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  const resolvedTone: ConfirmDialogTone = tone ?? (destructive ? "danger" : "default");

  return (
    <Dialog open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3">
            {resolvedTone !== "default" && (
              <span
                className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONE_ICON_CLASSES[resolvedTone]}`}
              >
                <AlertTriangle className="h-4 w-4" />
              </span>
            )}
            <div>
              <DialogTitle>{title}</DialogTitle>
              {description && <DialogDescription className="mt-1">{description}</DialogDescription>}
            </div>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {cancelText}
          </Button>
          <Button
            type="button"
            variant={TONE_BUTTON_VARIANT[resolvedTone]}
            loading={loading}
            onClick={onConfirm}
          >
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
