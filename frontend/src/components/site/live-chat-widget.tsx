"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, Send, X } from "lucide-react";
import type { SiteSettings } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * Görev (2026-09-15) — Sağ alt canlı destek widget'ı. `settings` `(site)/layout.tsx`'ten (server
 * component, `fetchSiteSettingsServer()`) props olarak GELİR — `booking-payment-step.tsx`'teki
 * ayrı bir client-side `getPublicSettings()` çağrısı İCAT EDİLMEDİ, zaten sunucu tarafında
 * YÜKLENMİŞ olan `settings` yeniden kullanılır (fazladan bir network isteği önlenir).
 *
 * NOT (backend-agent EKSİĞİ, bkz. `types.ts::SiteSettings.liveChatEnabled` yorumu) — Prisma
 * sütunları eklendi ama backend `toSiteSettingsDto`/`SiteSettingsSchema`/openapi.yaml şemaları
 * BU ALANLARI HENÜZ TAŞIMIYOR. Bu yüzden `settings.liveChatEnabled` gerçek ortamda `undefined`
 * gelecektir — aşağıdaki `=== true` katı eşitlik kontrolü BUNU GÜVENLİ (kapalı/render etmeme)
 * şekilde ele alır; backend wiring tamamlandığında herhangi bir frontend değişikliği GEREKMEZ.
 */
interface LiveChatWidgetProps {
  settings: Pick<SiteSettings, "siteName" | "liveChatEnabled" | "liveChatProvider" | "liveChatScriptId">;
}

interface ChatMessage {
  id: string;
  from: "visitor" | "agent";
  text: string;
}

/**
 * `doctor-portal-route-guard.tsx::isDoctorSharedRouteException` İLE AYNI desen (locale prefix'i
 * de düşünen `/consultation/{id}` regex'i) — widget video oda kontrollerinin ÜSTÜNE BİNMESİN diye
 * bu rotalarda HİÇ render edilmez. Guard'ın KENDİSİNE dokunulmaz, bu tamamen AYRI bir kontrol.
 */
function isConsultationRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return /^\/(?:[a-z]{2}\/)?consultation(?:\/|$)/.test(pathname);
}

const AUTO_REPLY_DELAY_MS = 800;
const AUTO_REPLY_TEXT = "Mesajınız alındı, ekibimiz en kısa sürede size dönüş yapacaktır.";

function InternalChatPanel({ siteName, onClose }: { siteName: string; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  function nextId() {
    idRef.current += 1;
    return `msg-${idRef.current}`;
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setMessages((prev) => [...prev, { id: nextId(), from: "visitor", text }]);
    setDraft("");
    // İSTEMCİ TARAFLI MOCK — gerçek bir insan/AI YANITLAMAZ, kalıcı DEĞİLDİR (sayfa yenilenince
    // sıfırlanır). Yeni bir backend/websocket altyapısı İCAT EDİLMEDİ (görev talimatı, bağlayıcı).
    setTimeout(() => {
      setMessages((prev) => [...prev, { id: nextId(), from: "agent", text: AUTO_REPLY_TEXT }]);
    }, AUTO_REPLY_DELAY_MS);
  }

  return (
    <div
      role="dialog"
      aria-label={`${siteName} Destek`}
      className="flex h-[28rem] w-[22rem] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-[var(--site-radius)] border border-border bg-surface shadow-lg"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border bg-primary/5 px-4 py-3">
        <p className="text-sm font-semibold text-foreground">{siteName} Destek</p>
        <button
          type="button"
          aria-label="Sohbeti kapat"
          onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-foreground/60 transition-colors duration-300 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        <div className="max-w-[85%] rounded-[var(--site-radius)] bg-muted px-3 py-2 text-sm text-foreground">
          Merhaba! Randevu veya teknik konularda size nasıl yardımcı olabiliriz?
        </div>
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "max-w-[85%] rounded-[var(--site-radius)] px-3 py-2 text-sm",
              m.from === "visitor" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted text-foreground"
            )}
          >
            {m.text}
          </div>
        ))}
      </div>

      <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-border p-3">
        <label htmlFor="live-chat-message-input" className="sr-only">
          Mesajınızı yazın
        </label>
        <input
          id="live-chat-message-input"
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Mesajınızı yazın…"
          className="h-9 w-full min-w-0 rounded-[var(--site-radius)] border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/30"
        />
        <button
          type="submit"
          aria-label="Mesajı gönder"
          disabled={!draft.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--site-radius)] bg-primary text-primary-foreground transition-colors duration-300 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}

