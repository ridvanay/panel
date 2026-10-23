import { isCrmExcludedPath } from "@/lib/crm/excluded-paths";

/**
 * Paket N1 — WM CRM tarayıcı takip modülü. YALNIZCA analitik onayından sonra `CrmTrackerLoader` tarafından
 * dinamik `import()` ile yüklenir (onaysız bu dosya hiç indirilmez, istek gitmez, depolamaya yazılmaz).
 *
 * Gizlilik:
 * - input/textarea/select/contenteditable DEĞERİ ve tuş vuruşu ASLA okunmaz; öğe metni yalnızca link ve
 *   buton için, en fazla 80 karakter. `data-crm-ignore` içindeki her şey atlanır.
 * - Hariç yollarda (portal, görüşme, ödeme, giriş…) hiçbir olay üretilmez.
 * - gclid/gbraid/wbraid yalnızca pazarlama onayı varsa gönderilir.
 * - Bağlantı hedefinin sorgu dizesi gönderilmez (WhatsApp mesaj metni vb.).
 */
export interface TrackerConfig {
  apiBase: string;
  consentVersion: string;
  marketing: boolean;
  whatsappRef: boolean;
  excludedPaths: readonly string[];
  heartbeatSeconds: number;
}

type TrackEvent = Record<string, string | number | boolean | Record<string, string | number | boolean> | undefined> & { t: string; ts: number; p: string };

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const FLUSH_MS = 5000;
const MAX_BATCH = 50;
const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const INTERACTIVE = 'a[href],button,[role="button"],[role="link"],input,select,textarea,label,summary,[onclick],[data-track],[tabindex]:not([tabindex="-1"])';

let cfg: TrackerConfig | null = null;
let queue: TrackEvent[] = [];
let currentPath = "";
let maxScroll = 0;
let recentClicks: { x: number; y: number; at: number }[] = [];
let timers: number[] = [];
let cleanup: (() => void)[] = [];
let originalPush: History["pushState"] | null = null;
let originalReplace: History["replaceState"] | null = null;

function store(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function rand(length: number, alphabet: string): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Kalıcı ziyaretçi kimliğinin azami ömrü — saklama süresiyle aynı (180 gün); sonra yeni kimlik. */
const VISITOR_ID_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

function visitorId(): string {
  const createdAt = Number(store("wmcrm_vid_at") ?? 0);
  const existing = store("wmcrm_vid");
  if (existing && createdAt > 0 && Date.now() - createdAt < VISITOR_ID_MAX_AGE_MS) return existing;
  store("wmcrm_vid_at", String(Date.now()));
  return store("wmcrm_vid", rand(22, ID_ALPHABET)) ?? rand(22, ID_ALPHABET);
}

function sessionId(): string {
  const now = Date.now();
  let sid: string | null = null;
  try {
    const parsed = JSON.parse(store("wmcrm_sid") ?? "null") as { id?: string; at?: number } | null;
    if (parsed?.id && typeof parsed.at === "number" && now - parsed.at < SESSION_TIMEOUT_MS) sid = parsed.id;
  } catch {
    // bozuk değer — yeni oturum
  }
  sid ??= rand(22, ID_ALPHABET);
  store("wmcrm_sid", JSON.stringify({ id: sid, at: now }));
  return sid;
}

function refCode(): string | undefined {
  if (!cfg?.whatsappRef) return undefined;
  return store("wmcrm_ref") ?? store("wmcrm_ref", rand(6, REF_ALPHABET)) ?? undefined;
}

function excluded(path = location.pathname): boolean {
  return isCrmExcludedPath(path, cfg?.excludedPaths ?? []);
}

function pct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 1000) / 10));
}

function referrerOrigin(): string | undefined {
  try {
    return document.referrer ? new URL(document.referrer).origin : undefined;
  } catch {
    return undefined;
  }
}

const AD_CLICK_KEYS = ["gclid", "gbraid", "wbraid"];

