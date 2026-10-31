import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdminTestimonial } from "@/lib/api/testimonials";

/** Paket Y — admin "Hasta yorumları": metin düzenlenemez, maskeleme doğru gövdeyle gider, öne çıkar yalnızca onaylıda, manuel eklemede kanıt notu zorunlu. */
const { api } = vi.hoisted(() => {
  const api = {
    listAdminTestimonials: vi.fn(),
    createManualTestimonial: vi.fn(),
    setTestimonialStatus: vi.fn(),
    redactTestimonial: vi.fn(),
    updateTestimonial: vi.fn(),
    removeTestimonial: vi.fn(),
  };
  return { api };
});
vi.mock("@/lib/api/testimonials", () => api);
vi.mock("@/lib/api/telehealth", () => ({ listAdminDoctors: vi.fn(async () => ({ items: [], meta: { nextCursor: null } })) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import AdminTestimonialsPage from "@/app/admin/telehealth/testimonials/page";

const BODY = "Doktor çok ilgiliydi, ameliyat sonrası süreç sorunsuz geçti ve çok memnun kaldım.";

function make(overrides: Partial<AdminTestimonial>): AdminTestimonial {
  return {
    id: "t-1",
    doctorId: null,
    doctorName: "Dr. Ayşe Yılmaz",
    specialtyId: null,
    bookingId: null,
    authorDisplay: "M. K.",
    displayMode: "initials",
    country: "DE",
    language: "tr",
    rating: 5,
    title: "Harika deneyim",
    body: BODY,
    translations: null,
    source: "verified_booking",
    verified: true,
    consentAt: "2026-10-01T10:00:00.000Z",
    consentEvidenceNote: null,
    status: "pending",
    moderatedAt: null,
    redactionCount: 0,
    featuredOnHome: false,
    publishedAt: null,
    doctorReply: null,
    anonymizedAt: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    ...overrides,
  };
}

function listResult(items: AdminTestimonial[]) {
  return { total: items.length, page: 1, pageSize: 25, counts: { pending: 1, approved: 1 }, items };
}

describe("AdminTestimonialsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listAdminTestimonials.mockResolvedValue(listResult([make({ id: "t-1" }), make({ id: "t-2", status: "approved", source: "manual_with_consent", consentEvidenceNote: "E-posta izni 2026-09-30" })]));
  });

  it("yorum metni için düzenleme alanı sunmaz (metin yalnızca okunur)", async () => {
    render(<AdminTestimonialsPage />);
    await screen.findAllByText(BODY);

    // Hiçbir input/textarea orijinal başlık ya da metni taşımaz; "Düzenle" eylemi yoktur.
    for (const el of screen.queryAllByRole("textbox")) {
      expect((el as HTMLInputElement).value).not.toBe(BODY);
      expect((el as HTMLInputElement).value).not.toBe("Harika deneyim");
    }
    expect(screen.queryByRole("button", { name: /düzenle/i })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Maskele" }).length).toBeGreaterThan(0);
  });

  it("kaynak rozetlerini ve sekme sayılarını gösterir", async () => {
    render(<AdminTestimonialsPage />);
    await screen.findAllByText(BODY);
    expect(screen.getByText("Doğrulanmış hasta")).toBeInTheDocument();
    expect(screen.getByText("Manuel (onaylı)")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Bekleyen (1)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Onaylı (1)" })).toBeInTheDocument();
  });

  it("maskeleme çağrısı doğru gövdeyle (alan + ifade) gider", async () => {
    api.redactTestimonial.mockResolvedValue(make({ id: "t-1", body: "Doktor çok ilgiliydi, ██████ sonrası süreç sorunsuz geçti.", redactionCount: 1 }));
    const user = userEvent.setup();
    render(<AdminTestimonialsPage />);
    await screen.findAllByText(BODY);

    await user.click(screen.getAllByRole("button", { name: "Maskele" })[0]);
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Maskelenecek ifade"), "ameliyat");
    await user.click(within(dialog).getByRole("button", { name: "Maskele" }));

    await waitFor(() => expect(api.redactTestimonial).toHaveBeenCalledWith("t-1", "body", "ameliyat"));
  });

  it("öne çıkar düğmesi yalnızca onaylı yorumda etkin", async () => {
    render(<AdminTestimonialsPage />);
    await screen.findAllByText(BODY);
    const buttons = screen.getAllByRole("button", { name: "Anasayfada öne çıkar" });
    expect(buttons[0]).toBeDisabled(); // t-1 pending
    expect(buttons[1]).toBeEnabled(); // t-2 approved
  });

  it("manuel eklemede onay kanıtı notu zorunlu: boşken API çağrılmaz", async () => {
    const user = userEvent.setup();
    render(<AdminTestimonialsPage />);
    await screen.findAllByText(BODY);

    await user.click(screen.getByRole("button", { name: /Manuel yorum ekle/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText(/Doğrulanmış hasta” rozeti verilmez/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/Uydurma yorum girmeyin/)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/Görünen ad/), "A. B.");
    await user.type(within(dialog).getByLabelText(/^Başlık/), "Çok iyi");
    await user.type(within(dialog).getByLabelText(/Yorum metni/), "Hastanın kendi sözleri ile yazılmış yeterince uzun bir yorum metni.");
    await user.type(within(dialog).getByLabelText(/Onay kanıtı notu/), "kısa");
    await user.click(within(dialog).getByRole("button", { name: "Ekle" }));

    expect(await within(dialog).findByText(/Onay kanıtı notu zorunlu/)).toBeInTheDocument();
    expect(api.createManualTestimonial).not.toHaveBeenCalled();

    await user.clear(within(dialog).getByLabelText(/Onay kanıtı notu/));
    await user.type(within(dialog).getByLabelText(/Onay kanıtı notu/), "Hasta e-postayla izin verdi (30.09.2026)");
    api.createManualTestimonial.mockResolvedValue(make({ id: "t-3" }));
    await user.click(within(dialog).getByRole("button", { name: "Ekle" }));
    await waitFor(() => expect(api.createManualTestimonial).toHaveBeenCalledTimes(1));
    expect(api.createManualTestimonial.mock.calls[0][0]).toMatchObject({ source: "manual_with_consent", consentEvidenceNote: "Hasta e-postayla izin verdi (30.09.2026)" });
  });
});
