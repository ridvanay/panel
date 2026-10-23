"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import * as crmApi from "@/lib/api/crm";
import type { CrmScoreWeights, CrmSettings } from "@/lib/api/crm";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { fieldErrorsFrom, friendlyErrorMessage } from "@/lib/api/friendly-error";
import { SITE_URL } from "@/lib/env";
import { SearchConsoleCard } from "@/components/admin/crm/search-console-card";

interface FormState {
  trackingEnabled: boolean;
  trackStaff: boolean;
  ipMode: "masked" | "full";
  excludedIps: string;
  excludedPaths: string;
  retentionDays: string;
  leadRetentionDays: string;
  notificationEmail: string;
  whatsappRef: boolean;
  slaHours: string;
  adsConversionName: string;
  adsLeadConversionName: string;
  scoreWeights: Record<keyof CrmScoreWeights, string>;
}

const WEIGHT_FIELDS: { key: keyof CrmScoreWeights; label: string; hint: string }[] = [
  { key: "perEngagedMinute", label: "Okuma dakikası başına", hint: "En fazla 30 puan" },
  { key: "perPageview", label: "Sayfa görüntüleme başına", hint: "En fazla 30 puan" },
  { key: "perReturnVisit", label: "Tekrar ziyaret başına", hint: "En fazla 20 puan" },
  { key: "bookingPage", label: "Randevu sihirbazına gelme", hint: "Tek sefer" },
  { key: "contactClick", label: "WhatsApp / telefon / e-posta tıklaması", hint: "Tek sefer" },
  { key: "hotThreshold", label: "Sıcak ziyaretçi eşiği", hint: "Bu puan ve üzeri" },
];

function toForm(settings: CrmSettings): FormState {
  return {
    trackingEnabled: settings.trackingEnabled,
    trackStaff: settings.trackStaff,
    ipMode: settings.ipMode,
    excludedIps: settings.excludedIps.join("\n"),
    excludedPaths: settings.excludedPaths.join("\n"),
    retentionDays: String(settings.retentionDays),
    leadRetentionDays: String(settings.leadRetentionDays),
    notificationEmail: settings.notificationEmail ?? "",
    whatsappRef: settings.whatsappRef,
    slaHours: String(settings.slaHours),
    adsConversionName: settings.adsConversionName,
    adsLeadConversionName: settings.adsLeadConversionName,
    scoreWeights: Object.fromEntries(Object.entries(settings.scoreWeights).map(([k, v]) => [k, String(v)])) as FormState["scoreWeights"],
  };
}

function lines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Paket N1 — CRM Ayarları: takip aç/kapa (varsayılan kapalı), personel hariç tutma, IP modu (varsayılan
 * maskeli), hariç IP/yol listeleri, saklama süreleri, bildirim e-postası, WhatsApp Ref kodu, sıcaklık
 * puanı ağırlıkları, SLA ve Google Ads dönüşüm adları.
 */
