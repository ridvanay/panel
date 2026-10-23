import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTracker, stopTracker, flush, type TrackerConfig } from "@/lib/crm/tracker";

/**
 * Paket N1 — takip modülü (gerçek kod, jsdom). Input değeri ve tuş vuruşu ASLA gönderilmez; öğe metni
 * yalnızca link/buton ve ≤80 karakter; hariç yollarda ve `data-crm-ignore` içinde olay yok; WhatsApp Ref;
 * pazarlama onayı olmadan gclid yok; randevu atfı isteği.
 */
const CONFIG: TrackerConfig = {
  apiBase: "http://api.test/api/v1",
  consentVersion: "2026-10-23",
  marketing: false,
  whatsappRef: false,
  excludedPaths: [],
  heartbeatSeconds: 15,
};

interface Sent {
  url: string;
  body: { vid: string; sid: string; mk: boolean; ref?: string; ctx: Record<string, string>; events: Record<string, unknown>[] };
}

let sent: Sent[] = [];
let blobs: Promise<void>[] = [];
const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sent = [];
  blobs = [];
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: (url: string, data: Blob) => {
      blobs.push(data.text().then((text) => void sent.push({ url, body: JSON.parse(text) })));
      return true;
    },
  });
  document.body.innerHTML = "";
});

