"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Image as ImageIcon, Plus, Trash2, X } from "lucide-react";
import * as productsApi from "@/lib/api/products";
import type { Media, ProductVariant, ProductVariantOption } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MediaPicker } from "@/components/admin/media/media-picker";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

function centsToLiraString(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toString();
}

interface RowFormState {
  sku: string;
  priceLira: string;
  discountPriceLira: string;
  stockQuantity: string;
  isActive: boolean;
  media: Media | null;
}

function toRowFormState(variant: ProductVariant): RowFormState {
  return {
    sku: variant.sku ?? "",
    priceLira: centsToLiraString(variant.priceCents),
    discountPriceLira: centsToLiraString(variant.discountPriceCents),
    stockQuantity: String(variant.stockQuantity),
    isActive: variant.isActive,
    media: variant.media,
  };
}

const EMPTY_NEW_FORM: RowFormState = {
  sku: "",
  priceLira: "",
  discountPriceLira: "",
  stockQuantity: "0",
  isActive: true,
  media: null,
};

interface ProductVariantsPanelProps {
  productId: string;
  /**
   * SUNUCUDA KAYITLI eksen tanımı — yeni varyasyon eklerken backend BUNLARA göre doğrular
   * (`optionValues` eksik/fazla eksen ya da tanımsız değer içeriyorsa 422). Henüz kaydedilmemiş
   * yerel taslak eksenler (`axesDirty`) BURADA KULLANILMAZ.
   */
  savedAxes: ProductVariantOption[];
  /** `true` ise yerel eksen taslağı SUNUCUDAKİNDEN farklıdır — yeni varyasyon ekleme KAPALIDIR. */
  axesDirty: boolean;
  variants: ProductVariant[];
  onVariantsChange: (next: ProductVariant[]) => void;
}

/**
 * Varyasyon KOMBİNASYON tablosu (sku/fiyat/stok/görsel/aktiflik) — her satır KENDİ "Kaydet"
 * butonuyla ANINDA `PATCH .../variants/:variantId` çağırır (`gallery-field.tsx` ile AYNI ilke:
 * bu panel sayfanın "Kaydet" akışına DAHİL DEĞİLDİR). Yeni satır ekleme, SUNUCUDA KAYITLI
 * eksenlere göre `POST .../variants` çağırır — bu yüzden eksen taslağı kaydedilmeden AÇILMAZ.
 */
