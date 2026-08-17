import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as emailTemplatesApi from "@/lib/api/email-templates";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import type { EmailBlock, EmailCustomVariable, EmailTemplate } from "@/lib/api/types";

interface Snapshot {
  name: string;
  subject: string;
  blocksJson: string;
  customVariablesJson: string;
}

/**
 * §10.16.11 — editör state'i tek bir hook'ta toplanır. Otomatik kaydetme YOK (kaydedilmemiş bir
 * şablon gerçek kullanıcılara bozuk e-posta gönderir) — `dirty` iken sayfadan ayrılma uyarısı
 * çağıran taraftadır (bkz. `[templateId]/page.tsx`). Önizleme tek kaynaktan gelir: istemci HTML
 * üretmez, 500ms debounce ile `POST /admin/notifications/templates/preview` çağrılır.
 */
export function useEmailTemplateEditor(templateId: string) {
  const [template, setTemplate] = useState<EmailTemplate | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [blocks, setBlocks] = useState<EmailBlock[]>([]);
  const [customVariables, setCustomVariables] = useState<EmailCustomVariable[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  const [preview, setPreview] = useState<{ html: string; subject: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // BUG DÜZELTMESİ (qa-agent, `admin-email-template-editor.spec.ts` bulgusu) — mount sırasında
  // `GET .../templates/{id}` isteği React Strict Mode/App Router çift-mount etkileşimi yüzünden
  // BİRDEN FAZLA KEZ (gözlemlenen: 4) atılıyordu; istek iptali/sıra koruması OLMADIĞI için GEÇ
  // dönen bir yanıt `applyLoaded()` ile kullanıcının ilk 1-2 saniyede yaptığı yerel düzenlemeleri
  // SESSİZCE eziyordu. Düzeltme: her `load()` çağrısı bir "nesil" (generation) numarası alır;
  // yalnızca EN SON çağrılan `load()`'a ait yanıt uygulanır — daha önceki (stale) çağrılardan gelen
  // geç yanıtlar (başarılı ya da hatalı) sessizce YOK SAYILIR. AbortController'dan farklı olarak
  // ağ isteğini iptal etmez, ama state'e uygulanmasını KESİN olarak engeller.
  const requestGenerationRef = useRef(0);

  const applyLoaded = useCallback((data: EmailTemplate) => {
    setTemplate(data);
    setName(data.name);
    setSubject(data.subject);
    setBlocks(data.blocks);
    setCustomVariables(data.customVariables);
    setSnapshot({
      name: data.name,
      subject: data.subject,
      blocksJson: JSON.stringify(data.blocks),
      customVariablesJson: JSON.stringify(data.customVariables),
    });
  }, []);

  const load = useCallback(async () => {
    const generation = ++requestGenerationRef.current;
    try {
      const data = await emailTemplatesApi.getTemplate(templateId);
      if (requestGenerationRef.current !== generation) return; // daha yeni bir load() zaten başladı — bu yanıt STALE
      applyLoaded(data);
      setLoaded(true);
    } catch (err) {
      if (requestGenerationRef.current !== generation) return;
      setLoadError(friendlyErrorMessage(err));
    }
  }, [templateId, applyLoaded]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const dirty = useMemo(() => {
    if (!snapshot) return false;
    return (
      name !== snapshot.name ||
      subject !== snapshot.subject ||
      JSON.stringify(blocks) !== snapshot.blocksJson ||
      JSON.stringify(customVariables) !== snapshot.customVariablesJson
    );
  }, [name, subject, blocks, customVariables, snapshot]);

  // `/admin/navigation`/`/admin/settings` ile AYNI paylaşılan `beforeunload` + link-onayı deseni.
  useUnsavedChangesGuard({ enabled: dirty });

  // 500ms debounce'lu durumsuz önizleme — WYSIWYG'in TEK doğruluk kaynağı.
  useEffect(() => {
    if (!template) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const result = await emailTemplatesApi.previewTemplate({
          purpose: template.purpose,
          editorMode: "BLOCKS",
          subject,
          blocks,
          customVariables,
        });
        if (!cancelled) setPreview({ html: result.renderedHtml, subject: result.renderedSubject });
      } catch {
        // Önizleme hatası editörü BLOKLAMAZ — kullanıcı yazmaya devam edebilir.
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [template, subject, blocks, customVariables]);

  function updateBlock(next: EmailBlock) {
    setBlocks((prev) => prev.map((b) => (b.id === next.id ? next : b)));
  }

  function addCustomVariable(variable: EmailCustomVariable) {
    setCustomVariables((prev) => [...prev, variable]);
  }

  async function save(): Promise<boolean> {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await emailTemplatesApi.updateTemplate(templateId, { name, subject, blocks, customVariables });
      applyLoaded(updated);
      return true;
    } catch (err) {
      setSaveError(friendlyErrorMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function activate(): Promise<boolean> {
    try {
      const updated = await emailTemplatesApi.activateTemplate(templateId);
      applyLoaded(updated);
      return true;
    } catch (err) {
      setSaveError(friendlyErrorMessage(err));
      return false;
    }
  }

  return {
    template,
    loaded,
    loadError,
    saving,
    saveError,
    name,
    setName,
    subject,
    setSubject,
    blocks,
    setBlocks,
    updateBlock,
    customVariables,
    addCustomVariable,
    selectedBlockId,
    setSelectedBlockId,
    dirty,
    preview,
    previewLoading,
    save,
    activate,
    reload: load,
  };
}
