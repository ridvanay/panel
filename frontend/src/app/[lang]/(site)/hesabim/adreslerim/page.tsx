"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, CheckCircle2, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import * as usersApi from "@/lib/api/users";
import type { Address } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

// `CreateAddressRequest`/`UpdateAddressRequest` (openapi) gövdesini yansıtan istemci tarafı
// zod şeması — `country` formda GÖSTERİLMEZ (design-notes §3 madde 4, backend "TR" varsayar).
const addressFormSchema = z.object({
  title: z.string().min(1, "Adres başlığı gerekli.").max(60),
  fullName: z.string().min(1, "Alıcı adı gerekli.").max(120),
  phone: z.string().min(7, "Geçerli bir telefon numarası girin.").max(20),
  city: z.string().min(1, "İl gerekli.").max(100),
  district: z.string().min(1, "İlçe gerekli.").max(100),
  neighborhood: z.string().max(100).optional(),
  addressLine1: z.string().min(1, "Adres satırı gerekli.").max(200),
  addressLine2: z.string().max(200).optional(),
  postalCode: z.string().max(20).optional(),
  isDefault: z.boolean(),
});

type AddressFormValues = z.infer<typeof addressFormSchema>;

const emptyFormValues: AddressFormValues = {
  title: "",
  fullName: "",
  phone: "",
  city: "",
  district: "",
  neighborhood: "",
  addressLine1: "",
  addressLine2: "",
  postalCode: "",
  isDefault: false,
};

function addressToFormValues(address: Address): AddressFormValues {
  return {
    title: address.title,
    fullName: address.fullName,
    phone: address.phone,
    city: address.city,
    district: address.district,
    neighborhood: address.neighborhood ?? "",
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2 ?? "",
    postalCode: address.postalCode ?? "",
    isDefault: address.isDefault,
  };
}

/**
 * `/hesabim/adreslerim` — §customer-portal §2.2/design-notes §3. Modül guard'ı YOK ("her zaman
 * açık" sekme). Ekleme/düzenleme AYNI `Dialog` üzerinden yapılır (inline sayfa-içi form
 * KULLANILMAZ).
 */
