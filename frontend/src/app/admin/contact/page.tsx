"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { AlertCircle, Inbox, MessageSquare, Plus } from "lucide-react";
import * as contactApi from "@/lib/api/contact";
import * as emailTemplatesApi from "@/lib/api/email-templates";
import * as pagesApi from "@/lib/api/pages";
import type { ContactForm, ContactFormField, EmailTemplateSummary, SitePage } from "@/lib/api/types";
import { PageHeading } from "@/components/admin/page-heading";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { LinkButton } from "@/components/ui/link-button";
import { FieldEditorRow } from "@/components/admin/contact/field-editor-row";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

function newFieldId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

export default function ContactAdminPage() {
  const [form, setForm] = useState<ContactForm | null>(null);
  const [fields, setFields] = useState<ContactFormField[]>([]);
  const [templates, setTemplates] = useState<EmailTemplateSummary[]>([]);
  const [legalPages, setLegalPages] = useState<SitePage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingForm, setSavingForm] = useState(false);
  const [savingFields, setSavingFields] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const load = useCallback(async () => {
    try {
      const [contactForm, notificationTemplates, pages] = await Promise.all([
        contactApi.getContactForm(),
        emailTemplatesApi.listTemplates({ purpose: "CONTACT_FORM_NOTIFICATION" }),
        pagesApi.listPages({ limit: 100 }),
      ]);
      setForm(contactForm);
      setFields(contactForm.fields.map((f) => ({ ...f, id: f.id || newFieldId() })));
      setTemplates(notificationTemplates);
      setLegalPages(pages.items.filter((p) => p.isLegalDocument));
      setLoaded(true);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  function patchForm(patch: Partial<ContactForm>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function handleSaveForm() {
    if (!form) return;
    setSavingForm(true);
    setSaveError(null);
    try {
      const updated = await contactApi.updateContactForm({
        title: form.title,
        description: form.description,
        submitLabel: form.submitLabel,
        successMessage: form.successMessage,
        isEnabled: form.isEnabled,
        notifyEmail: form.notifyEmail,
        notificationTemplateId: form.notificationTemplateId,
        consentRequired: form.consentRequired,
        consentText: form.consentText,
        consentLegalPageId: form.consentLegalPageId,
        retentionDays: form.retentionDays,
      });
      setForm(updated);
      toast.success("Form ayarları kaydedildi.");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setSaveError(message);
      toast.error(message);
    } finally {
      setSavingForm(false);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = fields.findIndex((f) => f.id === active.id);
    const newIndex = fields.findIndex((f) => f.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    setFields((prev) => arrayMove(prev, oldIndex, newIndex));
  }

  function addField() {
    setFields((prev) => [
      ...prev,
      {
        id: newFieldId(),
        order: prev.length,
        key: "",
        label: "",
        type: "TEXT",
        required: false,
        placeholder: null,
        helpText: null,
        options: [],
        maxLength: null,
        isSystem: false,
      },
    ]);
  }

  function updateField(id: string, next: ContactFormField) {
    setFields((prev) => prev.map((f) => (f.id === id ? next : f)));
  }

  function removeField(id: string) {
    setFields((prev) => prev.filter((f) => f.id !== id));
  }

  async function handleSaveFields() {
    setSavingFields(true);
    setSaveError(null);
    try {
      const updated = await contactApi.replaceContactFormFields({
        fields: fields.map(({ key, label, type, placeholder, helpText, options, maxLength, required }) => ({
          key,
          label,
          type,
          required,
          placeholder,
          helpText,
          options,
          maxLength,
        })),
      });
      setFields(updated.map((f) => ({ ...f, id: f.id || newFieldId() })));
      toast.success("Form alanları kaydedildi.");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setSaveError(message);
      toast.error(message);
    } finally {
      setSavingFields(false);
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

  if (!loaded || !form) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16">
      <PageHeading
        icon={MessageSquare}
        title="İletişim Formu"
        description="Public iletişim formunu ve alanlarını yönetin."
        actions={
          <LinkButton href="/admin/contact/submissions" variant="outline" size="sm">
            <Inbox className="h-4 w-4" />
            Gelen Kutusu
          </LinkButton>
        }
      />

      {saveError && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {saveError}
          </span>
        </Alert>
      )}

      <Card className="space-y-4">
        <h2 className="admin-h2">Genel Ayarlar</h2>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
          <div>
            <p className="text-sm font-medium text-foreground">Form etkin</p>
            <p className="text-xs text-foreground/60">Kapatılırsa public sayfa 404 döner.</p>
          </div>
          <Switch checked={form.isEnabled} onCheckedChange={(isEnabled) => patchForm({ isEnabled })} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="contact-title" label="Başlık" required>
            {(inputProps) => <Input {...inputProps} required value={form.title} onChange={(e) => patchForm({ title: e.target.value })} />}
          </Field>
          <Field id="contact-submit-label" label="Gönder butonu metni">
            {(inputProps) => <Input {...inputProps} value={form.submitLabel} onChange={(e) => patchForm({ submitLabel: e.target.value })} />}
          </Field>
        </div>

        <Field id="contact-description" label="Açıklama">
          {(inputProps) => (
            <Textarea {...inputProps} rows={2} value={form.description ?? ""} onChange={(e) => patchForm({ description: e.target.value || null })} />
          )}
        </Field>

        <Field id="contact-success-message" label="Başarı mesajı">
          {(inputProps) => (
            <Textarea {...inputProps} rows={2} value={form.successMessage} onChange={(e) => patchForm({ successMessage: e.target.value })} />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="contact-notify-email" label="Bildirim e-postası" hint="Boş bırakılırsa bildirim gönderilmez.">
            {(inputProps) => (
              <Input
                {...inputProps}
                type="email"
                value={form.notifyEmail ?? ""}
                onChange={(e) => patchForm({ notifyEmail: e.target.value || null })}
              />
            )}
          </Field>
          <Field id="contact-notification-template" label="Bildirim şablonu" hint="Boş bırakılırsa amacın aktif şablonu kullanılır.">
            {(inputProps) => (
              <Select
                {...inputProps}
                value={form.notificationTemplateId ?? ""}
                onChange={(e) => patchForm({ notificationTemplateId: e.target.value || null })}
              >
                <option value="">Aktif şablon (otomatik)</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <Field
          id="contact-retention"
          label="Gönderim saklama süresi (gün)"
          hint="0 = süresiz saklama. KVKK/GDPR veri minimizasyonu ilkesi gereği süresiz saklama İSTİSNAİ bir durumdur; yalnızca somut bir hukuki/sözleşmesel gerekçe varsa seçin."
        >
          {(inputProps) => (
            <Input
              {...inputProps}
              type="number"
              min={0}
              className="max-w-40"
              value={form.retentionDays}
              onChange={(e) => patchForm({ retentionDays: Number(e.target.value) || 0 })}
            />
          )}
        </Field>
        {form.retentionDays === 0 && (
          <Alert variant="warning">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>
                Saklama süresi <strong>süresiz</strong> olarak ayarlandı. Gönderimler otomatik silinmeyecek (yalnızca
                30 gün sonra IP adresi/tarayıcı bilgisi anonimleştirilecek). KVKK m.4/GDPR Art. 5(1)(e) veri
                minimizasyonu ilkesi gereği süresiz saklama yalnızca gerekçelendirilebilir istisnai durumlarda
                tercih edilmelidir — mümkünse belirli bir süre (ör. 180-365 gün) girin.
              </span>
            </div>
          </Alert>
        )}

        <div className="space-y-3 border-t border-border/60 pt-4">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-foreground">KVKK onayı zorunlu</p>
              <p className="text-xs text-foreground/60">Kapatılırsa onay kutusu public formda gösterilmez.</p>
            </div>
            <Switch checked={form.consentRequired} onCheckedChange={(consentRequired) => patchForm({ consentRequired })} />
          </div>
          <Field
            id="contact-consent-text"
            label="Onay metni"
            hint="Gönderim anında ziyaretçiye gösterilen bu metnin BİREBİR kopyası her gönderimle birlikte donmuş olarak saklanır (ispat yükümlülüğü); metni sonradan değiştirmek geçmiş gönderimlerin kaydını etkilemez."
          >
            {(inputProps) => (
              <Textarea {...inputProps} rows={2} value={form.consentText} onChange={(e) => patchForm({ consentText: e.target.value })} />
            )}
          </Field>
          <Field id="contact-consent-page" label="Aydınlatma metni sayfası">
            {(inputProps) => (
              <Select
                {...inputProps}
                value={form.consentLegalPageId ?? ""}
                onChange={(e) => patchForm({ consentLegalPageId: e.target.value || null })}
              >
                <option value="">Seçilmedi</option>
                {legalPages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {form.consentRequired && !form.consentLegalPageId && (
            <Alert variant="warning">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>
                  KVKK onayı zorunlu ama bir aydınlatma metni sayfası seçilmedi. Açık rıza, ancak veri sahibinin
                  aydınlatma metnine (KVKK m.10) erişimi varsa geçerlidir — ziyaretçinin onay kutusunun yanında
                  tıklayabileceği bir bağlantı olması için &ldquo;Hukuki belge&rdquo; olarak işaretlenmiş bir sayfa seçin.
                </span>
              </div>
            </Alert>
          )}
        </div>

        <div className="flex justify-end">
          <Button type="button" loading={savingForm} onClick={handleSaveForm}>
            Ayarları Kaydet
          </Button>
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="admin-h2">Form Alanları</h2>
          <Button type="button" variant="outline" size="sm" onClick={addField}>
            <Plus className="h-4 w-4" />
            Alan Ekle
          </Button>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {fields.map((field) => (
                <FieldEditorRow key={field.id} field={field} onChange={(next) => updateField(field.id, next)} onRemove={() => removeField(field.id)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <div className="flex justify-end">
          <Button type="button" loading={savingFields} onClick={handleSaveFields}>
            Alanları Kaydet
          </Button>
        </div>
      </Card>

      <p className="text-xs text-foreground/50">
        Alanlar kaydedildiğinde her biri{" "}
        <Link href="/admin/notifications/templates" className="admin-link">
          İletişim Formu Bildirimi
        </Link>{" "}
        şablonunda otomatik olarak <code className="font-mono">{"{{anahtar}}"}</code> değişkeni haline gelir.
      </p>
    </div>
  );
}
