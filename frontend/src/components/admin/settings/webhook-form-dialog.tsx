"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, Lock } from "lucide-react";
import { useCreateWebhook, useUpdateWebhook, useWebhookEvents } from "@/hooks/use-outbound-webhooks";
import type { CreateOutboundWebhookResponse, OutboundWebhook, WebhookEvent } from "@/lib/api/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { fieldErrorsFrom, friendlyErrorMessage } from "@/lib/api/friendly-error";

// Backend `CreateOutboundWebhookSchema`/`UpdateOutboundWebhookSchema`'yı (openapi.yaml
// `OutboundWebhooks` tag'i, §10.13.7) yansıtan istemci tarafı ön kontrol — asıl SSRF
// doğrulaması (literal IP/port/DNS çözümlemesi) yalnızca sunucudadır; burada sadece `https://`
// ön eki ve uzunluk kontrol edilir, geri kalanı backend `422` + `error.details.url` ile döner.
const formSchema = z.object({
  name: z.string().trim().min(1, "İsim gerekli.").max(100, "İsim en fazla 100 karakter olabilir."),
  description: z.string().trim().max(500, "Açıklama en fazla 500 karakter olabilir.").optional(),
  url: z
    .string()
    .trim()
    .min(1, "URL gerekli.")
    .max(2048, "URL en fazla 2048 karakter olabilir.")
    .refine((v) => v.startsWith("https://"), { message: "Yalnızca https:// adresleri kabul edilir." }),
  events: z.array(z.string()).min(1, "En az bir olay seçmelisiniz."),
});

type FormValues = z.infer<typeof formSchema>;

interface WebhookFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = oluşturma modu, dolu = düzenleme modu. */
  webhook: OutboundWebhook | null;
  /** Yalnızca OLUŞTURMA başarılı olunca çağrılır — `plainSecret` tek seferlik gösterim için üst bileşene taşınır. */
  onCreated: (response: CreateOutboundWebhookResponse) => void;
}

/**
 * Webhook oluşturma/düzenleme formu. Olay listesi `GET /admin/settings/webhooks/events`'ten
 * DİNAMİK gelir (ARCHITECTURE.md §10.13.10) — hiçbir olay burada HARDCODE EDİLMEZ; yeni bir
 * olay backend'e eklendiğinde bu form kendiliğinden günceldir. Aktif/duraklatılmış durumu
 * BİLEREK bu formda YOKTUR — `WebhooksSection` listesindeki anahtar (switch) ile yönetilir,
 * tek bir kontrol yüzeyi tutmak için.
 */
export function WebhookFormDialog({ open, onOpenChange, webhook, onCreated }: WebhookFormDialogProps) {
  const isEditMode = webhook !== null;
  const eventsQuery = useWebhookEvents();
  const createMutation = useCreateWebhook();
  const updateMutation = useUpdateWebhook();
  const mutation = isEditMode ? updateMutation : createMutation;

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    setError,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", description: "", url: "", events: [] },
  });

  const selectedEvents = useWatch({ control, name: "events" });

  useEffect(() => {
    if (open) {
      reset({
        name: webhook?.name ?? "",
        description: webhook?.description ?? "",
        url: webhook?.url ?? "",
        events: webhook?.events ?? [],
      });
      createMutation.reset();
      updateMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, webhook]);

  function handleOpenChange(next: boolean) {
    if (!mutation.isPending) onOpenChange(next);
  }

  function toggleEvent(event: string, checked: boolean) {
    if (checked) setValue("events", [...selectedEvents, event], { shouldValidate: true });
    else
      setValue(
        "events",
        selectedEvents.filter((e) => e !== event),
        { shouldValidate: true }
      );
  }

  async function onSubmit(values: FormValues) {
    const description = values.description && values.description.length > 0 ? values.description : null;
    const events = values.events as WebhookEvent[];

    if (isEditMode && webhook) {
      try {
        await updateMutation.mutateAsync({
          webhookId: webhook.id,
          input: { name: values.name, description, url: values.url, events },
        });
      } catch (err) {
        for (const [field, message] of Object.entries(fieldErrorsFrom(err))) {
          if (field === "name" || field === "description" || field === "url" || field === "events") {
            setError(field, { message });
          }
        }
        return;
      }
      toast.success("Webhook güncellendi.");
      onOpenChange(false);
      return;
    }

    let response: CreateOutboundWebhookResponse;
    try {
      response = await createMutation.mutateAsync({ name: values.name, description, url: values.url, events });
    } catch (err) {
      for (const [field, message] of Object.entries(fieldErrorsFrom(err))) {
        if (field === "name" || field === "description" || field === "url" || field === "events") {
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
          <DialogTitle>{isEditMode ? "Webhook'u Düzenle" : "Yeni Webhook Ekle"}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? "Webhook ayarlarını güncelleyin. Etkin/duraklatılmış durumunu listeden değiştirebilirsiniz."
              : "Seçtiğiniz olaylar gerçekleştiğinde bu adrese HMAC imzalı bir POST isteği gönderilir."}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <Field id="webhook-name" label="İsim" error={errors.name?.message} required>
            {(inputProps) => <Input {...inputProps} placeholder="Örn. Muhasebe Entegrasyonu" {...register("name")} />}
          </Field>

          <Field id="webhook-description" label="Açıklama (opsiyonel)" error={errors.description?.message}>
            {(inputProps) => <Textarea {...inputProps} {...register("description")} />}
          </Field>

          <Field
            id="webhook-url"
            label="Hedef URL"
            error={errors.url?.message}
            hint="Yalnızca https:// — sunucu tarafında ek güvenlik doğrulamalarından (SSRF koruması) geçer."
            required
          >
            {(inputProps) => <Input {...inputProps} placeholder="https://ornek.com/webhooks/cms" {...register("url")} />}
          </Field>

          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-foreground">
              Tetiklenecek Olaylar <span className="text-danger">*</span>
            </span>
            {eventsQuery.isPending && (
              <div className="space-y-2">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            )}
            {eventsQuery.isError && (
              <Alert variant="error">
                <span className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {friendlyErrorMessage(eventsQuery.error)}
                  </span>
                  <Button type="button" variant="outline" size="sm" onClick={() => void eventsQuery.refetch()}>
                    Tekrar Dene
                  </Button>
                </span>
              </Alert>
            )}
            {eventsQuery.data && (
              <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-border p-3">
                {eventsQuery.data
                  .filter((def) => def.event !== "PING")
                  .map((def) => (
                    <div key={def.event} className="flex items-start gap-2.5">
                      <Checkbox
                        id={`webhook-event-${def.event}`}
                        checked={selectedEvents.includes(def.event)}
                        onCheckedChange={(checked) => toggleEvent(def.event, Boolean(checked))}
                        className="mt-0.5"
                      />
                      <Label htmlFor={`webhook-event-${def.event}`} className="flex-1 cursor-pointer font-normal">
                        <span className="block text-sm text-foreground">{def.label}</span>
                        <span className="block text-xs text-foreground/60">{def.description}</span>
                        {def.containsPii && (
                          <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-warning">
                            <Lock className="h-3 w-3" />
                            Kişisel veri içerebilir (KVKK)
                          </span>
                        )}
                      </Label>
                    </div>
                  ))}
              </div>
            )}
            {errors.events?.message && <p className="text-xs text-danger">{errors.events.message}</p>}
          </div>

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
