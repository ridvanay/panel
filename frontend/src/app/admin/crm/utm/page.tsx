"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { SITE_URL } from "@/lib/env";
import { buildUtmUrl, normalizeUtm } from "@/lib/crm/utm";

const PRESETS: { label: string; source: string; medium: string }[] = [
  { label: "Google Ads", source: "google", medium: "cpc" },
  { label: "Facebook / Instagram", source: "facebook", medium: "social" },
  { label: "E-posta bülteni", source: "newsletter", medium: "email" },
  { label: "WhatsApp paylaşımı", source: "whatsapp", medium: "social" },
  { label: "Partner sitesi", source: "partner", medium: "referral" },
];

/** Paket N2 — kampanya bağlantısı (UTM) oluşturucu. Sunucuya bir şey göndermez. */
export default function CrmUtmBuilderPage() {
  const [base, setBase] = useState(`${SITE_URL.replace(/\/$/, "")}/`);
  const [source, setSource] = useState("");
  const [medium, setMedium] = useState("");
  const [campaign, setCampaign] = useState("");
  const [term, setTerm] = useState("");
  const [content, setContent] = useState("");
  const url = useMemo(() => buildUtmUrl(base, { source, medium, campaign, term, content }), [base, source, medium, campaign, term, content]);
  const ready = Boolean(url && normalizeUtm(source) && normalizeUtm(medium) && normalizeUtm(campaign));

  return (
    <Card className="max-w-3xl space-y-4">
      <div>
        <h2 className="admin-h2">UTM bağlantı oluşturucu</h2>
        <p className="mt-1 text-sm text-foreground/70">
          Reklam, bülten ya da paylaşım bağlantılarına kaynak/kampanya etiketi ekleyin; Hasta Yolculuğu ekranında hangi kampanyanın ödeme getirdiği görünür.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p.label}
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setSource(p.source);
              setMedium(p.medium);
            }}
          >
            {p.label}
          </Button>
        ))}
      </div>
      <Field id="utm-base" label="Sayfa adresi">
        {(p) => <Input {...p} dir="ltr" value={base} onChange={(e) => setBase(e.target.value)} />}
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id="utm-source" label="Kaynak (utm_source) *">
          {(p) => <Input {...p} dir="ltr" value={source} onChange={(e) => setSource(e.target.value)} placeholder="google" />}
        </Field>
        <Field id="utm-medium" label="Ortam (utm_medium) *">
          {(p) => <Input {...p} dir="ltr" value={medium} onChange={(e) => setMedium(e.target.value)} placeholder="cpc" />}
        </Field>
        <Field id="utm-campaign" label="Kampanya (utm_campaign) *">
          {(p) => <Input {...p} dir="ltr" value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="obezite-ekim" />}
        </Field>
        <Field id="utm-term" label="Anahtar kelime (utm_term)">
          {(p) => <Input {...p} dir="ltr" value={term} onChange={(e) => setTerm(e.target.value)} />}
        </Field>
        <Field id="utm-content" label="İçerik (utm_content)">
          {(p) => <Input {...p} dir="ltr" value={content} onChange={(e) => setContent(e.target.value)} />}
        </Field>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">Oluşan bağlantı</p>
        <output className="block break-all rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs" dir="ltr" data-testid="utm-output">
          {url ?? "Geçerli bir sayfa adresi girin."}
        </output>
        <Button
          type="button"
          disabled={!ready}
          onClick={() => {
            if (!url) return;
            void navigator.clipboard?.writeText(url).then(
              () => toast.success("Bağlantı kopyalandı."),
              () => toast.error("Kopyalanamadı.")
            );
          }}
        >
          <Copy className="h-4 w-4" aria-hidden="true" /> Kopyala
        </Button>
        {!ready && <p className="text-xs text-foreground/60">Kaynak, ortam ve kampanya zorunludur.</p>}
      </div>
    </Card>
  );
}
