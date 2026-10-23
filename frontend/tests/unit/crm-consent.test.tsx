import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * Paket N1 — çerez onayı ve takip yükleyicisi. Onay yokken takip modülü YÜKLENMEZ ve hiçbir istek
 * gitmez; "Reddet" ile "Kabul et" aynı görünürlükte; footer bağlantısı tercihleri açar; RTL (ar) bant.
 */
const startTracker = vi.fn();
const stopTracker = vi.fn();
vi.mock("@/lib/crm/tracker", () => ({ startTracker, stopTracker }));

import { CookieConsentBanner } from "@/components/site/cookie-consent-banner";
import { CookiePreferencesButton } from "@/components/site/cookie-preferences-button";
import { CrmTrackerLoader } from "@/components/site/crm-tracker-loader";
import { CONSENT_STORAGE_KEY, CONSENT_VERSION, readConsent } from "@/lib/crm/consent";
import { CRM_ALWAYS_EXCLUDED_PATHS, isCrmExcludedPath } from "@/lib/crm/excluded-paths";
import { consentStrings as trConsent } from "@/lib/i18n/site-dictionaries/tr/consent";
import { consentStrings as arConsent } from "@/lib/i18n/site-dictionaries/ar/consent";
import type { CrmPublicConfig } from "@/lib/api/server-crm";

const CONFIG: CrmPublicConfig = {
  trackingEnabled: true,
  trackStaff: false,
  whatsappRef: false,
  excludedPaths: [],
  consentVersion: CONSENT_VERSION,
  heartbeatSeconds: 15,
};

const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));

