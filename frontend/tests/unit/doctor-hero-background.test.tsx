import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DoctorHeroBackground, DOCTOR_HERO_DEFAULT_IMAGE } from "@/components/site/telehealth/doctor-hero-background";
import type { TelehealthThemeSettings } from "@/lib/api/types";

/**
 * Paket M (2026-10-23) — doktor profil başlığı arka planı (site) ve admin kartı. Dış URL'nin
 * reddi sunucuda (`backend/tests/integration/telehealth-doctor-hero.test.ts`); burada admin
 * arayüzünün dış URL alanı OLMADIĞI ve yalnızca `imageMediaId` gönderdiği doğrulanır.
 */
vi.mock("@/lib/api/telehealth", () => ({
  getTelehealthThemeSettings: vi.fn(),
  updateDoctorHeroSettings: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/admin/media/media-select-field", () => ({
  MediaSelectField: ({ value, onChange }: { value: { url: string } | null; onChange: (m: unknown) => void }) => (
    <div>
      <span data-testid="selected-media">{value?.url ?? "yok"}</span>
      <button type="button" onClick={() => onChange({ id: "11111111-1111-4111-8111-111111111111", url: "https://cdn.example/new.webp", altText: null })}>
        Kütüphaneden seç
      </button>
    </div>
  ),
}));

import * as telehealthApi from "@/lib/api/telehealth";
import { DoctorHeroSettingsCard } from "@/components/admin/appearance/doctor-hero-settings-card";

function heroImage(container: HTMLElement) {
  return container.querySelector("img") as HTMLImageElement;
}

describe("DoctorHeroBackground", () => {
  it("görsel seçilmemişse varsayılan SVG, varsayılan %55 katman", () => {
    const { container } = render(
      <DoctorHeroBackground hero={null}>
        <h1>Dr. Test</h1>
      </DoctorHeroBackground>
    );
    expect(heroImage(container).getAttribute("src")).toContain(DOCTOR_HERO_DEFAULT_IMAGE);
    expect(heroImage(container).getAttribute("alt")).toBe("");
    expect(screen.getByTestId("doctor-hero-overlay").style.opacity).toBe("0.55");
    expect(screen.getByRole("heading", { name: "Dr. Test" })).toBeInTheDocument();
  });

  it("admin görseli ve opaklığı uygulanır", () => {
    const { container } = render(
      <DoctorHeroBackground hero={{ imageMediaId: "m1", imageUrl: "https://media.example/uploads/hero.webp", overlayOpacity: 30 }}>
        <span>x</span>
      </DoctorHeroBackground>
    );
    expect(heroImage(container).getAttribute("src")).toContain("hero.webp");
    expect(heroImage(container).className).toContain("object-cover");
    expect(screen.getByTestId("doctor-hero-overlay").style.opacity).toBe("0.3");
  });

  it("imageUrl null (silinmiş medya) → varsayılan SVG", () => {
    const { container } = render(
      <DoctorHeroBackground hero={{ imageMediaId: "m1", imageUrl: null, overlayOpacity: 0 }}>
        <span>x</span>
      </DoctorHeroBackground>
    );
    expect(heroImage(container).getAttribute("src")).toContain(DOCTOR_HERO_DEFAULT_IMAGE);
    expect(screen.getByTestId("doctor-hero-overlay").style.opacity).toBe("0");
  });
});

describe("DoctorHeroSettingsCard (admin)", () => {
  const settings = (hero: TelehealthThemeSettings["doctorHero"]): TelehealthThemeSettings => ({
    primaryColor: "#4ab9e1",
    secondaryColor: "#2951A0",
    accentColor: "#4ab9e1",
    calendarActiveBg: "#4ab9e1",
    doctorHero: hero,
  });

  it("dış URL alanı yok; Kaydet yalnızca imageMediaId + overlayOpacity gönderir", async () => {
    vi.mocked(telehealthApi.getTelehealthThemeSettings).mockResolvedValue(settings({ imageMediaId: null, imageUrl: null, overlayOpacity: 55 }));
    vi.mocked(telehealthApi.updateDoctorHeroSettings).mockImplementation(async (input) =>
      settings({ imageMediaId: input.imageMediaId ?? null, imageUrl: "https://cdn.example/new.webp", overlayOpacity: input.overlayOpacity ?? 55 })
    );
    render(<DoctorHeroSettingsCard />);

    await screen.findByText("Kütüphaneden seç");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kaydet" })).toBeDisabled();

    fireEvent.click(screen.getByText("Kütüphaneden seç"));
    fireEvent.change(screen.getByLabelText(/Karartma yoğunluğu/), { target: { value: "20" } });
    expect(screen.getByRole("status")).toHaveTextContent(/WCAG AA/);
    fireEvent.change(screen.getByLabelText(/Karartma yoğunluğu/), { target: { value: "70" } });
    expect(screen.getByLabelText(/Karartma yoğunluğu/)).toHaveAttribute("max", "80");
    fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));

    await waitFor(() =>
      expect(telehealthApi.updateDoctorHeroSettings).toHaveBeenCalledWith({ imageMediaId: "11111111-1111-4111-8111-111111111111", overlayOpacity: 70 })
    );
    const preview = screen.getByTestId("doctor-hero-preview");
    expect(preview.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example/new.webp");
  });

  it("Varsayılana dön: görsel null, opaklık 55", async () => {
    vi.mocked(telehealthApi.getTelehealthThemeSettings).mockResolvedValue(
      settings({ imageMediaId: "m1", imageUrl: "https://cdn.example/old.webp", overlayOpacity: 20 })
    );
    vi.mocked(telehealthApi.updateDoctorHeroSettings).mockResolvedValue(settings({ imageMediaId: null, imageUrl: null, overlayOpacity: 55 }));
    render(<DoctorHeroSettingsCard />);

    fireEvent.click(await screen.findByRole("button", { name: "Varsayılana dön" }));
    await waitFor(() => expect(telehealthApi.updateDoctorHeroSettings).toHaveBeenCalledWith({ imageMediaId: null, overlayOpacity: 55 }));
    await waitFor(() => expect(screen.getByTestId("selected-media")).toHaveTextContent("yok"));
    expect(screen.getByTestId("doctor-hero-preview").querySelector("img")?.getAttribute("src")).toBe(DOCTOR_HERO_DEFAULT_IMAGE);
  });
});
