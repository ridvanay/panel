import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** Paket X — admin: paket formu, destinasyon, iletişim kanalları, CRM paket paneli, sidebar. */
const { api } = vi.hoisted(() => ({ api: { getContactChannelsSettings: vi.fn(), updateContactChannelsSettings: vi.fn() } }));
vi.mock("@/lib/api/admin-packages", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/admin-packages")>("@/lib/api/admin-packages");
  return { ...actual, ...api };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/admin/media/media-select-field", () => ({ MediaSelectField: () => <div data-testid="media-field" /> }));

import { PackageForm } from "@/components/admin/packages/package-form";
import { DestinationForm } from "@/components/admin/destinations/destination-form";
import { ContactChannelsSettingsCard, validateContactChannels } from "@/components/admin/telehealth/contact-channels-settings";
import { PackageInquiryCard } from "@/components/admin/crm/package-inquiry-card";
import {
  MAX_TOP_TREATMENTS,
  addTreatment,
  buildDestinationBody,
  buildPackageBody,
  emptyDestinationForm,
  emptyPackageForm,
  emptyPackageLocale,
  validatePackageForm,
} from "@/components/admin/packages/package-form-helpers";
import { filterVisibleNavItems, navItems } from "@/components/admin/sidebar";
import { CRM_LEAD_CHANNEL_OPTIONS, leadChannelLabel } from "@/lib/api/crm";

const LOCALES = [] as never[]; // sekmesiz: yalnızca EN (kanonik) görünür

beforeEach(() => {
  vi.clearAllMocks();
  api.getContactChannelsSettings.mockResolvedValue({ whatsappEnabled: false, whatsappNumber: null, coordinatorEmail: null, whatsappMessages: {} });
});

describe("Paket formu gövdesi", () => {
  it("sözleşme alanlarını üretir; boş dilleri atar, satırları diziye çevirir", () => {
    const form = emptyPackageForm();
    form.slug = " executive-check-up ";
    form.locales = {
      en: { ...emptyPackageLocale(), title: "Executive", includes: "Blood test\n\n MRI \n", faq: [{ question: "Q?", answer: "A" }, { question: "yarım", answer: "" }] },
      de: emptyPackageLocale(),
    };
    form.priceFrom = "1490";
    form.showPrice = true;
    form.specialtyIds = ["s2", "s1"];
    const body = buildPackageBody(form);
    expect(Object.keys(body.translations)).toEqual(["en"]);
    expect(body.translations.en.includes).toEqual(["Blood test", "MRI"]);
    expect(body.translations.en.faq).toEqual([{ question: "Q?", answer: "A" }]);
    expect(body).toMatchObject({
      slug: "executive-check-up",
      category: "check-up",
      coverMediaId: null,
      priceFrom: 1490,
      currency: "EUR",
      showPrice: true,
      relatedSpecialtyIds: ["s2", "s1"],
      relatedDoctorIds: [],
      isActive: false,
      isFeatured: false,
      sortOrder: 0,
    });
  });

  it("showPrice açıkken priceFrom yoksa istemci hatası verir", () => {
    const form = emptyPackageForm();
    form.slug = "a-b";
    form.locales = { en: { ...emptyPackageLocale(), title: "T" } };
    form.showPrice = true;
    expect(validatePackageForm(form).priceFrom).toMatch(/zorunlu/);
    form.priceFrom = "100";
    expect(validatePackageForm(form).priceFrom).toBeUndefined();
  });

  it("formda fiyat gösterimi açık + fiyat boşken gönderilmez, uyarı çıkar", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<PackageForm pkg={null} locales={LOCALES} specialtyOptions={[]} doctorOptions={[]} saving={false} onSubmit={onSubmit} onCancel={() => {}} />);
    await user.type(screen.getByLabelText(/Slug/), "my-package");
    await user.type(screen.getByLabelText(/^Başlık/), "My package");
    await user.click(screen.getByRole("switch", { name: "Fiyatı sitede göster" }));
    await user.click(screen.getByRole("button", { name: "Ekle" }));
    expect(await screen.findByText(/“başlangıç fiyatı” zorunludur/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/Başlangıç fiyatı/), "990");
    await user.click(screen.getByRole("button", { name: "Ekle" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ showPrice: true, priceFrom: 990, isActive: false });
  });
});

describe("Destinasyon", () => {
  it("en çok 3 tedavi eklenir ve gövde 3'ü aşmaz", () => {
    let t = [] as ReturnType<typeof addTreatment>;
    for (let i = 0; i < 5; i++) t = addTreatment(t);
    expect(t).toHaveLength(MAX_TOP_TREATMENTS);
    const form = emptyDestinationForm();
    form.treatments = [...t, { label: { en: "x" }, priceFrom: "", currency: "EUR" }].map((x, i) => ({ ...x, label: { en: `T${i}` } }));
    expect(buildDestinationBody(form).topTreatments).toHaveLength(3);
  });

  it("formda 3 tedaviden sonra ekle düğmesi devre dışı; boş hasta sayısı null gider", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<DestinationForm destination={null} locales={LOCALES} saving={false} onSubmit={onSubmit} onCancel={() => {}} />);
    const add = screen.getByRole("button", { name: /Tedavi ekle/ });
    for (let i = 0; i < 3; i++) await user.click(add);
    expect(add).toBeDisabled();
    expect(screen.getAllByLabelText(/Tedavi \d adı/)).toHaveLength(3);
    expect(screen.getByText(/boş bırakılan alanlar sitede gösterilmez/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Şehir/), "Istanbul");
    await user.type(screen.getByLabelText(/Slug/), "istanbul");
    await user.type(screen.getByLabelText(/^Başlık/), "Istanbul");
    await user.click(screen.getByRole("button", { name: "Ekle" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ patientCountLastYear: null, dataPeriodLabel: null, showPrices: false, isActive: false, topTreatments: [] });
  });
});

