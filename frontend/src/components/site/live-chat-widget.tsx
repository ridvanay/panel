"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Script from "next/script";
import { motion, AnimatePresence } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { MessageCircle, Send, X } from "lucide-react";
import * as supportApi from "@/lib/api/support";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { fetchLegalPagesClient, resolveKvkkNoticePage } from "@/lib/legal-pages";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { useAuthOptional } from "@/context/auth-context";
import type { LiveChatPosition, SitePage, SiteSettings, SupportChatMessagePublic, SupportSessionStatus } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * `.claude/architect-scope-support-desk-and-reminders.md` §3 — Sağ alt canlı destek widget'ı.
 * `settings` `(site)/layout.tsx`'ten (server component, `fetchSiteSettingsServer()`) props olarak
 * GELİR — ayrı bir client-side `getPublicSettings()` çağrısı İCAT EDİLMEZ.
 *
 * `liveChatProvider = "internal"` artık gerçek, kalıcı, sunucu taraflı bir sohbet sistemidir
 * (2026-09-15 kararının BİLİNÇLİ tersine çevrilmesi — [ASD] §3.1). `schemas/entities.ts`,
 * `mappers/index.ts` ve `openapi.yaml` `liveChatEnabled`/`liveChatProvider`/`liveChatScriptId`
 * alanlarını ZATEN taşıyor; `=== true` katı eşitliği yalnızca savunma amaçlı KALIR (zararsız).
 */
interface LiveChatWidgetProps {
  settings: Pick<
    SiteSettings,
    | "siteName"
    | "liveChatEnabled"
    | "liveChatProvider"
    | "liveChatScriptId"
    | "liveChatPreChatEnabled"
    | "liveChatRequireName"
    | "liveChatRequirePhone"
    | "liveChatRequireEmail"
    | "liveChatPosition"
  >;
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

/**
 * `?afterSeq=` artımlı çekim ile ziyaretçi mesajları — [ASD] §3.3 bağlayıcı kadanslar: panel
 * AÇIKKEN 5sn'de bir, KAPALIYKEN poll YOK (bu bileşen zaten yalnızca panel açıkken monte edilir),
 * 10dk etkisizlikten sonra durur (kullanıcı etkileşiminde otomatik devam eder — `bump()`).
 */
const POLL_INTERVAL_MS = 5000;
const POLL_INACTIVITY_LIMIT_MS = 10 * 60 * 1000;

/**
 * `accessToken` yanıtta BİR KEZ döner — `sessionStorage`'da tutulur (`localStorage` KESİNLİKLE
 * DEĞİL, [ASD] §3 + compliance-notes-support-desk.md: paylaşılan cihazda kalıcı ziyaretçi PII
 * izi bırakmasın). Sekme kapanınca/yeni sekmede otomatik silinir — bu BİLİNÇLİ bir tercihtir.
 */
const SUPPORT_SESSION_STORAGE_KEY = "support-chat-session";

interface StoredSupportSession {
  sessionId: string;
  accessToken: string;
}

/**
 * `.claude/architect-scope-support-desk-and-reminders.md` §7.4 — ön görüşme (pre-chat) formu.
 * `visitorPhone` KASITLI OLARAK basit bir format kontrolüne tabidir (backend `maxLength` dışında
 * DOĞRULAMA YAPMAZ, §7.3 madde 2) — bu tamamen istemci tarafı bir UX kolaylığıdır, uluslararası
 * numaraları reddetmemesi için gevşek tutulur (yalnızca rakam/boşluk/+/()/- ve 7-20 karakter).
 */
const PHONE_FORMAT_REGEX = /^\+?[0-9\s()-]{7,20}$/;

/**
 * Zorunluluk (`liveChatRequireName/Phone/Email`) `superRefine` İLE uygulanır — şemanın STATİK
 * TS tipi (`PreChatFormValues`) bu YÜZDEN `requireName/Phone/Email` bayraklarından BAĞIMSIZ,
 * SABİT kalır (üç alan da her zaman `string | undefined`). Yalnızca zorunlu olan alanlarda boş
 * bırakma HATA ÜRETİR; doldurulmuş ama hatalı biçimli bir alan zorunlu OLMASA bile reddedilir
 * (görev talimatı: "e-posta/telefon formatı basit bir regex ile" doğrulanır).
 */
const preChatBaseSchema = z.object({
  visitorName: z.string().trim().max(120, "En fazla 120 karakter olmalı.").optional(),
  visitorPhone: z
    .string()
    .trim()
    .max(40, "En fazla 40 karakter olmalı.")
    .optional()
    .refine((value) => !value || PHONE_FORMAT_REGEX.test(value), "Geçerli bir telefon numarası girin."),
  visitorEmail: z
    .string()
    .trim()
    .max(200, "En fazla 200 karakter olmalı.")
    .optional()
    .refine((value) => !value || z.string().email().safeParse(value).success, "Geçerli bir e-posta adresi girin."),
  message: z.string().trim().min(1, "Lütfen bir mesaj yazın.").max(2000, "En fazla 2000 karakter olmalı."),
});

type PreChatFormValues = z.infer<typeof preChatBaseSchema>;

function buildPreChatSchema(require: { name: boolean; phone: boolean; email: boolean }) {
  return preChatBaseSchema.superRefine((values, ctx) => {
    if (require.name && !values.visitorName?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["visitorName"], message: "Ad soyad zorunludur." });
    }
    if (require.phone && !values.visitorPhone?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["visitorPhone"], message: "Telefon numarası zorunludur." });
    }
    if (require.email && !values.visitorEmail?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["visitorEmail"], message: "E-posta zorunludur." });
    }
  });
}

