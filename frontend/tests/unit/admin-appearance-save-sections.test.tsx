import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminAppearancePage from "@/app/admin/appearance/page";
import type {
  AppearancePreset,
  NavigationConfigDto,
  Page,
  SiteAppearance,
  SiteCustomCode,
  SitePage,
  SiteSettings,
} from "@/lib/api/types";

/**
 * ARCHITECTURE.md §10.12.9 QA odak noktası — kullanıcının açıkça istediği kapsam:
 * "Her alt bölümün kaydetme/geri yükleme davranışı": değişiklik yap → Kaydet → API'ye DOĞRU
 * payload gidiyor mu (§10.12.9 — "her bölüm yalnızca kendi alanlarını gönderir"), sekmeler arası
 * geçişte kaydedilmemiş değişiklik uyarısı çıkıyor mu, "Tümünü Kaydet" doğru çalışıyor mu, preset
 * seçimi renk/font alanlarını toplu güncelliyor mu, reset ucu doğru çağrılıyor mu, özel CSS/JS
 * `acknowledged` UI kısıtı doğru mu. `a11y-admin-appearance.test.tsx`'in KAPSAMADIĞI (a11y odaklı,
 * payload/davranış doğrulamayan) senaryolar — qa-agent boşluğu.
 */
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/appearance",
}));
vi.mock("@/lib/api/appearance", () => ({
  getAdminAppearance: vi.fn(),
  updateAppearance: vi.fn(),
  getPresets: vi.fn(),
  resetAppearance: vi.fn(),
  getCustomCode: vi.fn(),
  updateCustomCss: vi.fn(),
  updateCustomJs: vi.fn(),
}));
vi.mock("@/lib/api/settings", () => ({ getSettings: vi.fn() }));
vi.mock("@/lib/api/pages", () => ({ listPages: vi.fn() }));
vi.mock("@/lib/api/navigation", () => ({ getNavigationConfig: vi.fn() }));

const appearanceApi = await import("@/lib/api/appearance");
const settingsApi = await import("@/lib/api/settings");
const pagesApi = await import("@/lib/api/pages");
const navigationApi = await import("@/lib/api/navigation");

