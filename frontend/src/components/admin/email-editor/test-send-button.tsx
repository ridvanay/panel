"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import * as emailTemplatesApi from "@/lib/api/email-templates";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

/**
 * §A.6 — durum matrisi: `dirty` iken disabled + tooltip (test KAYDEDİLMİŞ satır üzerinde
 * çalışır, editör auto-save yapmıyor). Geri bildirim `sonner` toast ile (yeni bileşen YOK).
 */
export function TestSendButton({ templateId, dirty }: { templateId: string; dirty: boolean }) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const result = await emailTemplatesApi.testSendTemplate(templateId, {});
      toast.success(`Test e-postası ${result.sentTo} adresine gönderildi.`);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 429) {
        toast.error("Çok fazla deneme — 1 dakika sonra tekrar deneyin.");
      } else {
        toast.error(friendlyErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={dirty}
      loading={loading}
      title={dirty ? "Test göndermeden önce değişiklikleri kaydedin" : undefined}
      onClick={handleClick}
    >
      <Send className="h-4 w-4" />
      {loading ? "Gönderiliyor…" : "Test E-postası Gönder"}
    </Button>
  );
}
