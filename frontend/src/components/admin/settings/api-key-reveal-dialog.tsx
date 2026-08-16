"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import type { CreateApiKeyResponse } from "@/lib/api/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ApiKeyRevealDialogProps {
  /** `null` = kapalı. Dolu olduğunda tek seferlik `plainKey` gösterilir. */
  response: CreateApiKeyResponse | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Bir kere gösterilen anahtar" modalı (ARCHITECTURE.md §10.13.3 — `plainKey` sunucuda
 * SAKLANMAZ, yalnızca oluşturma yanıtında bir kez döner). `response` KALICI STATE'E
 * YAZILMAZ: üst bileşen (`ApiKeysSection`) bu değeri yalnızca dialog açıkken bir `useState`'te
 * tutar, dialog kapanınca `null`'a döner ve değer bellekten düşer — `security/page.tsx`'teki
 * yedek kodlar diyaloğuyla (`BackupCodesList`) AYNI desen.
 */
export function ApiKeyRevealDialog({ response, onOpenChange }: ApiKeyRevealDialogProps) {
  function copyKey() {
    if (!response) return;
    navigator.clipboard.writeText(response.plainKey).then(
      () => toast.success("Anahtar panoya kopyalandı."),
      () => toast.error("Panoya kopyalanamadı.")
    );
  }

  return (
    <Dialog open={response !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>API Anahtarınız Oluşturuldu</DialogTitle>
          <DialogDescription>
            &ldquo;{response?.apiKey.name}&rdquo; için ham anahtar aşağıdadır — güvenli bir yere kopyalayın.
          </DialogDescription>
        </DialogHeader>

        {response && (
          <div className="space-y-3">
            <Alert variant="warning">Bu anahtar bir daha gösterilmeyecek. Kaybederseniz yenisini oluşturmanız gerekir.</Alert>
            <div className="break-all rounded-lg border border-border bg-surface-muted p-3 font-mono text-sm text-foreground/90">
              {response.plainKey}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={copyKey}>
              <Copy className="h-4 w-4" />
              Kopyala
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Anladım, Kapat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