export function ProductVariantsPanel({ productId, savedAxes, axesDirty, variants, onVariantsChange }: ProductVariantsPanelProps) {
  const [rowStates, setRowStates] = useState<Record<string, RowFormState>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pickerOpenForId, setPickerOpenForId] = useState<string | null>(null);

  const [addingOpen, setAddingOpen] = useState(false);
  const [newSelection, setNewSelection] = useState<Record<string, string>>({});
  const [newForm, setNewForm] = useState<RowFormState>(EMPTY_NEW_FORM);
  const [newPickerOpen, setNewPickerOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function rowState(variant: ProductVariant): RowFormState {
    return rowStates[variant.id] ?? toRowFormState(variant);
  }

  function patchRow(variantId: string, base: ProductVariant, patch: Partial<RowFormState>) {
    setRowStates((prev) => ({ ...prev, [variantId]: { ...(prev[variantId] ?? toRowFormState(base)), ...patch } }));
  }

  async function handleSaveRow(variant: ProductVariant) {
    const state = rowState(variant);
    setSavingId(variant.id);
    try {
      const updated = await productsApi.updateProductVariant(productId, variant.id, {
        sku: state.sku.trim() || null,
        priceCents: state.priceLira.trim() ? Math.round(Number(state.priceLira) * 100) : null,
        discountPriceCents: state.discountPriceLira.trim() ? Math.round(Number(state.discountPriceLira) * 100) : null,
        stockQuantity: Number(state.stockQuantity || "0"),
        mediaId: state.media?.id ?? null,
        isActive: state.isActive,
      });
      onVariantsChange(updated.variants);
      toast.success("Varyasyon güncellendi.");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(variantId: string) {
    setDeletingId(variantId);
    try {
      const updated = await productsApi.deleteProductVariant(productId, variantId);
      onVariantsChange(updated.variants);
      toast.success("Varyasyon silindi.");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  const canAdd = savedAxes.length > 0 && !axesDirty;
  const newSelectionComplete = savedAxes.length > 0 && savedAxes.every((axis) => Boolean(newSelection[axis.name]));

  async function handleCreate() {
    if (!newSelectionComplete) return;
    setCreating(true);
    setCreateError(null);
    try {
      const updated = await productsApi.addProductVariant(productId, {
        optionValues: newSelection,
        sku: newForm.sku.trim() || null,
        priceCents: newForm.priceLira.trim() ? Math.round(Number(newForm.priceLira) * 100) : null,
        discountPriceCents: newForm.discountPriceLira.trim() ? Math.round(Number(newForm.discountPriceLira) * 100) : null,
        stockQuantity: Number(newForm.stockQuantity || "0"),
        mediaId: newForm.media?.id ?? null,
        isActive: newForm.isActive,
      });
      onVariantsChange(updated.variants);
      toast.success("Varyasyon eklendi.");
      setAddingOpen(false);
      setNewSelection({});
      setNewForm(EMPTY_NEW_FORM);
    } catch (err) {
      setCreateError(friendlyErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-3">
      {axesDirty && (
        <Alert variant="warning">
          Eksen değişikliklerini sayfanın üstündeki &quot;Kaydet&quot; butonuyla kaydetmeden yeni varyasyon ekleyemezsiniz.
        </Alert>
      )}

      {variants.length === 0 ? (
        <p className="text-sm text-foreground/60">Henüz varyasyon eklenmedi.</p>
      ) : (
        <div className="space-y-3">
          {variants.map((variant) => {
            const state = rowState(variant);
            return (
              <Card key={variant.id} className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{variant.label}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`"${variant.label}" varyasyonunu sil`}
                    onClick={() => setConfirmDeleteId(variant.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-foreground/70">SKU</label>
                    <Input value={state.sku} onChange={(e) => patchRow(variant.id, variant, { sku: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-foreground/70">Fiyat (TL)</label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Ürün fiyatını miras alır"
                      value={state.priceLira}
                      onChange={(e) => patchRow(variant.id, variant, { priceLira: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-foreground/70">İndirimli fiyat (TL)</label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={state.discountPriceLira}
                      onChange={(e) => patchRow(variant.id, variant, { discountPriceLira: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-foreground/70">Stok</label>
                    <Input
                      type="number"
                      step="1"
                      min="0"
                      value={state.stockQuantity}
                      onChange={(e) => patchRow(variant.id, variant, { stockQuantity: e.target.value })}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {state.media ? (
                      <div className="relative h-12 w-12 overflow-hidden rounded-md border border-border">
                        {/* eslint-disable-next-line @next/next/no-img-element -- varyasyon görseli medya kütüphanesinden gelir */}
                        <img src={state.media.url} alt="" className="h-full w-full object-cover" />
                        <button
                          type="button"
                          aria-label="Varyasyon görselini kaldır"
                          onClick={() => patchRow(variant.id, variant, { media: null })}
                          className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center bg-black/60 text-white"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    ) : (
                      <Button type="button" variant="secondary" size="sm" onClick={() => setPickerOpenForId(variant.id)}>
                        <ImageIcon className="h-3.5 w-3.5" />
                        Görsel seç
                      </Button>
                    )}
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <Switch
                        checked={state.isActive}
                        onCheckedChange={(checked) => patchRow(variant.id, variant, { isActive: checked })}
                      />
                      Aktif
                    </label>
                  </div>
                  <Button type="button" size="sm" loading={savingId === variant.id} onClick={() => handleSaveRow(variant)}>
                    Kaydet
                  </Button>
                </div>
                <MediaPicker
                  open={pickerOpenForId === variant.id}
                  onOpenChange={(open) => setPickerOpenForId(open ? variant.id : null)}
                  onSelect={(media) => {
                    patchRow(variant.id, variant, { media });
                    setPickerOpenForId(null);
                  }}
                />
              </Card>
            );
          })}
        </div>
      )}

      {!addingOpen ? (
        <Button
          type="button"
          variant="secondary"
          disabled={!canAdd}
          title={!canAdd ? "Önce en az bir eksen tanımlayıp kaydedin." : undefined}
          onClick={() => setAddingOpen(true)}
        >
          <Plus className="h-4 w-4" />
          Yeni varyasyon ekle
        </Button>
      ) : (
        <Card className="space-y-3">
          <p className="text-sm font-medium text-foreground">Yeni varyasyon</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {savedAxes.map((axis) => (
              <div key={axis.name} className="space-y-1.5">
                <label className="block text-xs font-medium text-foreground/70">{axis.name}</label>
                <Select
                  value={newSelection[axis.name] ?? ""}
                  onChange={(e) => setNewSelection((prev) => ({ ...prev, [axis.name]: e.target.value }))}
                >
                  <option value="">Seçin…</option>
                  {axis.values.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.value}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground/70">SKU</label>
              <Input value={newForm.sku} onChange={(e) => setNewForm((prev) => ({ ...prev, sku: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground/70">Fiyat (TL)</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="Ürün fiyatını miras alır"
                value={newForm.priceLira}
                onChange={(e) => setNewForm((prev) => ({ ...prev, priceLira: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground/70">İndirimli fiyat (TL)</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={newForm.discountPriceLira}
                onChange={(e) => setNewForm((prev) => ({ ...prev, discountPriceLira: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground/70">Stok</label>
              <Input
                type="number"
                step="1"
                min="0"
                value={newForm.stockQuantity}
                onChange={(e) => setNewForm((prev) => ({ ...prev, stockQuantity: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            {newForm.media ? (
              <div className="relative h-12 w-12 overflow-hidden rounded-md border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element -- varyasyon görseli medya kütüphanesinden gelir */}
                <img src={newForm.media.url} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  aria-label="Varyasyon görselini kaldır"
                  onClick={() => setNewForm((prev) => ({ ...prev, media: null }))}
                  className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center bg-black/60 text-white"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ) : (
              <Button type="button" variant="secondary" size="sm" onClick={() => setNewPickerOpen(true)}>
                <ImageIcon className="h-3.5 w-3.5" />
                Görsel seç
              </Button>
            )}
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Switch
                checked={newForm.isActive}
                onCheckedChange={(checked) => setNewForm((prev) => ({ ...prev, isActive: checked }))}
              />
              Aktif
            </label>
          </div>
          {createError && <Alert variant="error">{createError}</Alert>}
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setAddingOpen(false);
                setCreateError(null);
                setNewSelection({});
                setNewForm(EMPTY_NEW_FORM);
              }}
            >
              Vazgeç
            </Button>
            <Button type="button" loading={creating} disabled={!newSelectionComplete} onClick={handleCreate}>
              Ekle
            </Button>
          </div>
          <MediaPicker
            open={newPickerOpen}
            onOpenChange={setNewPickerOpen}
            onSelect={(media) => {
              setNewForm((prev) => ({ ...prev, media }));
              setNewPickerOpen(false);
            }}
          />
        </Card>
      )}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => !open && setConfirmDeleteId(null)}
        title="Varyasyonu sil"
        description="Bu varyasyonu silmek istediğinize emin misiniz? Sepetteki ilgili satırlar da kaldırılır, siparişlerdeki geçmiş kayıtlar etkilenmez."
        confirmText="Sil"
        tone="danger"
        loading={deletingId !== null}
        onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)}
      />
    </div>
  );
}
