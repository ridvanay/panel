import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import AdminLogsPage from "@/app/admin/logs/page";
import type { AuditLog, Page } from "@/lib/api/types";

vi.mock("@/lib/api/logs", () => ({
  listAuditLogs: vi.fn(),
}));

const logsApi = await import("@/lib/api/logs");

const axeOptions = { rules: { region: { enabled: false } } };

const logs: AuditLog[] = [
  {
    id: "log-1",
    actorId: "user-1",
    actorEmail: "editor@example.com",
    action: "post.update",
    status: "SUCCESS",
    targetType: "post",
    targetId: "post-1",
    metadata: null,
    ipAddress: "127.0.0.1",
    createdAt: "2026-08-01T10:00:00.000Z",
  },
  {
    id: "log-2",
    actorId: "user-2",
    actorEmail: "viewer@example.com",
    action: "login",
    status: "FAILURE",
    targetType: null,
    targetId: null,
    metadata: null,
    ipAddress: "10.0.0.2",
    createdAt: "2026-08-01T11:00:00.000Z",
  },
  {
    id: "log-3",
    actorId: "user-3",
    actorEmail: "guest@example.com",
    action: "settings.update",
    status: "FORBIDDEN",
    targetType: "settings",
    targetId: null,
    metadata: null,
    ipAddress: "10.0.0.3",
    createdAt: "2026-08-01T12:00:00.000Z",
  },
];

const logsPage: Page<AuditLog> = { items: logs, meta: { nextCursor: null } };

describe("AdminLogsPage — a11y", () => {
  it("SUCCESS/FAILURE/FORBIDDEN durumlarını içeren log listesi yüklendikten sonra kritik/ciddi a11y ihlali içermez", async () => {
    vi.mocked(logsApi.listAuditLogs).mockResolvedValue(logsPage);

    const { container } = render(<AdminLogsPage />);

    expect(await screen.findByText("post.update")).toBeInTheDocument();
    expect(screen.getByText("login")).toBeInTheDocument();
    expect(screen.getByText("settings.update")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("durum filtresi sekmesi değiştirildikten sonra da kritik/ciddi a11y ihlali içermez", async () => {
    vi.mocked(logsApi.listAuditLogs).mockResolvedValue(logsPage);

    const user = userEvent.setup();
    const { container } = render(<AdminLogsPage />);

    await screen.findByText("post.update");
    await user.click(screen.getByRole("button", { name: "İzin Reddedildi" }));

    expect(logsApi.listAuditLogs).toHaveBeenCalledWith({ status: "FORBIDDEN" });

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
