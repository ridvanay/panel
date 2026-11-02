"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Eye, Link2, Link2Off } from "lucide-react";
import { toast } from "sonner";
import * as blogApi from "@/lib/api/blog";
import type { BlogPreviewLinkStatus } from "@/lib/api/types";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { absolutePreviewUrl, formatPreviewExpiry, openAdminBlogPreview, resolveDefaultLocaleCode } from "@/lib/blog/preview";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";

export interface BlogPreviewControlsProps {
  postId: string;
  /** Bilinen varsayılan dil kodu (editör zaten yükler); yoksa tıklayınca admin dil listesinden okunur. */
  defaultLocale?: string;
}

/**
 * Taslak önizleme: "Önizle" (30 dk'lık oturum belirteci, yeni sekme) ve oturumsuz paylaşılabilir bağlantı
 * (7 gün; tam adres YALNIZCA oluşturulduğu anda gösterilir, sunucu yalnızca özetini tutar). Önizleme yazının
 * durumunu değiştirmez.
 */
export function BlogPreviewControls({ postId, defaultLocale }: BlogPreviewControlsProps) {
  const [status, setStatus] = useState<BlogPreviewLinkStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [opening, setOpening] = useState(false);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [fresh, setFresh] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setStatusError(false);
    try {
      setStatus(await blogApi.getPreviewLink(postId));
    } catch {
      setStatusError(true);
    }
  }, [postId]);

  useEffect(() => {
    (async () => {
      await loadStatus();
    })();
  }, [loadStatus]);

  async function handleOpen() {
    setOpening(true);
    setError(null);
    try {
      await openAdminBlogPreview(postId, defaultLocale);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setOpening(false);
    }
  }

  async function handleCreate() {
    setCreating(true);
    setError(null);
    setCopied(false);
    try {
      const created = await blogApi.createPreviewLink(postId);
      const def = defaultLocale ?? (await resolveDefaultLocaleCode());
      setFresh({ url: absolutePreviewUrl(postId, created.token, def), expiresAt: created.expiresAt });
      setStatus({ active: true, expiresAt: created.expiresAt, createdAt: new Date().toISOString() });
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy() {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.url);
      setCopied(true);
      toast.success("Önizleme bağlantısı kopyalandı.");
    } catch {
      setCopied(false);
      toast.error("Kopyalanamadı. Bağlantıyı elle seçip kopyalayın.");
    }
  }

  async function handleRevoke() {
    setRevoking(true);
    setError(null);
    try {
      await blogApi.revokePreviewLink(postId);
      setStatus({ active: false, expiresAt: null, createdAt: null });
      setFresh(null);
      setRevokeOpen(false);
      toast.success("Önizleme bağlantısı iptal edildi.");
    } catch (err) {
      setError(friendlyErrorMessage(err));
      setRevokeOpen(false);
    } finally {
      setRevoking(false);
    }
  }

  return (
    <Card className="space-y-3" data-testid="blog-preview-controls">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Önizleme</h2>
          <p className="mt-0.5 text-xs text-foreground/60">
            Yazıyı yayındaki sayfa tasarımıyla görün. Önizleme yazının durumunu değiştirmez ve arama motorlarına kapalıdır.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" loading={opening} onClick={() => void handleOpen()}>
            <Eye className="h-4 w-4" aria-hidden="true" />
            Önizle
          </Button>
          <Button type="button" variant="outline" size="sm" loading={creating} onClick={() => void handleCreate()}>
            <Link2 className="h-4 w-4" aria-hidden="true" />
            Önizleme bağlantısı oluştur
          </Button>
        </div>
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}

      {fresh ? (
        <div className="space-y-2 rounded-md border border-border bg-background p-3" data-testid="blog-preview-link-fresh">
          <label htmlFor={`preview-link-${postId}`} className="block text-xs font-medium text-foreground/80">
            Paylaşılabilir bağlantı (oturum açmadan görüntülenir)
          </label>
          <div className="flex gap-2">
            <Input id={`preview-link-${postId}`} readOnly value={fresh.url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
            <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()}>
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {copied ? "Kopyalandı" : "Kopyala"}
            </Button>
          </div>
          <p className="text-xs text-foreground/60">
            Son geçerlilik: {formatPreviewExpiry(fresh.expiresAt)}. Bu bağlantı yalnızca şimdi gösterilir; kapatırsanız yeniden oluşturmanız gerekir (yeni bağlantı eskisini geçersiz kılar).
          </p>
        </div>
      ) : null}

      {status?.active ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm" data-testid="blog-preview-link-status">
          <span className="flex flex-wrap items-center gap-2 text-foreground/80">
            <Badge tone="success">Bağlantı etkin</Badge>
            {status.expiresAt ? <span>Son geçerlilik: {formatPreviewExpiry(status.expiresAt)}</span> : null}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setRevokeOpen(true)}>
            <Link2Off className="h-4 w-4" aria-hidden="true" />
            Bağlantıyı iptal et
          </Button>
        </div>
      ) : status && !fresh ? (
        <p className="text-xs text-foreground/60" data-testid="blog-preview-link-none">
          Etkin önizleme bağlantısı yok.
        </p>
      ) : null}
      {statusError ? <p className="text-xs text-foreground/60">Bağlantı durumu yüklenemedi.</p> : null}

      <ConfirmDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title="Önizleme bağlantısını iptal et"
        description="Bu bağlantıyı alan kişiler yazıyı artık açamaz. Gerekirse yeni bir bağlantı oluşturabilirsiniz."
        confirmText="Bağlantıyı iptal et"
        tone="warning"
        loading={revoking}
        onConfirm={() => void handleRevoke()}
      />
    </Card>
  );
}
