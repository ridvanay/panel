"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FileText, Plus, Trash2 } from "lucide-react";
import * as productsApi from "@/lib/api/products";
import type { Media, ProductDocument } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { MediaPicker } from "@/components/admin/media/media-picker";
import { formatBytes } from "@/lib/format-bytes";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

interface ProductDocumentsPanelProps {
  productId: string;
  documents: ProductDocument[];
  onDocumentsChange: (next: ProductDocument[]) => void;
}

/**
 * Ürün teknik döküman (PDF) paneli — `POST/DELETE /admin/products/:productId/documents[/:id]`
 * ile ANINDA yazar (`gallery-field.tsx` ile AYNI ilke, sayfanın "Kaydet" akışına DAHİL DEĞİL).
 * `MediaPicker`'ı `mediaType="document"` ile açar (§2.2 madde 6 — PDF dışı medya gösterilmez).
 * Kontrat sıralama ucu (`PATCH .../documents/:id`) SUNMUYOR — yeni dökümanlar listenin SONUNA
 * eklenir (`ProductImage` ile AYNI davranış), bu yüzden elle sıralama arayüzü YOKTUR.
 */
export function ProductDocumentsPanel({ productId, documents, onDocumentsChange }: ProductDocumentsPanelProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<Media | null>(null);
  const [pendingTitle, setPendingTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  function handlePickMedia(media: Media) {
    setPendingMedia(media);
    setPendingTitle(media.filename.replace(/\.pdf$/i, ""));
    setAddError(null);
  }

  async function handleConfirmAdd() {
    if (!pendingMedia) return;
    setAdding(true);
    setAddError(null);
    try {
      const updated = await productsApi.addProductDocument(productId, {
        mediaId: pendingMedia.id,
        title: pendingTitle.trim() || undefined,
      });
      onDocumentsChange(updated.documents);
      toast.success("Döküman eklendi.");
      setPendingMedia(null);
      setPendingTitle("");
    } catch (err) {
      setAddError(friendlyErrorMessage(err));
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(documentId: string) {
    setRemovingId(documentId);
    try {
      const updated = await productsApi.removeProductDocument(productId, documentId);
      onDocumentsChange(updated.documents);
      toast.success("Döküman kaldırıldı.");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-3">
      {documents.length > 0 && (
        <div className="space-y-2">
          {documents.map((doc) => (
            <div key={doc.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-muted text-foreground/60">
                <FileText className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{doc.title || doc.media.filename}</p>
                <p className="text-xs text-foreground/60">{formatBytes(doc.media.sizeBytes)}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`"${doc.title || doc.media.filename}" dökümanını kaldır`}
                loading={removingId === doc.id}
                onClick={() => handleRemove(doc.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {pendingMedia ? (
        <Card className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-muted text-foreground/60">
              <FileText className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{pendingMedia.filename}</p>
              <p className="text-xs text-foreground/60">{formatBytes(pendingMedia.sizeBytes)}</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground/70" htmlFor="pending-document-title">
              Başlık
            </label>
            <Input
              id="pending-document-title"
              value={pendingTitle}
              placeholder="ör. Teknik Çizim — PDF"
              onChange={(e) => setPendingTitle(e.target.value)}
            />
          </div>
          {addError && <Alert variant="error">{addError}</Alert>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPendingMedia(null);
                setAddError(null);
              }}
            >
              Vazgeç
            </Button>
            <Button type="button" loading={adding} onClick={handleConfirmAdd}>
              Ekle
            </Button>
          </div>
        </Card>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setPickerOpen(true)}>
          <Plus className="h-4 w-4" />
          Döküman ekle
        </Button>
      )}

      <MediaPicker open={pickerOpen} onOpenChange={setPickerOpen} mediaType="document" onSelect={handlePickMedia} />
    </div>
  );
}
