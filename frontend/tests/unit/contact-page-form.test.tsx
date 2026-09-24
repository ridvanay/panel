import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClientError } from "@/lib/api/error";
import { contactStrings as en } from "@/lib/i18n/site-dictionaries/en/contact";
import { contactStrings as tr } from "@/lib/i18n/site-dictionaries/tr/contact";

vi.mock("@/lib/api/contact", () => ({
  getContactPageToken: vi.fn(),
  submitContactPage: vi.fn(),
}));
const contactApi = await import("@/lib/api/contact");
const { ContactPageForm } = await import("@/components/site/contact/contact-page-form");

const CONSENT = {
  notice: "I have read the Privacy Notice describing how my personal data will be processed to respond to this enquiry.",
  explicit: "I explicitly consent to the processing of the treatment area I selected (see Privacy Notice).",
  privacyLinkLabel: "Privacy Notice",
};

function renderForm(overrides: Partial<Parameters<typeof ContactPageForm>[0]> = {}) {
  return render(
    <ContactPageForm
      dict={en}
      locale="en"
      displayLocale="en"
      consent={CONSENT}
      privacyHref="/en/privacy"
      treatments={[{ slug: "kardiyoloji", name: "Cardiology" }]}
      treatmentNotSure="not_sure"
      responseTime="We reply within one business day."
      defaultPhoneCountry=""
      minTokenAgeMs={0}
      {...overrides}
    />
  );
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Full name/), "Jane Doe");
  await user.type(screen.getByRole("textbox", { name: /^Email/ }), "jane@example.com");
  await user.type(screen.getByLabelText(/^Message/), "Hello, I have a question.");
  await user.click(screen.getByRole("checkbox", { name: /I have read the Privacy Notice/ }));
}

beforeEach(() => {
  vi.mocked(contactApi.getContactPageToken).mockReset().mockResolvedValue({ token: "v1.1.sig" });
  vi.mocked(contactApi.submitContactPage).mockReset();
});