/** Mevcut mesaj kutusu (`live-chat-message-input`) İLE BİREBİR AYNI sınıflar — yeni bir görsel dil İCAT EDİLMEZ. */
const PRE_CHAT_INPUT_CLASSES =
  "w-full min-w-0 rounded-[var(--site-radius)] border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/30 aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger/20";

function readStoredSession(): StoredSupportSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SUPPORT_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSupportSession>;
    if (!parsed.sessionId || !parsed.accessToken) return null;
    return { sessionId: parsed.sessionId, accessToken: parsed.accessToken };
  } catch {
    return null;
  }
}

function writeStoredSession(session: StoredSupportSession | null): void {
  if (typeof window === "undefined") return;
  if (session) window.sessionStorage.setItem(SUPPORT_SESSION_STORAGE_KEY, JSON.stringify(session));
  else window.sessionStorage.removeItem(SUPPORT_SESSION_STORAGE_KEY);
}

interface InternalChatPanelProps {
  siteName: string;
  onClose: () => void;
  /** `SiteSettings.liveChatPreChatEnabled === true` — bkz. dosya başı `LiveChatWidget` yorumu. */
  preChatEnabled: boolean;
  requireName: boolean;
  requirePhone: boolean;
  requireEmail: boolean;
}

function InternalChatPanel({ siteName, onClose, preChatEnabled, requireName, requirePhone, requireEmail }: InternalChatPanelProps) {
  const localize = useLocalizePath();
  // `favorite-button.tsx` İLE AYNI desen: `status === "loading"` da `unauthenticated` gibi ele
  // alınır (henüz TEYİT EDİLMEMİŞ bir giriş durumunda form YANLIŞLIKLA atlanmaz/gösterilmez —
  // `AuthProvider` bu widget'ın MONTE EDİLDİĞİ layout'un kökünde olduğundan pratikte panel
  // açılana kadar zaten çözülmüş olur).
  const auth = useAuthOptional();
  const authenticated = auth?.status === "authenticated";
  const [session, setSession] = useState<StoredSupportSession | null>(() => readStoredSession());
  const [messages, setMessages] = useState<SupportChatMessagePublic[]>([]);
  const [status, setStatus] = useState<SupportSessionStatus | null>(null);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(() => Boolean(readStoredSession()));
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // §7.4 — ön görüşme formu YALNIZCA misafir (`!authenticated`) VE henüz açık bir oturum
  // YOKKEN (`!session`) gösterilir; form gönderiminin KENDİSİ `session`'ı doldurduğu için bu
  // koşul otomatik olarak `false`'a döner (ayrı bir "form gönderildi" bayrağı GEREKMEZ).
  const showPreChatForm = preChatEnabled && !authenticated && !session;
  const preChatFormSchema = useMemo(
    () => buildPreChatSchema({ name: requireName, phone: requirePhone, email: requireEmail }),
    [requireName, requirePhone, requireEmail]
  );
  const {
    register: registerPreChat,
    handleSubmit: handlePreChatFormSubmit,
    formState: { errors: preChatErrors, isSubmitting: preChatSubmitting },
  } = useForm<PreChatFormValues>({
    resolver: zodResolver(preChatFormSchema),
    defaultValues: { visitorName: "", visitorPhone: "", visitorEmail: "", message: "" },
  });
  const [preChatError, setPreChatError] = useState<string | null>(null);
  // §4 (compliance-notes-support-desk.md) — mevcut, site genelindeki KVKK Aydınlatma Metni
  // sayfasına link verir (`telehealth-şablonundaki `kvkk-aydinlatma-metni` sayfasıyla AYNI
  // kaynak) — yoksa düz metin bırakılır (yeni bir sayfa İCAT EDİLMEZ).
  const [kvkkPage, setKvkkPage] = useState<Pick<SitePage, "title" | "slug"> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastSeqRef = useRef<number | null>(null);
  // eslint-disable-next-line react-hooks/purity -- `join-meeting-button.tsx` İLE AYNI gerekçe: 10dk etkisizlik penceresinin BAŞLANGICI, ilk render anındaki "şu an" yeterlidir
  const lastActivityRef = useRef(Date.now());
  // Yalnızca sayfa YÜKLENİRKEN `sessionStorage`'dan HİDRATE edilen oturumu tutar — `handleSend`'in
  // YENİ oluşturduğu bir oturum bu ref'e YAZILMAZ. Aşağıdaki "ilk yükleme" efekti bu YÜZDEN yalnızca
  // MOUNT'ta bir kez çalışır (`session` state'ine değil bu ref'e bakar); aksi halde `handleSend`
  // `setSession(next)` çağırdığında `session?.sessionId` değişir ve efekt YENİDEN tetiklenip
  // az önce zaten elde ettiğimiz mesaj geçmişini GEREKSİZ YERE tekrar ağdan çekerdi.
  const hydratedSessionRef = useRef<StoredSupportSession | null>(session);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    fetchLegalPagesClient()
      .then((pages) => setKvkkPage(resolveKvkkNoticePage(pages)))
      .catch(() => setKvkkPage(null));
  }, []);

  const resetSession = useCallback(() => {
    writeStoredSession(null);
    setSession(null);
    setMessages([]);
    setStatus(null);
    lastSeqRef.current = null;
  }, []);

  function bump() {
    lastActivityRef.current = Date.now();
  }

  // İlk yükleme — YALNIZCA MOUNT'ta, `sessionStorage`'dan hidrate edilen bir oturum varsa (sayfa
  // yenilenmeden ÖNCE de kurulmuş olabilir) TAM geçmişi çeker (`afterSeq` YOK — verilmezse TÜM
  // mesajlar döner). Token geçersiz/eksikse (`404`) oturum sıfırlanır — widget "yeni sohbet
  // başlat" durumuna sessizce düşer. `handleSend`'in YENİ kurduğu bir oturum İÇİN TEKRAR ÇALIŞMAZ
  // (bkz. `hydratedSessionRef` yorumu) — o akış zaten ilk mesajı response'tan alıp state'e yazar.
  useEffect(() => {
    const initial = hydratedSessionRef.current;
    if (!initial) {
      setLoadingHistory(false);
      return;
    }
    let cancelled = false;
    setLoadingHistory(true);
    supportApi
      .getSupportMessages(initial.sessionId, initial.accessToken)
      .then(({ items, meta }) => {
        if (cancelled) return;
        setMessages(items);
        setStatus(meta.status);
        if (meta.lastSeq !== null) lastSeqRef.current = meta.lastSeq;
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.status === 404) resetSession();
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- BİLİNÇLİ OLARAK yalnızca mount'ta bir kez çalışır (bkz. yukarıdaki yorum); `resetSession` referansı `useCallback` ile stabildir
  }, []);

  // Polling — 5sn kadans, 10dk etkisizlikten sonra fiilen durur (istek atılmaz) ama efekt/timer
  // KENDİSİ sökülmez; bir sonraki kullanıcı etkileşimi (`bump()`) bir sonraki tick'te otomatik
  // devam ettirir — ayrı bir "yeniden başlat" mekanizması GEREKMEZ.
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => {
      if (Date.now() - lastActivityRef.current > POLL_INACTIVITY_LIMIT_MS) return;
      supportApi
        .getSupportMessages(session.sessionId, session.accessToken, lastSeqRef.current ?? undefined)
        .then(({ items, meta }) => {
          setStatus(meta.status);
          if (meta.lastSeq !== null) lastSeqRef.current = meta.lastSeq;
          if (items.length > 0) setMessages((prev) => [...prev, ...items]);
        })
        .catch((err) => {
          if (err instanceof ApiClientError && err.status === 404) resetSession();
        });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [session, resetSession]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    bump();
    setSending(true);
    setSendError(null);
    try {
      if (!session) {
        const result = await supportApi.createSupportSession({
          message: text,
          pageUrl: typeof window !== "undefined" ? window.location.pathname : undefined,
        });
        const next: StoredSupportSession = { sessionId: result.sessionId, accessToken: result.accessToken };
        writeStoredSession(next);
        setSession(next);
        setMessages([result.message]);
        setStatus(result.status);
        lastSeqRef.current = result.message.seq;
      } else {
        const message = await supportApi.sendSupportMessage(session.sessionId, session.accessToken, { body: text });
        setMessages((prev) => [...prev, message]);
        lastSeqRef.current = message.seq;
        // Ziyaretçi mesajı her zaman oturumu `PENDING`e çeker (yeni oturumda zaten `PENDING`
        // doğar; `ANSWERED`ken de "temsilcinin yeni yanıtı bekleniyor"a geri döner — [ASD] §3.5).
        setStatus("PENDING");
      }
      setDraft("");
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) {
        resetSession();
        setSendError("Oturumunuz sona ermiş. Yeni bir sohbet başlatabilirsiniz.");
      } else if (err instanceof ApiClientError && err.code === "SUPPORT_SESSION_CLOSED") {
        setStatus("CLOSED");
        setSendError(null);
      } else {
        setSendError(friendlyErrorMessage(err));
      }
    } finally {
      setSending(false);
    }
  }

  /**
   * §7.4 — form YALNIZCA misafirde gösterilir, bu yüzden `visitor*` alanları BURADA (giriş
   * yapmış kullanıcı akışında handleSend'in `!session` dalının AKSİNE) gövdeye eklenir. Boş
   * bırakılan opsiyonel alanlar `undefined` olarak gönderilir (`""` DEĞİL) — sunucu tarafında
   * `null` sütunla AYNI sonucu verir, ama boş string bir "beyan" gibi YORUMLANMAZ.
   */
  async function onPreChatSubmit(values: PreChatFormValues) {
    bump();
    setPreChatError(null);
    // Bir önceki (artık sıfırlanmış) oturumdan kalan "oturumunuz sona ermiş" mesajı varsa
    // (`resetSession()` bunu TEMİZLEMEZ) yeni bir görüşme başlatılırken temizlenir.
    setSendError(null);
    try {
      const result = await supportApi.createSupportSession({
        message: values.message.trim(),
        visitorName: values.visitorName?.trim() || undefined,
        visitorPhone: values.visitorPhone?.trim() || undefined,
        visitorEmail: values.visitorEmail?.trim() || undefined,
        pageUrl: typeof window !== "undefined" ? window.location.pathname : undefined,
      });
      const next: StoredSupportSession = { sessionId: result.sessionId, accessToken: result.accessToken };
      writeStoredSession(next);
      setSession(next);
      setMessages([result.message]);
      setStatus(result.status);
      lastSeqRef.current = result.message.seq;
    } catch (err) {
      setPreChatError(friendlyErrorMessage(err));
    }
  }

  const isClosed = status === "CLOSED";

  return (
    <div
      role="dialog"
      aria-label={`${siteName} Destek`}
      className="flex h-[28rem] w-[22rem] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-[var(--site-radius)] border border-border bg-surface shadow-lg"
      // Alt çubuk + güvenli alan varken pencere ekranın üstünden taşmasın.
      style={{ maxHeight: "calc(100dvh - var(--site-bottom-inset, 0px) - env(safe-area-inset-bottom, 0px) - 3rem)" }}
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

      {showPreChatForm ? (
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <p className="text-sm text-foreground">
            Merhaba! Size daha hızlı yardımcı olabilmemiz için önce birkaç bilgi rica ediyoruz.
          </p>
          <form
            // `handleSend`/`handleAssign` İLE AYNI desen (dosya geneli) — RHF'in `handleSubmit(cb)`
            // çağrısı RENDER SIRASINDA değil, olay anında (`onSubmit` tetiklenince) yapılır; bu
            // fonksiyon `bump()` (ref/`Date.now`) OKUDUĞU için `react-hooks/refs`+`react-hooks/purity`
            // bunu render'da doğrudan `handlePreChatFormSubmit(onPreChatSubmit)` çağrısından AYIRT
            // edemez — ERTELENMİŞ (deferred) çağrı bu belirsizliği ORTADAN KALDIRIR.
            onSubmit={(e) => void handlePreChatFormSubmit(onPreChatSubmit)(e)}
            aria-label="Görüşme öncesi bilgi formu"
            className="space-y-3"
            noValidate
          >
            <div className="space-y-1">
              <label htmlFor="pre-chat-visitor-name" className="text-xs font-medium text-foreground/70">
                Adınız Soyadınız{requireName && <span className="text-danger"> *</span>}
              </label>
              <input
                id="pre-chat-visitor-name"
                type="text"
                autoComplete="name"
                placeholder="Adınız Soyadınız"
                aria-invalid={preChatErrors.visitorName ? true : undefined}
                aria-describedby={preChatErrors.visitorName ? "pre-chat-visitor-name-error" : undefined}
                className={cn(PRE_CHAT_INPUT_CLASSES, "h-9")}
                {...registerPreChat("visitorName")}
              />
              {preChatErrors.visitorName && (
                <p id="pre-chat-visitor-name-error" role="alert" className="text-xs text-danger">
                  {preChatErrors.visitorName.message}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label htmlFor="pre-chat-visitor-phone" className="text-xs font-medium text-foreground/70">
                Telefon Numaranız{requirePhone && <span className="text-danger"> *</span>}
              </label>
              <input
                id="pre-chat-visitor-phone"
                type="tel"
                autoComplete="tel"
                placeholder="+90 5XX XXX XX XX"
                aria-invalid={preChatErrors.visitorPhone ? true : undefined}
                aria-describedby={preChatErrors.visitorPhone ? "pre-chat-visitor-phone-error" : undefined}
                className={cn(PRE_CHAT_INPUT_CLASSES, "h-9")}
                {...registerPreChat("visitorPhone")}
              />
              {preChatErrors.visitorPhone && (
                <p id="pre-chat-visitor-phone-error" role="alert" className="text-xs text-danger">
                  {preChatErrors.visitorPhone.message}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label htmlFor="pre-chat-visitor-email" className="text-xs font-medium text-foreground/70">
                E-posta Adresiniz{requireEmail && <span className="text-danger"> *</span>}
              </label>
              <input
                id="pre-chat-visitor-email"
                type="email"
                autoComplete="email"
                placeholder="ornek@eposta.com"
                aria-invalid={preChatErrors.visitorEmail ? true : undefined}
                aria-describedby={preChatErrors.visitorEmail ? "pre-chat-visitor-email-error" : undefined}
                className={cn(PRE_CHAT_INPUT_CLASSES, "h-9")}
                {...registerPreChat("visitorEmail")}
              />
              {preChatErrors.visitorEmail && (
                <p id="pre-chat-visitor-email-error" role="alert" className="text-xs text-danger">
                  {preChatErrors.visitorEmail.message}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label htmlFor="pre-chat-message" className="text-xs font-medium text-foreground/70">
                Mesajınız<span className="text-danger"> *</span>
              </label>
              <textarea
                id="pre-chat-message"
                rows={3}
                placeholder="Size nasıl yardımcı olabiliriz?"
                aria-invalid={preChatErrors.message ? true : undefined}
                aria-describedby={preChatErrors.message ? "pre-chat-message-error" : undefined}
                className={cn(PRE_CHAT_INPUT_CLASSES, "min-h-[4.5rem] resize-none py-2")}
                {...registerPreChat("message")}
              />
              {preChatErrors.message && (
                <p id="pre-chat-message-error" role="alert" className="text-xs text-danger">
                  {preChatErrors.message.message}
                </p>
              )}
            </div>

            {preChatError && <p className="text-xs text-danger">{preChatError}</p>}

            <button
              type="submit"
              disabled={preChatSubmitting}
              className="flex h-9 w-full items-center justify-center rounded-[var(--site-radius)] bg-primary text-sm font-medium text-primary-foreground transition-colors duration-300 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {preChatSubmitting ? "Gönderiliyor…" : "Görüşmeyi Başlat"}
            </button>
          </form>
        </div>
      ) : (
        <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
          <div className="max-w-[85%] rounded-[var(--site-radius)] bg-muted px-3 py-2 text-sm text-foreground">
            Merhaba! Randevu veya teknik konularda size nasıl yardımcı olabiliriz?
          </div>
          {loadingHistory && <p className="text-xs text-foreground/40">Yükleniyor…</p>}
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "max-w-[85%] rounded-[var(--site-radius)] px-3 py-2 text-sm",
                m.senderType === "VISITOR" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted text-foreground"
              )}
            >
              {m.body}
            </div>
          ))}
        </div>
      )}

      {/*
       * `.claude/compliance-notes-support-desk.md` §4 — SÜREKLİ görünür, KAPATILAMAZ (dismissible
       * DEĞİL), mesaj gönderme formunun SABİT bir parçası. Ne `sessionStorage` ne `localStorage`
       * ile "bir daha gösterme" YAPILMAZ — her mesajdan önce hatırlatılmalıdır.
       */}
      <div className="space-y-1 border-t border-border bg-warning/5 px-4 py-2 text-xs text-foreground/70">
        <p>Lütfen sağlık durumunuza ilişkin ayrıntı paylaşmayın; tıbbi konular için randevu oluşturun.</p>
        <p>
          Bu sohbeti kullanarak{" "}
          {kvkkPage ? (
            <Link
              href={localize(`/${kvkkPage.slug}`)}
              target="_blank"
              className="underline underline-offset-2 hover:text-foreground"
            >
              KVKK Aydınlatma Metni
            </Link>
          ) : (
            "KVKK Aydınlatma Metni"
          )}
          {"'"}ni kabul etmiş olursunuz.
        </p>
      </div>

      {sendError && <p className="px-4 pt-2 text-xs text-danger">{sendError}</p>}

      {showPreChatForm ? null : isClosed ? (
        <div className="flex items-center justify-between gap-2 border-t border-border p-3">
          <p className="text-xs text-foreground/60">Bu sohbet kapatıldı.</p>
          <button
            type="button"
            onClick={() => {
              resetSession();
              setSendError(null);
            }}
            className="text-xs font-medium text-primary hover:underline"
          >
            Yeni Sohbet Başlat
          </button>
        </div>
      ) : (
        <form onSubmit={(e) => void handleSend(e)} className="flex items-center gap-2 border-t border-border p-3">
          <label htmlFor="live-chat-message-input" className="sr-only">
            Mesajınızı yazın
          </label>
          <input
            id="live-chat-message-input"
            type="text"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              bump();
            }}
            placeholder="Mesajınızı yazın…"
            className="h-9 w-full min-w-0 rounded-[var(--site-radius)] border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/30"
          />
          <button
            type="submit"
            aria-label="Mesajı gönder"
            disabled={!draft.trim() || sending}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--site-radius)] bg-primary text-primary-foreground transition-colors duration-300 hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * Yüzen düğme konumu — alt çubuk varsa (`--site-bottom-inset`, bkz. `bottom-bar-inset.tsx`) onun
 * üstüne, iPhone güvenli alanı (`safe-area-inset-bottom`) kadar da yukarı çıkar.
 */