afterEach(() => {
  stopTracker();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

async function collected() {
  flush();
  await Promise.all(blobs);
  return sent.flatMap((s) => s.body.events);
}

describe("takip modülü", () => {
  it("sayfa görüntüleme + ctx; pazarlama onayı yoksa gclid gönderilmez", async () => {
    window.history.replaceState({}, "", "/en/doctors/x?utm_source=newsletter&gclid=abc123");
    startTracker(CONFIG);
    vi.advanceTimersByTime(400);
    const events = await collected();
    expect(events).toEqual([expect.objectContaining({ t: "pageview", p: "/en/doctors/x" })]);
    expect(sent[0]!.url).toBe("http://api.test/api/v1/crm/collect");
    expect(sent[0]!.body.ctx).toMatchObject({ us: "newsletter" });
    expect(sent[0]!.body.ctx.gclid).toBeUndefined();
    expect(sent[0]!.body.mk).toBe(false);
    expect(sent[0]!.body.vid).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("pazarlama onayıyla gclid gönderilir", async () => {
    window.history.replaceState({}, "", "/en?gclid=abc123");
    startTracker({ ...CONFIG, marketing: true });
    vi.advanceTimersByTime(400);
    await collected();
    expect(sent[0]!.body.ctx.gclid).toBe("abc123");
    expect(sent[0]!.body.mk).toBe(true);
  });

  it("input değeri ve tuş vuruşu ASLA gönderilmez; buton metni ≤80; ölü tıklama işaretlenir", async () => {
    window.history.replaceState({}, "", "/en/contact");
    document.body.innerHTML = `
      <main>
        <form id="f"><input id="name" value="Ali Veli 05551112233" /><textarea id="note">Bel fıtığı şikayetim var</textarea></form>
        <button id="cta">${"Randevu al ".repeat(20)}</button>
        <p id="plain">Sadece metin</p>
      </main>`;
    startTracker(CONFIG);
    vi.advanceTimersByTime(400);
    const input = document.getElementById("name") as HTMLInputElement;
    input.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "A", bubbles: true }));
    document.getElementById("note")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.getElementById("cta")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.getElementById("plain")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.getElementById("f")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    const events = await collected();
    const raw = JSON.stringify(sent);
    expect(raw).not.toContain("Ali Veli");
    expect(raw).not.toContain("05551112233");
    expect(raw).not.toContain("fıtığı");
    const clicks = events.filter((e) => e.t === "click");
    expect(clicks).toHaveLength(4);
    expect(clicks[0]!.tx).toBeUndefined();
    expect(String(clicks[2]!.tx).length).toBeLessThanOrEqual(80);
    expect(clicks[3]).toMatchObject({ dd: true });
    expect(clicks[2]!.dd).toBeUndefined();
    expect(events.find((e) => e.t === "form_submit")).toMatchObject({ sel: "#f" });
    expect(events.some((e) => e.t === "keydown")).toBe(false);
  });

  it("data-crm-ignore içindeki tıklamalar ve hariç yollar kaydedilmez", async () => {
    window.history.replaceState({}, "", "/tr/doctors/x");
    document.body.innerHTML = `<div data-crm-ignore><button id="slot">10:30</button></div><button id="ok">Tamam</button>`;
    startTracker(CONFIG);
    vi.advanceTimersByTime(400);
    document.getElementById("slot")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    window.history.pushState({}, "", "/tr/patient/bookings/1");
    vi.advanceTimersByTime(400);
    document.getElementById("ok")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    window.history.pushState({}, "", "/tr/checkout");
    vi.advanceTimersByTime(400);
    const events = await collected();
    expect(events.map((e) => [e.t, e.p])).toEqual([["pageview", "/tr/doctors/x"]]);
  });

  it("WhatsApp tıklaması: Ref kodu mesaja eklenir, hedefte sorgu dizesi gönderilmez", async () => {
    window.history.replaceState({}, "", "/en");
    document.body.innerHTML = `<a id="wa" href="https://wa.me/905551112233?text=Merhaba">WhatsApp</a><a id="tel" href="tel:+905551112233">Ara</a>`;
    startTracker({ ...CONFIG, whatsappRef: true });
    vi.advanceTimersByTime(400);
    const wa = document.getElementById("wa") as HTMLAnchorElement;
    wa.addEventListener("click", (e) => e.preventDefault());
    wa.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    document.getElementById("tel")!.addEventListener("click", (e) => e.preventDefault());
    document.getElementById("tel")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    const ref = localStorage.getItem("wmcrm_ref");
    expect(ref).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(decodeURIComponent(wa.href.replace(/\+/g, " "))).toContain(`Merhaba (Ref: ${ref})`);
    const events = await collected();
    expect(events.find((e) => e.t === "whatsapp_click")).toMatchObject({ hr: "https://wa.me/905551112233", tx: "WhatsApp" });
    expect(events.find((e) => e.t === "phone_click")).toMatchObject({ hr: "tel:+905551112233" });
    expect(sent[0]!.body.ref).toBe(ref);
  });

  it("randevu adımı ve randevu atfı; durdurulunca gönderim olmaz", async () => {
    window.history.replaceState({}, "", "/en/doctors/x");
    startTracker(CONFIG);
    vi.advanceTimersByTime(400);
    window.dispatchEvent(new CustomEvent("wmcrm:booking-step", { detail: { step: 3 } }));
    window.dispatchEvent(new CustomEvent("wmcrm:booking-created", { detail: { bookingId: "b-1", accessToken: "tok" } }));
    const events = await collected();
    expect(events.find((e) => e.t === "booking_step")).toMatchObject({ st: 3 });
    const attribution = fetchMock.mock.calls.find((c) => String((c as unknown[])[0]).endsWith("/crm/attribution")) as unknown as [string, RequestInit];
    expect(JSON.parse(String(attribution[1].body))).toMatchObject({ bookingId: "b-1", token: "tok" });

    stopTracker();
    sent = [];
    window.dispatchEvent(new CustomEvent("wmcrm:booking-step", { detail: { step: 4 } }));
    vi.advanceTimersByTime(20_000);
    expect(await collected()).toEqual([]);
    expect((window as unknown as { WMCRM?: unknown }).WMCRM).toBeUndefined();
  });

  it("window.WMCRM.track özel olay; heartbeat yalnızca görünürken", async () => {
    window.history.replaceState({}, "", "/en");
    startTracker(CONFIG);
    vi.advanceTimersByTime(400);
    (window as unknown as { WMCRM: { track: (n: string, p: unknown) => void } }).WMCRM.track("brosur_indir", { dil: "en", sayi: 2, nesne: { x: 1 } });
    vi.advanceTimersByTime(15_000);
    const events = await collected();
    expect(events.find((e) => e.t === "custom")).toMatchObject({ n: "brosur_indir", pr: { dil: "en", sayi: 2 } });
    expect(events.filter((e) => e.t === "heartbeat")).toHaveLength(1);
  });
});
