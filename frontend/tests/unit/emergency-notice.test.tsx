import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { EmergencyNoticeCard, EmergencyNoticeStrip } from "@/components/site/telehealth/emergency-notice";
import { EmergencyNoticeSettingsCard } from "@/components/admin/telehealth/emergency-notice-settings";
import { hasRequiredKeyword, resolveEmergencyNotice, validateEmergencyNoticeText } from "@/lib/emergency-notice";
import { telehealthStrings as en } from "@/lib/i18n/site-dictionaries/en/telehealth";
import { telehealthStrings as tr } from "@/lib/i18n/site-dictionaries/tr/telehealth";

const updateEmergencyNoticeSettings = vi.fn();
vi.mock("@/lib/api/telehealth", () => ({
  updateEmergencyNoticeSettings: (...args: unknown[]) => updateEmergencyNoticeSettings(...args),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const THEME = { primaryColor: "#000000", secondaryColor: "#000000", accentColor: "#000000", calendarActiveBg: "#000000" };

describe("resolveEmergencyNotice", () => {
  it("ayar yoksa şerit AÇIK ve sözlük varsayılanları", () => {
    const r = resolveEmergencyNotice(undefined, "en", en);
    expect(r).toMatchObject({ stripEnabled: true, summary: en.emergencyNoticeSummary, full: en.emergencyNoticeFull });
  });

  it("yalnızca enabled=false şeridi kapatır; admin metni o dilde varsa kullanılır", () => {
    const settings = { emergencyNotice: { enabled: false, summary: { tr: "Özel özet metni" }, full: {} } };
    const r = resolveEmergencyNotice(settings, "tr", tr);
    expect(r.stripEnabled).toBe(false);
    expect(r.summary).toBe("Özel özet metni");
    expect(r.full).toBe(tr.emergencyNoticeFull);
    expect(resolveEmergencyNotice(settings, "en", en).summary).toBe(en.emergencyNoticeSummary);
  });

  it("varsayılan metinler karakter sınırları ve anahtar kelime kuralı içinde", () => {
    for (const [locale, dict] of [["en", en], ["tr", tr]] as const) {
      expect(validateEmergencyNoticeText(dict.emergencyNoticeSummary, "summary", locale)).toBeNull();
      expect(validateEmergencyNoticeText(dict.emergencyNoticeFull, "full", locale)).toBeNull();
    }
  });

  it("EN 'emergency', TR 'acil' içermeli (harf duyarsız); diğer dillerde kontrol yok", () => {
    expect(validateEmergencyNoticeText("Please call your doctor first.", "summary", "en")).toMatch(/"emergency" kelimesini/);
    expect(validateEmergencyNoticeText("Lütfen önce doktorunuzu arayın.", "summary", "tr")).toMatch(/"acil" kelimesini/);
    expect(validateEmergencyNoticeText("EMERGENCY: call 112 now.", "summary", "en")).toBeNull();
    expect(hasRequiredKeyword("tr", "ACİL DURUM")).toBe(true);
    expect(hasRequiredKeyword("tr", "ACIL DURUM")).toBe(true);
    expect(validateEmergencyNoticeText("Nicht für Notfälle gedacht.", "summary", "de")).toBeNull();
  });

  it("boş / kısa / uzun / HTML metni reddeder", () => {
    expect(validateEmergencyNoticeText("   ", "summary")).toMatch(/boş/);
    expect(validateEmergencyNoticeText("kısa", "summary")).toMatch(/En az 10/);
    expect(validateEmergencyNoticeText("x".repeat(91), "summary")).toMatch(/En fazla 90/);
    expect(validateEmergencyNoticeText("x".repeat(300), "full")).toBeNull();
    expect(validateEmergencyNoticeText("x".repeat(301), "full")).toMatch(/En fazla 300/);
    expect(validateEmergencyNoticeText("<b>Acil durum uyarısı</b>", "summary")).toMatch(/HTML/);
  });
});

describe("EmergencyNoticeStrip", () => {
  it("kapalı başlar, düğme özet ↔ tam metin arasında geçiş yapar (a11y öznitelikleriyle)", () => {
    render(<EmergencyNoticeStrip summary="Kısa özet" full="Uzun tam metin" showDetailsLabel="Details" hideDetailsLabel="Hide details" />);
    const note = screen.getByRole("note");
    const button = within(note).getByRole("button", { name: "Details" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    const controlled = document.getElementById(button.getAttribute("aria-controls")!);
    expect(controlled).toHaveTextContent("Kısa özet");
    expect(button.className).toContain("min-h-11");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveTextContent("Hide details");
    expect(controlled).toHaveTextContent("Uzun tam metin");
    expect(screen.queryByText("Kısa özet")).toBeNull();
  });
});

describe("EmergencyNoticeCard", () => {
  it("her zaman tam metinle, düğmesiz gösterilir", () => {
    render(<EmergencyNoticeCard text={tr.emergencyNoticeFull} />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(tr.emergencyNoticeFull);
    expect(within(note).queryByRole("button")).toBeNull();
  });
});

describe("EmergencyNoticeSettingsCard", () => {
  beforeEach(() => updateEmergencyNoticeSettings.mockReset());

  const defaults = { enabled: true, summary: {}, full: {} };

  it("ADMIN olmayan için salt okunur", () => {
    render(<EmergencyNoticeSettingsCard settings={defaults} canEdit={false} onSaved={vi.fn()} />);
    expect(screen.getByText(/yalnızca Yönetici \(ADMIN\)/)).toBeInTheDocument();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByLabelText(/Özet/, { selector: "#emergency-notice-tr-summary" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Metinleri Kaydet" })).toBeNull();
  });

  it("alanlar varsayılan metinle dolu gelir; boş metin kaydedilmez", async () => {
    render(<EmergencyNoticeSettingsCard settings={defaults} canEdit onSaved={vi.fn()} />);
    const trSummary = document.getElementById("emergency-notice-tr-summary") as HTMLInputElement;
    expect(trSummary.value).toBe(tr.emergencyNoticeSummary);
    fireEvent.change(trSummary, { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Metinleri Kaydet" }));
    expect(await screen.findByText("Bu alan boş bırakılamaz.")).toBeInTheDocument();
    expect(updateEmergencyNoticeSettings).not.toHaveBeenCalled();
  });

  it("anahtar kelimesiz metin anlaşılır hatayla kaydedilmez", async () => {
    render(<EmergencyNoticeSettingsCard settings={defaults} canEdit onSaved={vi.fn()} />);
    fireEvent.change(document.getElementById("emergency-notice-en-full")!, {
      target: { value: "This platform does not replace urgent medical care at all." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Metinleri Kaydet" }));
    expect(await screen.findByText(/"emergency" kelimesini içermelidir/)).toBeInTheDocument();
    expect(updateEmergencyNoticeSettings).not.toHaveBeenCalled();
  });

  it("anahtar açıklaması görüşme ekranı ve doktor kartının açık kaldığını söyler", () => {
    render(<EmergencyNoticeSettingsCard settings={defaults} canEdit onSaved={vi.fn()} />);
    expect(screen.getByText(/Görüşme ekranındaki\s+şerit ve doktor detay sayfasında/)).toBeInTheDocument();
  });

  it("yalnızca değişen alanı gönderir", async () => {
    const onSaved = vi.fn();
    updateEmergencyNoticeSettings.mockResolvedValue({
      ...THEME,
      emergencyNotice: { enabled: true, summary: { en: "Custom emergency text" }, full: {} },
    });
    render(<EmergencyNoticeSettingsCard settings={defaults} canEdit onSaved={onSaved} />);
    fireEvent.change(document.getElementById("emergency-notice-en-summary")!, { target: { value: "Custom emergency text " } });
    fireEvent.click(screen.getByRole("button", { name: "Metinleri Kaydet" }));
    await waitFor(() => expect(updateEmergencyNoticeSettings).toHaveBeenCalledWith({ summary: { en: "Custom emergency text" } }));
    expect(onSaved).toHaveBeenCalledWith({ enabled: true, summary: { en: "Custom emergency text" }, full: {} });
  });

  it("anahtarı kapatmak onay ister, onaydan sonra enabled=false gönderir", async () => {
    updateEmergencyNoticeSettings.mockResolvedValue({ ...THEME, emergencyNotice: { enabled: false, summary: {}, full: {} } });
    render(<EmergencyNoticeSettingsCard settings={defaults} canEdit onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(updateEmergencyNoticeSettings).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Şeridi Kapat" }));
    await waitFor(() => expect(updateEmergencyNoticeSettings).toHaveBeenCalledWith({ enabled: false }));
  });

  it("varsayılana dön o dilin metinlerini null ile siler", async () => {
    updateEmergencyNoticeSettings.mockResolvedValue({ ...THEME, emergencyNotice: defaults });
    render(
      <EmergencyNoticeSettingsCard settings={{ enabled: true, summary: { tr: "Özel özet metni" }, full: {} }} canEdit onSaved={vi.fn()} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Varsayılana dön/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Varsayılana Dön" }));
    await waitFor(() => expect(updateEmergencyNoticeSettings).toHaveBeenCalledWith({ summary: { tr: null }, full: { tr: null } }));
  });
});
