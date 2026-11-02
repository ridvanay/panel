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

const GROUPS: RequestServiceGroup[] = [
  {
    slug: "gastroenterology",
    name: "Gastroenterology",
    children: [
      { slug: "esd", name: "ESD" },
      { slug: "poem", name: "POEM" },
    ],
  },
  { slug: "dental", name: "Dental care", children: [] },
];

let dict: SiteDictionary;

beforeEach(async () => {
  submit.mockReset().mockResolvedValue({ requestNumber: "REQ-2026-0001" });
  dict = await getSiteDictionary("en");
});

function renderForm(over: Partial<React.ComponentProps<typeof RequestForm>> = {}) {
  return render(
    <RequestForm
      lang="en"
      strings={dict.request}
      groups={GROUPS}
      initialService={null}
      pkg={null}
      privacyHref="/privacy-notice"
      consentHref="/explicit-consent"
      homeHref="/"
      servicesHref="/specialties"
      contactHref="/contact"
      {...over}
    />
  );
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>, opts: { service?: string } = {}) {
  await user.selectOptions(screen.getByLabelText(dict.request.serviceLabel), opts.service ?? "esd");
  await user.selectOptions(screen.getByLabelText(dict.request.countryLabel), "DE");
  await user.type(screen.getByLabelText(dict.request.fullNameLabel), "Anna Schmidt");
  await user.type(screen.getByLabelText(dict.request.emailLabel), "anna@example.com");
}