export default function MyAddressesPage() {
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<Address | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<Address | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<AddressFormValues>({
    resolver: zodResolver(addressFormSchema),
    defaultValues: emptyFormValues,
  });

  // `useWatch` — `form.watch()`'un aksine React Compiler ile UYUMLU (bkz. `create-export-dialog.tsx`).
  const isDefaultValue = useWatch({ control, name: "isDefault" });

  const load = useCallback(async () => {
    setAddresses(null);
    setError(null);
    try {
      const items = await usersApi.getMyAddresses();
      setAddresses(items);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  function openCreateDialog() {
    setEditingAddress(null);
    setFormError(null);
    reset(emptyFormValues);
    setDialogOpen(true);
  }

  function openEditDialog(address: Address) {
    setEditingAddress(address);
    setFormError(null);
    reset(addressToFormValues(address));
    setDialogOpen(true);
  }

  async function onSubmit(values: AddressFormValues) {
    setFormError(null);
    const body = {
      title: values.title,
      fullName: values.fullName,
      phone: values.phone,
      city: values.city,
      district: values.district,
      neighborhood: values.neighborhood || null,
      addressLine1: values.addressLine1,
      addressLine2: values.addressLine2 || null,
      postalCode: values.postalCode || null,
      isDefault: values.isDefault,
    };
    try {
      if (editingAddress) {
        await usersApi.updateMyAddress(editingAddress.id, body);
        toast.success("Adres güncellendi.");
      } else {
        await usersApi.createMyAddress(body);
        toast.success("Adres eklendi.");
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      setFormError(friendlyErrorMessage(err));
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await usersApi.deleteMyAddress(pendingDelete.id);
      toast.success("Adres silindi.");
      setPendingDelete(null);
      await load();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  async function handleSetDefault(address: Address) {
    setSettingDefaultId(address.id);
    try {
      await usersApi.updateMyAddress(address.id, { isDefault: true });
      toast.success("Varsayılan adres güncellendi.");
      await load();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setSettingDefaultId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Adreslerim</h2>
          <p className="mt-1 text-sm text-foreground/60">Sipariş verirken kullanmak üzere adreslerinizi yönetin.</p>
        </div>
        <Button type="button" onClick={openCreateDialog}>
          <Plus className="h-4 w-4" />
          Yeni Adres Ekle
        </Button>
      </div>

      {error && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Tekrar Dene
            </Button>
          </span>
        </Alert>
      )}

      {!error && addresses === null && (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-[var(--site-primary)]" />
        </div>
      )}

      {!error && addresses && addresses.length === 0 && (
        <EmptyState
          icon={MapPin}
          title="Henüz kayıtlı adresiniz yok"
          description="Sipariş verirken kullanmak üzere bir adres ekleyin."
          action={
            <Button type="button" onClick={openCreateDialog}>
              <Plus className="h-4 w-4" />
              Yeni Adres Ekle
            </Button>
          }
        />
      )}

      {!error && addresses && addresses.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="grid gap-4 sm:grid-cols-2"
        >
          {addresses.map((address) => (
            <Card key={address.id} className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">{address.title}</p>
                  <p className="text-sm text-foreground/60">
                    {address.fullName} · {address.phone}
                  </p>
                </div>
                {address.isDefault && (
                  <Badge tone="primary">
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    Varsayılan
                  </Badge>
                )}
              </div>
              <p className="text-sm leading-relaxed text-foreground/70">
                {address.addressLine1}
                {address.addressLine2 && `, ${address.addressLine2}`}
                <br />
                {[address.neighborhood, address.district, address.city].filter(Boolean).join(" / ")}
                {address.postalCode && ` ${address.postalCode}`}
              </p>
              <div className="flex items-center gap-1 pt-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => openEditDialog(address)}>
                  <Pencil className="h-4 w-4" />
                  Düzenle
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:bg-danger/10"
                  onClick={() => setPendingDelete(address)}
                >
                  <Trash2 className="h-4 w-4" />
                  Sil
                </Button>
                {!address.isDefault && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    loading={settingDefaultId === address.id}
                    onClick={() => void handleSetDefault(address)}
                  >
                    Varsayılan Yap
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </motion.div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingAddress ? "Adresi Düzenle" : "Yeni Adres Ekle"}</DialogTitle>
            <DialogDescription>Bu adres yalnızca profilinizde saklanır, sipariş verirken referans olarak kullanılır.</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
            {formError && (
              <Alert variant="error">
                <span className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {formError}
                </span>
              </Alert>
            )}

            <div className="space-y-2">
              <p className="text-xs font-medium tracking-wide text-foreground/50 uppercase">Adres Başlığı</p>
              <Field id="title" label="Başlık" error={errors.title?.message} required>
                {(inputProps) => <Input {...inputProps} maxLength={60} placeholder="Ev, İş…" {...register("title")} />}
              </Field>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium tracking-wide text-foreground/50 uppercase">Alıcı Bilgileri</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id="fullName" label="Ad Soyad" error={errors.fullName?.message} required>
                  {(inputProps) => <Input {...inputProps} maxLength={120} {...register("fullName")} />}
                </Field>
                <Field id="phone" label="Telefon" error={errors.phone?.message} required>
                  {(inputProps) => <Input {...inputProps} type="tel" maxLength={20} {...register("phone")} />}
                </Field>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium tracking-wide text-foreground/50 uppercase">Adres</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id="city" label="İl" error={errors.city?.message} required>
                  {(inputProps) => <Input {...inputProps} maxLength={100} {...register("city")} />}
                </Field>
                <Field id="district" label="İlçe" error={errors.district?.message} required>
                  {(inputProps) => <Input {...inputProps} maxLength={100} {...register("district")} />}
                </Field>
              </div>
              <Field id="neighborhood" label="Mahalle">
                {(inputProps) => <Input {...inputProps} maxLength={100} {...register("neighborhood")} />}
              </Field>
              <Field id="addressLine1" label="Adres Satırı 1" error={errors.addressLine1?.message} required>
                {(inputProps) => <Input {...inputProps} maxLength={200} {...register("addressLine1")} />}
              </Field>
              <Field id="addressLine2" label="Adres Satırı 2">
                {(inputProps) => <Input {...inputProps} maxLength={200} {...register("addressLine2")} />}
              </Field>
              <Field id="postalCode" label="Posta Kodu">
                {(inputProps) => <Input {...inputProps} maxLength={20} {...register("postalCode")} />}
              </Field>
            </div>

            <label className="flex items-center gap-2 text-sm text-foreground/80">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border accent-primary"
                checked={isDefaultValue}
                onChange={(e) => setValue("isDefault", e.target.checked)}
              />
              Varsayılan adresim olsun
            </label>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Vazgeç
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {editingAddress ? "Kaydet" : "Adresi Ekle"}
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
        title="Adresi sil"
        description={pendingDelete ? `"${pendingDelete.title}" adresini silmek istediğinize emin misiniz?` : undefined}
        confirmText="Sil"
        destructive
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
