"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, Pencil, Percent, Plus, Trash2 } from "lucide-react";
import * as settingsApi from "@/lib/api/settings";
import * as taxApi from "@/lib/api/tax";
import type { AdminSiteSettings, TaxRate } from "@/lib/api/types";
import { ApiClientError } from "@/lib/api/error";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionHeader } from "@/components/admin/settings/section-header";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { cn } from "@/lib/utils";

const PRICING_MODE_OPTIONS: { value: boolean; label: string; description: string }[] = [
  { value: true, label: "Fiyatlara KDV dahildir", description: "Ürün fiyatı girildiği gibi (KDV dahil) müşteriye gösterilir." },
  { value: false, label: "Fiyatlara KDV hariçtir", description: "KDV, girilen fiyatın üzerine ayrıca eklenir." },
];

const taxRateFormSchema = z.object({
  name: z.string().trim().min(1, "Ad gerekli."),
  ratePercent: z.coerce
    .number({ invalid_type_error: "Geçerli bir oran girin." })
    .min(0, "0 veya daha büyük olmalı.")
    .max(100, "100'den büyük olamaz."),
  description: z.string().optional(),
  isDefault: z.boolean(),
});

type TaxRateFormValues = z.infer<typeof taxRateFormSchema>;

/** `err.details.reason[0]` — `409` gövdesi (bkz. `tax.routes.ts`) doğrulama-hatası şeklini varsaymaz, gerçek çalışma zamanı şekli burada daraltılır. */
function conflictReason(err: unknown): string | undefined {
  if (!(err instanceof ApiClientError) || err.status !== 409) return undefined;
  const details = err.details as unknown as { reason?: string[] } | undefined;
  return details?.reason?.[0];
}

/**
 * `/admin/settings` → "Vergi Sınıfları" sekmesi. Merkezi KDV oranı mimarisi — fiyat giriş biçimi
 * (`pricesIncludeTax`), mağaza varsayılan KDV sınıfı (`defaultTaxRateId`) ve `/admin/tax-rates`
 * CRUD'unu tek ekranda toplar. `ApiKeysSection`/`WebhooksSection` İLE AYNI kendi kendine yeten
 * (self-contained) bölüm deseni.
 */
