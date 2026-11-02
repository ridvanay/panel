import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClientError } from "@/lib/api/error";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import type { SiteDictionary } from "@/lib/i18n/site-dictionaries";

/**
 * Paket AH — talep formu (`/request`): doğrulama, rıza kutuları, honeypot, gövde biçimi, 422 alan hataları, 429,
 * başarı ekranı ve 8 dil sözlük eşitliği. Backend uç çağrısı mock'lanır.
 */
const submit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/consultation-requests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/consultation-requests")>()),
  submitConsultationRequest: (...args: unknown[]) => submit(...args),
}));

import { RequestForm, type RequestServiceGroup } from "@/components/site/request/request-form";
import { CONTACT_LANGUAGES } from "@/lib/api/consultation-requests";
import { SERVICE_GROUP_ORDER, serviceGroupTitle, type ServiceGroupId } from "@/lib/service-groups";

const GROUPS: RequestServiceGroup[] = [
  {
    slug: "gastroenterology",
    name: "Gastroenterology",
    icon: "Stethoscope",
    serviceGroup: "digestive-interventional",
    children: [
      { slug: "esd", name: "ESD" },
      { slug: "poem", name: "POEM" },
    ],
  },
  { slug: "dental", name: "Dental care", icon: "Smile", serviceGroup: "aesthetic-dental-hair", children: [] },
];

let dict: SiteDictionary;

beforeEach(async () => {
  submit.mockReset().mockResolvedValue({ requestNumber: "REQ-2026-0001" });
  dict = await getSiteDictionary("en");
});

function renderForm(over: Partial<React.ComponentProps<typeof RequestForm>> = {}) {
  const groupTitles = Object.fromEntries(SERVICE_GROUP_ORDER.map((id) => [id, serviceGroupTitle(id, dict.services)])) as Record<ServiceGroupId, string>;
  return render(
    <RequestForm
      lang="en"
      strings={dict.request}
      groups={GROUPS}
      groupTitles={groupTitles}
      initialService={null}
      pkg={null}
      privacyHref="/privacy-notice"
      consentHref="/explicit-consent"
      homeHref="/"
      servicesHref="/specialties"
      contactHref="/contact"
      vipHref="/vip-accommodation-transfer"
      guidesHref="/blog"
      whatsappHref="https://wa.me/905550000000"
      {...over}
    />
  );
}

type User = ReturnType<typeof userEvent.setup>;
const next = (user: User) => user.click(screen.getByTestId("request-next"));

async function fillService(user: User, slug = "esd") {
  await user.click(screen.getByTestId(`request-service-${slug}`));
  await next(user);
}
async function fillTiming(user: User, country = "DE") {
  await user.selectOptions(screen.getByLabelText(dict.request.countryLabel), country);
  await next(user);
}
async function fillDetails(user: User) {
  await user.type(screen.getByLabelText(dict.request.fullNameLabel), "Anna Schmidt");
  await user.type(screen.getByRole("textbox", { name: dict.request.emailLabel }), "anna@example.com");
  await next(user);
}
/** Adım 1-3 doldurulur; adım 4 (inceleme) açık kalır. */
async function reachReview(user: User, opts: { service?: string } = {}) {
  await fillService(user, opts.service);
  await fillTiming(user);
  await fillDetails(user);
}

