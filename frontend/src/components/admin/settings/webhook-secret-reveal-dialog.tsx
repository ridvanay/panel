"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface WebhookSecretReveal {
  webhookName: string;
  plainSecret: string;
}

interface WebhookSecretRevealDialogProps {
  /** `null` = kapalı. */
  reveal: WebhookSecretReveal | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Webhook imzalama secret'ının ("whsec_...") tek seferlik gösterimi — hem oluşturma hem
 * rotasyon sonrasında KULLANILIR (ARCHITECTURE.md §10.13.9). `reveal` KALICI STATE'E YAZILMAZ;
 * üst bileşen bu değeri yalnızca dialog açıkken tutar — `ApiKeyRevealDialog` ile AYNI desen.
 */
export function WebhookSecretRevealDialog({ reveal, onOpenChange }: WebhookSecretRevealDialogProps) {
  function copySecret() {
    if (!reveal) return;
    navigator.clipboard.writeText(reveal.plainSecret).then(
      () => toast.success("Secret panoya kopyalandı."),
      () => toast.error("Panoya kopyalanamadı.")
    );
  }

  return (
    <Dialog open={reveal !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Webhook İmzalama Secret&apos;ı</DialogTitle>
          <DialogDescription>
            &ldquo;{reveal?.webhookName}&rdquo; için imzalama secret&apos;ı aşağıdadır — gelen isteklerin imzasını (
            <code>X-Webhook-Signature</code>) doğrulamak için alıcı sisteminize kaydedin.
          </DialogDescription>
        </DialogHeader>

        {reveal && (
          <div className="space-y-3">
            <Alert variant="warning">Bu secret bir daha gösterilmeyecek ve eski secret ANINDA geçersiz olur.</Alert>
            <div className="break-all rounded-lg border border-border bg-surface-muted p-3 font-mono text-sm text-foreground/90">
              {reveal.plainSecret}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={copySecret}>
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