/** "internal" sağlayıcı — kendi mock sohbet arayüzü. */
function InternalLiveChatWidget({ siteName }: { siteName: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <AnimatePresence mode="wait">
        {open ? (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.3 }}
          >
            <InternalChatPanel siteName={siteName} onClose={() => setOpen(false)} />
          </motion.div>
        ) : (
          <motion.button
            key="trigger"
            type="button"
            aria-label="Canlı destek sohbetini aç"
            onClick={() => setOpen(true)}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.3 }}
            className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform duration-300 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <MessageCircle className="h-6 w-6" aria-hidden="true" />
            <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-success ring-2 ring-surface" aria-hidden="true" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * "crisp"/"tawkto" sağlayıcı — bu bileşenin KENDİ arayüzü YOKTUR, yalnızca harici sağlayıcının
 * embed script'ini enjekte eder (script kendi widget'ını DOM'a ekler). `strategy="lazyOnload"` —
 * ana sayfa yükünü ETKİLEMEZ.
 */
function ExternalLiveChatScript({ provider, scriptId }: { provider: "crisp" | "tawkto"; scriptId: string }) {
  if (provider === "crisp") {
    return (
      <Script id="live-chat-crisp" strategy="lazyOnload">
        {`window.$crisp=[];window.CRISP_WEBSITE_ID="${scriptId}";(function(){var d=document;var s=d.createElement("script");s.src="https://client.crisp.chat/l.js";s.async=1;d.getElementsByTagName("head")[0].appendChild(s);})();`}
      </Script>
    );
  }
  return (
    <Script id="live-chat-tawkto" strategy="lazyOnload">
      {`var Tawk_API=Tawk_API||{},Tawk_LoadStart=new Date();(function(){var s1=document.createElement("script"),s0=document.getElementsByTagName("script")[0];s1.async=true;s1.src='https://embed.tawk.to/${scriptId}/default';s1.charset='UTF-8';s1.setAttribute('crossorigin','*');s0.parentNode.insertBefore(s1,s0);})();`}
    </Script>
  );
}

export function LiveChatWidget({ settings }: LiveChatWidgetProps) {
  const pathname = usePathname();

  // Video oda kontrollerinin ÜSTÜNE BİNMEMESİ için `/consultation/**`de HİÇ render edilmez.
  if (isConsultationRoute(pathname)) return null;

  // Backend wiring EKSİK olduğu ortamlarda `liveChatEnabled` `undefined` gelir — katı `=== true`
  // kontrolü bunu güvenli (kapalı) şekilde ele alır (bkz. dosya başlığı notu).
  if (settings.liveChatEnabled !== true) return null;

  const provider = settings.liveChatProvider ?? "internal";

  if (provider !== "internal") {
    // `liveChatScriptId` boşsa harici sağlayıcı YAPILANDIRILAMAZ — sessizce hiçbir şey render
    // edilmez (ne kendi mock arayüzü, ne de boş bir script; admin panel zaten bu durumda uyarır).
    if (!settings.liveChatScriptId) return null;
    return <ExternalLiveChatScript provider={provider} scriptId={settings.liveChatScriptId} />;
  }

  return <InternalLiveChatWidget siteName={settings.siteName} />;
}