function context() {
  const params = new URLSearchParams(location.search);
  const get = (key: string) => params.get(key)?.slice(0, 150) || undefined;
  const ctx: Record<string, string | undefined> = {
    lang: navigator.language?.slice(0, 20),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone?.slice(0, 60),
    // Veri minimizasyonu: yalnızca yönlendiren sitenin kökü (yol/sorgu gönderilmez).
    rf: referrerOrigin(),
    us: get("utm_source"),
    um: get("utm_medium"),
    uc: get("utm_campaign"),
    ut: get("utm_term"),
    ucn: get("utm_content"),
  };
  if (cfg?.marketing) {
    ctx.gclid = params.get("gclid")?.slice(0, 200) || undefined;
    ctx.gbraid = params.get("gbraid")?.slice(0, 200) || undefined;
    ctx.wbraid = params.get("wbraid")?.slice(0, 200) || undefined;
  }
  return Object.fromEntries(Object.entries(ctx).filter(([, v]) => v));
}

let landingContext: Record<string, string> = {};

function push(event: Omit<TrackEvent, "ts" | "p"> & { p?: string }) {
  const p = event.p ?? location.pathname;
  if (!cfg || excluded(p)) return;
  queue.push({ ...event, p, ts: Date.now() } as TrackEvent);
  if (queue.length >= MAX_BATCH) flush();
}

export function flush(): void {
  if (!cfg || queue.length === 0) return;
  const events = queue.splice(0, MAX_BATCH);
  const ref = refCode();
  const body = JSON.stringify({
    v: 1,
    vid: visitorId(),
    sid: sessionId(),
    cv: cfg.consentVersion,
    mk: cfg.marketing,
    ...(ref ? { ref } : {}),
    // Pazarlama onayı sonradan geri alındıysa reklam tıklama kimlikleri artık gönderilmez.
    ctx: cfg.marketing ? landingContext : Object.fromEntries(Object.entries(landingContext).filter(([k]) => !AD_CLICK_KEYS.includes(k))),
    events,
  });
  const url = `${cfg.apiBase}/crm/collect`;
  let sent = false;
  try {
    sent = typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url, new Blob([body], { type: "text/plain;charset=UTF-8" }));
  } catch {
    sent = false;
  }
  if (!sent) {
    void fetch(url, { method: "POST", body, keepalive: true, credentials: "omit", headers: { "content-type": "text/plain;charset=UTF-8" } }).catch(() => {});
  }
  if (queue.length > 0) flush();
}

function finishPage() {
  if (maxScroll > 0 && currentPath) push({ t: "scroll", p: currentPath, sc: Math.round(maxScroll) });
  maxScroll = 0;
}

function pageview() {
  const path = location.pathname;
  if (path === currentPath) return;
  finishPage();
  currentPath = path;
  // Kaydırmadan çıkan ziyaretçi için de ilk görünür alan ölçülür (kaydırma haritası yukarı yanlı olmasın).
  window.setTimeout(onScroll, 350);
  // Next.js başlığı rota değişiminden hemen sonra günceller — kısa gecikmeyle okunur.
  window.setTimeout(() => push({ t: "pageview", p: path, ti: document.title.slice(0, 300) }), 300);
}

function onScroll() {
  const doc = document.documentElement;
  const height = Math.max(doc.scrollHeight, 1);
  maxScroll = Math.max(maxScroll, pct((window.scrollY + window.innerHeight) / height));
}

function selectorOf(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.body && parts.length < 30) {
    if (node.id && /^[A-Za-z][\w-]{0,40}$/.test(node.id)) {
      parts.unshift(`#${node.id}`);
      break;
    }
    const tag = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    const index = parent ? Array.from(parent.children).filter((c) => c.tagName === node!.tagName).indexOf(node) + 1 : 1;
    parts.unshift(index > 1 ? `${tag}:nth-of-type(${index})` : tag);
    node = parent;
  }
  // `body`'ye sabitlenmiş tam yol (ya da kimlikli bir ataya); 400 karakteri aşan seçici gönderilmez
  // (ısı haritası o noktada yüzde konumuna düşer — yanlış öğeye eşlenmesin).
  const selector = node === document.body ? `body>${parts.join(">")}` : parts.join(">");
  return selector.length <= 400 ? selector : "";
}