// Sunucu DEFAULTS'uyla (appearance.routes.ts::DEFAULTS) BİREBİR aynı başlangıç durumu — toggle'ların
// "false→true" gibi net, tek-yönlü bir değişim üretmesi için bilinçli olarak seçildi.
const appearance: SiteAppearance = {
  presetKey: null,
  pageHeaderStyle: "PLAIN",
  pageHeaderLayout: "CENTERED",
  pageHeaderBackgroundColor: null,
  pageHeaderBackgroundMediaId: null,
  pageHeaderBackgroundUrl: null,
  pageHeaderOverlayOpacity: 40,
  primaryColor: "#4f46e5",
  secondaryColor: "#111827",
  buttonColor: "#4f46e5",
  buttonTextColor: "#ffffff",
  linkColor: "#4f46e5",
  accentColor: "#f59e0b",
  backgroundColor: "#ffffff",
  surfaceColor: "#f9fafb",
  textColor: "#111827",
  mutedTextColor: "#6b7280",
  headingFont: "SYSTEM",
  bodyFont: "SYSTEM",
  baseFontSize: 16,
  borderRadius: "MD",
  buttonStyle: "SOLID",
  socialShareEnabled: false,
  socialShareNetworks: [],
  backToTopEnabled: true,
  stickyHeaderEnabled: true,
  cookieBannerEnabled: false,
  cookieBannerText: null,
  cookieBannerPolicyHref: null,
  maintenanceModeEnabled: false,
  maintenanceMessage: null,
  notFoundTitle: null,
  notFoundMessage: null,
  notFoundButtonLabel: null,
  notFoundButtonHref: null,
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const presets: AppearancePreset[] = [
  {
    key: "modern",
    label: "Modern",
    description: "Yüksek kontrastlı, geniş boşluklu, sans-serif.",
    values: {
      primaryColor: "#4f46e5",
      secondaryColor: "#111827",
      buttonColor: "#4f46e5",
      buttonTextColor: "#ffffff",
      linkColor: "#4f46e5",
      headingFont: "INTER",
      bodyFont: "INTER",
      baseFontSize: 16,
    },
  },
  {
    key: "minimal",
    label: "Minimal",
    description: "Yumuşak nötr tonlar, sade tipografi.",
    values: {
      primaryColor: "#0f172a",
      secondaryColor: "#475569",
      buttonColor: "#0f172a",
      buttonTextColor: "#ffffff",
      linkColor: "#0f172a",
      headingFont: "SYSTEM",
      bodyFont: "SYSTEM",
      baseFontSize: 18,
    },
  },
];

const customCode: SiteCustomCode = {
  css: null,
  js: null,
  cssUpdatedAt: null,
  cssUpdatedBy: null,
  jsUpdatedAt: null,
  jsUpdatedBy: null,
  customCodeEnabled: true,
};

const settings: SiteSettings = {
  siteName: "Örnek Site",
  logoUrl: null,
  tagline: "Kaliteli ürünler",
  homePageId: null,
  siteTemplate: "SHOWCASE",
  headerLogoHeight: null,
  headerLogoMaxWidth: null,
};

const navConfig: NavigationConfigDto = {
  headerCtaLabel: null,
  headerCtaHref: null,
  footerCopyrightText: null,
  navigationItems: [{ id: "nav-1", label: "Anasayfa", href: "/", order: 0, parentId: null }],
  socialLinks: [],
  footerColumns: [],
};

const pagesPage: Page<SitePage> = { items: [], meta: { nextCursor: null } };

function mockLoad(overrides?: Partial<SiteAppearance>) {
  vi.mocked(appearanceApi.getAdminAppearance).mockResolvedValue({ ...appearance, ...overrides });
  vi.mocked(appearanceApi.getPresets).mockResolvedValue(presets);
  vi.mocked(appearanceApi.getCustomCode).mockResolvedValue(customCode);
  vi.mocked(settingsApi.getSettings).mockResolvedValue(settings);
  vi.mocked(pagesApi.listPages).mockResolvedValue(pagesPage);
  vi.mocked(navigationApi.getNavigationConfig).mockResolvedValue(navConfig);
}

async function goToTab(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(screen.getByRole("tab", { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AdminAppearancePage — Logo & Marka (salt-okunur özet)", () => {
  it("Navigasyon'a derin link ?tab=locations ile verir, Kaydet düğmesi YOKTUR", async () => {
    mockLoad();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");
    expect(screen.getByRole("link", { name: /Navigasyon'da Düzenle/ })).toHaveAttribute(
      "href",
      "/admin/navigation?tab=locations"
    );
    expect(screen.queryByRole("button", { name: "Bu bölümü kaydet" })).not.toBeInTheDocument();
  });
});

describe("AdminAppearancePage — bölüm başına Kaydet payload'ları (PATCH /admin/appearance)", () => {
  it("'Stil / Renk': bir rengi elle değiştirmek presetKey'i null'a düşürür ve YALNIZCA colors alanlarını gönderir", async () => {
    mockLoad({ presetKey: "modern" });
    vi.mocked(appearanceApi.updateAppearance).mockResolvedValue({ ...appearance, presetKey: null, primaryColor: "#112233" });
    const user = userEvent.setup();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");
    await goToTab(user, /Stil \/ Renk/);

    const primaryHex = screen.getByLabelText("Birincil Renk — hex kod");
    await user.clear(primaryHex);
    await user.type(primaryHex, "#112233");

    await user.click(screen.getByRole("button", { name: "Bu bölümü kaydet" }));

    await waitFor(() => expect(appearanceApi.updateAppearance).toHaveBeenCalledTimes(1));
    expect(appearanceApi.updateAppearance).toHaveBeenCalledWith({
      presetKey: null,
      primaryColor: "#112233",
      secondaryColor: "#111827",
      buttonColor: "#4f46e5",
      buttonTextColor: "#ffffff",
      linkColor: "#4f46e5",
      accentColor: "#f59e0b",
      backgroundColor: "#ffffff",
      surfaceColor: "#f9fafb",
      textColor: "#111827",
      mutedTextColor: "#6b7280",
      borderRadius: "MD",
      buttonStyle: "SOLID",
    });
  });

  it("'Sayfa Başlığı Düzeni': BANNER seçmek yalnızca pageHeader alanlarını gönderir", async () => {
    mockLoad();
    vi.mocked(appearanceApi.updateAppearance).mockResolvedValue({ ...appearance, pageHeaderStyle: "BANNER" });
    const user = userEvent.setup();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");
    await goToTab(user, /Sayfa Başlığı Düzeni/);

    await user.click(screen.getByRole("radio", { name: /Banner/ }));
    await user.click(screen.getByRole("button", { name: "Bu bölümü kaydet" }));

    await waitFor(() => expect(appearanceApi.updateAppearance).toHaveBeenCalledTimes(1));
    expect(appearanceApi.updateAppearance).toHaveBeenCalledWith({
      pageHeaderStyle: "BANNER",
      pageHeaderLayout: "CENTERED",
      pageHeaderBackgroundColor: "#ffffff",
      pageHeaderBackgroundMediaId: null,
      pageHeaderOverlayOpacity: 40,
    });
  });

  it("'Sosyal Medya Paylaşımı': switch açmak yalnızca social alanlarını gönderir", async () => {
    mockLoad();
    vi.mocked(appearanceApi.updateAppearance).mockResolvedValue({ ...appearance, socialShareEnabled: true });
    const user = userEvent.setup();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");
    await goToTab(user, /Sosyal Medya Paylaşımı/);

    await user.click(screen.getByRole("switch", { name: "Paylaşım butonlarını göster" }));
    await user.click(screen.getByRole("button", { name: "Bu bölümü kaydet" }));

    await waitFor(() => expect(appearanceApi.updateAppearance).toHaveBeenCalledTimes(1));
    expect(appearanceApi.updateAppearance).toHaveBeenCalledWith({
      socialShareEnabled: true,
      socialShareNetworks: [],
    });
  });

  it("'Yazı Tipi': başlık fontunu değiştirmek presetKey'i null'a düşürür ve YALNIZCA typography alanlarını gönderir", async () => {
    mockLoad({ presetKey: "modern" });
    vi.mocked(appearanceApi.updateAppearance).mockResolvedValue({ ...appearance, presetKey: null, headingFont: "ROBOTO" });
    const user = userEvent.setup();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");
    await goToTab(user, /Yazı Tipi/);

    const headingGroup = screen.getByRole("radiogroup", { name: "Başlık fontu" });
    await user.click(within(headingGroup).getByRole("radio", { name: /Roboto/ }));
    await user.click(screen.getByRole("button", { name: "Bu bölümü kaydet" }));

    await waitFor(() => expect(appearanceApi.updateAppearance).toHaveBeenCalledTimes(1));
    expect(appearanceApi.updateAppearance).toHaveBeenCalledWith({
      presetKey: null,
      headingFont: "ROBOTO",
      bodyFont: "SYSTEM",
      baseFontSize: 16,
    });
  });

  it("'Ekstra Özellikler': Yukarı Çık Butonu'nu kapatmak yalnızca features alanlarını gönderir (boş metinler null olur)", async () => {
    mockLoad();
    vi.mocked(appearanceApi.updateAppearance).mockResolvedValue({ ...appearance, backToTopEnabled: false });
    const user = userEvent.setup();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");
    await goToTab(user, /Ekstra Özellikler/);

    await user.click(screen.getByRole("switch", { name: "Yukarı Çık Butonu" }));
    await user.click(screen.getByRole("button", { name: "Bu bölümü kaydet" }));

    await waitFor(() => expect(appearanceApi.updateAppearance).toHaveBeenCalledTimes(1));
    expect(appearanceApi.updateAppearance).toHaveBeenCalledWith({
      backToTopEnabled: false,
      stickyHeaderEnabled: true,
      cookieBannerEnabled: false,
      cookieBannerText: null,
      cookieBannerPolicyHref: null,
      maintenanceModeEnabled: false,
      maintenanceMessage: null,
    });
  });

  it("'404 Sayfası': başlık girmek yalnızca notFound alanlarını gönderir (dokunulmamış alanlar null)", async () => {
    mockLoad();
    vi.mocked(appearanceApi.updateAppearance).mockResolvedValue({ ...appearance, notFoundTitle: "Aradığınız Sayfa Yok" });
    const user = userEvent.setup();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");
    await goToTab(user, /404 Sayfası/);

    await user.type(screen.getByLabelText("Başlık"), "Aradığınız Sayfa Yok");
    await user.click(screen.getByRole("button", { name: "Bu bölümü kaydet" }));

    await waitFor(() => expect(appearanceApi.updateAppearance).toHaveBeenCalledTimes(1));
    expect(appearanceApi.updateAppearance).toHaveBeenCalledWith({
      notFoundTitle: "Aradığınız Sayfa Yok",
      notFoundMessage: null,
      notFoundButtonLabel: null,
      notFoundButtonHref: null,
    });
  });

  it("'Tasarım Ön Ayarları': bir preset seçmek renk/font alanlarını TOPLU günceller ve o alt kümeyi gönderir", async () => {
    mockLoad();
    vi.mocked(appearanceApi.updateAppearance).mockResolvedValue({ ...appearance, presetKey: "minimal" });
    const user = userEvent.setup();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");
    await goToTab(user, /Tasarım Ön Ayarları/);

    await user.click(screen.getByRole("radio", { name: /Minimal/ }));
    await user.click(screen.getByRole("button", { name: "Bu bölümü kaydet" }));

    await waitFor(() => expect(appearanceApi.updateAppearance).toHaveBeenCalledTimes(1));
    expect(appearanceApi.updateAppearance).toHaveBeenCalledWith({
      presetKey: "minimal",
      primaryColor: "#0f172a",
      secondaryColor: "#475569",
      buttonColor: "#0f172a",
      buttonTextColor: "#ffffff",
      linkColor: "#0f172a",
      // Mock preset'in `values` alanı yeni 5 rengi/borderRadius/buttonStyle'ı TAŞIMIYOR — `applyPreset`
      // bu durumda mevcut form değerine (yüklenen `appearance` fixture'ının varsayılanlarına) düşer.
      accentColor: "#f59e0b",
      backgroundColor: "#ffffff",
      surfaceColor: "#f9fafb",
      textColor: "#111827",
      mutedTextColor: "#6b7280",
      headingFont: "SYSTEM",
      bodyFont: "SYSTEM",
      baseFontSize: 18,
      borderRadius: "MD",
      buttonStyle: "SOLID",
    });
  });
});

describe("AdminAppearancePage — sekme değişimi kaydedilmemiş değişiklik uyarısı (§10.12.8)", () => {
  it("bir bölümde kaydedilmemiş değişiklik varken başka sekmeye geçilirse onay istenir; iptal edilirse sekme değişmez", async () => {
    mockLoad();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");
    await goToTab(user, /Ekstra Özellikler/);
    await user.click(screen.getByRole("switch", { name: "Yukarı Çık Butonu" }));

    await goToTab(user, /Yazı Tipi/);

    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: /Ekstra Özellikler/ })).toHaveAttribute("aria-selected", "true");

    confirmSpy.mockRestore();
  });

  it("onay verilirse sekme değişir ve kirli sekmede uyarı noktası (DirtyDot) görünür", async () => {
    mockLoad();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");
    await goToTab(user, /Ekstra Özellikler/);
    await user.click(screen.getByRole("switch", { name: "Yukarı Çık Butonu" }));

    const featuresTab = screen.getByRole("tab", { name: /Ekstra Özellikler/ });
    expect(within(featuresTab).getByText("", { selector: "span.bg-warning" })).toBeInTheDocument();

    await goToTab(user, /Yazı Tipi/);
    expect(screen.getByRole("tab", { name: /Yazı Tipi/ })).toHaveAttribute("aria-selected", "true");

    confirmSpy.mockRestore();
  });

  it("kaydedilmemiş değişiklik yokken sekme değişiminde window.confirm HİÇ çağrılmaz", async () => {
    mockLoad();
    const confirmSpy = vi.spyOn(window, "confirm");
    const user = userEvent.setup();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");
    await goToTab(user, /Yazı Tipi/);

    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe("AdminAppearancePage — 'Tümünü Kaydet' yapışkan çubuğu", () => {
  it("'Kaydedilmemiş değişiklikler var' uyarısı dirty iken görünür ve 'Tümünü Kaydet' TEK istek atar", async () => {
    mockLoad();
    vi.mocked(appearanceApi.updateAppearance).mockResolvedValue(appearance);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");

    await goToTab(user, /Stil \/ Renk/);
    const primaryHex = screen.getByLabelText("Birincil Renk — hex kod");
    await user.clear(primaryHex);
    await user.type(primaryHex, "#000000");

    expect(screen.getByText("Kaydedilmemiş değişiklikler var")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tümünü Kaydet" }));

    await waitFor(() => expect(appearanceApi.updateAppearance).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(appearanceApi.updateAppearance).mock.calls[0][0];
    // Tam gövde — 9 bölümden 8'inin (`brand` hariç) BİRLEŞİMİ (presetKey dahil, çünkü hem
    // `colors` hem `typography` hem `presets` bunu taşır — bkz. SECTION_FIELDS).
    expect(payload).toMatchObject({
      presetKey: null,
      primaryColor: "#000000",
      pageHeaderStyle: "PLAIN",
      socialShareEnabled: false,
      backToTopEnabled: true,
      notFoundTitle: null,
    });
    expect(Object.keys(payload).sort()).toEqual(
      [
        "presetKey",
        "pageHeaderStyle",
        "pageHeaderLayout",
        "pageHeaderBackgroundColor",
        "pageHeaderBackgroundMediaId",
        "pageHeaderOverlayOpacity",
        "primaryColor",
        "secondaryColor",
        "buttonColor",
        "buttonTextColor",
        "linkColor",
        "accentColor",
        "backgroundColor",
        "surfaceColor",
        "textColor",
        "mutedTextColor",
        "borderRadius",
        "buttonStyle",
        "socialShareEnabled",
        "socialShareNetworks",
        "headingFont",
        "bodyFont",
        "baseFontSize",
        "backToTopEnabled",
        "stickyHeaderEnabled",
        "cookieBannerEnabled",
        "cookieBannerText",
        "cookieBannerPolicyHref",
        "maintenanceModeEnabled",
        "maintenanceMessage",
        "notFoundTitle",
        "notFoundMessage",
        "notFoundButtonLabel",
        "notFoundButtonHref",
      ].sort()
    );

    confirmSpy.mockRestore();
  });

  it("dirty durum yokken 'Kaydedilmemiş değişiklikler var' uyarısı GÖRÜNMEZ", async () => {
    mockLoad();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");
    expect(screen.queryByText("Kaydedilmemiş değişiklikler var")).not.toBeInTheDocument();
  });
});

describe("AdminAppearancePage — Reset davranışı (§10.12.3 — reset scoped to color/typography only)", () => {
  it("'Fabrika Ayarlarına Sıfırla' → onay diyaloğu açılır → 'Sıfırla' ile POST /admin/appearance/reset çağrılır (presetKey GÖNDERİLMEZ, fabrika DEFAULTS'u istenir)", async () => {
    mockLoad({ presetKey: "modern", primaryColor: "#ff0000" });
    vi.mocked(appearanceApi.resetAppearance).mockResolvedValue({ ...appearance, presetKey: null, primaryColor: "#4f46e5" });
    const user = userEvent.setup();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");
    await goToTab(user, /Tasarım Ön Ayarları/);

    await user.click(screen.getByRole("button", { name: "Fabrika Ayarlarına Sıfırla" }));

    const dialog = await screen.findByRole("dialog", { name: "Görünümü fabrika ayarlarına döndür" });
    expect(within(dialog).getByText(/Özel CSS\/JS ve diğer ayarlar ETKİLENMEZ/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Sıfırla" }));

    await waitFor(() => expect(appearanceApi.resetAppearance).toHaveBeenCalledTimes(1));
    // `handleReset` presetKey seçmeden çağrılır — bu "fabrikaya sıfırla" akışıdır (belirli bir
    // preset uygulamak değil), backend'de presetKey verilmezse fabrika DEFAULTS'una döner
    // (bkz. appearance.routes.ts::POST /reset, backend.test.ts satır 217).
    expect(appearanceApi.resetAppearance).toHaveBeenCalledWith();

    // Dönen DTO form'a yansımalı.
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Görünümü fabrika ayarlarına döndür" })).not.toBeInTheDocument();
    });
  });
});

describe("AdminAppearancePage — Özel CSS/JS güvenlik kısıtlaması (§10.12.6)", () => {
  it("JS textarea'sına kod yazınca 'anladım' checkbox'ı işaretlenmeden Kaydet butonu DISABLED'dır", async () => {
    mockLoad();
    const user = userEvent.setup();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");
    await goToTab(user, /Özel CSS \/ JS/);

    const jsTextarea = screen.getByLabelText("Özel JS");
    await user.type(jsTextarea, "console.log(1)");

    expect(screen.getByRole("button", { name: "JS'i Kaydet" })).toBeDisabled();
  });

  it("checkbox işaretlenince Kaydet ENABLED olur ve acknowledged: true ile PUT çağrılır", async () => {
    mockLoad();
    vi.mocked(appearanceApi.updateCustomJs).mockResolvedValue({ ...customCode, js: "console.log(1)" });
    const user = userEvent.setup();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");
    await goToTab(user, /Özel CSS \/ JS/);

    const jsTextarea = screen.getByLabelText("Özel JS");
    await user.type(jsTextarea, "console.log(1)");

    const acknowledgeCheckboxes = screen.getAllByRole("checkbox", {
      name: "Bu kodun ne yaptığını anlıyorum ve sonuçlarını kabul ediyorum.",
    });
    // Sayfa hem CSS hem JS için AYNI etiketle bir checkbox render eder — JS kartındaki ikincisi.
    const jsCheckbox = acknowledgeCheckboxes[1];
    await user.click(jsCheckbox);

    const saveButton = screen.getByRole("button", { name: "JS'i Kaydet" });
    expect(saveButton).not.toBeDisabled();
    await user.click(saveButton);

    await waitFor(() => expect(appearanceApi.updateCustomJs).toHaveBeenCalledTimes(1));
    expect(appearanceApi.updateCustomJs).toHaveBeenCalledWith({ js: "console.log(1)", acknowledged: true });
  });

  it("CSS için de AYNI kural geçerlidir — checkbox işaretlenmeden Kaydet DISABLED'dır", async () => {
    mockLoad();
    const user = userEvent.setup();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");
    await goToTab(user, /Özel CSS \/ JS/);

    const cssTextarea = screen.getByLabelText("Özel CSS");
    // `{`/`}` user-event.type'ta özel tuş sözdizimidir (bkz. keyboard API dokümantasyonu) —
    // gerçek bir CSS gövdesi için doğrudan `fireEvent.change` kullanılır.
    fireEvent.change(cssTextarea, { target: { value: "body { color: red; }" } });

    expect(screen.getByRole("button", { name: "CSS'i Kaydet" })).toBeDisabled();
  });

  it("textarea BOŞKEN (kod kaldırılırken) Kaydet checkbox işaretlenmeden de ENABLED'dır — 'kod kaldırmak her zaman güvenlidir'", async () => {
    mockLoad({});
    const user = userEvent.setup();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");
    await goToTab(user, /Özel CSS \/ JS/);

    // Başlangıçta customCode.css/js null → textarea zaten boş, checkbox işaretlenmemiş.
    expect(screen.getByRole("button", { name: "CSS'i Kaydet" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "JS'i Kaydet" })).not.toBeDisabled();
  });

  it("kill switch KAPALIYKEN (customCodeEnabled: false) textarea ve checkbox DISABLED'dır, bilgilendirme mesajı gösterilir", async () => {
    mockLoad();
    vi.mocked(appearanceApi.getCustomCode).mockResolvedValue({ ...customCode, customCodeEnabled: false });
    const user = userEvent.setup();
    render(<AdminAppearancePage />);

    await screen.findAllByText("Örnek Site");
    await goToTab(user, /Özel CSS \/ JS/);

    expect(screen.getByText(/Özel kod düzenleme şu anda ortam tarafından devre dışı bırakılmış/)).toBeInTheDocument();
    expect(screen.getByLabelText("Özel CSS")).toBeDisabled();
    expect(screen.getByLabelText("Özel JS")).toBeDisabled();
    expect(screen.getByRole("button", { name: "CSS'i Kaydet" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "JS'i Kaydet" })).toBeDisabled();
  });
});