// Çok alanlı form + userEvent — tam paket yükünde varsayılan 5 sn yetmeyebiliyor.
describe("ContactPageForm", { timeout: 20_000 }, () => {
  it("erişilebilir alanlar: autocomplete, tel/email türleri, 16px (text-base) girişler, gizlilik bağlantısı", () => {
    renderForm();
    expect(screen.getByLabelText(/Full name/)).toHaveAttribute("autocomplete", "name");
    const email = screen.getByRole("textbox", { name: /^Email/ });
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText("Phone number")).toHaveAttribute("type", "tel");
    expect(email.className).toContain("text-base");
    expect(screen.getByRole("link", { name: "Privacy Notice" })).toHaveAttribute("href", "/en/privacy");
    expect(screen.getByRole("radio", { name: "Email" })).toBeChecked();
    expect(screen.getByText(en.whatsappNote)).toBeInTheDocument();
    expect(screen.getByText(en.treatmentHelp)).toBeInTheDocument();
    // Honeypot sekme sırasında değil ve ekran okuyucudan gizli.
    const honeypot = document.querySelector<HTMLInputElement>('input[name="website"]')!;
    expect(honeypot.tabIndex).toBe(-1);
    expect(honeypot.closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("boş gönderimde alan altı hatalar (aria-describedby) ve ilk hatalı alana odak", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();
    await user.click(screen.getByRole("button", { name: en.submit }));
    const name = screen.getByLabelText(/Full name/);
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(name.getAttribute("aria-describedby")!.split(" ")[0]!)).toHaveTextContent(en.errorRequired);
    expect(name).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent(en.errorSummary);
    expect(contactApi.submitContactPage).not.toHaveBeenCalled();
  });

  it("tedavi seçilince ayrı, işaretsiz açık rıza kutusu çıkar ve zorunludur; 'Not sure yet' için çıkmaz", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();
    expect(screen.queryByRole("checkbox", { name: /explicitly consent/ })).toBeNull();

    await user.selectOptions(screen.getByLabelText("Treatment of interest"), "kardiyoloji");
    const explicit = screen.getByRole("checkbox", { name: /explicitly consent/ });
    expect(explicit).not.toBeChecked();

    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: en.submit }));
    expect(explicit).toHaveAttribute("aria-invalid", "true");
    expect(explicit).toHaveFocus();
    expect(contactApi.submitContactPage).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText("Treatment of interest"), "not_sure");
    expect(screen.queryByRole("checkbox", { name: /explicitly consent/ })).toBeNull();
  });

  it("başarılı gönderim: doğru gövde, form yerine teşekkür mesajı", async () => {
    vi.mocked(contactApi.submitContactPage).mockResolvedValue({ id: "s1" });
    const user = userEvent.setup({ delay: null });
    renderForm();
    await fillRequired(user);
    await user.selectOptions(screen.getByLabelText("Treatment of interest"), "kardiyoloji");
    await user.click(screen.getByRole("checkbox", { name: /explicitly consent/ }));
    await user.click(screen.getByRole("radio", { name: "WhatsApp" }));
    await user.selectOptions(screen.getByLabelText("Country code"), "GB");
    await user.type(screen.getByLabelText("Phone number"), "7700 900123");
    await user.click(screen.getByRole("button", { name: en.submit }));

    await screen.findByRole("heading", { name: en.successTitle });
    expect(contactApi.submitContactPage).toHaveBeenCalledWith({
      token: "v1.1.sig",
      website: "",
      locale: "en",
      fullName: "Jane Doe",
      email: "jane@example.com",
      contactMethod: "whatsapp",
      message: "Hello, I have a question.",
      noticeAccepted: true,
      phoneNumber: "7700 900123",
      phoneCountry: "GB",
      treatment: "kardiyoloji",
      explicitConsent: true,
    });
    expect(screen.queryByRole("button", { name: en.submit })).toBeNull();
  });

  it("hata durumunda veri korunur ve anlaşılır mesaj gösterilir (429)", async () => {
    vi.mocked(contactApi.submitContactPage).mockRejectedValue(new ApiClientError(429, { code: "RATE_LIMITED", message: "x" }));
    const user = userEvent.setup({ delay: null });
    renderForm();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: en.submit }));
    expect(await screen.findByRole("alert")).toHaveTextContent(en.errorRateLimited);
    expect(screen.getByLabelText(/Full name/)).toHaveValue("Jane Doe");
    expect(screen.getByLabelText(/^Message/)).toHaveValue("Hello, I have a question.");
  });

  it("sunucu alan hataları sözlük mesajına çevrilir ve alana odaklanılır", async () => {
    vi.mocked(contactApi.submitContactPage).mockRejectedValue(
      new ApiClientError(422, { code: "VALIDATION_ERROR", message: "x", details: { email: ["invalid_email"] } })
    );
    const user = userEvent.setup({ delay: null });
    renderForm();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: en.submit }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: /^Email/ })).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByText(en.errorInvalidEmail)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^Email/ })).toHaveFocus();
  });

  it("damga geçersiz/süresi dolmuşsa yeni damga alınıp bir kez otomatik yeniden gönderilir", async () => {
    vi.mocked(contactApi.getContactPageToken).mockResolvedValueOnce({ token: "old" }).mockResolvedValue({ token: "new" });
    vi.mocked(contactApi.submitContactPage)
      .mockRejectedValueOnce(new ApiClientError(422, { code: "CONTACT_FORM_TOKEN_INVALID", message: "x", details: { token: ["expired"] } }))
      .mockResolvedValue({ id: "s2" });
    const user = userEvent.setup({ delay: null });
    renderForm();
    await fillRequired(user);
    await user.click(screen.getByRole("button", { name: en.submit }));
    await screen.findByRole("heading", { name: en.successTitle });
    expect(vi.mocked(contactApi.submitContactPage).mock.calls.map((c) => c[0].token)).toEqual(["old", "new"]);
  });

  it("Türkçe sözlük: TR etiketler ve varsayılan ülke kodu TR", () => {
    renderForm({ dict: tr, locale: "tr", displayLocale: "tr", defaultPhoneCountry: "TR" });
    expect(screen.getByLabelText(/Ad soyad/)).toBeInTheDocument();
    expect(screen.getByLabelText("Ülke kodu")).toHaveValue("TR");
    expect(screen.getByRole("option", { name: "Henüz emin değilim" })).toBeInTheDocument();
  });
});
