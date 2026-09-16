"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileText, MessageCircle } from "lucide-react";
import * as supportApi from "@/lib/api/support";
import type { SupportAgentSummary, SupportChatSession, SupportChatSessionSummary, SupportReplyTemplate, SupportSessionCounts, SupportSessionStatus } from "@/lib/api/types";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PageHeading } from "@/components/admin/page-heading";
import { SupportSessionList } from "@/components/admin/support/support-session-list";
import { SupportChatPanel } from "@/components/admin/support/support-chat-panel";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

/**
 * `.claude/architect-scope-support-desk-and-reminders.md` §3 + `.claude/design-notes-support-desk.md`
 * §2 — Admin Canlı Destek Masası. İki panelli: sol oturum listesi (arama + sekme rozetleri),
 * sağ sohbet dizisi + yanıt kutusu + şablon seçici + atama dropdown'ı.
 *
 * Polling kadansı (BAĞLAYICI, §3.3): oturum listesi 15sn, 10dk etkisizlikten sonra durur
 * (kullanıcı etkileşiminde otomatik devam eder — sohbet paneli İLE AYNI "durdur ama efekt sökme"
 * deseni, bkz. `support-chat-panel.tsx`).
 */
const LIST_POLL_INTERVAL_MS = 15000;
const POLL_INACTIVITY_LIMIT_MS = 10 * 60 * 1000;

export default function AdminSupportPage() {
  const [sessions, setSessions] = useState<SupportChatSessionSummary[] | null>(null);
  const [counts, setCounts] = useState<SupportSessionCounts | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<SupportSessionStatus | undefined>(undefined);
  const [q, setQ] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [agents, setAgents] = useState<SupportAgentSummary[]>([]);
  const [templates, setTemplates] = useState<SupportReplyTemplate[]>([]);
  // eslint-disable-next-line react-hooks/purity -- `join-meeting-button.tsx` İLE AYNI gerekçe: bu yalnızca 10dk etkisizlik penceresinin BAŞLANGICIDIR, ilk render anındaki "şu an" yeterlidir; `bump()` her etkileşimde günceller
  const lastActivityRef = useRef(Date.now());

  function bump() {
    lastActivityRef.current = Date.now();
  }

  const load = useCallback(async (filterStatus: SupportSessionStatus | undefined, query: string) => {
    try {
      const page = await supportApi.listSupportSessions({ status: filterStatus, q: query || undefined });
      setSessions(page.items);
      setNextCursor(page.meta.nextCursor);
      setCounts(page.meta.counts);
      setLoadError(null);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    bump();
    const handle = setTimeout(() => load(status, q), 300);
    return () => clearTimeout(handle);
  }, [status, q, load]);

  // Atanabilir temsilciler + aktif şablonlar — sohbet paneline props olarak geçirilir, her oturum
  // seçiminde YENİDEN ÇEKİLMEZ.
  useEffect(() => {
    (async () => {
      try {
        const [agentList, templateList] = await Promise.all([supportApi.listSupportAgents(), supportApi.listSupportTemplates()]);
        setAgents(agentList);
        setTemplates(templateList);
      } catch {
        // Sessizce yutulur — atama/şablon dropdown'ları boş görünür, ana akışı (mesajlaşma) BLOKLAMAZ.
      }
    })();
  }, []);

  // 15sn poll — 10dk etkisizlikten sonra durur (bkz. dosya başı yorumu).
  useEffect(() => {
    const timer = setInterval(() => {
      if (Date.now() - lastActivityRef.current > POLL_INACTIVITY_LIMIT_MS) return;
      load(status, q);
    }, LIST_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [status, q, load]);

  async function handleLoadMore() {
    if (!nextCursor) return;
    bump();
    setLoadingMore(true);
    try {
      const page = await supportApi.listSupportSessions({ status, q: q || undefined, cursor: nextCursor });
      setSessions((prev) => [...(prev ?? []), ...page.items]);
      setNextCursor(page.meta.nextCursor);
      setCounts(page.meta.counts);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  function handleSelect(id: string) {
    bump();
    setSelectedId(id);
  }

  /** Sohbet panelinden gelen güncel oturumu liste kartına yansıtır (durum/atama/son mesaj). */
  function handleSessionChanged(updated: SupportChatSession) {
    setSessions((prev) => (prev ? prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)) : prev));
  }

  function handleDeleted() {
    setSelectedId(null);
    setSessions((prev) => prev?.filter((s) => s.id !== selectedId) ?? null);
    void load(status, q);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageHeading
        icon={MessageCircle}
        title="Canlı Destek"
        description="Ziyaretçi destek oturumlarını yönetin ve yanıtlayın."
        actions={
          // Base UI dokümantasyonu (`node_modules/@base-ui/react/docs/react/components/button.md`
          // §"Rendering links as buttons") `<Button render={<Link/>}>` desenini a11y açısından
          // YANLIŞ kabul ediyor (`appearance/page.tsx` İLE AYNI gerekçe/desen) — `Link` doğrudan
          // `buttonVariants()` ile stillendirilir.
          <Link href="/admin/support/templates" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            <FileText className="h-4 w-4" />
            Şablonlar
          </Link>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="min-h-0 min-w-0 lg:h-[calc(100vh-14rem)]">
          <SupportSessionList
            sessions={sessions}
            loadError={loadError}
            counts={counts}
            status={status}
            onStatusChange={(v) => {
              bump();
              setStatus(v);
            }}
            q={q}
            onQChange={(v) => {
              bump();
              setQ(v);
            }}
            selectedId={selectedId}
            onSelect={handleSelect}
            nextCursor={nextCursor}
            loadingMore={loadingMore}
            onLoadMore={handleLoadMore}
          />
        </div>
        <div className="min-h-[28rem] lg:h-[calc(100vh-14rem)]">
          <SupportChatPanel sessionId={selectedId} agents={agents} templates={templates} onSessionChanged={handleSessionChanged} onDeleted={handleDeleted} />
        </div>
      </div>
    </div>
  );
}
