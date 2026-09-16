"use client";

import { formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import { MessageCircle, Search } from "lucide-react";
import type { SupportChatSessionSummary, SupportSessionCounts, SupportSessionStatus } from "@/lib/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

/**
 * `.claude/design-notes-support-desk.md` §2.1/§2.2 — `contact/submissions/page.tsx` liste
 * deseni (arama + kart listesi) + `Tabs variant="line"` sekme filtresi (`Select` DEĞİL —
 * `meta.counts` sekme rozetleriyle daha iyi eşleşiyor). Durum rozet tonları: `PENDING`→warning,
 * `ANSWERED`→success, `CLOSED`→neutral (hepsi `soft`, `solid` KULLANILMAZ — liste yoğun).
 */
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

type TabValue = "ALL" | SupportSessionStatus;

interface SupportSessionListProps {
  sessions: SupportChatSessionSummary[] | null;
  loadError: string | null;
  counts: SupportSessionCounts | null;
  status: SupportSessionStatus | undefined;
  onStatusChange: (status: SupportSessionStatus | undefined) => void;
  q: string;
  onQChange: (q: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  nextCursor: string | null;
  loadingMore: boolean;
  onLoadMore: () => void;
}

export function SupportSessionList({
  sessions,
  loadError,
  counts,
  status,
  onStatusChange,
  q,
  onQChange,
  selectedId,
  onSelect,
  nextCursor,
  loadingMore,
  onLoadMore,
}: SupportSessionListProps) {
  const tabValue: TabValue = status ?? "ALL";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <Search className="h-3.5 w-3.5 text-foreground/40" />
        </InputGroupAddon>
        <InputGroupInput placeholder="Ziyaretçi adı/e-postası ara…" value={q} onChange={(e) => onQChange(e.target.value)} aria-label="Ziyaretçi adı veya e-postası ara" />
      </InputGroup>

      <Tabs
        value={tabValue}
        onValueChange={(v) => onStatusChange(v === "ALL" ? undefined : (v as SupportSessionStatus))}
      >
        <TabsList variant="line" className="flex-nowrap overflow-x-auto">
          <TabsTrigger value="ALL">
            Tümü <span className="ml-1 tabular-nums text-foreground/70">({counts?.all ?? 0})</span>
          </TabsTrigger>
          <TabsTrigger value="PENDING">
            Bekleyen <span className="ml-1 tabular-nums text-foreground/70">({counts?.pending ?? 0})</span>
          </TabsTrigger>
          <TabsTrigger value="ANSWERED">
            Yanıtlandı <span className="ml-1 tabular-nums text-foreground/70">({counts?.answered ?? 0})</span>
          </TabsTrigger>
          <TabsTrigger value="CLOSED">
            Kapatıldı <span className="ml-1 tabular-nums text-foreground/70">({counts?.closed ?? 0})</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {loadError && <p className="p-3 text-sm text-danger">{loadError}</p>}

        {!loadError && sessions === null && (
          <div className="flex justify-center py-10">
            <Spinner className="h-5 w-5 text-primary" />
          </div>
        )}

        {!loadError && sessions !== null && sessions.length === 0 && (
          <EmptyState icon={MessageCircle} title="Oturum yok" description="Bu filtreye uyan bir destek oturumu bulunamadı." />
        )}

        {!loadError &&
          sessions !== null &&
          sessions.map((session) => {
            const active = session.id === selectedId;
            const displayName = session.visitorName?.trim() || "Misafir Ziyaretçi";
            return (
              <button
                key={session.id}
                type="button"
                onClick={() => onSelect(session.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "block w-full rounded-xl border p-4 text-left shadow-sm transition-colors duration-300",
                  active ? "border-primary/30 bg-primary/5" : "border-border bg-card hover:bg-muted/50"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">{displayName}</span>
                    <Badge tone={STATUS_TONE[session.status]} size="sm">
                      {STATUS_LABEL[session.status]}
                    </Badge>
                  </div>
                  {session.unreadForAgent > 0 && (
                    <Badge tone="primary" size="sm">
                      {session.unreadForAgent}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-foreground/60">{session.lastMessagePreview ?? "—"}</p>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-foreground/40">
                  <span>
                    {formatDistanceToNow(new Date(session.lastMessageAt ?? session.createdAt), { addSuffix: true, locale: tr })}
                  </span>
                  {session.assignedAgent ? <span className="truncate">{session.assignedAgent.name}</span> : <span>Atanmamış</span>}
                </div>
              </button>
            );
          })}

        {nextCursor && (
          <div className="flex justify-center pt-2">
            <Button type="button" variant="outline" size="sm" loading={loadingMore} onClick={onLoadMore}>
              Daha Fazla Yükle
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
