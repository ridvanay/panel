import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SiteSettings } from "@/lib/api/types";

/**
 * Paket AK — panel kontrolleri: `/admin/settings` "Site özellikleri" kartı (iki anahtar, yalnızca ADMIN, mevcut PATCH),
 * `/admin/contact` "çalışma saatlerini göster" anahtarı, sayfa oluşturucu "Ziyaretçiden gizle" ve sayaç "Canlı veri".
 */
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/settings", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/api/settings", () => ({ getSettings: vi.fn(), updateSettings: vi.fn(), getPermissionsMatrix: vi.fn() }));
vi.mock("@/lib/api/pages", () => ({ listPages: vi.fn() }));
vi.mock("@/lib/api/locales", () => ({ listAdminLocales: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/api/contact", () => ({ getAdminContactPage: vi.fn(), updateAdminContactPage: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
let role: string | null = "ADMIN";
vi.mock("@/context/auth-context", () => ({ useAuthOptional: () => (role ? { user: { role } } : null) }));

import AdminSettingsPage from "@/app/admin/settings/page";
import { ContactPageContentCard } from "@/components/admin/contact/contact-page-content-card";
import { BuilderCanvas } from "@/components/admin/page-builder/builder-canvas";
import { CounterBlockEditor, COUNTER_METRIC_OPTIONS } from "@/components/admin/page-builder/blocks/counter-block";
import { I18nProvider } from "@/context/i18n-context";
import type { CounterBlock, PageNode } from "@/lib/page-builder/types";

const settingsApi = await import("@/lib/api/settings");
const pagesApi = await import("@/lib/api/pages");
const contactApi = await import("@/lib/api/contact");

const baseSettings = {
  siteName: "Örnek Site",
  logoUrl: null,
  tagline: null,
  homePageId: null,
  siteTemplate: "SHOWCASE",
  headerLogoHeight: null,
  headerLogoMaxWidth: null,
  shippingFlatFeeCents: null,
  freeShippingThresholdCents: null,
  shippingEstimatedDaysMin: null,
  shippingEstimatedDaysMax: null,
  demoPaymentsEnabled: false,
  demoPaymentsSupported: false,
  bookingNotificationRecipients: null,
  bookingNotificationRecipientsEffective: ["admin@wmhealthistanbul.com"],
} as SiteSettings;

async function renderSettings(extra: Partial<SiteSettings> = {}) {
  vi.mocked(settingsApi.getSettings).mockResolvedValue({ ...baseSettings, ...extra });
  vi.mocked(settingsApi.updateSettings).mockResolvedValue({ ...baseSettings, ...extra });
  vi.mocked(pagesApi.listPages).mockResolvedValue({ items: [], meta: { nextCursor: null } });
  render(
    <I18nProvider>
      <AdminSettingsPage />
    </I18nProvider>
  );
  expect(await screen.findByLabelText(/Site adı/)).toBeInTheDocument();
}

describe("/admin/settings — Site özellikleri kartı", () => {
  beforeEach(() => {
    role = "ADMIN";
    vi.clearAllMocks();
  });

  it("ADMIN: kart, iki anahtar ve kısa açıklama görünür; alan yoksa ikisi de AÇIK", async () => {
    await renderSettings();
    const card = screen.getByTestId("site-features-card");
    expect(within(card).getByRole("heading", { name: "Site özellikleri" })).toBeInTheDocument();
    expect(within(card).getByTestId("switch-find-treatment")).toBeChecked();
    expect(within(card).getByTestId("switch-book-consultation")).toBeChecked();
    expect(card).toHaveTextContent("en geç 60 saniye");
    expect(card).toHaveTextContent("mevcut randevular");
  });

  it("kayıtlı kapalı değerler anahtarlara yansır", async () => {
    await renderSettings({ findTreatmentEnabled: false, bookConsultationCtaEnabled: false });
    expect(screen.getByTestId("switch-find-treatment")).not.toBeChecked();
    expect(screen.getByTestId("switch-book-consultation")).not.toBeChecked();
  });

  it("anahtarı kapatıp kaydet: mevcut PATCH iki alanı gönderir", async () => {
    await renderSettings();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("switch-find-treatment"));
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(settingsApi.updateSettings).toHaveBeenCalled());
    expect(settingsApi.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ findTreatmentEnabled: false, bookConsultationCtaEnabled: true }));
  });

  it("ADMIN dışı rol: kart yok ve PATCH bu alanları göndermez", async () => {
    role = "MANAGER";
    await renderSettings();
    expect(screen.queryByTestId("site-features-card")).toBeNull();
  });
});