describe("Talep formu — adımlar ve alanlar", () => {
  it("hizmet adımı gruplu ikonlu kartlar gösterir; arama süzer; Find your treatment bağlantısı var", async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.getByRole("radio", { name: "Dental care" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "ESD" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: dict.request.serviceLabel })).toBeNull();
    expect(screen.getByRole("link", { name: dict.request.findTreatmentLink })).toHaveAttribute("href", "/find-your-treatment");
    await user.type(screen.getByTestId("request-service-search"), "dental");
    expect(screen.queryByRole("radio", { name: "ESD" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Dental care" })).toBeInTheDocument();
    await user.clear(screen.getByTestId("request-service-search"));
    await user.type(screen.getByTestId("request-service-search"), "zzz");
    expect(screen.getByTestId("request-service-empty")).toHaveTextContent(dict.request.serviceNoResults);
  });

  it("iletişim dili 8 dil (tr yok); ilerleme göstergesi 4 adımdır", async () => {
    const user = userEvent.setup();
    renderForm();
    expect(within(screen.getByTestId("request-progress")).getAllByRole("listitem")).toHaveLength(4);
    await fillService(user);
    const languages = Array.from((screen.getByLabelText(dict.request.contactLanguageLabel) as HTMLSelectElement).options).map((o) => o.value);
    expect(languages).toEqual([...CONTACT_LANGUAGES]);
    expect(languages).not.toContain("tr");
    expect(screen.getByTestId("request-step-status")).toHaveTextContent("Step 2 of 4");
  });

  it("?service= ile gelen hizmet önceden seçilidir; paket seçiliyse paket adı gösterilir", () => {
    renderForm({ initialService: "esd", pkg: { slug: "check-up", title: "Executive Check-up" } });
    expect(screen.getByRole("radio", { name: "ESD" })).toBeChecked();
    expect(screen.getByTestId("request-package")).toHaveTextContent("Executive Check-up");
  });

  it("mesaj uyarısı görünür; honeypot alanı erişilebilir değildir", async () => {
    const user = userEvent.setup();
    renderForm();
    const honeypot = screen.getByTestId("request-website");
    expect(honeypot).toHaveAttribute("tabindex", "-1");
    expect(honeypot.closest('[aria-hidden="true"]')).not.toBeNull();
    await fillService(user);
    await fillTiming(user);
    expect(screen.getByTestId("request-message-notice")).toHaveTextContent("Do not share detailed medical information here; our coordinator will guide you securely.");
  });

  it("girilenler Geri/İleri arasında korunur", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillService(user, "poem");
    await fillTiming(user, "GB");
    await user.type(screen.getByLabelText(dict.request.fullNameLabel), "Tom Reed");
    await user.click(screen.getByTestId("request-back"));
    expect(screen.getByLabelText(dict.request.countryLabel)).toHaveValue("GB");
    await user.click(screen.getByTestId("request-back"));
    expect(screen.getByRole("radio", { name: "POEM" })).toBeChecked();
    await next(user);
    await next(user);
    expect(screen.getByLabelText(dict.request.fullNameLabel)).toHaveValue("Tom Reed");
  });

  it("I'm flexible tarih alanlarını kapatır", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillService(user);
    await user.click(screen.getByTestId("request-flexible"));
    expect(screen.getByTestId("request-date-from")).toBeDisabled();
    expect(screen.getByTestId("request-date-to")).toBeDisabled();
  });

  it("ülke araması listeyi süzer", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillService(user);
    await user.type(screen.getByTestId("request-country-search"), "germ");
    const options = Array.from((screen.getByLabelText(dict.request.countryLabel) as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toContain("DE");
    expect(options).not.toContain("GB");
  });

  it("hizmet listesi boşsa uyarı ve iletişim bağlantısı; ileri kapalı", () => {
    renderForm({ groups: [] });
    expect(screen.getByTestId("request-services-unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("request-next")).toBeDisabled();
  });
});

describe("Talep formu — doğrulama ve rıza", () => {
  it("hizmet seçmeden ilerlenmez; zorunlu alan hatası görünür", async () => {
    const user = userEvent.setup();
    renderForm();
    await next(user);
    expect(await screen.findByText(dict.request.required)).toBeInTheDocument();
    expect(screen.getByTestId("request-step-1")).toBeInTheDocument();
  });

  it("ülke seçmeden 2. adımdan ilerlenmez", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillService(user);
    await next(user);
    expect(await screen.findByText(dict.request.required)).toBeInTheDocument();
    expect(screen.getByTestId("request-step-2")).toBeInTheDocument();
  });

  it("WhatsApp/telefon kanalı seçilip numara girilmezse uyarı verir", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillService(user);
    await fillTiming(user);
    await user.type(screen.getByLabelText(dict.request.fullNameLabel), "Anna Schmidt");
    await user.type(screen.getByRole("textbox", { name: dict.request.emailLabel }), "anna@example.com");
    await user.click(screen.getByTestId("request-channel-whatsapp"));
    await next(user);
    expect(await screen.findByText(dict.request.channelPhoneNeeded)).toBeInTheDocument();
    expect(screen.getByTestId("request-step-3")).toBeInTheDocument();
  });

  it("inceleme adımına geçmek formu göndermez ve rıza hatası göstermez (AJ-9 kalite turu bulgusu)", async () => {
    const user = userEvent.setup();
    renderForm();
    await reachReview(user);
    expect(screen.getByTestId("request-submit")).toBeInTheDocument();
    expect(screen.queryByTestId("request-consent-contact-error")).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });

  it("iletişim rızası olmadan gönderilmez", async () => {
    const user = userEvent.setup();
    renderForm();
    await reachReview(user);
    await user.click(screen.getByTestId("request-submit"));
    expect(await screen.findByTestId("request-consent-contact-error")).toHaveTextContent(dict.request.consentContactRequired);
    expect(submit).not.toHaveBeenCalled();
  });

  it("mesaj doluysa sağlık verisi açık rızası zorunlu; kutu işaretlenince gönderilir", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillService(user);
    await fillTiming(user);
    await user.type(screen.getByLabelText(dict.request.fullNameLabel), "Anna Schmidt");
    await user.type(screen.getByRole("textbox", { name: dict.request.emailLabel }), "anna@example.com");
    await user.type(screen.getByLabelText(dict.request.messageLabel), "Short note");
    await next(user);
    await user.click(screen.getByTestId("request-consent-contact"));
    await user.click(screen.getByTestId("request-submit"));
    expect(await screen.findByTestId("request-consent-health-error")).toHaveTextContent(dict.request.healthConsentRequired);
    expect(submit).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("request-consent-health"));
    await user.click(screen.getByTestId("request-submit"));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0]![0]).toMatchObject({ message: "Short note", healthDataConsent: true });
  });

  it("mesaj boşken sağlık rızası zorunlu değildir ve gövdede false gider", async () => {
    const user = userEvent.setup();
    renderForm();
    await reachReview(user);
    await user.click(screen.getByTestId("request-consent-contact"));
    await user.click(screen.getByTestId("request-submit"));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0]![0]).toMatchObject({ message: null, healthDataConsent: false, contactConsent: true });
  });

  it("geçersiz tarih aralığı 2. adımda, geçersiz e-posta 3. adımda engellenir", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillService(user);
    await user.selectOptions(screen.getByLabelText(dict.request.countryLabel), "DE");
    await user.type(screen.getByTestId("request-date-from"), "2026-12-10");
    await user.type(screen.getByTestId("request-date-to"), "2026-12-01");
    await next(user);
    expect(await screen.findByText(dict.request.dateRangeInvalid)).toBeInTheDocument();
    await user.click(screen.getByTestId("request-flexible"));
    await next(user);
    await user.type(screen.getByLabelText(dict.request.fullNameLabel), "Anna Schmidt");
    await user.type(screen.getByRole("textbox", { name: dict.request.emailLabel }), "not-an-email");
    await next(user);
    expect(await screen.findByText(dict.request.invalidEmail)).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it("inceleme adımındaki Düzenle düğmesi ilgili adıma döner", async () => {
    const user = userEvent.setup();
    renderForm();
    await reachReview(user);
    expect(within(screen.getByTestId("request-review")).getByText("ESD")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `${dict.request.reviewEdit}: ${dict.request.serviceLabel}` }));
    expect(screen.getByTestId("request-step-1")).toBeInTheDocument();
  });
});

