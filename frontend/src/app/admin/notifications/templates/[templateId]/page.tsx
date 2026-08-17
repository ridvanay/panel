"use client";

import { use } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertCircle, ChevronLeft } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { useEmailTemplateEditor } from "@/hooks/use-email-template-editor";
import { useVariableTarget } from "@/hooks/use-variable-target";
import { createEmailBlock } from "@/lib/email-blocks/registry";
import { EmailBlockPalette } from "@/components/admin/email-editor/block-palette";
import { EmailCanvas } from "@/components/admin/email-editor/email-canvas";
import { EmailBlockSettingsPanel } from "@/components/admin/email-editor/block-settings-panel";
import { VariablePanel } from "@/components/admin/email-editor/variable-panel";
import { VariableInput } from "@/components/admin/email-editor/variable-field";
import { EmailPreviewPane } from "@/components/admin/email-editor/preview-pane";
import { TestSendButton } from "@/components/admin/email-editor/test-send-button";
import type { EmailBlockType } from "@/lib/api/types";

function DirtyDot() {
  return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" title="Kaydedilmemiş değişiklikler" />;
}

export default function EmailTemplateEditorPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = use(params);
  const editor = useEmailTemplateEditor(templateId);
  const target = useVariableTarget();

  function addBlock(type: EmailBlockType) {
    const block = createEmailBlock(type);
    editor.setBlocks([...editor.blocks, block]);
    editor.setSelectedBlockId(block.id);
  }

  async function handleSave() {
    const ok = await editor.save();
    if (ok) toast.success("Şablon kaydedildi.");
    else if (editor.saveError) toast.error(editor.saveError);
  }

  async function handleActivate() {
    const ok = await editor.activate();
    if (ok) toast.success("Şablon aktif edildi.");
    else if (editor.saveError) toast.error(editor.saveError);
  }

  if (editor.loadError) {
    return (
      <Alert variant="error">
        <span className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {editor.loadError}
        </span>
      </Alert>
    );
  }

  if (!editor.loaded || !editor.template) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  const selectedBlock = editor.blocks.find((b) => b.id === editor.selectedBlockId) ?? null;

  return (
    <div className="space-y-4 pb-10">
      <div className="sticky top-0 z-10 -mx-4 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link
            href="/admin/notifications/templates"
            aria-label="Bildirimlere dön"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-foreground/60 transition-colors hover:bg-surface-muted hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <Input
            className="h-8 max-w-64 font-medium"
            value={editor.name}
            onChange={(e) => editor.setName(e.target.value)}
            aria-label="Şablon adı"
            disabled={editor.template.isSystem}
          />
          {editor.dirty && <DirtyDot />}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <TestSendButton templateId={templateId} dirty={editor.dirty} />
          {!editor.template.isActive && (
            <Button type="button" variant="secondary" size="sm" onClick={handleActivate}>
              Aktif Yap
            </Button>
          )}
          <Button type="button" size="sm" loading={editor.saving} onClick={handleSave}>
            Kaydet
          </Button>
        </div>
      </div>

      {editor.saveError && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {editor.saveError}
          </span>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[16rem_1fr_20rem]">
        <div className="lg:w-64">
          <EmailBlockPalette onAdd={addBlock} />
        </div>

        <div className="min-w-0 flex-1 space-y-4">
          <Card className="mx-auto max-w-2xl">
            <Field id="template-subject" label="Konu" required>
              {(inputProps) => (
                <VariableInput {...inputProps} target={target} value={editor.subject} onChange={editor.setSubject} required />
              )}
            </Field>
          </Card>

          <EmailCanvas
            blocks={editor.blocks}
            onChange={editor.setBlocks}
            selectedBlockId={editor.selectedBlockId}
            onSelect={editor.setSelectedBlockId}
          />

          <div className="mx-auto max-w-2xl">
            <EmailPreviewPane subject={editor.preview?.subject ?? editor.subject} html={editor.preview?.html ?? null} loading={editor.previewLoading} />
          </div>
        </div>

        <div className="space-y-6 lg:w-80">
          {selectedBlock ? (
            <EmailBlockSettingsPanel block={selectedBlock} onChange={editor.updateBlock} target={target} />
          ) : (
            <p className="text-sm text-foreground/50">Ayarlarını düzenlemek için bir blok seçin.</p>
          )}
          <div className="border-t border-border/60 pt-4">
            <VariablePanel
              variables={editor.template.variables}
              customVariables={editor.customVariables}
              onAddCustomVariable={editor.addCustomVariable}
              target={target}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