describe("Talep formu — alanlar", () => {
  it("hizmet seçici aktif bölümleri ve alt bölümleri gruplu listeler; iletişim dili 8 dil (tr yok)", () => {
    renderForm();
    const select = screen.getByLabelText(dict.request.serviceLabel) as HTMLSelectElement;
    const group = select.querySelector("optgroup")!;
    expect(group).toHaveAttribute("label", "Gastroenterology");
    expect(Array.from(group.querySelectorAll("option")).map((o) => o.value)).toEqual(["gastroenterology", "esd", "poem"]);
    expect(select.querySelector('option[value="dental"]')).not.toBeNull();
    const languages = Array.from((screen.getByLabelText(dict.request.contactLanguageLabel) as HTMLSelectElement).options).map((o) => o.value);
    expect(languages).toEqual(["en", "de", "ar", "ru", "fr", "es", "ro", "sr-latn"]);
    expect(languages).toEqual([...CONTACT_LANGUAGES]);
    expect(languages).not.toContain("tr");
  });

  it("?service= ile gelen bölüm önceden seçilidir; paket seçiliyse paket adı gösterilir", () => {
    renderForm({ initialService: "esd", pkg: { slug: "check-up", title: "Executive Check-up" } });
    expect(screen.getByLabelText(dict.request.serviceLabel)).toHaveValue("esd");
    expect(screen.getByTestId("request-package")).toHaveTextContent("Executive Check-up");
  });

  it("mesaj uyarısı görünür; honeypot alanı erişilebilir değildir", () => {
    renderForm();
    expect(screen.getByTestId("request-message-notice")).toHaveTextContent("Do not share detailed medical information here; our coordinator will guide you securely.");
    const honeypot = screen.getByTestId("request-website");
    expect(honeypot).toHaveAttribute("tabindex", "-1");
    expect(honeypot.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("gizlilik bildirimi bağlantısı iletişim rızasının yanında", () => {
    renderForm();
    const link = screen.getByRole("link", { name: dict.request.privacyNoticeLink });
    expect(link).toHaveAttribute("href", "/privacy-notice");
  });

  it("hizmet listesi boşsa uyarı ve iletişim bağlantısı; gönderim kapalı", () => {
    renderForm({ groups: [] });
    expect(screen.getByTestId("request-services-unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("request-submit")).toBeDisabled();
  });
});

describe("Talep formu — doğrulama ve rıza", () => {
  it("boş gönderimde zorunlu alan hataları; backend çağrılmaz", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByTestId("request-submit"));
    expect(await screen.findAllByText(dict.request.required)).not.toHaveLength(0);
    expect(screen.getByTestId("request-consent-contact-error")).toHaveTextContent(dict.request.consentContactRequired);
    expect(submit).not.toHaveBeenCalled();
  });

  it("iletişim rızası olmadan gönderilmez", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillRequired(user);
    await user.click(screen.getByTestId("request-submit"));
    expect(await screen.findByTestId("request-consent-contact-error")).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it("mesaj doluysa sağlık verisi açık rızası zorunlu; kutu işaretlenince gönderilir", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillRequired(user);
    await user.type(screen.getByLabelText(dict.request.messageLabel), "Short note");
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
    await fillRequired(user);
    await user.click(screen.getByTestId("request-consent-contact"));
    await user.click(screen.getByTestId("request-submit"));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0]![0]).toMatchObject({ message: null, healthDataConsent: false, contactConsent: true });
  });

  it("geçersiz e-posta ve tarih aralığı hataları", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillRequired(user);
    const email = screen.getByLabelText(dict.request.emailLabel);
    await user.clear(email);
    await user.type(email, "not-an-email");
    await user.type(screen.getByTestId("request-date-from"), "2026-12-10");
    await user.type(screen.getByTestId("request-date-to"), "2026-12-01");
    await user.click(screen.getByTestId("request-consent-contact"));
    await user.click(screen.getByTestId("request-submit"));
    expect(await screen.findByText(dict.request.invalidEmail)).toBeInTheDocument();
    expect(screen.getByText(dict.request.dateRangeInvalid)).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("Talep formu — gönderim", () => {
  it("sözleşmedeki gövde biçimi; başarı ekranı talep numarasını gösterir", async () => {
    const user = userEvent.setup();
    renderForm({ lang: "de", initialService: null });
    await fillRequired(user, { service: "poem" });
    await user.type(screen.getByTestId("request-date-from"), "2026-12-01");
    await user.type(screen.getByTestId("request-date-to"), "2026-12-15");
    await user.click(screen.getByTestId("request-interpreter-yes"));
    await user.type(screen.getByLabelText(dict.request.phoneLabel), "+49 151 1234567");
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
      message: null,
      contactConsent: true,
      healthDataConsent: false,
      locale: "de",
      website: "",
    });
    const success = await screen.findByTestId("request-success");
    expect(within(success).getByTestId("request-number")).toHaveTextContent("REQ-2026-0001");
    expect(screen.queryByTestId("request-form")).toBeNull();
  });

  it("paket seçiliyken packageSlug gönderilir ve hizmet zorunlu değildir", async () => {
    const user = userEvent.setup();
    renderForm({ pkg: { slug: "check-up", title: "Executive Check-up" } });
    await user.selectOptions(screen.getByLabelText(dict.request.countryLabel), "GB");
    await user.type(screen.getByLabelText(dict.request.fullNameLabel), "Tom Reed");
    await user.type(screen.getByLabelText(dict.request.emailLabel), "tom@example.com");
    await user.click(screen.getByTestId("request-consent-contact"));
    await user.click(screen.getByTestId("request-submit"));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0]![0]).toMatchObject({ packageSlug: "check-up", serviceSlug: null });
  });

  it("honeypot doluysa değer olduğu gibi gönderilir (backend sessizce eler)", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillRequired(user);
    await user.type(screen.getByTestId("request-website"), "spam.example");
    await user.click(screen.getByTestId("request-consent-contact"));
    await user.click(screen.getByTestId("request-submit"));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(submit.mock.calls[0]![0]).toMatchObject({ website: "spam.example" });
  });

  it("422 alan hataları ilgili alanda gösterilir", async () => {
    submit.mockRejectedValueOnce(
      new ApiClientError(422, { code: "VALIDATION_ERROR", message: "Invalid", details: { email: ["Email domain is not accepted."], preferredTo: ["End must not precede start."] } })
    );
    const user = userEvent.setup();
    renderForm();
    await fillRequired(user);
    await user.click(screen.getByTestId("request-consent-contact"));
    await user.click(screen.getByTestId("request-submit"));
    expect(await screen.findByText("Email domain is not accepted.")).toBeInTheDocument();
    expect(screen.getByText("End must not precede start.")).toBeInTheDocument();
    expect(screen.getByTestId("request-error")).toHaveTextContent(dict.request.errorFields);
    expect(screen.queryByTestId("request-success")).toBeNull();
  });

  it("429: oran sınırı mesajı; form açık kalır", async () => {
    submit.mockRejectedValueOnce(new ApiClientError(429, { code: "RATE_LIMITED", message: "Too many" } as never));
    const user = userEvent.setup();
    renderForm();
    await fillRequired(user);
    await user.click(screen.getByTestId("request-consent-contact"));
    await user.click(screen.getByTestId("request-submit"));
    expect(await screen.findByTestId("request-error")).toHaveTextContent(dict.request.errorRateLimit);
    expect(screen.getByTestId("request-form")).toBeInTheDocument();
  });

  it("genel hata: yeniden denenebilir mesaj", async () => {
    submit.mockRejectedValueOnce(new Error("network"));
    const user = userEvent.setup();
    renderForm();
    await fillRequired(user);
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
      expect(same.length, `${lang}: ${same.join(",")}`).toBeLessThanOrEqual(4); // ortak: "{n}/{max}", "{service} (general)" gibi
    }
  });

  it("Türkçe sözlük klasörü EN metin taşır (Türkçe ziyaretçiye kapalı)", async () => {
    const en = (await getSiteDictionary("en")).request;
    const tr = (await getSiteDictionary("tr")).request;
    expect(tr).toEqual(en);
  });
});