export function TaxSettingsSection() {
  const [settings, setSettings] = useState<AdminSiteSettings | null>(null);
  const [rates, setRates] = useState<TaxRate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingPricing, setSavingPricing] = useState(false);
  const [savingDefault, setSavingDefault] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingRate, setEditingRate] = useState<TaxRate | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<TaxRate | null>(null);
  const [deleting, setDeleting] = useState(false);
  // 409 TAX_RATE_IN_USE — ürünleri hedef sınıfa taşımadan silinemez (bkz. tax.routes.ts).
  const [reassignConflict, setReassignConflict] = useState<{ rate: TaxRate; message: string } | null>(null);
  const [reassignToId, setReassignToId] = useState("");
  const [reassigning, setReassigning] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TaxRateFormValues>({
    resolver: zodResolver(taxRateFormSchema),
    defaultValues: { name: "", ratePercent: 0, description: "", isDefault: false },
  });

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [s, r] = await Promise.all([settingsApi.getSettings(), taxApi.listTaxRates()]);
      setSettings(s);
      setRates(r);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function handlePricingModeChange(pricesIncludeTax: boolean) {
    if (!settings || settings.pricesIncludeTax === pricesIncludeTax) return;
    setSavingPricing(true);
    try {
      const updated = await settingsApi.updateSettings({ pricesIncludeTax });
      setSettings(updated);
      toast.success("Fiyat giriş biçimi güncellendi.");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setSavingPricing(false);
    }
  }

  async function handleDefaultRateChange(defaultTaxRateId: string) {
    if (!settings) return;
    const nextValue = defaultTaxRateId || null;
    if (settings.defaultTaxRateId === nextValue) return;
    setSavingDefault(true);
    try {
      const updated = await settingsApi.updateSettings({ defaultTaxRateId: nextValue });
      setSettings(updated);
      toast.success("Varsayılan vergi sınıfı güncellendi.");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setSavingDefault(false);
    }
  }

  function openCreateDialog() {
    setEditingRate(null);
    setFormError(null);
    reset({ name: "", ratePercent: 0, description: "", isDefault: false });
    setFormOpen(true);
  }

  function openEditDialog(rate: TaxRate) {
    setEditingRate(rate);
    setFormError(null);
    reset({ name: rate.name, ratePercent: rate.ratePercent, description: rate.description ?? "", isDefault: rate.isDefault });
    setFormOpen(true);
  }

  async function onSubmit(values: TaxRateFormValues) {
    setFormError(null);
    try {
      if (editingRate) {
        await taxApi.updateTaxRate(editingRate.id, {
          name: values.name,
          ratePercent: values.ratePercent,
          description: values.description?.trim() || null,
          // Varsayılanı doğrudan `false`'a çekmek backend'de 422 — Switch zaten bu durumda disabled
          // tutulur (bkz. render), ama yine de `true`'dan `true`'ya göndermek zararsızdır.
          isDefault: values.isDefault,
        });
        toast.success("Vergi sınıfı güncellendi.");
      } else {
        await taxApi.createTaxRate({
          name: values.name,
          ratePercent: values.ratePercent,
          description: values.description?.trim() || null,
          isDefault: values.isDefault,
        });
        toast.success("Vergi sınıfı eklendi.");
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      setFormError(friendlyErrorMessage(err));
    }
  }

  function requestDelete(rate: TaxRate) {
    if (rate.isDefault) return;
    setPendingDelete(rate);
  }

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await taxApi.deleteTaxRate(pendingDelete.id);
      toast.success("Vergi sınıfı silindi.");
      setPendingDelete(null);
      await load();
    } catch (err) {
      const reason = conflictReason(err);
      if (reason === "TAX_RATE_IN_USE") {
        setReassignConflict({ rate: pendingDelete, message: friendlyErrorMessage(err) });
        setReassignToId("");
        setPendingDelete(null);
      } else {
        // `TAX_RATE_IS_DEFAULT` dahil diğer tüm hatalar — basit bir hata toast'ı yeterli (§ görev notu).
        toast.error(friendlyErrorMessage(err));
        setPendingDelete(null);
      }
    } finally {
      setDeleting(false);
    }
  }

  async function handleConfirmReassignDelete() {
    if (!reassignConflict || !reassignToId) return;
    setReassigning(true);
    try {
      await taxApi.deleteTaxRate(reassignConflict.rate.id, reassignToId);
      toast.success("Ürünler taşındı ve vergi sınıfı silindi.");
      setReassignConflict(null);
      await load();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setReassigning(false);
    }
  }

  if (loadError) {
    return (
      <Card className="space-y-4">
        <SectionHeader icon={Percent} title="Vergi Sınıfları" description="Fiyat giriş biçimini ve KDV oranlarını yönetin." />
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {loadError}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      </Card>
    );
  }

  if (!settings || !rates) {
    return (
      <Card>
        <div className="flex items-center justify-center py-10">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      </Card>
    );
  }

  const reassignCandidates = reassignConflict ? rates.filter((r) => r.id !== reassignConflict.rate.id) : [];
  const lockDefaultToggle = Boolean(editingRate?.isDefault);

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <SectionHeader
          icon={Percent}
          title="Fiyat Giriş Biçimi"
          description="Ürün fiyatlarının KDV dahil mi yoksa hariç mi girildiğini belirleyin."
        />
        <div role="radiogroup" aria-label="Fiyat giriş biçimi" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PRICING_MODE_OPTIONS.map((option) => {
            const active = option.value === settings.pricesIncludeTax;
            return (
              <button
                key={String(option.value)}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={savingPricing}
                onClick={() => void handlePricingModeChange(option.value)}
                className={cn(
                  "flex flex-col gap-1 rounded-lg border p-3 text-left transition-all duration-300 disabled:opacity-60",
                  active ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
                )}
              >
                <span className="text-sm font-medium text-foreground">{option.label}</span>
                <span className="text-xs text-foreground/60">{option.description}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="space-y-4">
        <SectionHeader
          icon={Percent}
          title="Varsayılan Vergi Sınıfı"
          description="Kendi KDV oranı seçilmemiş ürünlerde bu sınıf kullanılır."
        />
        <Field id="defaultTaxRateId" label="Varsayılan vergi sınıfı" hint="Yeni ürünlerde otomatik seçilir.">
          {(inputProps) => (
            <Select
              {...inputProps}
              disabled={savingDefault}
              value={settings.defaultTaxRateId ?? ""}
              onChange={(e) => void handleDefaultRateChange(e.target.value)}
            >
              <option value="">Tanımlanmamış (KDV hesaplanmaz)</option>
              {rates.map((rate) => (
                <option key={rate.id} value={rate.id}>
                  %{rate.ratePercent} — {rate.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </Card>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeader icon={Percent} title="Vergi Sınıfları" description="Ürünlere atanabilecek KDV oranlarını yönetin." />
          <Button type="button" size="sm" onClick={openCreateDialog}>
            <Plus className="h-4 w-4" />
            Yeni Vergi Sınıfı Ekle
          </Button>
        </div>

        {rates.length === 0 ? (
          <EmptyState
            icon={Percent}
            title="Henüz vergi sınıfı yok"
            description="Ürünlere atamak için ilk KDV oranınızı ekleyin."
            action={
              <Button type="button" size="sm" onClick={openCreateDialog}>
                <Plus className="h-4 w-4" />
                Yeni Vergi Sınıfı Ekle
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ad</TableHead>
                <TableHead className="text-right">Oran (%)</TableHead>
                <TableHead>Varsayılan</TableHead>
                <TableHead>Açıklama</TableHead>
                <TableHead className="text-right">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.map((rate) => (
                <TableRow key={rate.id} className={cn(rate.isDefault && "border-l-2 border-l-primary bg-primary/5")}>
                  <TableCell className="font-medium text-foreground">{rate.name}</TableCell>
                  <TableCell className="text-right text-foreground">{rate.ratePercent}</TableCell>
                  <TableCell>{rate.isDefault ? <Badge tone="primary">Varsayılan</Badge> : <span className="text-foreground/40">—</span>}</TableCell>
                  <TableCell className="text-foreground/60">{rate.description || "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`"${rate.name}" vergi sınıfını düzenle`}
                        onClick={() => openEditDialog(rate)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {rate.isDefault ? (
                        <Tooltip>
                          <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={`"${rate.name}" vergi sınıfını sil`} disabled>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Varsayılan sınıf silinemez</TooltipContent>
                        </Tooltip>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`"${rate.name}" vergi sınıfını sil`}
                          onClick={() => requestDelete(rate)}
                        >
                          <Trash2 className="h-4 w-4 text-danger" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingRate(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingRate ? "Vergi Sınıfını Düzenle" : "Yeni Vergi Sınıfı"}</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
            {formError && (
              <Alert variant="error">
                <span className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {formError}
                </span>
              </Alert>
            )}
            <Field id="taxRateName" label="Ad" error={errors.name?.message} required>
              {(inputProps) => <Input {...inputProps} {...register("name")} autoFocus />}
            </Field>
            <Field id="taxRateRatePercent" label="Oran (%)" error={errors.ratePercent?.message} required>
              {(inputProps) => <Input {...inputProps} type="number" step="0.01" min="0" max="100" {...register("ratePercent")} />}
            </Field>
            <Field id="taxRateDescription" label="Açıklama" hint="Opsiyonel.">
              {(inputProps) => <Textarea {...inputProps} rows={2} {...register("description")} />}
            </Field>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-foreground">Varsayılan yap</p>
                <p className="text-xs text-foreground/60">
                  {lockDefaultToggle
                    ? "Varsayılanı kaldırmak için başka bir sınıfı varsayılan yapın."
                    : "Bu sınıf tek varsayılan KDV oranı olarak işaretlenir."}
                </p>
              </div>
              <Controller
                control={control}
                name="isDefault"
                render={({ field }) => (
                  <Switch
                    aria-label="Varsayılan yap"
                    checked={field.value}
                    disabled={lockDefaultToggle}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                Vazgeç
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {editingRate ? "Kaydet" : "Ekle"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Vergi sınıfını sil"
        description={pendingDelete ? `"${pendingDelete.name}" vergi sınıfını silmek istediğinize emin misiniz?` : undefined}
        confirmText="Sil"
        tone="danger"
        loading={deleting}
        onConfirm={handleConfirmDelete}
      />

      <Dialog
        open={reassignConflict !== null}
        onOpenChange={(open) => {
          if (!open) setReassignConflict(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
                <AlertCircle className="h-4 w-4" />
              </span>
              <div>
                <DialogTitle>Vergi sınıfı kullanımda</DialogTitle>
                <DialogDescription className="mt-1">{reassignConflict?.message}</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <Field id="reassignToId" label="Ürünleri şu sınıfa taşı" required>
            {(inputProps) => (
              <Select {...inputProps} value={reassignToId} onChange={(e) => setReassignToId(e.target.value)}>
                <option value="">Seçin…</option>
                {reassignCandidates.map((rate) => (
                  <option key={rate.id} value={rate.id}>
                    %{rate.ratePercent} — {rate.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReassignConflict(null)}>
              Vazgeç
            </Button>
            <Button type="button" variant="warning" disabled={!reassignToId} loading={reassigning} onClick={() => void handleConfirmReassignDelete()}>
              Taşı ve Sil
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