function contactType(href: string): string | null {
  const lower = href.toLowerCase();
  if (lower.startsWith("tel:")) return "phone_click";
  if (lower.startsWith("mailto:")) return "email_click";
  if (/^whatsapp:|\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com|chat\.whatsapp\.com)\//.test(lower)) return "whatsapp_click";
  return null;
}

/** Hedef: sorgu dizesi ATILIR (mesaj metni, e-posta konusu vb. gönderilmez). */
function cleanHref(href: string): string {
  return href.split(/[?#]/)[0]!.slice(0, 1000);
}

function addWhatsappRef(link: HTMLAnchorElement) {
  const code = refCode();
  if (!code) return;
  try {
    const url = new URL(link.href);
    const text = url.searchParams.get("text") ?? "";
    if (text.includes("(Ref:")) return;
    url.searchParams.set("text", `${text}${text ? " " : ""}(Ref: ${code})`);
    link.href = url.toString();
  } catch {
    // ayrıştırılamayan bağlantı — dokunulmaz
  }
}

function onClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || excluded() || target.closest("[data-crm-ignore]")) return;
  const interactive = target.closest(INTERACTIVE) as HTMLElement | null;
  const el = interactive ?? (target as HTMLElement);
  const link = target.closest("a[href]") as HTMLAnchorElement | null;
  const rect = el.getBoundingClientRect();
  const docH = Math.max(document.documentElement.scrollHeight, 1);

  const now = Date.now();
  recentClicks = recentClicks.filter((c) => now - c.at < 1000);
  recentClicks.push({ x: event.clientX, y: event.clientY, at: now });
  const rage = recentClicks.filter((c) => Math.abs(c.x - event.clientX) < 30 && Math.abs(c.y - event.clientY) < 30).length >= 3;

  const tag = el.tagName;
  const isLinkOrButton = tag === "A" || tag === "BUTTON" || el.getAttribute("role") === "button" || el.getAttribute("role") === "link";
  // Öğe metni: YALNIZCA link/buton, en fazla 80 karakter. Form alanlarının değeri asla okunmaz.
  const text = isLinkOrButton ? (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80) : undefined;
  const href = link?.getAttribute("href") ?? undefined;
  const contact = href ? contactType(link!.href || href) : null;
  if (contact === "whatsapp_click" && link) addWhatsappRef(link);

  push({
    t: contact ?? "click",
    sel: selectorOf(el) || undefined,
    tx: text || undefined,
    hr: href ? cleanHref(href) : undefined,
    n: (target.closest("[data-track]") as HTMLElement | null)?.dataset.track?.slice(0, 100),
    x: pct(event.clientX / Math.max(window.innerWidth, 1)),
    y: pct((event.clientY + window.scrollY) / docH),
    ex: rect.width > 0 ? pct((event.clientX - rect.left) / rect.width) : undefined,
    ey: rect.height > 0 ? pct((event.clientY - rect.top) / rect.height) : undefined,
    vw: window.innerWidth,
    vh: window.innerHeight,
    dh: docH,
    rg: rage || undefined,
    dd: interactive ? undefined : true,
  });
  if (contact) flush();
}

function onSubmit(event: Event) {
  const form = event.target instanceof HTMLFormElement ? event.target : null;
  if (!form || excluded() || form.closest("[data-crm-ignore]")) return;
  // Yalnızca "bir form gönderildi" bilgisi + form konumu; alan değerleri ASLA okunmaz.
  push({ t: "form_submit", sel: selectorOf(form), n: (form.dataset.track || form.getAttribute("name") || form.id || "").slice(0, 100) || undefined });
  flush();
}

