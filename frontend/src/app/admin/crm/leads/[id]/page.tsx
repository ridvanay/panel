"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Link2, Trash2, UserSearch } from "lucide-react";
import * as crmApi from "@/lib/api/crm";
import { CRM_LEAD_STATUS_OPTIONS, leadChannelLabel, type CrmLeadDetail, type CrmLeadStatus } from "@/lib/api/crm";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Field } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LeadStatusBadge, SlaBadge, formatDateTime, formatMoney } from "@/components/admin/crm/crm-ui";
import { fieldErrorsFrom, friendlyErrorMessage } from "@/lib/api/friendly-error";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface EditForm {
  status: CrmLeadStatus;
  assignedToId: string;
  nextActionAt: string;
  name: string;
  phone: string;
  email: string;
  country: string;
  language: string;
}

function toForm(lead: CrmLeadDetail): EditForm {
  return {
    status: lead.status,
    assignedToId: lead.assignedToId ?? "",
    nextActionAt: toLocalInput(lead.nextActionAt),
    name: lead.name ?? "",
    phone: lead.phone ?? "",
    email: lead.email ?? "",
    country: lead.country ?? "",
    language: lead.language ?? "",
  };
}

/**
 * Paket N2 — talep detayı. Açılışı denetim kaydına yazılır (`crm.lead.viewed`). Durum/atama/sonraki aksiyon,
 * kişi bilgisi, şifreli notlar (zaman çizelgesi), randevu eşleştirme ÖNERİSİ (admin "Bağla" der) ve
 * ziyaretçiyi elle bağlama (Ref kodu / zaman yakınlığı adayları). Otomatik birleştirme YOKTUR.
 */
