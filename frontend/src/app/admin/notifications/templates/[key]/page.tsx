"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertCircle, ChevronLeft, Copy, Eye } from "lucide-react";
import * as emailTemplatesApi from "@/lib/api/email-templates";
import type { EmailTemplate, EmailTemplateKey } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PostEditor } from "@/components/admin/blog/post-editor";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

interface TemplateSnapshot {
  subject: string;
  bodyHtml: string;
}

export default function EditEmailTemplatePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const templateKey = key as EmailTemplateKey;

  const [template, setTemplate] = useState<EmailTemplate | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [snapshot, setSnapshot] = useState<TemplateSnapshot | null>(null);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [sampleValues, setSampleValues] = useState<Record<string, string>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<{ renderedSubject: string; renderedHtml: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await emailTemplatesApi.getTemplate(templateKey);
      setTemplate(data);
      setSubject(data.subject);
      setBodyHtml(data.bodyHtml);
      setSnapshot({ subject: data.subject, bodyHtml: data.bodyHtml });
      setLoaded(true);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, [templateKey]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const hasUnsavedChanges = useMemo(() => {
    if (!snapshot) return false;
    return subject !== snapshot.subject || bodyHtml !== snapshot.bodyHtml;
  }, [subject, bodyHtml, snapshot]);

  async function handleSave() {
    setSaveError(null);
    setSaving(true);
    try {
      const updated = await emailTemplatesApi.updateTemplate(templateKey, { subject, bodyHtml });
      setTemplate(updated);
      setSnapshot({ subject: updated.subject, bodyHtml: updated.bodyHtml });
      toast.success("Şablon kaydedildi.");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  function copyVariable(variable: string) {
    navigator.clipboard.writeText(`{{${variable}}}`).then(
      () => toast.success(`{{${variable}}} panoya kopyalandı.`),
      () => toast.error("Panoya kopyalanamadı.")
    );
  }

  function openPreview() {
    if (!template) return;
    const initial: Record<string, string> = {};
    for (const variable of template.availableVariables) {
      initial[variable] = sampleValues[variable] ?? "";
    }
    setSampleValues(initial);
    setPreviewResult(null);
    setPreviewError(null);
    setPreviewOpen(true);
  }

  async function handleGeneratePreview() {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await emailTemplatesApi.previewTemplate(templateKey, sampleValues);
      setPreviewResult(result);
    } catch (err) {
      setPreviewError(friendlyErrorMessage(err));
    } finally {
      setPreviewLoading(false);
    }
  }

  if (loadError) {
    return (
      <Alert variant="error">
        <span className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {loadError}
        </span>
      </Alert>
    );
  }

  if (!loaded || !template) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-24">
      <div>
        <Link
          href="/admin/notifications/templates"
          className="inline-flex items-center gap-1 text-sm text-foreground/60 transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Bildirimler
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <h1 className="admin-h1">{template.name}</h1>
            <p className="mt-1 admin-text-secondary">
              <Badge tone="primary">{template.key}</Badge>
            </p>
          </div>
          {hasUnsavedChanges && (
            <Badge tone="primary">
              <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-primary" />
              Kaydedilmemiş değişiklik
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={openPreview}>
            <Eye className="h-4 w-4" />
            Önizle
          </Button>
        </div>
      </div>

      {saveError && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {saveError}
          </span>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          <Card className="space-y-4">
            <Field id="subject" label="Konu" required>
              {(inputProps) => <Input {...inputProps} required value={subject} onChange={(e) => setSubject(e.target.value)} />}
            </Field>
          </Card>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">İçerik</label>
            <PostEditor content={bodyHtml} onChange={setBodyHtml} />
          </div>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <Card className="space-y-3">
            <h2 className="admin-h2">Kullanılabilir Değişkenler</h2>
            <p className="admin-text-secondary">
              Bu değişkenleri konu veya içerik metnine ekleyip tıklayarak panoya kopyalayabilirsiniz.
            </p>
            <div className="flex flex-wrap gap-2">
              {template.availableVariables.map((variable) => (
                <button
                  key={variable}
                  type="button"
                  onClick={() => copyVariable(variable)}
                  className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-foreground/70 transition-colors hover:text-foreground"
                  title="Panoya kopyala"
                >
                  <Copy className="h-3 w-3" />
                  {`{{${variable}}}`}
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div className="sticky bottom-6 z-10 flex justify-end">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface/95 px-4 py-3 shadow-lg backdrop-blur">
          {saving && <span className="text-xs text-foreground/60">Kaydediliyor…</span>}
          <Button loading={saving} onClick={handleSave}>
            Kaydet
          </Button>
        </div>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Şablonu Önizle</DialogTitle>
            <DialogDescription>Örnek değerler girerek şablonun nasıl görüneceğini önizleyin.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {template.availableVariables.map((variable) => (
              <Field key={variable} id={`sample-${variable}`} label={`{{${variable}}}`}>
                {(inputProps) => (
                  <Input
                    {...inputProps}
                    value={sampleValues[variable] ?? ""}
                    onChange={(e) => setSampleValues((prev) => ({ ...prev, [variable]: e.target.value }))}
                  />
                )}
              </Field>
            ))}

            {previewError && (
              <Alert variant="error">
                <span className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {previewError}
                </span>
              </Alert>
            )}

            {previewResult && (
              <div className="space-y-2 rounded-lg border border-border bg-surface-muted p-3">
                <p className="text-sm font-semibold text-foreground">{previewResult.renderedSubject}</p>
                <div
                  className="prose prose-sm max-w-none text-foreground/80"
                  dangerouslySetInnerHTML={{ __html: previewResult.renderedHtml }}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPreviewOpen(false)}>
              Kapat
            </Button>
            <Button type="button" loading={previewLoading} onClick={handleGeneratePreview}>
              Oluştur
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
