"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Eye, ShieldAlert } from "lucide-react";
import * as crmApi from "@/lib/api/crm";
import { CRM_REQUEST_STATUS_OPTIONS, requestChannelLabel, type CrmRequestStatus } from "@/lib/api/crm";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Field } from "@/components/ui/field";
import { SlaBadge, formatDateTime } from "@/components/admin/crm/crm-ui";
import { RequestStatusBadge } from "@/components/admin/crm/request-ui";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

/**
 * Paket AJ-4 - danışma talebi detayı: durum akışı (Yeni → Görüşüldü → Planlama → Dönüştü / Kapandı), atama
 * (personel), iç notlar (yazar + zaman damgası; sunucuda şifreli) ve talep mesajı. Mesaj sağlık verisi
 * içerebileceği için YALNIZCA "Mesajı göster" ile (2FA'lı yönetici oturumu) alınır; her görüntüleme denetim
 * kaydına yazılır. Ziyaretçiden gelen her metin React ile METİN olarak basılır (dangerouslySetInnerHTML YASAK).
 */
export default function CrmRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ["crm-request", id], queryFn: () => crmApi.getCrmRequest(id) });
  const assignees = useQuery({ queryKey: ["crm-request-assignees"], queryFn: crmApi.listCrmRequestAssignees });
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageLoading, setMessageLoading] = useState(false);

  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: ["crm-request", id] });
    void queryClient.invalidateQueries({ queryKey: ["crm-requests"] });
  };

  const update = useMutation({
    mutationFn: (input: { status?: CrmRequestStatus; assignedToId?: string | null }) => crmApi.updateCrmRequest(id, input),
    onSuccess: () => {
      toast.success("Talep güncellendi.");
      reload();
    },
    onError: (err) => toast.error(friendlyErrorMessage(err)),
  });
  const addNote = useMutation({
    mutationFn: (body: string) => crmApi.addCrmRequestNote(id, body),
    onSuccess: () => {
      setNote("");
      reload();
    },
    onError: (err) => toast.error(friendlyErrorMessage(err)),
  });

  async function showMessage() {
    setMessageLoading(true);
    try {
      const result = await crmApi.getCrmRequestMessage(id);
      setMessage(result.message ?? "");
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setMessageLoading(false);
    }
  }

  if (detail.isPending) return <Skeleton className="h-96 w-full" data-testid="request-detail-loading" />;
  if (detail.isError) {
    return (
      <Alert variant="error">
        <span className="flex flex-wrap items-center gap-3">
          {friendlyErrorMessage(detail.error)}
          <Button type="button" size="sm" variant="outline" onClick={() => void detail.refetch()}>
            Tekrar dene
          </Button>
        </span>
      </Alert>
    );
  }
  const r = detail.data;
  const rows: [string, string][] = [
    ["Hizmet / paket", r.serviceName ?? "-"],
    ["Tercih edilen tarih", r.preferredFrom || r.preferredTo ? `${r.preferredFrom ?? "…"} → ${r.preferredTo ?? "…"}` : "Esnek / belirtilmedi"],
    ["Ülke", r.country ?? "-"],
    ["İletişim dili", r.contactLanguage ?? "-"],
    ["Tercüman", r.needsInterpreter ? "Evet" : "Hayır"],
    ["Tercih edilen kanal", requestChannelLabel(r.preferredContactChannel)],
    ["Site dili", r.locale ?? "-"],
    ["İletişim rızası", formatDateTime(r.contactConsentAt)],
    ["Sağlık verisi açık rızası", r.healthDataConsentAt ? formatDateTime(r.healthDataConsentAt) : "Yok"],
    ...(r.fullName || r.email || r.phone ? ([["Ad / e-posta / telefon", [r.fullName, r.email, r.phone].filter(Boolean).join(" · ")]] as [string, string][]) : []),
  ];

  return (
    <div className="space-y-6" data-testid="crm-request-detail">
      <Link href="/admin/crm/requests" className="inline-flex items-center gap-1 text-sm text-foreground/70 hover:text-foreground">
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" /> Danışma talepleri
      </Link>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="admin-h2" dir="ltr">
              {r.number}
            </h2>
            <p className="text-xs text-foreground/60">{formatDateTime(r.createdAt)}</p>
          </div>
          <div className="flex items-center gap-2">
            <RequestStatusBadge status={r.status} />
            <SlaBadge sla={r.sla} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="request-status" label="Durum">
            {(props) => (
              <Select
                {...props}
                value={r.status ?? "new"}
                disabled={update.isPending || !r.status}
                onChange={(e) => update.mutate({ status: e.target.value as CrmRequestStatus })}
              >
                {CRM_REQUEST_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="request-assignee" label="Atanan kişi">
            {(props) => (
              <Select
                {...props}
                value={r.assignedToId ?? ""}
                disabled={update.isPending}
                onChange={(e) => update.mutate({ assignedToId: e.target.value || null })}
              >
                <option value="">Atanmadı</option>
                {(assignees.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-foreground/60">{label}</dt>
              <dd className="text-foreground" dir="auto">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="space-y-3">
        <h2 className="admin-h2">Talep mesajı</h2>
        {!r.hasMessage ? (
          <p className="text-sm text-foreground/60">Hasta mesaj bırakmadı.</p>
        ) : message === null ? (
          <>
            <Alert variant="warning">
              <span className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  Mesaj sağlık verisi içerebilir. Görüntülemek için iki adımlı doğrulaması (2FA) açık yönetici oturumu gerekir
                  ve her görüntüleme denetim kaydına yazılır.
                </span>
              </span>
            </Alert>
            <Button type="button" variant="outline" onClick={() => void showMessage()} disabled={messageLoading} data-testid="request-show-message">
              <Eye className="h-4 w-4" aria-hidden="true" /> Mesajı göster
            </Button>
          </>
        ) : (
          <p className="whitespace-pre-wrap text-sm text-foreground" dir="auto" data-testid="request-message">
            {message || "(boş)"}
          </p>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="admin-h2">İç notlar</h2>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) addNote.mutate(note.trim());
          }}
        >
          <Field id="request-note" label="Yeni not">
            {(props) => <Textarea {...props} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={3} />}
          </Field>
          <Button type="submit" disabled={!note.trim() || addNote.isPending}>
            Not ekle
          </Button>
        </form>
        {r.notes.length === 0 ? (
          <p className="text-sm text-foreground/60">Henüz not yok.</p>
        ) : (
          <ul className="divide-y divide-border" data-testid="request-notes">
            {r.notes.map((n) => (
              <li key={n.id} className="py-2 text-sm">
                <p className="text-xs text-foreground/60">
                  {n.authorName ?? "Sistem"} · {formatDateTime(n.createdAt)}
                </p>
                <p className="whitespace-pre-wrap text-foreground" dir="auto">
                  {n.body}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
