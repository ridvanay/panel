import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { extractVideoRef } from "@/lib/video-ref";

/** Paket Y — "Foto ve videolar": onaysız hasta içeriği yayınlanamaz (arayüz), kalıcı büyük video notu, video kimliği ayıklama. */
const { showcase } = vi.hoisted(() => ({
  showcase: {
    listDoctorMedia: vi.fn(),
    createDoctorMedia: vi.fn(),
    updateDoctorMedia: vi.fn(),
    deleteDoctorMedia: vi.fn(),
  },
}));
vi.mock("@/lib/api/doctor-showcase", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/doctor-showcase")>("@/lib/api/doctor-showcase");
  return { ...actual, ...showcase };
});
vi.mock("@/components/admin/media/media-select-field", () => ({ MediaSelectField: () => <div data-testid="media-select" /> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { DoctorMediaManager, buildMediaInput, canPublishMedia, type MediaFormState } from "@/components/admin/telehealth/doctor-media-manager";

describe("extractVideoRef", () => {
  it("YouTube bağlantı biçimlerinden kimliği ayıklar", () => {
    expect(extractVideoRef("https://youtu.be/dQw4w9WgXcQ")).toEqual({ provider: "youtube", videoId: "dQw4w9WgXcQ" });
    expect(extractVideoRef("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s")).toEqual({ provider: "youtube", videoId: "dQw4w9WgXcQ" });
    expect(extractVideoRef("youtube.com/embed/dQw4w9WgXcQ")).toEqual({ provider: "youtube", videoId: "dQw4w9WgXcQ" });
    expect(extractVideoRef("dQw4w9WgXcQ", "youtube")).toEqual({ provider: "youtube", videoId: "dQw4w9WgXcQ" });
  });

  it("Vimeo bağlantılarından kimliği ayıklar", () => {
    expect(extractVideoRef("https://vimeo.com/123456789")).toEqual({ provider: "vimeo", videoId: "123456789" });
    expect(extractVideoRef("https://player.vimeo.com/video/123456789?h=abc")).toEqual({ provider: "vimeo", videoId: "123456789" });
  });

  it("geçersiz girdiyi reddeder", () => {
    expect(extractVideoRef("")).toBeNull();
    expect(extractVideoRef("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(extractVideoRef("https://youtu.be/kısa")).toBeNull();
  });
});

describe("canPublishMedia / buildMediaInput", () => {
  const base: MediaFormState = {
    id: null,
    kind: "video",
    photo: null,
    videoProvider: "youtube",
    videoInput: "https://youtu.be/dQw4w9WgXcQ",
    category: "about",
    translations: {},
    showsPatient: false,
    patientConsentConfirmed: false,
    consentNote: "",
    isPublished: false,
    sortOrder: 0,
  };

  it("önce/sonra ve hasta içeriği onaysız yayınlanamaz", () => {
    expect(canPublishMedia({ ...base, category: "before-after" })).toBe(false);
    expect(canPublishMedia({ ...base, showsPatient: true })).toBe(false);
    expect(canPublishMedia({ ...base, category: "before-after", patientConsentConfirmed: true })).toBe(true);
    expect(canPublishMedia(base)).toBe(true);
  });

  it("videoda kimlik gövdeye ayıklanmış gider; onay işaretliyse not zorunlu", () => {
    const ok = buildMediaInput(base);
    expect(ok.input).toMatchObject({ kind: "video", videoProvider: "youtube", videoId: "dQw4w9WgXcQ", mediaId: null });
    const noNote = buildMediaInput({ ...base, patientConsentConfirmed: true });
    expect(noNote.errors.consentNote).toBeTruthy();
  });

  it("fotoğrafta görsel ve alt metin zorunlu", () => {
    const res = buildMediaInput({ ...base, kind: "photo" });
    expect(res.errors.mediaId).toBeTruthy();
    expect(res.errors.translations).toBeTruthy();
  });
});

describe("DoctorMediaManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    showcase.listDoctorMedia.mockResolvedValue([]);
  });

  it("büyük video notu görünür; önce/sonra seçilince onay yokken yayın anahtarı devre dışı ve açıklama gösterilir", async () => {
    const user = userEvent.setup();
    render(<DoctorMediaManager doctorId="d-1" />);

    expect(await screen.findByText("Büyük videoları sunucuya yüklemeyin; YouTube/Vimeo'ya yükleyip bağlantısını girin.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Medya ekle/ }));

    const publish = await screen.findByRole("switch", { name: "Medya yayında" });
    expect(publish).not.toHaveAttribute("aria-disabled", "true");

    await user.selectOptions(screen.getByLabelText(/Kategori/), "before-after");
    await waitFor(() => expect(screen.getByRole("switch", { name: "Medya yayında" })).toHaveAttribute("aria-disabled", "true"));
    expect(screen.getByText(/yazılı onay alınmadan yayınlanamaz/)).toBeInTheDocument();

    await user.click(screen.getByLabelText(/Hastadan yazılı onay alındı/));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Medya yayında" })).not.toHaveAttribute("aria-disabled", "true"));
    expect(screen.getByLabelText(/Onay notu/)).toBeInTheDocument();
  });
});