export const FLOATING_BOTTOM = "calc(1.5rem + var(--site-bottom-inset, 0px) + env(safe-area-inset-bottom, 0px))";
/** Sohbet düğmesi (3.5rem) + boşluk (0.75rem) — aynı köşedeki "yukarı çık" düğmesi bunun üstüne çıkar. */
const CHAT_STACK_OFFSET = "4.25rem";

interface InternalLiveChatWidgetProps {
  position: LiveChatPosition;
  siteName: string;
  preChatEnabled: boolean;
  requireName: boolean;
  requirePhone: boolean;
  requireEmail: boolean;
}

/** "internal" sağlayıcı — kendi (gerçek backend'e bağlı) sohbet arayüzü. */
function InternalLiveChatWidget({ position, siteName, preChatEnabled, requireName, requirePhone, requireEmail }: InternalLiveChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const side = position === "BOTTOM_LEFT" ? "left" : "right";

  // Aynı köşedeki "yukarı çık" düğmesi sohbet düğmesinin üstüne çıksın diye yığın payını yayınla.
  useEffect(() => {
    const root = document.documentElement;
    const variable = `--site-chat-stack-${side}`;
    root.style.setProperty(variable, CHAT_STACK_OFFSET);
    return () => {
      root.style.removeProperty(variable);
    };
  }, [side]);

  return (
    <div
      data-live-chat-position={side}
      className={cn("fixed z-50 flex flex-col transition-[bottom] duration-300", side === "left" ? "items-start" : "items-end")}
      style={{ bottom: FLOATING_BOTTOM, [side]: "1.5rem" }}
    >
      <AnimatePresence mode="wait">
        {open ? (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.3 }}
          >
            <InternalChatPanel
              siteName={siteName}
              onClose={() => setOpen(false)}
              preChatEnabled={preChatEnabled}
              requireName={requireName}
              requirePhone={requirePhone}
              requireEmail={requireEmail}
            />
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

  // `liveChatEnabled` backend'den `undefined` gelirse (ör. satır kaydı hiç oluşturulmamışsa)
  // katı `=== true` kontrolü bunu güvenli (kapalı) şekilde ele alır.
  if (settings.liveChatEnabled !== true) return null;

  const provider = settings.liveChatProvider ?? "internal";

  if (provider !== "internal") {
    // `liveChatScriptId` boşsa harici sağlayıcı YAPILANDIRILAMAZ — sessizce hiçbir şey render
    // edilmez (ne kendi arayüzü, ne de boş bir script; admin panel zaten bu durumda uyarır).
    if (!settings.liveChatScriptId) return null;
    return <ExternalLiveChatScript provider={provider} scriptId={settings.liveChatScriptId} />;
  }

  return (
    <InternalLiveChatWidget
      position={settings.liveChatPosition ?? "BOTTOM_RIGHT"}
      siteName={settings.siteName}
      // §7.4 — pre-chat bayrakları da `liveChatEnabled` İLE AYNI "backend henüz yetişmemişse
      // güvenli (kapalı) varsayılan" disipliniyle `?? ` düşer. `liveChatRequireName/Phone` backend
      // Prisma varsayılanı `true`, `liveChatRequireEmail` `false` (bkz. `types.ts` yorumu).
      preChatEnabled={settings.liveChatPreChatEnabled === true}
      requireName={settings.liveChatRequireName ?? true}
      requirePhone={settings.liveChatRequirePhone ?? true}
      requireEmail={settings.liveChatRequireEmail ?? false}
    />
  );
}
