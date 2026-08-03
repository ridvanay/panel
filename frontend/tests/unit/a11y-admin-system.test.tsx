import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import AdminSystemHealthPage from "@/app/admin/system/page";
import type { SystemHealthDto } from "@/lib/api/types";

vi.mock("@/lib/api/system", () => ({ getSystemHealth: vi.fn() }));

const systemApi = await import("@/lib/api/system");

const axeOptions = { rules: { region: { enabled: false } } };

const health: SystemHealthDto = {
  dbPingMs: 12,
  dbSizeBytes: 1024 * 1024 * 40,
  dbQuotaBytes: 1024 * 1024 * 1024,
  mediaStorageBytes: 1024 * 1024 * 100,
  mediaStorageQuotaBytes: 1024 * 1024 * 1024 * 5,
  memoryUsedBytes: 1024 * 1024 * 512,
  memoryTotalBytes: 1024 * 1024 * 1024 * 4,
  processMemoryBytes: 1024 * 1024 * 80,
  loadAverage: [0.5, 0.4, 0.3],
  platform: "linux",
  uptimeSeconds: 3661,
  checkedAt: "2026-08-01T12:00:00.000Z",
};

describe("AdminSystemHealthPage — a11y", () => {
  it("sağlık metrikleri yüklendikten sonra kritik/ciddi a11y ihlali içermez", async () => {
    vi.mocked(systemApi.getSystemHealth).mockResolvedValue(health);

    const { container } = render(<AdminSystemHealthPage />);

    expect(await screen.findByText("Veritabanı Ping")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
