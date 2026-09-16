"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FileText, MessageCircle, Send, Trash2, UserCog } from "lucide-react";
import * as supportApi from "@/lib/api/support";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import type { SupportAgentSummary, SupportChatMessage, SupportChatSession, SupportReplyTemplate, SupportSessionStatus } from "@/lib/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/**
 * `.claude/design-notes-support-desk.md` §2.3/§2.4/§2.5 — sohbet paneli. Baloncuk yönü widget'ın
 * TERSİ: burada "ben" = AGENT → sağda/`bg-primary`; VISITOR → solda/`bg-muted`. Yanıt kutusu
 * `Textarea` + karakter sayacı, şablon `Select`'i seçilince metni doldurur, gönder `Send` ikonlu
 * `Button`. Atama `Select`'i `GET /admin/support/agents`'tan gelir (`/admin/users` KULLANILMAZ).
 *
 * Polling: `.claude/architect-scope-support-desk-and-reminders.md` §3.3 — açık sohbet dizisi 5sn,
 * 10dk etkisizlikten sonra durur (widget ile AYNI "durdur ama efekt sökme" deseni).
 */
const POLL_INTERVAL_MS = 5000;
const POLL_INACTIVITY_LIMIT_MS = 10 * 60 * 1000;

const STATUS_TONE: Record<SupportSessionStatus, "warning" | "success" | "neutral"> = {
  PENDING: "warning",
  ANSWERED: "success",
  CLOSED: "neutral",
};

const STATUS_LABEL: Record<SupportSessionStatus, string> = {
  PENDING: "Bekleyen",
  ANSWERED: "Yanıtlandı",
  CLOSED: "Kapatıldı",
};

interface SupportChatPanelProps {
  sessionId: string | null;
  agents: SupportAgentSummary[];
  templates: SupportReplyTemplate[];
  /** Liste panelindeki ilgili kartı senkronize tutmak için (durum/atama değişince). */
  onSessionChanged: (session: SupportChatSession) => void;
  /** Silme sonrası — üst bileşen seçimi temizler ve listeyi tazeler. */
  onDeleted: () => void;
}

