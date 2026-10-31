import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/** Paket AE — "Azami video boyutu (MB)" ayarı: 1–500 doğrulaması, kısmi olmayan PUT gövdesi. */
const { api } = vi.hoisted(() => ({ api: { getDoctorMediaSettings: vi.fn(), updateDoctorMediaSettings: vi.fn() } }));
vi.mock("@/lib/api/doctor-showcase", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/doctor-showcase")>("@/lib/api/doctor-showcase");
  return { ...actual, ...api };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { DoctorMediaSettingsCard } from "@/components/admin/telehealth/doctor-media-settings-card";

beforeEach(() => {
  vi.clearAllMocks();
  api.getDoctorMediaSettings.mockResolvedValue({ beforeAfterEnabled: false, maxVideoUploadMb: 100 });
});

describe("DoctorMediaSettingsCard — azami video boyutu", () => {
  it("mevcut değeri gösterir ve Nginx yardım metnini içerir", async () => {
    render(<DoctorMediaSettingsCard canEdit />);
    const input = await screen.findByLabelText(/Azami video boyutu/);
    expect(input).toHaveValue(100);
    expect(screen.getByText(/client_max_body_size/)).toBeInTheDocument();
  });

  it("aralık dışı değerde hata gösterir ve Kaydet devre dışı kalır", async () => {
    const user = userEvent.setup();
    render(<DoctorMediaSettingsCard canEdit />);
    const input = await screen.findByLabelText(/Azami video boyutu/);
    await user.clear(input);
    await user.type(input, "501");
    expect(await screen.findByText(/1 ile 500 MB arasında/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kaydet" })).toBeDisabled();
    expect(api.updateDoctorMediaSettings).not.toHaveBeenCalled();
  });

  it("geçerli değeri PUT eder", async () => {
    const user = userEvent.setup();
    api.updateDoctorMediaSettings.mockResolvedValue({ beforeAfterEnabled: false, maxVideoUploadMb: 250 });
    render(<DoctorMediaSettingsCard canEdit />);
    const input = await screen.findByLabelText(/Azami video boyutu/);
    await user.clear(input);
    await user.type(input, "250");
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(api.updateDoctorMediaSettings).toHaveBeenCalledWith({ beforeAfterEnabled: false, maxVideoUploadMb: 250 }));
  });
});