describe("Talep formu — gönderim", () => {
  it("sözleşmedeki gövde biçimi (tercih edilen kanal dahil); başarı ekranı talep numarasını gösterir", async () => {
    const user = userEvent.setup();
    renderForm({ lang: "de", initialService: null });
    await fillService(user, "poem");
    await user.selectOptions(screen.getByLabelText(dict.request.countryLabel), "DE");
    await user.type(screen.getByTestId("request-date-from"), "2026-12-01");
    await user.type(screen.getByTestId("request-date-to"), "2026-12-15");
    await user.click(screen.getByTestId("request-interpreter"));
    await next(user);
    await user.type(screen.getByLabelText(dict.request.fullNameLabel), "Anna Schmidt");
    await user.type(screen.getByRole("textbox", { name: dict.request.emailLabel }), "anna@example.com");
    await user.type(screen.getByLabelText(dict.request.phoneLabel), "151 1234567");
    await user.click(screen.getByTestId("request-channel-whatsapp"));
    await next(user);
    await user.click(screen.getByTestId("request-consent-contact"));
    await user.click(screen.getByTestId("request-submit"));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0]![0]).toEqual({
      serviceSlug: "poem",
      packageSlug: null,
      preferredFrom: "2026-12-01",
      preferredTo: "2026-12-15",
      country: "DE",
      contactLanguage: "de",
      needsInterpreter: true,
      fullName: "Anna Schmidt",
      email: "anna@example.com",
      phone: "+49 151 1234567",
      preferredContactChannel: "whatsapp",
      message: null,
      contactConsent: true,
      healthDataConsent: false,
      locale: "de",
      website: "",
    });
    const success = await screen.findByTestId("request-success");
    expect(within(success).getByTestId("request-number")).toHaveTextContent("REQ-2026-0001");
    expect(within(success).getByRole("link", { name: new RegExp(`^${dict.request.waitVipTitle}`) })).toHaveAttribute("href", "/vip-accommodation-transfer");
    expect(within(success).getByRole("link", { name: new RegExp(`^${dict.request.waitGuidesTitle}`) })).toHaveAttribute("href", "/blog");
    expect(within(success).getByRole("link", { name: dict.request.waitWhatsapp })).toHaveAttribute("href", "https://wa.me/905550000000");
    expect(within(success).getByTestId("request-next-steps")).toBeInTheDocument();
    expect(screen.queryByTestId("request-form")).toBeNull();
  });

  it("paket seçiliyken packageSlug gönderilir ve hizmet zorunlu değildir", async () => {
    const user = userEvent.setup();
    renderForm({ pkg: { slug: "check-up", title: "Executive Check-up" } });
    await next(user);
    await user.selectOptions(screen.getByLabelText(dict.request.countryLabel), "GB");
    await next(user);
    await fillDetails(user);
    await user.click(screen.getByTestId("request-consent-contact"));
    await user.click(screen.getByTestId("request-submit"));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0]![0]).toMatchObject({ packageSlug: "check-up", serviceSlug: null, preferredContactChannel: "email" });
  });

  it("honeypot doluysa değer olduğu gibi gönderilir (backend sessizce eler)", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByTestId("request-website"), "spam.example");
    await reachReview(user);
    await user.click(screen.getByTestId("request-consent-contact"));
    await user.click(screen.getByTestId("request-submit"));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0]![0]).toMatchObject({ website: "spam.example" });
  });

  it("422 alan hataları ilgili adıma dönüp alanda gösterilir", async () => {
    submit.mockRejectedValueOnce(
      new ApiClientError(422, { code: "VALIDATION_ERROR", message: "Invalid", details: { email: ["Email domain is not accepted."] } })
    );
    const user = userEvent.setup();
    renderForm();
    await reachReview(user);
    await user.click(screen.getByTestId("request-consent-contact"));
    await user.click(screen.getByTestId("request-submit"));
    expect(await screen.findByText("Email domain is not accepted.")).toBeInTheDocument();
    expect(screen.getByTestId("request-step-3")).toBeInTheDocument();
    expect(screen.getByTestId("request-error")).toHaveTextContent(dict.request.errorFields);
    expect(screen.queryByTestId("request-success")).toBeNull();
  });

  it("429: oran sınırı mesajı; form açık kalır", async () => {
    submit.mockRejectedValueOnce(new ApiClientError(429, { code: "RATE_LIMITED", message: "Too many" } as never));
    const user = userEvent.setup();
    renderForm();
    await reachReview(user);
    await user.click(screen.getByTestId("request-consent-contact"));
    await user.click(screen.getByTestId("request-submit"));
    expect(await screen.findByTestId("request-error")).toHaveTextContent(dict.request.errorRateLimit);
    expect(screen.getByTestId("request-form")).toBeInTheDocument();
  });

  it("genel hata: yeniden denenebilir mesaj", async () => {
    submit.mockRejectedValueOnce(new Error("network"));
    const user = userEvent.setup();
    renderForm();
    await reachReview(user);
    await user.click(screen.getByTestId("request-consent-contact"));
    await user.click(screen.getByTestId("request-submit"));
    expect(await screen.findByTestId("request-error")).toHaveTextContent(dict.request.errorGeneric);
  });
});

