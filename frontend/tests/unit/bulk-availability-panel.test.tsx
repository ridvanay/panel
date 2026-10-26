import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BulkOperation, BulkPreview, BulkPreviewResult, DoctorProfile } from "@/lib/api/types";
import { ApiClientError } from "@/lib/api/error";

/**
 * Paket Q — admin toplu çalışma saati/izin ekranı: CSV hata listesi (satır numarasıyla), önizleme
 * (önce/sonra, çakışma, dosyada olmayan doktorlar), onay kutusu olmadan "Uygula" pasif, bayat
 * önizleme, kip değişimi, haftalık şablon ve toplu izin istek gövdeleri, engellenen geri alma.
 */
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const doctor = (id: string, name: string, specialtyId: string | null) =>
  ({ id, title: "Dr.", fullName: name, slug: id, isActive: true, archivedAt: null, specialtyId, specialty: specialtyId ? { id: specialtyId, name: specialtyId === "s-kardiyo" ? "Kardiyoloji" : "Dermatoloji" } : null, additionalSpecialties: [] }) as unknown as DoctorProfile;

const DOCTORS = [doctor("d-ayse", "Ayşe Kalp", "s-kardiyo"), doctor("d-burak", "Burak Cilt", "s-derma"), doctor("d-cem", "Cem Kalp", "s-kardiyo")];

const PREVIEW: BulkPreview = {
  previewId: "11111111-1111-4111-8111-111111111111",
  expiresAt: "2026-11-02T10:15:00.000Z",
  source: "CSV",
  fileName: "saatler.csv",
  rowCount: 2,
  weeklyMode: "replace",
  doctors: [
    {
      doctorId: "d-ayse",
      slug: "d-ayse",
      name: "Dr. Ayşe Kalp",
      timeZone: "Europe/Istanbul",
      weekly: {
        before: [
          { dayOfWeek: 1, startMinute: 540, endMinute: 720, isActive: true },
          { dayOfWeek: 3, startMinute: 540, endMinute: 720, isActive: true },
        ],
        after: [
          { dayOfWeek: 1, startMinute: 540, endMinute: 720, isActive: true },
          { dayOfWeek: 2, startMinute: 600, endMinute: 720, isActive: true },
        ],
        added: [{ dayOfWeek: 2, startMinute: 600, endMinute: 720, isActive: true }],
        removed: [{ dayOfWeek: 3, startMinute: 540, endMinute: 720, isActive: true }],
        unchanged: [{ dayOfWeek: 1, startMinute: 540, endMinute: 720, isActive: true }],
      },
      timeOff: { skipped: 1, toAdd: [{ startsAt: "2026-11-19T21:00:00.000Z", endsAt: "2026-11-22T21:00:00.000Z", kind: "CONGRESS", allDay: true, hasNote: true }] },
      conflicts: [
        {
          appointmentId: "appt-1",
          bookingNumber: "BKG-ABC-1234",
          startsAt: "2026-11-11T07:00:00.000Z",
          endsAt: "2026-11-11T07:30:00.000Z",
          patientTimeZone: "Europe/Berlin",
          reason: "REMOVED_HOURS",
        },
      ],
    },
  ],
  untouchedDoctors: [{ doctorId: "d-burak", slug: "d-burak", name: "Dr. Burak Cilt" }],
  totals: { doctors: 1, rulesAdded: 1, rulesRemoved: 1, timeOffAdded: 1, timeOffSkipped: 1, conflicts: 1 },
};
const OK_RESULT: BulkPreviewResult = { valid: true, errors: [], preview: PREVIEW };

const OPERATION: BulkOperation = {
  id: "op-1",
  source: "CSV",
  fileName: "saatler.csv",
  rowCount: 2,
  doctorCount: 1,
  summary: { rulesAdded: 1, rulesRemoved: 1, timeOffAdded: 1, timeOffSkipped: 0, conflicts: 1, doctorNames: ["Dr. Ayşe Kalp"] },
  actorEmail: "admin@example.com",
  createdAt: "2026-11-02T10:00:00.000Z",
  undoneAt: null,
};

vi.mock("@/lib/api/telehealth", () => ({
  listAdminDoctors: vi.fn(async () => ({ items: DOCTORS, meta: { nextCursor: null } })),
  listAdminSpecialties: vi.fn(async () => [
    { id: "s-kardiyo", name: "Kardiyoloji" },
    { id: "s-derma", name: "Dermatoloji" },
  ]),
  listBulkOperations: vi.fn(async () => [OPERATION]),
  previewBulkCsv: vi.fn(),
  previewBulkWeeklyTemplate: vi.fn(async () => OK_RESULT),
  previewBulkTimeOff: vi.fn(async () => OK_RESULT),
  changeBulkPreviewMode: vi.fn(),
  applyBulkPreview: vi.fn(async () => OPERATION),
  undoBulkOperation: vi.fn(),
  getDoctorAvailability: vi.fn(async () => [{ id: "r1", dayOfWeek: 4, startMinute: 600, endMinute: 660, isActive: true }]),
  downloadBulkAvailabilityTemplate: vi.fn(),
}));

