import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateExportDialog } from "@/components/admin/reports/create-export-dialog";
import type { ExportJob } from "@/lib/api/types";

/**
 * `CreateExportDialog` — react-hook-form + zod doğrulaması ve `unmaskPii` uyarısının
 * yalnızca PII içerebilecek rapor tiplerinde (`USERS`, bkz. `export-labels.ts::EXPORT_JOB_TYPES_WITH_PII`)
 * göründüğünü doğrular. `useCreateExportJob` hook'u mock'lanır — bu dosyanın kapsamı SAF form
 * davranışıdır, gerçek mutation/network akışı DEĞİL (bkz. `reports.test.ts` backend'de,
 * `reports-export-download.test.ts` indirme akışında zaten kapsanıyor).
 */
const mutateAsync = vi.fn();
const mutationState = { isPending: false, isError: false, error: null as unknown, reset: vi.fn() };

vi.mock("@/hooks/use-export-jobs", () => ({
  useCreateExportJob: () => ({ mutateAsync, ...mutationState }),
}));

function renderDialog(overrides: { onCreated?: (jobId: string) => void; onOpenChange?: (open: boolean) => void } = {}) {
  const onOpenChange = overrides.onOpenChange ?? vi.fn();
  const onCreated = overrides.onCreated ?? vi.fn();
  const utils = render(<CreateExportDialog open onOpenChange={onOpenChange} onCreated={onCreated} />);
  return { ...utils, onOpenChange, onCreated };
}

describe("CreateExportDialog — unmaskPii uyarısı yalnızca PII içerebilecek tiplerde görünür", () => {
  it("varsayılan tip (VIEWS) — unmaskPii uyarısı ve rol/abonelik filtreleri GÖRÜNMEZ", () => {
    renderDialog();
    expect(screen.queryByRole("checkbox", { name: "Ham/maskesiz kişisel veriyi göster" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Rol filtresi (opsiyonel)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Abonelik durumu filtresi (opsiyonel)")).not.toBeInTheDocument();
  });

  it("tip USERS'a değiştirilince unmaskPii uyarısı VE rol filtresi görünür", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.selectOptions(screen.getByLabelText(/Rapor Tipi/), "USERS");

    expect(screen.getByRole("checkbox", { name: "Ham/maskesiz kişisel veriyi göster" })).toBeInTheDocument();
    expect(screen.getByLabelText("Rol filtresi (opsiyonel)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Abonelik durumu filtresi (opsiyonel)")).not.toBeInTheDocument();
  });

  it("tip REVENUE'a değiştirilince abonelik durumu filtresi görünür AMA unmaskPii uyarısı GÖRÜNMEZ (PII listesinde değil)", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.selectOptions(screen.getByLabelText(/Rapor Tipi/), "REVENUE");

    expect(screen.getByLabelText("Abonelik durumu filtresi (opsiyonel)")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Ham/maskesiz kişisel veriyi göster" })).not.toBeInTheDocument();
  });
});

describe("CreateExportDialog — zod doğrulaması", () => {
  it("başlangıç tarihi bitiş tarihinden sonraysa gönderim ENGELLENİR ve hata mesajı gösterilir", async () => {
    const user = userEvent.setup();
    renderDialog();

    fireEvent.change(screen.getByLabelText(/^Başlangıç/), { target: { value: "2026-06-10" } });
    fireEvent.change(screen.getByLabelText(/^Bitiş/), { target: { value: "2026-06-01" } });

    await user.click(screen.getByRole("button", { name: "Oluştur" }));

    expect(await screen.findByText("Başlangıç tarihi bitiş tarihinden sonra olamaz.")).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("geçerli bir form gönderildiğinde mutateAsync doğru payload ile çağrılır ve onCreated/onOpenChange tetiklenir", async () => {
    const user = userEvent.setup();
    const createdJob: ExportJob = {
      id: "job-42",
      type: "VIEWS",
      format: "CSV",
      status: "PENDING",
      filters: {},
      containsPii: false,
      errorSummary: null,
      createdById: "user-1",
      createdBy: null,
      expiresAt: null,
      startedAt: null,
      finishedAt: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    };
    mutateAsync.mockResolvedValueOnce(createdJob);

    const { onOpenChange, onCreated } = renderDialog();

    fireEvent.change(screen.getByLabelText(/^Başlangıç/), { target: { value: "2026-06-01" } });
    fireEvent.change(screen.getByLabelText(/^Bitiş/), { target: { value: "2026-06-30" } });

    await user.click(screen.getByRole("button", { name: "Oluştur" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const payload = mutateAsync.mock.calls[0]![0];
    expect(payload.type).toBe("VIEWS");
    expect(payload.format).toBe("CSV");
    expect(payload.unmaskPii).toBe(false);
    // `from`/`to` yerel gün seçiminden GERÇEK UTC gün başı/sonuna normalize edilir.
    expect(payload.from).toBe("2026-06-01T00:00:00.000Z");
    expect(payload.to).toBe("2026-06-30T23:59:59.999Z");

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("job-42"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("mutation.isError olduğunda üst seviyede bir hata Alert'i gösterilir (dialog KAPANMAZ)", () => {
    // NOT: gerçek bir reddedilen `mutateAsync` çağrısı tetiklemiyoruz — `onSubmit`
    // (bkz. create-export-dialog.tsx) `mutation.mutateAsync`'i try/catch OLMADAN `await`ler;
    // bu, TanStack Query'nin `mutateAsync`'i (varsayılan olarak) hata durumunda YENİDEN
    // FIRLATTIĞI göz önüne alındığında bir "unhandled promise rejection" DOĞURUR (küçük bir
    // bug — kapsamım test, davranış düzeltmesi DEĞİL; backend-agent/frontend-agent'a
    // raporlanmalı). Burada bunun yerine hook'un `isError`/`error` DURUMUNU doğrudan simüle
    // ederiz — bu, bileşenin hata Alert'ini DOĞRU render ettiğini, gerçek reddi tetiklemeden
    // doğrular.
    mutationState.isError = true;
    mutationState.error = new Error("ağ hatası");
    try {
      renderDialog();
      expect(screen.getByText("Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.")).toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    } finally {
      mutationState.isError = false;
      mutationState.error = null;
    }
  });
});