function onBookingStep(event: Event) {
  const step = Number((event as CustomEvent<{ step?: number }>).detail?.step);
  if (Number.isInteger(step) && step >= 1 && step <= 10) push({ t: "booking_step", st: step });
}

function onBookingCreated(event: Event) {
  const detail = (event as CustomEvent<{ bookingId?: string; accessToken?: string }>).detail;
  if (!cfg || !detail?.bookingId || !detail.accessToken) return;
  flush();
  const body = JSON.stringify({ bookingId: detail.bookingId, token: detail.accessToken, sid: sessionId(), vid: visitorId() });
  void fetch(`${cfg.apiBase}/crm/attribution`, {
    method: "POST",
    body,
    keepalive: true,
    credentials: "omit",
    headers: { "content-type": "text/plain;charset=UTF-8" },
  }).catch(() => {});
}

function onVisibility() {
  if (document.visibilityState === "hidden") {
    finishPage();
    flush();
  }
}

function listen<K extends keyof WindowEventMap>(target: Window | Document, type: K | string, handler: EventListener, options?: AddEventListenerOptions) {
  target.addEventListener(type, handler, options);
  cleanup.push(() => target.removeEventListener(type, handler, options));
}

/** Yükleyici bunu yalnızca analitik onayı + takip açık + hariç tutulmamış cihaz koşullarında çağırır. */
export function startTracker(config: TrackerConfig): void {
  if (cfg) {
    cfg = config;
    return;
  }
  if (typeof window === "undefined" || navigator.webdriver) return;
  cfg = config;
  landingContext = context() as Record<string, string>;

  listen(document, "click", onClick as EventListener, { capture: true });
  listen(document, "submit", onSubmit, { capture: true });
  listen(window, "scroll", onScroll, { passive: true });
  listen(window, "popstate", pageview);
  listen(window, "pagehide", () => {
    finishPage();
    flush();
  });
  listen(document, "visibilitychange", onVisibility);
  listen(window, "wmcrm:booking-step", onBookingStep);
  listen(window, "wmcrm:booking-created", onBookingCreated);

  originalPush = history.pushState;
  originalReplace = history.replaceState;
  history.pushState = function (...args: Parameters<History["pushState"]>) {
    originalPush!.apply(this, args);
    pageview();
  };
  history.replaceState = function (...args: Parameters<History["replaceState"]>) {
    originalReplace!.apply(this, args);
    pageview();
  };

  timers.push(window.setInterval(flush, FLUSH_MS));
  timers.push(
    window.setInterval(() => {
      if (document.visibilityState === "visible") push({ t: "heartbeat" });
    }, Math.max(5, config.heartbeatSeconds) * 1000)
  );

  (window as unknown as { WMCRM?: unknown }).WMCRM = {
    track(name: string, props?: Record<string, unknown>) {
      const clean: Record<string, string | number | boolean> = {};
      for (const [key, value] of Object.entries(props ?? {}).slice(0, 10)) {
        if (typeof value === "string") clean[key.slice(0, 40)] = value.slice(0, 100);
        else if (typeof value === "number" && Number.isFinite(value)) clean[key.slice(0, 40)] = value;
        else if (typeof value === "boolean") clean[key.slice(0, 40)] = value;
      }
      push({ t: "custom", n: String(name).slice(0, 100), pr: clean });
    },
  };

  currentPath = "";
  pageview();
}

/** Onay geri alınınca: dinleyiciler/zamanlayıcılar kaldırılır, kuyruk GÖNDERİLMEDEN atılır. */
export function stopTracker(): void {
  if (!cfg) return;
  for (const fn of cleanup) fn();
  for (const id of timers) window.clearInterval(id);
  if (originalPush) history.pushState = originalPush;
  if (originalReplace) history.replaceState = originalReplace;
  cleanup = [];
  timers = [];
  queue = [];
  cfg = null;
  currentPath = "";
  originalPush = null;
  originalReplace = null;
  delete (window as unknown as { WMCRM?: unknown }).WMCRM;
}