import * as telehealthApi from "@/lib/api/telehealth";
import { BulkAvailabilityPanel } from "@/components/admin/telehealth/bulk-availability/bulk-availability-panel";

const csvFile = () => new File(["doktor_kodu;kayit_turu\n"], "saatler.csv", { type: "text/csv" });

async function uploadAndPreview(user: ReturnType<typeof userEvent.setup>) {
  render(<BulkAvailabilityPanel />);
  await screen.findByText(/Son toplu işlemler/);
  await user.upload(screen.getByLabelText(/Düzenlenmiş dosya/), csvFile());
  await user.click(screen.getByRole("button", { name: /Yükle ve önizle/ }));
}

describe("Paket Q — toplu çalışma saati/izin paneli", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(telehealthApi.previewBulkCsv).mockResolvedValue(OK_RESULT);
  });

  it("CSV hataları satır numarasıyla listelenir; uygulama düğmesi yok", async () => {
    vi.mocked(telehealthApi.previewBulkCsv).mockResolvedValue({
      valid: false,
      errors: [
        { row: 3, message: 'Bilinmeyen doktor kodu "dr-yok".' },
        { row: null, message: "Dosyada en fazla 5000 satır olabilir." },
      ],
      preview: null,
    });
    const user = userEvent.setup();
    await uploadAndPreview(user);
    const errors = await screen.findByTestId("bulk-preview-errors");
    expect(within(errors).getByText(/2 hata var/)).toBeInTheDocument();
    expect(within(errors).getByText("Satır 3:")).toBeInTheDocument();
    expect(within(errors).getByText(/Bilinmeyen doktor kodu/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Uygula/ })).not.toBeInTheDocument();
    const call = vi.mocked(telehealthApi.previewBulkCsv).mock.calls[0]![0];
    expect(call.fileName).toBe("saatler.csv");
    expect(atob(call.contentBase64)).toBe("doktor_kodu;kayit_turu\n");
  });

  it("önizleme: önce/sonra farkı, izinler, çakışma (yalnızca randevu no + iki saat), dosyada olmayanlar; onaysız Uygula pasif", async () => {
    const user = userEvent.setup();
    await uploadAndPreview(user);
    const preview = await screen.findByTestId("bulk-preview");
    const diff = within(preview).getByTestId("bulk-preview-doctor");
    expect(diff.querySelector('[data-diff="added"]')).toHaveTextContent("+ 10:00–12:00");
    expect(diff.querySelector('[data-diff="removed"]')).toHaveTextContent("− 09:00–12:00");
    expect(within(diff).getByText(/1 eklenecek · 1 kaldırılacak · 1 değişmeyen/)).toBeInTheDocument();
    expect(within(diff).getByText(/tam gün/)).toBeInTheDocument();
    expect(within(diff).getByText(/iç not var/)).toBeInTheDocument();
    const conflicts = within(preview).getByTestId("bulk-preview-conflicts");
    expect(conflicts).toHaveTextContent("BKG-ABC-1234");
    expect(conflicts).toHaveTextContent("TSİ");
    expect(conflicts).toHaveTextContent("Hasta: Berlin");
    expect(conflicts).toHaveTextContent("kaldırılan çalışma saatinde");
    expect(within(preview).getByText(/Dosyada olmayan doktorlar \(1\)/)).toBeInTheDocument();

    const applyButton = within(preview).getByRole("button", { name: /Uygula/ });
    expect(applyButton).toBeDisabled();
    await user.click(within(preview).getByRole("checkbox", { name: /onaylı randevu yeni saatlerle çakışıyor/ }));
    expect(applyButton).toBeEnabled();
    await user.click(applyButton);
    await waitFor(() => expect(telehealthApi.applyBulkPreview).toHaveBeenCalledWith(PREVIEW.previewId, true));
    await waitFor(() => expect(screen.queryByTestId("bulk-preview")).not.toBeInTheDocument());
    expect(telehealthApi.listBulkOperations).toHaveBeenCalledTimes(2);
  });

  it("kip değişimi sunucuda yeniden hesaplatır; bayat önizlemede uygulama yapılmaz ve yeniden önizleme istenir", async () => {
    vi.mocked(telehealthApi.changeBulkPreviewMode).mockResolvedValue({ ...OK_RESULT, preview: { ...PREVIEW, weeklyMode: "append" } });
    vi.mocked(telehealthApi.applyBulkPreview).mockRejectedValueOnce(new ApiClientError(409, { code: "BULK_PREVIEW_STALE", message: "bayat" }));
    const user = userEvent.setup();
    await uploadAndPreview(user);
    await user.click(await screen.findByRole("radio", { name: /Yalnızca ekle/ }));
    expect(telehealthApi.changeBulkPreviewMode).toHaveBeenCalledWith(PREVIEW.previewId, "append");
    await waitFor(() => expect(screen.getByRole("radio", { name: /Yalnızca ekle/ })).toBeChecked());

    await user.click(screen.getByRole("checkbox", { name: /onaylı randevu/ }));
    await user.click(screen.getByRole("button", { name: /Uygula/ }));
    expect(await screen.findByTestId("bulk-action-error")).toHaveTextContent("yeniden önizleyin");
    expect(screen.queryByTestId("bulk-preview")).not.toBeInTheDocument();
  });

  it("haftalık şablon: uzmanlık filtresi + Tümünü seç + saatleri kopyala → istek gövdesi", async () => {
    const user = userEvent.setup();
    render(<BulkAvailabilityPanel />);
    await user.click(await screen.findByRole("tab", { name: /Haftalık şablon uygula/ }));
    await waitFor(() => expect(screen.getAllByRole("option", { name: "Dr. Ayşe Kalp" }).length).toBeGreaterThan(0));
    await user.selectOptions(screen.getByLabelText(/saatlerini kopyala/), "d-ayse");
    await waitFor(() => expect(telehealthApi.getDoctorAvailability).toHaveBeenCalledWith("d-ayse"));
    const picker = screen.getByTestId("template-doctor-picker");
    await user.selectOptions(within(picker).getByLabelText(/Uzmanlığa göre filtrele/), "s-kardiyo");
    await user.click(within(picker).getByRole("button", { name: /Tümünü seç \(2\)/ }));
    expect(within(picker).getByText(/2 seçili/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Önizle" }));
    expect(telehealthApi.previewBulkWeeklyTemplate).toHaveBeenCalledWith({
      doctorIds: ["d-ayse", "d-cem"],
      rules: [{ dayOfWeek: 4, startMinute: 600, endMinute: 660 }],
      weeklyMode: "replace",
    });
  });

  it("toplu izin: tarih aralığı + saat aralığı + tür + not → istek gövdesi", async () => {
    const user = userEvent.setup();
    render(<BulkAvailabilityPanel />);
    await user.click(await screen.findByRole("tab", { name: /Toplu izin ekle/ }));
    const picker = await screen.findByTestId("time-off-doctor-picker");
    await waitFor(() => expect(within(picker).getByText("Dr. Burak Cilt")).toBeInTheDocument());
    await user.click(within(picker).getByRole("button", { name: /Tümünü seç \(3\)/ }));
    await user.type(screen.getByLabelText("Başlangıç tarihi"), "2026-11-26");
    await user.clear(screen.getByLabelText("Bitiş tarihi"));
    await user.type(screen.getByLabelText("Bitiş tarihi"), "2026-11-29");
    await user.click(screen.getByRole("checkbox", { name: "Tam gün" }));
    await user.selectOptions(screen.getByLabelText("Tür"), "OTHER");
    await user.type(screen.getByLabelText(/İç not/), "Bayram");
    await user.click(screen.getByRole("button", { name: "Önizle" }));
    expect(telehealthApi.previewBulkTimeOff).toHaveBeenCalledWith({
      doctorIds: ["d-ayse", "d-burak", "d-cem"],
      startDate: "2026-11-26",
      endDate: "2026-11-29",
      startTime: "09:00",
      endTime: "17:00",
      kind: "OTHER",
      note: "Bayram",
    });
  });

  it("geri alma engellenirse değişen kayıtlar listelenir", async () => {
    vi.mocked(telehealthApi.undoBulkOperation).mockRejectedValueOnce(
      new ApiClientError(409, { code: "BULK_UNDO_BLOCKED", message: "x", details: { changes: ["Dr. Ayşe Kalp: haftalık çalışma saatleri bu işlemden sonra değiştirilmiş."] } })
    );
    const user = userEvent.setup();
    render(<BulkAvailabilityPanel />);
    const row = await screen.findByTestId("bulk-operation-row");
    await user.click(within(row).getByRole("button", { name: /Geri al/ }));
    await user.click(await screen.findByRole("button", { name: "Geri al" }));
    expect(await screen.findByText(/Geri alma durduruldu/)).toBeInTheDocument();
    expect(screen.getByText(/haftalık çalışma saatleri bu işlemden sonra değiştirilmiş/)).toBeInTheDocument();
    expect(telehealthApi.undoBulkOperation).toHaveBeenCalledWith("op-1");
  });
});
