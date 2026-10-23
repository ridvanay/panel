import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CrmKeywordsReport, CrmSettings } from "@/lib/api/crm";

/**
 * Paket N4 — Anahtar Kelimeler (bağlı değilken kurulum adımları; bağlıyken sıra/değişim/gruplar), Search
 * Console bağlama kartı (JSON dosyası tek seferde gönderilir, ekranda yalnızca maskeli e-posta) ve Ads
 * dosya araçları.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/admin/crm/keywords" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api/crm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/crm")>();
  return {
    ...actual,
    getCrmKeywords: vi.fn(),
    syncSearchConsole: vi.fn(),
    connectSearchConsole: vi.fn(),
    disconnectSearchConsole: vi.fn(),
    importAdsLeads: vi.fn(),
    downloadAdsConversions: vi.fn(),
  };
});

import * as crmApi from "@/lib/api/crm";
import CrmKeywordsPage from "@/app/admin/crm/keywords/page";
import { SearchConsoleCard } from "@/components/admin/crm/search-console-card";
import { AdsTools } from "@/components/admin/crm/ads-tools";

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const baseReport = (connected: boolean): CrmKeywordsReport => ({
  connection: { connected, propertyUrl: connected ? "sc-domain:ornek.com" : null, lastSyncAt: connected ? "2026-10-22T03:00:00.000Z" : null, lastSyncError: null },
  rows: connected
    ? [
        { query: "obezite ameliyatı", position: 2.4, change: 1.5, clicks: 40, impressions: 800, ctr: 5, bestPage: "https://ornek.com/tr/doctors/a", group: "1-3" },
        { query: "gastric sleeve turkey", position: 14.2, change: -3, clicks: 3, impressions: 900, ctr: 0.3, bestPage: null, group: "11-20" },
      ]
    : [],
  groups: { "1-3": connected ? 1 : 0, "4-10": 0, "11-20": connected ? 1 : 0, "21+": 0 },
  total: connected ? 2 : 0,
  previousRange: { from: "2026-08-24", to: "2026-09-22" },
});

const settings = (connected: boolean): CrmSettings =>
  ({
    searchConsole: {
      propertyUrl: connected ? "sc-domain:ornek.com" : null,
      connected,
      clientEmailMasked: connected ? "crm*******@wm.iam.gserviceaccount.com" : null,
      lastSyncAt: null,
      lastSyncError: null,
      initialSyncDone: false,
    },
  }) as CrmSettings;

beforeEach(() => vi.clearAllMocks());

describe("Anahtar Kelimeler", () => {
  it("bağlı değilken kurulum adımları ve ayarlar bağlantısı", async () => {
    vi.mocked(crmApi.getCrmKeywords).mockResolvedValue(baseReport(false));
    wrap(<CrmKeywordsPage />);
    expect(await screen.findByText("Google Search Console bağlı değil")).toBeInTheDocument();
    expect(screen.getByText(/Google Search Console API/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /CRM Ayarları/ })).toHaveAttribute("href", "/admin/crm/settings#search-console");
  });

  it("bağlıyken sıra, değişim okları, gruplar ve şimdi güncelle", async () => {
    vi.mocked(crmApi.getCrmKeywords).mockResolvedValue(baseReport(true));
    vi.mocked(crmApi.syncSearchConsole).mockResolvedValue({ ok: true, from: "a", to: "b", rows: 10, error: null });
    wrap(<CrmKeywordsPage />);
    expect(await screen.findByText("obezite ameliyatı")).toBeInTheDocument();
    expect(screen.getByLabelText("1.5 sıra yükseldi")).toBeInTheDocument();
    expect(screen.getByLabelText("3 sıra düştü")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "11–20 (1)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "1–3 (1)" }));
    await waitFor(() => expect(crmApi.getCrmKeywords).toHaveBeenLastCalledWith(expect.objectContaining({ group: "1-3" })));
    fireEvent.click(screen.getByRole("button", { name: /Şimdi güncelle/ }));
    await waitFor(() => expect(crmApi.syncSearchConsole).toHaveBeenCalled());
  });
});

describe("Search Console kartı", () => {
  it("JSON dosyası okunup mülkle birlikte gönderilir; bağlıyken yalnızca maskeli e-posta görünür", async () => {
    vi.mocked(crmApi.connectSearchConsole).mockResolvedValue(settings(true));
    const json = JSON.stringify({ type: "service_account", client_email: "crm-reader@wm.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----x" });
    const { rerender } = wrap(<SearchConsoleCard settings={settings(false)} />);
    fireEvent.change(screen.getByLabelText("Mülk adresi"), { target: { value: "sc-domain:ornek.com" } });
    const file = new File([json], "key.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("Servis hesabı JSON anahtarı"), { target: { files: [file] } });
    expect(await screen.findByText(/key\.json/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bağla" }));
    await waitFor(() => expect(crmApi.connectSearchConsole).toHaveBeenCalledWith({ propertyUrl: "sc-domain:ornek.com", credentialsJson: json }));

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <SearchConsoleCard settings={settings(true)} />
      </QueryClientProvider>
    );
    expect(screen.getByText("crm*******@wm.iam.gserviceaccount.com")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("PRIVATE KEY");
  });
});

describe("Ads araçları", () => {
  it("CSV içe aktarma ve dönüşüm dosyası indirme", async () => {
    vi.mocked(crmApi.importAdsLeads).mockResolvedValue({ created: 2, skipped: 1, errors: ["Satır 4: ad, e-posta ya da telefon yok — atlandı."] });
    vi.mocked(crmApi.downloadAdsConversions).mockResolvedValue();
    const onImported = vi.fn();
    render(<AdsTools onImported={onImported} />);
    const csv = new File(["Lead ID,Full Name\nL-1,Hans"], "leads.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Google Ads CSV dosyası"), { target: { files: [csv] } });
    await waitFor(() => expect(crmApi.importAdsLeads).toHaveBeenCalledWith("Lead ID,Full Name\nL-1,Hans"));
    expect(await screen.findByText(/2 yeni talep, 1 satır atlandı/)).toBeInTheDocument();
    expect(onImported).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Ads dönüşüm dosyası/ }));
    fireEvent.click(await screen.findByRole("button", { name: "İndir" }));
    await waitFor(() => expect(crmApi.downloadAdsConversions).toHaveBeenCalledWith(expect.objectContaining({ from: expect.any(String), to: expect.any(String) })));
  });
});
