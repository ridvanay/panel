import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Specialty } from "@/lib/api/types";
import { ApiClientError } from "@/lib/api/error";

/** Paket AI (FE1) — admin uzmanlık formu: "Hizmet grubu" seçimi ve "Kısa açıklama" (≤120). */
const listAdminSpecialties = vi.fn();
const createSpecialty = vi.fn();
const updateSpecialty = vi.fn();
vi.mock("@/lib/api/telehealth", () => ({
  listAdminSpecialties: () => listAdminSpecialties(),
  createSpecialty: (...a: unknown[]) => createSpecialty(...a),
  updateSpecialty: (...a: unknown[]) => updateSpecialty(...a),
  deleteSpecialty: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/admin/translation-locale-tabs", () => ({
  CANONICAL_LOCALE_CODE: "en",
  TranslationLocaleTabs: () => null,
  getTranslation: () => "",
  isCanonicalLocale: () => true,
  setTranslation: (t: unknown) => t,
  useTranslationLocales: () => [],
}));
vi.mock("@/components/admin/page-builder/blocks/icon-picker", () => ({
  IconPickerField: ({ value }: { value: string }) => <span>ikon:{value}</span>,
}));
vi.mock("@/components/admin/media/media-select-field", () => ({ MediaSelectField: () => null }));

import AdminTelehealthSpecialtiesPage from "@/app/admin/telehealth/specialties/page";

const base = {
  description: null,
  order: 0,
  isActive: true,
  imageMediaId: null,
  imageUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  icon: "Stethoscope",
};
const list: Specialty[] = [
  { ...base, id: "g", name: "Gastroenterology", slug: "gastroenterology", parentId: null, parentSlug: null, serviceGroup: "digestive-interventional", shortDescription: "Digestive health procedures" },
  { ...base, id: "e", name: "ESD", slug: "esd", parentId: "g", parentSlug: "gastroenterology" },
  { ...base, id: "i", name: "IVF", slug: "ivf", parentId: null, parentSlug: null },
];

describe("admin uzmanlık formu — hizmet grubu ve kısa açıklama", () => {
  beforeEach(() => {
    listAdminSpecialties.mockReset().mockResolvedValue(list);
    updateSpecialty.mockReset().mockResolvedValue(list[2]);
    createSpecialty.mockReset();
  });

  it("seçenekler: Boş (Other) + 4 grup; mevcut değerler forma dolar", async () => {
    const user = userEvent.setup();
    render(<AdminTelehealthSpecialtiesPage />);
    await screen.findByTestId("specialty-child-row");
    await user.click(screen.getByRole("button", { name: '"Gastroenterology" uzmanlığını düzenle' }));
    const select = screen.getByLabelText("Hizmet grubu") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "— Boş (Other) —",
      "Surgery & Oncology",
      "Digestive & Interventional",
      "Aesthetic, Dental & Hair",
      "Fertility",
    ]);
    expect(select.value).toBe("digestive-interventional");
    expect(screen.getByLabelText("Kısa açıklama")).toHaveValue("Digestive health procedures");
    expect(screen.getByLabelText("Kısa açıklama")).toHaveAttribute("maxlength", "120");
  });

  it("grup ve kısa açıklama gövdeye girer (kırpılmış); boş değerler null gider", async () => {
    const user = userEvent.setup();
    render(<AdminTelehealthSpecialtiesPage />);
    await screen.findByTestId("specialty-child-row");
    await user.click(screen.getByRole("button", { name: '"IVF" uzmanlığını düzenle' }));
    await user.selectOptions(screen.getByLabelText("Hizmet grubu"), "fertility");
    await user.type(screen.getByLabelText("Kısa açıklama"), "  Fertility care at authorized facilities  ");
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(updateSpecialty).toHaveBeenCalledTimes(1));
    expect(updateSpecialty.mock.calls[0]![1]).toMatchObject({ serviceGroup: "fertility", shortDescription: "Fertility care at authorized facilities" });

    await user.click(await screen.findByRole("button", { name: '"IVF" uzmanlığını düzenle' }));
    await user.selectOptions(screen.getByLabelText("Hizmet grubu"), "");
    await user.clear(screen.getByLabelText("Kısa açıklama"));
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(updateSpecialty).toHaveBeenCalledTimes(2));
    expect(updateSpecialty.mock.calls[1]![1]).toMatchObject({ serviceGroup: null, shortDescription: null });
  });

  it("alt uzmanlıkta grup seçimi devre dışı ve gövdeye grup yazılmaz (üstten miras)", async () => {
    const user = userEvent.setup();
    render(<AdminTelehealthSpecialtiesPage />);
    await screen.findByTestId("specialty-child-row");
    await user.click(screen.getByRole("button", { name: '"ESD" uzmanlığını düzenle' }));
    expect(screen.getByLabelText("Hizmet grubu")).toBeDisabled();
    expect(screen.getByText(/grubunu üst uzmanlıktan devralır/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    await waitFor(() => expect(updateSpecialty).toHaveBeenCalled());
    expect(updateSpecialty.mock.calls[0]![1]).toMatchObject({ parentId: "g", serviceGroup: null });
  });

  it("backend 422 (serviceGroup) alanda gösterilir", async () => {
    const user = userEvent.setup();
    updateSpecialty.mockRejectedValueOnce(
      new ApiClientError(422, { code: "VALIDATION_ERROR", message: "Geçersiz", details: { serviceGroup: ["Geçersiz hizmet grubu."] } })
    );
    render(<AdminTelehealthSpecialtiesPage />);
    await screen.findByTestId("specialty-child-row");
    await user.click(screen.getByRole("button", { name: '"IVF" uzmanlığını düzenle' }));
    await user.selectOptions(screen.getByLabelText("Hizmet grubu"), "fertility");
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    expect(await screen.findByText("Geçersiz hizmet grubu.")).toBeInTheDocument();
  });
});