export function SupportChatPanel({ sessionId, agents, templates, onSessionChanged, onDeleted }: SupportChatPanelProps) {
  const [session, setSession] = useState<SupportChatSession | null>(null);
  const [messages, setMessages] = useState<SupportChatMessage[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const lastSeqRef = useRef<number | null>(null);
  // eslint-disable-next-line react-hooks/purity -- `join-meeting-button.tsx` İLE AYNI gerekçe: 10dk etkisizlik penceresinin BAŞLANGICI, ilk render anındaki "şu an" yeterlidir
  const lastActivityRef = useRef(Date.now());

  function bump() {
    lastActivityRef.current = Date.now();
  }

  const refreshDetail = useCallback(async (id: string) => {
    const updated = await supportApi.getSupportSession(id);
    setSession(updated);
    onSessionChanged(updated);
    return updated;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `onSessionChanged` çağıran taraftan yeni bir referans alsa da davranış AYNIDIR (yalnızca id ile eşleşen state güncellenir)
  }, []);

  // Oturum seçimi değişince: detay + TAM mesaj geçmişi (`afterSeq` YOK) yeniden yüklenir.
  useEffect(() => {
    if (!sessionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seçim `null`e döndüğünde (oturum silindi/temizlendi) panel önceki oturumun state'ini GÖSTERMEYE DEVAM ETMEMELİ
      setSession(null);
      setMessages([]);
      lastSeqRef.current = null;
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    setDetailError(null);
    setSelectedTemplateId("");
    setDraft("");
    setSendError(null);
    bump();
    (async () => {
      try {
        const [detail, history] = await Promise.all([
          supportApi.getSupportSession(sessionId),
          supportApi.getAdminSupportMessages(sessionId),
        ]);
        if (cancelled) return;
        setSession(detail);
        onSessionChanged(detail);
        setMessages(history.items);
        if (history.meta.lastSeq !== null) lastSeqRef.current = history.meta.lastSeq;
      } catch (err) {
        if (!cancelled) setDetailError(friendlyErrorMessage(err));
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnızca `sessionId` değişince; `onSessionChanged` referansı stabil olmasa da davranış değişmez
  }, [sessionId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  // Polling — bkz. dosya başı yorumu.
  useEffect(() => {
    if (!sessionId) return;
    const timer = setInterval(() => {
      if (Date.now() - lastActivityRef.current > POLL_INACTIVITY_LIMIT_MS) return;
      supportApi
        .getAdminSupportMessages(sessionId, lastSeqRef.current ?? undefined)
        .then(({ items, meta }) => {
          if (meta.lastSeq !== null) lastSeqRef.current = meta.lastSeq;
          if (items.length > 0) setMessages((prev) => [...prev, ...items]);
          setSession((prev) => (prev && prev.status !== meta.status ? { ...prev, status: meta.status } : prev));
        })
        .catch(() => {
          /* poll hatası sessizce yutulur — bir sonraki tick tekrar dener (bkz. contact/submissions polling deseni yok, ama bu proje genelinde poll hataları kullanıcıya toast İLE gürültü YAPMAZ) */
        });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [sessionId]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionId) return;
    const text = draft.trim();
    if (!text || sending) return;
    bump();
    setSending(true);
    setSendError(null);
    try {
      const message = await supportApi.sendAgentSupportMessage(sessionId, {
        body: text,
        templateId: selectedTemplateId || undefined,
      });
      setMessages((prev) => [...prev, message]);
      lastSeqRef.current = message.seq;
      setDraft("");
      setSelectedTemplateId("");
      // Yan etkiler (ANSWERED + olası otomatik atama) sunucu tarafında gerçekleşir — yerel
      // state'i TAHMİN ETMEK yerine detayı yeniden çekip senkronize kalınır.
      await refreshDetail(sessionId);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "SUPPORT_SESSION_CLOSED") {
        setSendError("Bu oturum kapatılmış — yanıt gönderilemez.");
        await refreshDetail(sessionId);
      } else {
        setSendError(friendlyErrorMessage(err));
      }
    } finally {
      setSending(false);
    }
  }

  function handleTemplateSelect(templateId: string) {
    setSelectedTemplateId(templateId);
    bump();
    const template = templates.find((t) => t.id === templateId);
    if (template) setDraft(template.body);
  }

  async function handleAssign(agentId: string) {
    if (!sessionId) return;
    setAssigning(true);
    try {
      const updated = await supportApi.assignSupportSession(sessionId, { agentId: agentId || null });
      setSession(updated);
      onSessionChanged(updated);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setAssigning(false);
    }
  }

  async function handleToggleClosed() {
    if (!sessionId || !session) return;
    setStatusUpdating(true);
    try {
      const updated = await supportApi.updateSupportSessionStatus(sessionId, {
        status: session.status === "CLOSED" ? "PENDING" : "CLOSED",
      });
      setSession(updated);
      onSessionChanged(updated);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setStatusUpdating(false);
    }
  }

  async function handleDelete() {
    if (!sessionId) return;
    setDeleting(true);
    try {
      await supportApi.deleteSupportSession(sessionId);
      toast.success("Oturum silindi.");
      setDeleteDialogOpen(false);
      onDeleted();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  if (!sessionId) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-border bg-card">
        <EmptyState icon={MessageCircle} title="Bir oturum seçin" description="Soldaki listeden bir destek oturumu seçerek görüşmeyi görüntüleyin." />
      </div>
    );
  }

  if (loadingDetail && !session) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-border bg-card">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  if (detailError || !session) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-border bg-card p-6 text-center">
        <p className="text-sm text-danger">{detailError ?? "Oturum yüklenemedi."}</p>
      </div>
    );
  }

  const isClosed = session.status === "CLOSED";
  const displayName = session.visitorName?.trim() || "Misafir Ziyaretçi";

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
            <Badge tone={STATUS_TONE[session.status]} size="lg">
              {STATUS_LABEL[session.status]}
            </Badge>
          </div>
          {/*
           * Görev (2026-09-16) — ön görüşme (pre-chat) formu §7.4: `visitorPhone` `visitorName`/
           * `visitorEmail` İLE AYNI yerde, "ziyaretçi beyanı" etiketiyle gösterilir. İkisi de
           * DOĞRULANMAMIŞ beyandır (SMS/OTP yok) — form kapalıyken/eski oturumlarda `null`
           * olabileceğinden placeholder ile güvenli şekilde ele alınır (sessizce GİZLENMEZ).
           */}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-foreground/50">
            <span
              className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground/40"
              title="Ziyaretçinin kendi beyanı — doğrulanmamıştır"
            >
              Ziyaretçi Beyanı
            </span>
            <span className="truncate">{session.visitorEmail || "E-posta belirtilmedi"}</span>
            <span aria-hidden="true">·</span>
            {session.visitorPhone ? (
              <a href={`tel:${session.visitorPhone}`} className="truncate text-primary hover:underline">
                {session.visitorPhone}
              </a>
            ) : (
              <span>Telefon belirtilmedi</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <UserCog className="h-3.5 w-3.5 text-foreground/40" aria-hidden="true" />
            <Select
              className="h-8 w-40"
              value={session.assignedAgent?.id ?? ""}
              disabled={assigning}
              onChange={(e) => void handleAssign(e.target.value)}
              aria-label="Temsilci ata"
            >
              <option value="">Atanmamış</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </Select>
          </div>
          <Button type="button" variant="outline" size="sm" loading={statusUpdating} onClick={() => void handleToggleClosed()}>
            {isClosed ? "Yeniden Aç" : "Kapat"}
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Oturumu sil" onClick={() => setDeleteDialogOpen(true)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div ref={listRef} className="space-y-3 p-4">
          {messages.map((m) => (
            <div key={m.id} className={cn("flex flex-col gap-0.5", m.senderType === "AGENT" ? "items-end" : "items-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-[var(--site-radius,0.75rem)] px-3 py-2 text-sm",
                  m.senderType === "AGENT" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                )}
              >
                {m.body}
              </div>
              <span className="px-1 text-[11px] text-foreground/40">
                {m.senderType === "AGENT" ? (m.senderDisplayName ?? "Temsilci") : displayName} ·{" "}
                {new Date(m.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))}
          {messages.length === 0 && <p className="py-8 text-center text-sm text-foreground/50">Henüz mesaj yok.</p>}
        </div>
      </ScrollArea>

      <div className="space-y-2 border-t border-border p-3">
        {templates.length > 0 && (
          <div className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 shrink-0 text-foreground/40" aria-hidden="true" />
            <Select className="h-8" value={selectedTemplateId} onChange={(e) => handleTemplateSelect(e.target.value)} aria-label="Hazır yanıt şablonu seç">
              <option value="">Şablon seç…</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.title}
                </option>
              ))}
            </Select>
          </div>
        )}

        {sendError && <p className="text-xs text-danger">{sendError}</p>}

        {isClosed ? (
          <p className="text-xs text-foreground/60">Bu oturum kapatıldı — yanıt göndermek için önce yeniden açın.</p>
        ) : (
          <form onSubmit={(e) => void handleSend(e)} className="space-y-1.5">
            <Textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                bump();
              }}
              maxLength={2000}
              rows={3}
              placeholder="Yanıtınızı yazın…"
              aria-label="Yanıt metni"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-foreground/40">{draft.length}/2000</span>
              <Button type="submit" size="sm" loading={sending} disabled={!draft.trim()}>
                <Send className="h-4 w-4" />
                Gönder
              </Button>
            </div>
          </form>
        )}
      </div>

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        tone="danger"
        title="Oturumu sil"
        description="Bu destek oturumunu ve tüm mesajlarını kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz."
        confirmText="Sil"
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