export default function CrmSettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ["crm-settings"], queryFn: crmApi.getCrmSettings });
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sunucu verisi geldiğinde formu bir kez doldur
    if (settings.data && !form) setForm(toForm(settings.data));
  }, [settings.data, form]);

  if (settings.isPending) return <Skeleton className="h-96 w-full" />;
  if (settings.isError) return <Alert variant="error">{friendlyErrorMessage(settings.error)}</Alert>;
  if (!form) return null;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  async function save() {
    if (!form) return;
    const numberFields: [string, string][] = [
      ["retentionDays", form.retentionDays],
      ["leadRetentionDays", form.leadRetentionDays],
      ["slaHours", form.slaHours],
      ...Object.entries(form.scoreWeights).map(([k, v]) => [`scoreWeights.${k}`, v] as [string, string]),
    ];
    const empty = numberFields.filter(([, v]) => v.trim() === "" || !Number.isFinite(Number(v)));
    if (empty.length > 0) {
      setErrors(Object.fromEntries(empty.map(([k]) => [k, "Bir sayı girin."])));
      toast.error("Boş ya da geçersiz sayı alanları var.");
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      const updated = await crmApi.updateCrmSettings({
        trackingEnabled: form.trackingEnabled,
        trackStaff: form.trackStaff,
        ipMode: form.ipMode,
        excludedIps: lines(form.excludedIps),
        excludedPaths: lines(form.excludedPaths),
        retentionDays: Number(form.retentionDays),
        leadRetentionDays: Number(form.leadRetentionDays),
        notificationEmail: form.notificationEmail.trim() || null,
        whatsappRef: form.whatsappRef,
        slaHours: Number(form.slaHours),
        adsConversionName: form.adsConversionName,
        adsLeadConversionName: form.adsLeadConversionName,
        scoreWeights: Object.fromEntries(Object.entries(form.scoreWeights).map(([k, v]) => [k, Number(v)])),
      });
      queryClient.setQueryData(["crm-settings"], updated);
      setForm(toForm(updated));
      toast.success("CRM ayarları kaydedildi.");
    } catch (err) {
      setErrors(fieldErrorsFrom(err));
      toast.error(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const optOutUrl = `${SITE_URL.replace(/\/$/, "")}/?crm_optout=1`;

  return (
    <div className="max-w-3xl space-y-6">
      <Card className="space-y-4">
        <h2 className="admin-h2">Takip</h2>
        <Toggle
          id="crm-tracking"
          label="Ziyaretçi takibi açık"
          description="Kapalıyken takip modülü sitede hiç yüklenmez. Açıkken de YALNIZCA çerez bandında “Analitik”e izin veren ziyaretçiler ölçülür; çerez bandı Görünüm ayarlarında kapalıysa onay alınamaz ve takip başlamaz."
          checked={form.trackingEnabled}
          onChange={(v) => set("trackingEnabled", v)}
        />
        <Toggle
          id="crm-track-staff"
          label="Personeli de takip et"
          description="Kapalıyken (önerilen) yönetim paneline giriş yapılmış cihazlar ölçülmez."
          checked={form.trackStaff}
          onChange={(v) => set("trackStaff", v)}
        />
        <Toggle
          id="crm-whatsapp-ref"
          label="WhatsApp mesajına Ref kodu ekle"
          description="WhatsApp bağlantısına tıklayan ziyaretçinin mesajına “(Ref: XXXXXX)” eklenir; talebi ziyaretçiyle elle eşleştirmek için kullanılır."
          checked={form.whatsappRef}
          onChange={(v) => set("whatsappRef", v)}
        />
        <p className="text-sm text-foreground/70">
          Kendi cihazınızı kalıcı olarak hariç tutmak için sitede bir kez şu adresi açın:{" "}
          <a href={optOutUrl} target="_blank" rel="noreferrer" className="font-mono text-xs text-primary underline" dir="ltr">
            {optOutUrl}
          </a>
        </p>
      </Card>

      <Card className="space-y-4">
        <h2 className="admin-h2">Gizlilik</h2>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">IP adresi kaydı</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="crm-ip-mode" checked={form.ipMode === "masked"} onChange={() => set("ipMode", "masked")} className="mt-1" />
            <span>Maskeli (önerilen) — IPv4 son blok, IPv6 son 80 bit silinir. Ülke/şehir maskelemeden önce çıkarılır.</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="crm-ip-mode" checked={form.ipMode === "full"} onChange={() => set("ipMode", "full")} className="mt-1" />
            <span>Tam IP</span>
          </label>
          {form.ipMode === "full" && (
            <Alert variant="warning">
              <span className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                Tam IP kişisel veridir: aydınlatma metninde ve çerez politikasında belirtilmelidir.
              </span>
            </Alert>
          )}
        </fieldset>
        <Field id="crm-excluded-ips" label="Hariç tutulan IP / CIDR (her satıra bir tane)" error={errors.excludedIps ?? errors["excludedIps.0"]} hint="Ör. ofis ağı: 203.0.113.0/24">
          {(p) => <Textarea {...p} dir="ltr" rows={3} value={form.excludedIps} onChange={(e) => set("excludedIps", e.target.value)} />}
        </Field>
        <Field
          id="crm-excluded-paths"
          label="Ek hariç yollar (her satıra bir tane)"
          error={errors.excludedPaths ?? errors["excludedPaths.0"]}
          hint="Panel, hasta/doktor portalı, görüşme, ödeme ve giriş sayfaları zaten HİÇ takip edilmez."
        >
          {(p) => <Textarea {...p} dir="ltr" rows={3} value={form.excludedPaths} onChange={(e) => set("excludedPaths", e.target.value)} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="crm-retention" label="Ziyaret verisi saklama (gün)" error={errors.retentionDays} hint="7–365, varsayılan 180">
            {(p) => <Input {...p} type="number" min={7} max={365} value={form.retentionDays} onChange={(e) => set("retentionDays", e.target.value)} />}
          </Field>
          <Field id="crm-lead-retention" label="Talep saklama (gün)" error={errors.leadRetentionDays} hint="Süre dolunca anonimleştirilir; varsayılan 730">
            {(p) => <Input {...p} type="number" min={30} max={3650} value={form.leadRetentionDays} onChange={(e) => set("leadRetentionDays", e.target.value)} />}
          </Field>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="admin-h2">Talepler</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="crm-notify-email" label="Yeni talep bildirim e-postası" error={errors.notificationEmail} hint="Boş bırakılırsa e-posta gönderilmez.">
            {(p) => <Input {...p} type="email" dir="ltr" value={form.notificationEmail} onChange={(e) => set("notificationEmail", e.target.value)} />}
          </Field>
          <Field id="crm-sla" label="İlk yanıt hedefi (saat)" error={errors.slaHours}>
            {(p) => <Input {...p} type="number" min={1} max={168} value={form.slaHours} onChange={(e) => set("slaHours", e.target.value)} />}
          </Field>
        </div>
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="admin-h2">Sıcaklık puanı</h2>
          <p className="mt-1 text-sm text-foreground/70">
            Puan = okuma dakikası × ağırlık (≤30) + sayfa × ağırlık (≤30) + (ziyaret − 1) × ağırlık (≤20) + randevu sihirbazı + temas
            tıklaması; en fazla 100.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {WEIGHT_FIELDS.map((w) => (
            <Field key={w.key} id={`crm-weight-${w.key}`} label={w.label} hint={w.hint} error={errors[`scoreWeights.${w.key}`]}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0}
                  max={100}
                  value={form.scoreWeights[w.key]}
                  onChange={(e) => set("scoreWeights", { ...form.scoreWeights, [w.key]: e.target.value })}
                />
              )}
            </Field>
          ))}
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="admin-h2">Google Ads dönüşüm dosyası</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="crm-ads-conv" label="Ödenen randevu dönüşüm adı" error={errors.adsConversionName} hint="Google Ads'teki dönüşüm işlemi adıyla birebir aynı olmalı.">
            {(p) => <Input {...p} value={form.adsConversionName} onChange={(e) => set("adsConversionName", e.target.value)} />}
          </Field>
          <Field id="crm-ads-lead-conv" label="“Tedavi Oldu” talep dönüşüm adı" error={errors.adsLeadConversionName}>
            {(p) => <Input {...p} value={form.adsLeadConversionName} onChange={(e) => set("adsLeadConversionName", e.target.value)} />}
          </Field>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? "Kaydediliyor…" : "Kaydet"}
        </Button>
      </div>

      {settings.data && <SearchConsoleCard settings={settings.data} />}
    </div>
  );
}

function Toggle({ id, label, description, checked, onChange }: { id: string; label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 accent-primary" />
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <p className="text-xs text-foreground/60">{description}</p>
      </div>
    </div>
  );
}
