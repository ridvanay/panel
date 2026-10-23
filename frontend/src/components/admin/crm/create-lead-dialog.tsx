"use client";

import { useState } from "react";
import { toast } from "sonner";
import * as crmApi from "@/lib/api/crm";
import { CRM_LEAD_CHANNEL_OPTIONS, type CrmLeadChannel } from "@/lib/api/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fieldErrorsFrom, friendlyErrorMessage } from "@/lib/api/friendly-error";

/** Paket N2 — elle talep ekleme; ziyaretçi detayından "Talebe dönüştür" ile `visitorId` bağlanarak açılır. */
export function CreateLeadDialog({
  open,
  onOpenChange,
  onCreated,
  visitorId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
  visitorId?: string;
}) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", channel: "MANUAL" as CrmLeadChannel, note: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setErrors({});
    try {
      const lead = await crmApi.createCrmLead({
        channel: form.channel,
        name: form.name || null,
        phone: form.phone || null,
        email: form.email || null,
        note: form.note || undefined,
        ...(visitorId ? { visitorId } : {}),
      });
      toast.success("Talep oluşturuldu.");
      onOpenChange(false);
      setForm({ name: "", phone: "", email: "", channel: "MANUAL", note: "" });
      onCreated(lead.id);
    } catch (err) {
      setErrors(fieldErrorsFrom(err));
      toast.error(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{visitorId ? "Ziyaretçiyi talebe dönüştür" : "Yeni talep"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field id="lead-channel" label="Kanal">
            {(p) => (
              <Select {...p} value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value as CrmLeadChannel })}>
                {CRM_LEAD_CHANNEL_OPTIONS.filter((o) => o.value !== "ADS_IMPORT" && o.value !== "BOOKING_ABANDONED").map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="lead-name" label="Ad soyad" error={errors.name}>
            {(p) => <Input {...p} dir="auto" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="lead-phone" label="Telefon" error={errors.phone}>
              {(p) => <Input {...p} dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />}
            </Field>
            <Field id="lead-email" label="E-posta" error={errors.email}>
              {(p) => <Input {...p} dir="ltr" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
            </Field>
          </div>
          <Field id="lead-note" label="İlk not (şifreli saklanır)">
            {(p) => <Textarea {...p} rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Vazgeç
            </Button>
            <Button type="button" onClick={() => void submit()} disabled={saving}>
              {saving ? "Kaydediliyor…" : "Oluştur"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
