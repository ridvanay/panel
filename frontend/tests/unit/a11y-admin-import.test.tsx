import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import AdminImportPage from "@/app/admin/import/page";
import type { ImportJobSummary, Page, User } from "@/lib/api/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/lib/api/import", () => ({
  listImportJobs: vi.fn(),
  createImportJob: vi.fn(),
  getImportJob: vi.fn(),
  deleteImportJob: vi.fn(),
  startImportJob: vi.fn(),
  cancelImportJob: vi.fn(),
  listImportJobErrors: vi.fn(),
}));

let mockUser: User;
vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({ user: mockUser }),
}));

// `ImportUploadDialog` artık `useModules()` ile PRODUCTS kartını modül-farkında filtreliyor
// (bkz. import-type-config.ts::visibleImportTypeConfigs) — `a11y-admin-modules.test.tsx` ile
// AYNI mock deseni; `products` modülü açık varsayılır ki kart listede test edilebilsin.
vi.mock("@/context/modules-context", () => ({
  useModules: () => ({ isModuleEnabled: () => true }),
}));

const importApi = await import("@/lib/api/import");

const axeOptions = { rules: { region: { enabled: false } } };

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "admin@example.com",
    name: "Admin Kullanıcı",
    avatarUrl: null,
    emailVerifiedAt: "2026-01-01T00:00:00.000Z",
    role: "ADMIN",
    createdAt: "2026-01-01T00:00:00.000Z",
    twoFactorEnabled: false,
    ...overrides,
  };
}

const jobs: ImportJobSummary[] = [
  {
    id: "job-1",
    type: "PAGES",
    format: "CSV",
    status: "COMPLETED",
    duplicateStrategy: "skip",
    filename: "sayfalar.csv",
    sizeBytes: 4096,
    totalCount: 10,
    processedCount: 10,
    successCount: 9,
    errorCount: 1,
    skippedCount: 0,
    errorSummary: null,
    createdById: "user-1",
    createdBy: { id: "user-1", name: "Admin Kullanıcı", email: "admin@example.com", avatarUrl: null },
    createdAt: "2026-08-01T10:00:00.000Z",
    startedAt: "2026-08-01T10:00:05.000Z",
    finishedAt: "2026-08-01T10:00:30.000Z",
  },
  {
    id: "job-2",
    type: "USERS",
    format: "CSV",
    status: "PROCESSING",
    duplicateStrategy: "skip",
    filename: "kullanicilar.csv",
    sizeBytes: 2048,
    totalCount: 50,
    processedCount: 20,
    successCount: 20,
    errorCount: 0,
    skippedCount: 0,
    errorSummary: null,
    createdById: "user-1",
    createdBy: { id: "user-1", name: "Admin Kullanıcı", email: "admin@example.com", avatarUrl: null },
    createdAt: "2026-08-02T10:00:00.000Z",
    startedAt: "2026-08-02T10:00:05.000Z",
    finishedAt: null,
  },
  {
    id: "job-3",
    type: "WORDPRESS",
    format: "XML",
    status: "FAILED",
    duplicateStrategy: null,
    filename: "export.xml",
    sizeBytes: 8192,
    totalCount: 0,
    processedCount: 0,
    successCount: 0,
    errorCount: 0,
    skippedCount: 0,
    errorSummary: "Dosya ayrıştırılamadı.",
    createdById: null,
    createdBy: null,
    createdAt: "2026-08-03T10:00:00.000Z",
    startedAt: null,
    finishedAt: "2026-08-03T10:00:01.000Z",
  },
];

const jobsPage: Page<ImportJobSummary> = { items: jobs, meta: { nextCursor: null } };

describe("AdminImportPage — ADMIN — a11y", () => {
  it("COMPLETED/PROCESSING/FAILED durumlarını içeren iş listesi yüklendikten sonra kritik/ciddi a11y ihlali içermez", async () => {
    mockUser = makeUser({ role: "ADMIN" });
    vi.mocked(importApi.listImportJobs).mockResolvedValue(jobsPage);

    const { container } = render(<AdminImportPage />);

    expect(await screen.findByText("sayfalar.csv")).toBeInTheDocument();
    expect(screen.getByText("kullanicilar.csv")).toBeInTheDocument();
    expect(screen.getByText("export.xml")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("\"Yeni İçe Aktarma\" diyaloğu açıldıktan sonra da kritik/ciddi a11y ihlali içermez", async () => {
    mockUser = makeUser({ role: "ADMIN" });
    vi.mocked(importApi.listImportJobs).mockResolvedValue(jobsPage);

    const user = userEvent.setup();
    const { container } = render(<AdminImportPage />);

    await screen.findByText("sayfalar.csv");
    await user.click(screen.getByRole("button", { name: /Yeni İçe Aktarma/ }));

    expect(await screen.findByRole("radiogroup", { name: "İçe aktarma türü" })).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});

describe("AdminImportPage — EDITOR (ADMIN-only sayfa GERÇEKTEN mount edilmez)", () => {
  it("erişim reddedildi durumu render edilir ve iş listesi API'si HİÇ çağrılmaz; kritik/ciddi a11y ihlali içermez", async () => {
    mockUser = makeUser({ role: "EDITOR" });
    vi.mocked(importApi.listImportJobs).mockClear();

    const { container } = render(<AdminImportPage />);

    expect(await screen.findByText("Bu bölüme erişiminiz yok")).toBeInTheDocument();
    expect(importApi.listImportJobs).not.toHaveBeenCalled();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