beforeEach(() => {
  localStorage.clear();
  startTracker.mockClear();
  stopTracker.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  // jsdom <dialog> desteği eksik — showModal/close'u `open` özniteliğiyle taklit et.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

async function flushPromises() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("onay bandı", () => {
  it("onay yokken görünür; Reddet ile Kabul et AYNI sınıflarda; onay yokken hiçbir istek gitmez ve takip yüklenmez", async () => {
    render(
      <>
        <CookieConsentBanner dict={trConsent} policyHref="/tr/cerez-politikasi" locale="tr" />
        <CrmTrackerLoader config={CONFIG} />
      </>
    );
    const reject = await screen.findByRole("button", { name: "Tümünü reddet" });
    const accept = screen.getByRole("button", { name: "Tümünü kabul et" });
    expect(reject.className).toBe(accept.className);
    expect(screen.getByRole("link", { name: "Çerez politikası" })).toHaveAttribute("href", "/tr/cerez-politikasi");
    await flushPromises();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(startTracker).not.toHaveBeenCalled();
    expect(localStorage.getItem("wmcrm_vid")).toBeNull();
  });

  it("eski 'gezinmeye devam ederek kabul' kaydı geçerli onay sayılmaz", async () => {
    localStorage.setItem("cookie-consent-accepted", "1");
    render(<CookieConsentBanner dict={trConsent} policyHref={null} locale="tr" />);
    expect(await screen.findByRole("button", { name: "Tümünü reddet" })).toBeInTheDocument();
    expect(readConsent()).toBeNull();
  });

  it("Reddet: analitik/pazarlama kapalı kaydedilir, onay kaydı gönderilir, takip YÜKLENMEZ", async () => {
    render(
      <>
        <CookieConsentBanner dict={trConsent} policyHref={null} locale="tr" />
        <CrmTrackerLoader config={CONFIG} />
      </>
    );
    fireEvent.click(await screen.findByRole("button", { name: "Tümünü reddet" }));
    await flushPromises();
    expect(readConsent()).toMatchObject({ v: CONSENT_VERSION, analytics: false, marketing: false });
    expect(localStorage.getItem("cookie-consent-accepted")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/crm\/consent$/);
    expect(JSON.parse(String(init.body))).toMatchObject({ a: false, m: false, act: "REJECT_ALL", l: "tr" });
    expect(startTracker).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Tümünü reddet" })).not.toBeInTheDocument();
  });

  it("Kabul et: takip başlar (pazarlama dahil); geri alınınca durur ve takip anahtarları silinir", async () => {
    render(
      <>
        <CookieConsentBanner dict={trConsent} policyHref={null} locale="tr" />
        <CookiePreferencesButton label={trConsent.footerLink} />
        <CrmTrackerLoader config={CONFIG} />
      </>
    );
    fireEvent.click(await screen.findByRole("button", { name: "Tümünü kabul et" }));
    await flushPromises();
    expect(startTracker).toHaveBeenCalledWith(expect.objectContaining({ marketing: true, consentVersion: CONSENT_VERSION }));

    localStorage.setItem("wmcrm_vid", "vvvvvvvvvvvvvvvvvvvvvv");
    fireEvent.click(screen.getByRole("button", { name: "Çerez tercihleri" }));
    const analytics = await screen.findByRole("switch", { name: "Analitik" });
    expect(analytics).toBeChecked();
    fireEvent.click(analytics);
    expect(screen.getByRole("switch", { name: "Pazarlama" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Seçimleri kaydet" }));
    await flushPromises();

    expect(readConsent()).toMatchObject({ analytics: false, marketing: false });
    expect(localStorage.getItem("wmcrm_vid")).toBeNull();
    expect(stopTracker).toHaveBeenCalled();
    const lastBody = JSON.parse(String((fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body));
    expect(lastBody).toMatchObject({ a: false, act: "WITHDRAW", vid: "vvvvvvvvvvvvvvvvvvvvvv" });
  });

  it("Tercihler: yalnızca analitik seçilebilir; zorunlu kategori her zaman açık", async () => {
    render(
      <>
        <CookieConsentBanner dict={trConsent} policyHref={null} locale="tr" />
        <CrmTrackerLoader config={CONFIG} />
      </>
    );
    fireEvent.click(await screen.findByRole("button", { name: "Tercihler" }));
    expect(screen.getByRole("switch", { name: "Zorunlu" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Analitik" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("switch", { name: "Analitik" }));
    fireEvent.click(screen.getByRole("button", { name: "Seçimleri kaydet" }));
    await flushPromises();
    expect(readConsent()).toMatchObject({ analytics: true, marketing: false });
    expect(startTracker).toHaveBeenCalledWith(expect.objectContaining({ marketing: false }));
  });

  it("Arapça (RTL): metinler sözlükten, bant mantıksal hizalı", async () => {
    render(
      <div dir="rtl" lang="ar">
        <CookieConsentBanner dict={arConsent} policyHref={null} locale="ar" />
      </div>
    );
    const region = await screen.findByRole("region", { name: "خصوصيتك" });
    expect(screen.getByRole("button", { name: "رفض الكل" }).className).toBe(screen.getByRole("button", { name: "قبول الكل" }).className);
    expect(region.innerHTML).not.toMatch(/\b(ml|mr|pl|pr|left|right|text-left|text-right)-/);
  });
});

describe("takip yükleyicisi", () => {
  function consent(analytics: boolean, marketing = false) {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ v: CONSENT_VERSION, id: "cccccccccccccccccccccc", analytics, marketing, ts: 1 }));
  }

  it("takip kapalıysa, onay eski sürümse ya da cihaz hariç tutulduysa başlamaz", async () => {
    consent(true);
    const { unmount } = render(<CrmTrackerLoader config={{ ...CONFIG, trackingEnabled: false }} />);
    await flushPromises();
    unmount();
    render(<CrmTrackerLoader config={null} />);
    await flushPromises();
    expect(startTracker).not.toHaveBeenCalled();

    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ v: "2020-01-01", id: "cccccccccccccccccccccc", analytics: true, marketing: true, ts: 1 }));
    render(<CrmTrackerLoader config={CONFIG} />);
    await flushPromises();
    expect(startTracker).not.toHaveBeenCalled();
  });

  it("?crm_optout=1 cihazı kalıcı olarak hariç tutar; personel cihazı ayar kapalıyken takip edilmez", async () => {
    consent(true);
    window.history.replaceState({}, "", "/tr?crm_optout=1");
    const first = render(<CrmTrackerLoader config={CONFIG} />);
    await flushPromises();
    expect(localStorage.getItem("wmcrm_optout")).toBe("1");
    expect(startTracker).not.toHaveBeenCalled();
    first.unmount();

    window.history.replaceState({}, "", "/tr?crm_optout=0");
    localStorage.setItem("wmcrm_staff", "1");
    const second = render(<CrmTrackerLoader config={CONFIG} />);
    await flushPromises();
    expect(startTracker).not.toHaveBeenCalled();
    second.unmount();

    render(<CrmTrackerLoader config={{ ...CONFIG, trackStaff: true }} />);
    await flushPromises();
    expect(startTracker).toHaveBeenCalledTimes(1);
  });
});

describe("backend ile uyum", () => {
  it("onay sürümü ve hariç yol listesi backend ile aynı", () => {
    const settingsSrc = readFileSync(resolve(__dirname, "../../../backend/src/modules/crm/crm.settings.ts"), "utf8");
    expect(settingsSrc).toContain(`export const CRM_CONSENT_VERSION = "${CONSENT_VERSION}";`);
    const privacySrc = readFileSync(resolve(__dirname, "../../../backend/src/modules/crm/crm.privacy.ts"), "utf8");
    const block = privacySrc.match(/export const CRM_ALWAYS_EXCLUDED_PATHS = \[([\s\S]*?)\] as const;/);
    const backendList = [...block![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(backendList).toEqual([...CRM_ALWAYS_EXCLUDED_PATHS]);
  });

  it("hariç yollar: portal, görüşme, ödeme, admin; public doktor sayfası hariç DEĞİL", () => {
    expect(isCrmExcludedPath("/tr/patient/bookings/1")).toBe(true);
    expect(isCrmExcludedPath("/en/consultation/x")).toBe(true);
    expect(isCrmExcludedPath("/tr/checkout/success")).toBe(true);
    expect(isCrmExcludedPath("/admin/crm")).toBe(true);
    expect(isCrmExcludedPath("/en/doctor/patients")).toBe(true);
    expect(isCrmExcludedPath("/en/doctors/x")).toBe(false);
  });
});
