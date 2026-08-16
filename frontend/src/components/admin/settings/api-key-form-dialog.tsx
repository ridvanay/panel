"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateApiKey, useUpdateApiKey } from "@/hooks/use-api-keys";
import type { ApiKey, ApiKeyScope, CreateApiKeyResponse } from "@/lib/api/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fieldErrorsFrom, friendlyErrorMessage } from "@/lib/api/friendly-error";
import { API_KEY_SCOPE_DESCRIPTIONS, API_KEY_SCOPE_LABELS } from "./api-key-labels";

const SCOPE_OPTIONS: ApiKeyScope[] = ["READ", "READ_WRITE"];

// Backend `CreateApiKeySchema`/`UpdateApiKeySchema`'yı (openapi.yaml `ApiKeys` tag'i, §10.13.3)
// BİREBİR yansıtan istemci tarafı zod şeması — react-hook-form ile client-side doğrulama.
const formSchema = z
  .object({
    name: z.string().trim().min(1, "İsim gerekli.").max(100, "İsim en fazla 100 karakter olabilir."),
    description: z.string().trim().max(500, "Açıklama en fazla 500 karakter olabilir.").optional(),
    scope: z.enum(["READ", "READ_WRITE"]),
    expiresAt: z.string().optional(),
  })
  .refine((v) => !v.expiresAt || new Date(`${v.expiresAt}T23:59:59`).getTime() > Date.now(), {
    message: "Son kullanma tarihi gelecekte olmalı.",
    path: ["expiresAt"],
  });

type FormValues = z.infer<typeof formSchema>;

function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

interface ApiKeyFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = oluşturma modu, dolu = düzenleme modu. */
  apiKey: ApiKey | null;
  /** Yalnızca OLUŞTURMA başarılı olunca çağrılır — `plainKey` tek seferlik gösterim için üst bileşene taşınır. */
  onCreated: (response: CreateApiKeyResponse) => void;
}

/**
 * API anahtarı oluşturma/düzenleme formu — `create-export-dialog.tsx` ile AYNI Dialog +
 * react-hook-form + zod görsel dili. Düzenleme modunda anahtarın KENDİSİ değiştirilemez
 * (yalnızca meta veri) — bu backend kısıtının (ARCHITECTURE.md §10.13.10) UI'daki yansımasıdır;
 * rotasyon istenirse kullanıcı yeni bir anahtar oluşturup eskisini iptal etmelidir.
 */
export function ApiKeyFormDialog({ open, onOpenChange, apiKey, onCreated }: ApiKeyFormDialogProps) {
  const isEditMode = apiKey !== null;
  const createMutation = useCreateApiKey();
  const updateMutation = useUpdateApiKey();
  const mutation = isEditMode ? updateMutation : createMutation;

  const {
    register,
    handleSubmit,
    reset,
    setError,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", description: "", scope: "READ", expiresAt: "" },
  });

  // `useWatch` — `form.watch()`'un aksine React Compiler ile UYUMLU (bkz. `create-export-dialog.tsx`).
  const scope = useWatch({ control, name: "scope" });

  useEffect(() => {
    if (open) {
      reset({
        name: apiKey?.name ?? "",
        description: apiKey?.description ?? "",
        scope: apiKey?.scope ?? "READ",
        expiresAt: toDateInputValue(apiKey?.expiresAt ?? null),
      });
      createMutation.reset();
      updateMutation.reset();
    }
    // Yalnızca dialog açılışında (ve düzenlenen anahtar değiştiğinde) formu doldurmak
    // istiyoruz — mutation nesnelerinin referansı her render'da yenilenebildiği için
    // bağımlılık listesine EKLENMEZ (aksi halde reset döngüsü oluşur).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, apiKey]);

  function handleOpenChange(next: boolean) {
    if (!mutation.isPending) onOpenChange(next);
  }

  async function onSubmit(values: FormValues) {
    const description = values.description && values.description.length > 0 ? values.description : null;
    const expiresAt = values.expiresAt ? new Date(`${values.expiresAt}T23:59:59`).toISOString() : null;

    if (isEditMode && apiKey) {
      try {
        await updateMutation.mutateAsync({
          keyId: apiKey.id,
          input: { name: values.name, description, scope: values.scope, expiresAt },
        });
      } catch (err) {
        for (const [field, message] of Object.entries(fieldErrorsFrom(err))) {
          if (field === "name" || field === "description" || field === "scope" || field === "expiresAt") {
            setError(field, { message });
          }
        }
        return;
      }
      toast.success("API anahtarı güncellendi.");
      onOpenChange(false);
      return;
    }

    let response: CreateApiKeyResponse;
    try {
      response = await createMutation.mutateAsync({ name: values.name, description, scope: values.scope, expiresAt });
    } catch (err) {
      for (const [field, message] of Object.entries(fieldErrorsFrom(err))) {
        if (field === "name" || field === "description" || field === "scope" || field === "expiresAt") {
          setError(field, { message });
        }
      }
      return;
    }
    onOpenChange(false);
    onCreated(response);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditMode ? "API Anahtarını Düzenle" : "Yeni API Anahtarı Oluştur"}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? "Anahtarın kendisi değiştirilemez — yalnızca isim, açıklama, yetki ve son kullanma tarihi güncellenebilir."
              : "Oluşturduktan sonra ham anahtar yalnızca bir kez gösterilecek; güvenli bir yere kaydetmeniz gerekecek."}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Field id="api-key-name" label="İsim" error={errors.name?.message} required>
            {(inputProps) => <Input {...inputProps} placeholder="Örn. Mobil Uygulama" {...register("name")} />}
          </Field>

          <Field id="api-key-description" label="Açıklama (opsiyonel)" error={errors.description?.message}>
            {(inputProps) => (
              <Textarea {...inputProps} placeholder="Bu anahtarın ne için kullanıldığını not edin." {...register("description")} />
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Field id="api-key-scope" label="Yetki" required>
                {(inputProps) => (
                  <Select {...inputProps} {...register("scope")}>
                    {SCOPE_OPTIONS.map((scope) => (
                      <option key={scope} value={scope}>
                        {API_KEY_SCOPE_LABELS[scope]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <Field
              id="api-key-expires-at"
              label="Son kullanma (opsiyonel)"
              error={errors.expiresAt?.message}
              hint="Boş bırakılırsa süresiz olur."
            >
              {(inputProps) => <Input {...inputProps} type="date" min={todayKey()} {...register("expiresAt")} />}
            </Field>
          </div>

          <p className="text-xs text-foreground/50">{API_KEY_SCOPE_DESCRIPTIONS[scope]}</p>

          {mutation.isError && <Alert variant="error">{friendlyErrorMessage(mutation.error)}</Alert>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={mutation.isPending}>
              Vazgeç
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {isEditMode ? "Kaydet" : "Oluştur"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