describe("/admin/contact — çalışma saatlerini göster anahtarı", () => {
  const adminPage = (hoursVisible?: boolean) => ({
    content: {
      locales: { en: { title: "", intro: "", phone: "", whatsapp: "", email: "", address: "", hours: [{ label: "Pazartesi – Cuma", value: "09:00" }], responseTime: "" } },
      mapImageMediaId: null,
      mapUrl: "",
      ...(hoursVisible === undefined ? {} : { hoursVisible }),
    },
    mapImageUrl: null,
  });

  beforeEach(() => vi.clearAllMocks());

  it("alan yoksa AÇIK; kapatıp kaydedince hoursVisible=false gider, satırlar silinmez", async () => {
    vi.mocked(contactApi.getAdminContactPage).mockResolvedValue(adminPage() as never);
    vi.mocked(contactApi.updateAdminContactPage).mockResolvedValue(adminPage(false) as never);
    render(<ContactPageContentCard />);
    const toggle = await screen.findByTestId("switch-contact-hours-visible");
    expect(toggle).toBeChecked();
    expect(screen.getAllByLabelText("İletişim sayfasında çalışma saatlerini göster")).toContain(toggle);
    const user = userEvent.setup();
    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "İletişim Sayfasını Kaydet" }));
    await waitFor(() => expect(contactApi.updateAdminContactPage).toHaveBeenCalled());
    const sent = vi.mocked(contactApi.updateAdminContactPage).mock.calls[0]![0];
    expect(sent.hoursVisible).toBe(false);
    expect(sent.locales.en?.hours).toHaveLength(1);
  });

  it("kayıtlı false değeri anahtarı kapalı gösterir; harita ipucu adres önceliğini söyler", async () => {
    vi.mocked(contactApi.getAdminContactPage).mockResolvedValue(adminPage(false) as never);
    render(<ContactPageContentCard />);
    expect(await screen.findByTestId("switch-contact-hours-visible")).not.toBeChecked();
    expect(screen.getByText(/Adres doluysa düğme her zaman adresi aratır/)).toBeInTheDocument();
  });
});

describe("sayfa oluşturucu — Ziyaretçiden gizle ve sayaç Canlı veri", () => {
  const text = (id: string, extra: Partial<PageNode> = {}) => ({ id, type: "text", data: { html: "<p>x</p>" }, ...extra }) as PageNode;

  it("blok kartında anahtar var; açınca onChange `hidden: true` yazar, kapatınca alanı kaldırır; gizli blok rozetlenir", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<BuilderCanvas nodes={[text("t1")]} onChange={onChange} selectedContainerId={null} onSelectContainer={vi.fn()} />);
    const toggle = screen.getByTestId("block-hidden-toggle");
    expect(toggle).not.toBeChecked();
    await userEvent.setup().click(toggle);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0][0]).toMatchObject({ id: "t1", hidden: true });

    onChange.mockClear();
    rerender(<BuilderCanvas nodes={[text("t1", { hidden: true })]} onChange={onChange} selectedContainerId={null} onSelectContainer={vi.fn()} />);
    expect(screen.getByText("Gizli")).toBeInTheDocument();
    const on = screen.getByTestId("block-hidden-toggle");
    expect(on).toBeChecked();
    await userEvent.setup().click(on);
    const next = onChange.mock.calls[0]![0][0];
    expect(next).toMatchObject({ id: "t1" });
    expect(next).not.toHaveProperty("hidden");
  });

  it("sayaç öğesinde 'Canlı veri' seçimi: 4 seçenek + 'Elle yazılan değer'; seçim `metric` yazar, boş seçim kaldırır", async () => {
    const block: CounterBlock = { id: "c", type: "counter", data: { items: [{ id: "i1", value: 6, label: "Spoken Language" }] } };
    const onChange = vi.fn();
    const { rerender } = render(<CounterBlockEditor block={block} onChange={onChange} />);
    const select = screen.getByLabelText("Canlı veri") as HTMLSelectElement;
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Elle yazılan değer", ...COUNTER_METRIC_OPTIONS.map((o) => o.label)]);
    await userEvent.setup().selectOptions(select, "visitorLanguages");
    expect(onChange.mock.calls[0]![0].data.items[0]).toMatchObject({ id: "i1", value: 6, metric: "visitorLanguages" });

    onChange.mockClear();
    rerender(<CounterBlockEditor block={{ ...block, data: { items: [{ ...block.data.items[0]!, metric: "visitorLanguages" }] } }} onChange={onChange} />);
    expect((screen.getByLabelText("Canlı veri") as HTMLSelectElement).value).toBe("visitorLanguages");
    await userEvent.setup().selectOptions(screen.getByLabelText("Canlı veri"), "");
    expect(onChange.mock.calls[0]![0].data.items[0].metric).toBeUndefined();
  });
});