export default function CrmLeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const lead = useQuery({ queryKey: ["crm-lead", id], queryFn: () => crmApi.getCrmLead(id) });
  const assignees = useQuery({ queryKey: ["crm-assignees"], queryFn: crmApi.listCrmAssignees });
  const [form, setForm] = useState<EditForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [showVisitors, setShowVisitors] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const candidates = useQuery({
    queryKey: ["crm-lead-visitors", id],
    queryFn: () => crmApi.getCrmLeadVisitorCandidates(id),
    enabled: showVisitors,
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sunucu verisi gelince formu doldur
    if (lead.data) setForm(toForm(lead.data));
  }, [lead.data]);

  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: ["crm-lead", id] });
    void queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
  };

  async function patch(input: crmApi.UpdateCrmLeadInput, success: string) {
    setSaving(true);
    setErrors({});
    try {
      await crmApi.updateCrmLead(id, input);
      toast.success(success);
      reload();
    } catch (err) {
      setErrors(fieldErrorsFrom(err));
      toast.error(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function addNote() {
    if (!note.trim()) return;
    try {
      await crmApi.addCrmLeadNote(id, note.trim());
      setNote("");
      reload();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    }
  }

  async function remove() {
    try {
      await crmApi.deleteCrmLead(id);
      toast.success("Talep silindi.");
      void queryClient.invalidateQueries({ queryKey: ["crm-leads"] });
      router.push("/admin/crm/leads");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    }
  }

  if (lead.isPending) return <Skeleton className="h-96 w-full" />;
  if (lead.isError) return <Alert variant="error">{friendlyErrorMessage(lead.error)}</Alert>;
  const data = lead.data;
  if (!form) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/admin/crm/leads" className="inline-flex items-center gap-1 text-sm text-foreground/70 hover:text-foreground">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" /> Talepler
        </Link>
        <Button type="button" variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Sil
        </Button>
      </div>

      <Card className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="admin-h2" dir="auto">
            {data.name || (data.candidate ? "Aday talep" : "İsimsiz talep")}
          </h2>
          <LeadStatusBadge status={data.status} />
          <SlaBadge sla={data.sla} />
        </div>
        <p className="text-sm text-foreground/70">
          #{data.seq} · {leadChannelLabel(data.channel)}
          {data.candidate ? " (tıklamadan doğan aday)" : ""} · {formatDateTime(data.createdAt)}
        </p>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="inline text-foreground/60">Kaynak: </dt>
            <dd className="inline" dir="auto">
              {[data.source, data.medium, data.campaign].filter(Boolean).join(" / ") || "—"}
            </dd>
          </div>
          <div>
            <dt className="inline text-foreground/60">Açılış sayfası: </dt>
            <dd className="inline" dir="ltr">
              {data.landingPath ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="inline text-foreground/60">WhatsApp Ref: </dt>
            <dd className="inline font-mono" dir="ltr">
              {data.refCode ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="inline text-foreground/60">Doktor / uzmanlık: </dt>
            <dd className="inline" dir="auto">
              {[data.doctorName, data.specialtyName].filter(Boolean).join(" · ") || "—"}
            </dd>
          </div>
        </dl>
        {data.anonymizedAt && <Alert variant="info">Saklama süresi dolduğu için kişi bilgileri ve notlar silindi ({formatDateTime(data.anonymizedAt)}).</Alert>}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3">
          <h3 className="text-sm font-semibold">Takip</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="lead-status" label="Durum" error={errors.status}>
              {(p) => (
                <Select {...p} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as CrmLeadStatus })}>
                  {CRM_LEAD_STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="lead-assignee" label="Atanan" error={errors.assignedToId}>
              {(p) => (
                <Select {...p} value={form.assignedToId} onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}>
                  <option value="">Atanmadı</option>
                  {assignees.data?.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="lead-next" label="Sonraki aksiyon (hatırlatma)" error={errors.nextActionAt}>
              {(p) => <Input {...p} type="datetime-local" value={form.nextActionAt} onChange={(e) => setForm({ ...form, nextActionAt: e.target.value })} />}
            </Field>
          </div>
          <h3 className="pt-2 text-sm font-semibold">Kişi</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="lead-name" label="Ad soyad" error={errors.name}>
              {(p) => <Input {...p} dir="auto" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
            </Field>
            <Field id="lead-phone" label="Telefon" error={errors.phone}>
              {(p) => <Input {...p} dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />}
            </Field>
            <Field id="lead-email" label="E-posta" error={errors.email}>
              {(p) => <Input {...p} dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
            </Field>
            <Field id="lead-country" label="Ülke (ISO, ör. DE)" error={errors.country}>
              {(p) => <Input {...p} dir="ltr" maxLength={2} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })} />}
            </Field>
            <Field id="lead-language" label="Dil (ör. en)" error={errors.language}>
              {(p) => <Input {...p} dir="ltr" maxLength={10} value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} />}
            </Field>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={saving}
              onClick={() =>
                void patch(
                  {
                    status: form.status,
                    assignedToId: form.assignedToId || null,
                    nextActionAt: form.nextActionAt ? new Date(form.nextActionAt).toISOString() : null,
                    name: form.name || null,
                    phone: form.phone || null,
                    email: form.email || null,
                    country: form.country || null,
                    language: form.language || null,
                  },
                  "Talep güncellendi."
                )
              }
            >
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </div>
        </Card>

        <Card className="space-y-3">
          <h3 className="text-sm font-semibold">Notlar ve geçmiş</h3>
          <p className="text-xs text-foreground/60">Notlar şifreli saklanır. Sağlık bilgisini yalnızca gerektiği kadar yazın.</p>
          <div className="space-y-2">
            <Textarea aria-label="Yeni not" rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={Boolean(data.anonymizedAt)} />
            <div className="flex justify-end">
              <Button type="button" size="sm" onClick={() => void addNote()} disabled={!note.trim() || Boolean(data.anonymizedAt)}>
                Not ekle
              </Button>
            </div>
          </div>
          <ol className="space-y-2">
            {data.notes.length === 0 && <li className="text-sm text-foreground/50">Henüz not yok.</li>}
            {data.notes.map((n) => (
              <li key={n.id} className={`rounded-lg border p-2 text-sm ${n.kind === "NOTE" ? "border-border" : "border-dashed border-border/70 text-foreground/70"}`}>
                <p className="whitespace-pre-wrap break-words" dir="auto">
                  {n.body}
                </p>
                <p className="mt-1 text-xs text-foreground/50">
                  {n.authorName ?? "Sistem"} · {formatDateTime(n.createdAt)}
                </p>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-3">
          <h3 className="text-sm font-semibold">Randevu</h3>
          {data.linkedBooking ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                Bağlı randevu <strong dir="ltr">{data.linkedBooking.bookingNumber}</strong> · {data.linkedBooking.paymentStatus} ·{" "}
                {formatMoney(data.linkedBooking.totalCents, data.linkedBooking.currency)}
              </span>
              <Button type="button" size="sm" variant="outline" onClick={() => void patch({ bookingId: null }, "Randevu bağlantısı kaldırıldı.")}>
                Bağlantıyı kaldır
              </Button>
            </div>
          ) : (
            <p className="text-sm text-foreground/60">Bağlı randevu yok.</p>
          )}
          {data.bookingSuggestions.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Bu talep şu randevu olabilir:</p>
              <ul className="space-y-1.5">
                {data.bookingSuggestions.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm">
                    <span>
                      <strong dir="ltr">{b.bookingNumber}</strong> · <span dir="auto">{b.doctorName}</span> · {formatDateTime(b.createdAt)} · {b.paymentStatus} ·{" "}
                      {formatMoney(b.totalCents, b.currency)}
                      <span className="block text-xs text-foreground/60">{b.reason}</span>
                    </span>
                    <Button type="button" size="sm" onClick={() => void patch({ bookingId: b.id }, "Randevu talebe bağlandı.")}>
                      <Link2 className="h-4 w-4" aria-hidden="true" /> Bağla
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card className="space-y-3">
          <h3 className="text-sm font-semibold">Ziyaretçi</h3>
          {data.visitorId ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <Link href={`/admin/crm/visitors/${data.visitorId}`} className="font-mono text-primary underline" dir="ltr">
                {data.visitorId}
              </Link>
              <Button type="button" size="sm" variant="outline" onClick={() => void patch({ visitorId: null }, "Ziyaretçi bağlantısı kaldırıldı.")}>
                Bağlantıyı kaldır
              </Button>
            </div>
          ) : (
            <>
              <p className="text-sm text-foreground/60">
                Ziyaretçi geçmişi talebe otomatik bağlanmaz. Ref kodu ya da tıklama zamanına göre adayları görüp elle bağlayabilirsiniz.
              </p>
              <Button type="button" size="sm" variant="outline" onClick={() => setShowVisitors(true)}>
                <UserSearch className="h-4 w-4" aria-hidden="true" /> Aday ziyaretçileri göster
              </Button>
              {showVisitors &&
                (candidates.isPending ? (
                  <Skeleton className="h-20 w-full" />
                ) : candidates.isError ? (
                  <Alert variant="error">{friendlyErrorMessage(candidates.error)}</Alert>
                ) : candidates.data.length === 0 ? (
                  <p className="text-sm text-foreground/50">Aday ziyaretçi bulunamadı.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {candidates.data.map((v) => (
                      <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm">
                        <span>
                          <Link href={`/admin/crm/visitors/${v.id}`} className="font-mono text-primary underline" dir="ltr">
                            {v.id.slice(0, 10)}…
                          </Link>{" "}
                          · {v.country ?? "?"} · {v.deviceType} · puan {v.score} · {formatDateTime(v.lastSeenAt)}
                          <span className="block text-xs text-foreground/60">{v.reason}</span>
                        </span>
                        <Button type="button" size="sm" onClick={() => void patch({ visitorId: v.id }, "Ziyaretçi talebe bağlandı.")}>
                          <Link2 className="h-4 w-4" aria-hidden="true" /> Bağla
                        </Button>
                      </li>
                    ))}
                  </ul>
                ))}
            </>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Talep silinsin mi?"
        description="Talep ve notları kalıcı olarak silinir. İşlem denetim kaydına yazılır. Test/spam kayıtlar için “Test/Spam” durumunu kullanmanız önerilir."
        confirmText="Sil"
        tone="danger"
        onConfirm={() => void remove()}
      />
    </div>
  );
}