describe("İletişim kanalları", () => {
  it("açıkken numara zorunlu ve E.164 doğrulanır", () => {
    const base = { whatsappEnabled: true, whatsappNumber: "", coordinatorEmail: "", whatsappMessages: {} };
    expect(validateContactChannels(base).whatsappNumber).toMatch(/zorunlu/);
    expect(validateContactChannels({ ...base, whatsappNumber: "0555 123" }).whatsappNumber).toMatch(/uluslararası/);
    expect(validateContactChannels({ ...base, whatsappNumber: "+905551234567" }).whatsappNumber).toBeUndefined();
    expect(validateContactChannels({ ...base, whatsappEnabled: false }).whatsappNumber).toBeUndefined();
    expect(validateContactChannels({ ...base, whatsappNumber: "+905551234567", whatsappMessages: { en: "Hi {name}" } }).whatsappMessages).toMatch(/yer tutucusu/);
  });

  it("kartta numarasız açma kaydedilmez; geçerli numara PUT edilir", async () => {
    const user = userEvent.setup();
    api.updateContactChannelsSettings.mockImplementation(async (b: unknown) => b);
    render(<ContactChannelsSettingsCard canEdit />);
    await user.click(await screen.findByRole("switch", { name: "WhatsApp düğmesini göster" }));
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(await screen.findByText(/numara zorunludur/)).toBeInTheDocument();
    expect(api.updateContactChannelsSettings).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/WhatsApp numarası/), "+905551234567");
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() =>
      expect(api.updateContactChannelsSettings).toHaveBeenCalledWith({ whatsappEnabled: true, whatsappNumber: "+905551234567", coordinatorEmail: null, whatsappMessages: {} }),
    );
  });

  it("canEdit=false iken alanlar ve Kaydet devre dışı", async () => {
    render(<ContactChannelsSettingsCard canEdit={false} />);
    expect(await screen.findByLabelText(/WhatsApp numarası/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Kaydet" })).toBeDisabled();
  });
});

describe("CRM paket paneli", () => {
  const inquiry = {
    number: 7,
    packageId: "p1",
    packageSlug: "check-up",
    packageTitle: "Executive Check-up",
    preferredDates: "1-5 Mart",
    travellers: 2,
    note: null as string | null,
    consentContactAt: "2026-10-30T10:00:00.000Z",
    consentHealthAt: null,
    anonymizedAt: null as string | null,
  };

  it("not yokken not bölümü yok; paket bağlantısı var", () => {
    render(<PackageInquiryCard leadId="l1" inquiry={inquiry} />);
    expect(screen.queryByTestId("package-inquiry-note")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Executive Check-up/ })).toHaveAttribute("href", "/admin/packages?edit=p1");
  });

  it("not varsa sağlık uyarısıyla gösterilir; anonimleştirme rozeti", () => {
    render(<PackageInquiryCard leadId="l1" inquiry={{ ...inquiry, note: "Diyabetim var", anonymizedAt: "2026-10-31T00:00:00.000Z" }} />);
    expect(screen.getByTestId("package-inquiry-note")).toHaveTextContent("Diyabetim var");
    expect(screen.getByText(/sağlık bilgisi içerebilir/)).toBeInTheDocument();
    expect(screen.getByText("Anonimleştirildi")).toBeInTheDocument();
  });

  it("geri çek düğmesi yalnızca not ya da sağlık onayı varken görünür; sürüm gösterilir", () => {
    const { rerender } = render(<PackageInquiryCard leadId="l1" inquiry={{ ...inquiry, consentTextVersion: "package-v1" }} />);
    expect(screen.queryByRole("button", { name: /Sağlık onayını geri çek/ })).not.toBeInTheDocument();
    expect(screen.getByText("package-v1")).toBeInTheDocument();
    rerender(<PackageInquiryCard leadId="l1" inquiry={{ ...inquiry, note: "x" }} />);
    expect(screen.getByRole("button", { name: /Sağlık onayını geri çek/ })).toBeInTheDocument();
    rerender(<PackageInquiryCard leadId="l1" inquiry={{ ...inquiry, consentHealthAt: "2026-10-30T10:00:00.000Z" }} />);
    expect(screen.getByRole("button", { name: /Sağlık onayını geri çek/ })).toBeInTheDocument();
  });

  it("PACKAGE kanal etiketi 'Sağlık paketi'", () => {
    expect(leadChannelLabel("PACKAGE")).toBe("Sağlık paketi");
    expect(CRM_LEAD_CHANNEL_OPTIONS.some((o) => o.value === "PACKAGE")).toBe(true);
  });
});

describe("Sidebar", () => {
  const visible = (role: string, moduleEnabled = true) => filterVisibleNavItems(navItems, { role } as never, () => moduleEnabled).map((i) => i.href);
  it("paketler ve destinasyonlar ADMIN/MANAGER'a görünür, EDITOR'a ve modül kapalıyken gizli", () => {
    for (const href of ["/admin/packages", "/admin/destinations"]) {
      expect(visible("ADMIN")).toContain(href);
      expect(visible("MANAGER")).toContain(href);
      expect(visible("EDITOR")).not.toContain(href);
      expect(visible("ADMIN", false)).not.toContain(href);
      expect(navItems.find((i) => i.href === href)?.module).toBe("telehealth");
    }
  });
});