describe("Talep formu — sözlük (8 dil)", () => {
  const LANGS = ["en", "de", "ar", "ru", "fr", "es", "ro", "sr-latn"] as const;

  it.each(LANGS)("%s: tüm anahtarlar dolu ve yer tutucular EN ile aynı", async (lang) => {
    const en = (await getSiteDictionary("en")).request as Record<string, string>;
    const d = (await getSiteDictionary(lang)).request as Record<string, string>;
    expect(Object.keys(d).sort()).toEqual(Object.keys(en).sort());
    const placeholders = (v: string) => (v.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const [key, value] of Object.entries(d)) {
      expect(value.trim().length, `${lang}.${key}`).toBeGreaterThan(0);
      expect(placeholders(value), `${lang}.${key}`).toBe(placeholders(en[key]!));
    }
  });

  it("EN dışındaki 7 dil, talep sözlüğünde EN metni birebir kopyalamaz (ortak sözcükler hariç)", async () => {
    const en = (await getSiteDictionary("en")).request as Record<string, string>;
    for (const lang of LANGS.filter((l) => l !== "en")) {
      const d = (await getSiteDictionary(lang)).request as Record<string, string>;
      const same = Object.keys(en).filter((k) => d[k] === en[k]);
      expect(same.length, `${lang}: ${same.join(",")}`).toBeLessThanOrEqual(8); // ortak: "{n}/{max}", "{service} (general)" gibi
    }
  });

  it("Türkçe sözlük klasörü EN metin taşır (Türkçe ziyaretçiye kapalı)", async () => {
    const en = (await getSiteDictionary("en")).request;
    const tr = (await getSiteDictionary("tr")).request;
    expect(tr).toEqual(en);
  });
});

describe("Talep formu — VIP topic ön-doldurma", () => {
  it("initialMessage mesaj alanına yazılır; sağlık rızası uyarısı mevcut kuralla çalışır", async () => {
    const user = userEvent.setup();
    renderForm({ initialMessage: dict.request.topicVipTransfer });
    await fillService(user);
    await fillTiming(user);
    expect(screen.getByLabelText(dict.request.messageLabel)).toHaveValue(dict.request.topicVipTransfer);
  });
});
