import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Link from "next/link";
import { useUnsavedChangesGuard, UNSAVED_CHANGES_WARNING } from "@/hooks/use-unsaved-changes-guard";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/appearance",
}));

function TestHarness({ enabled }: { enabled: boolean }) {
  const { confirmDiscard } = useUnsavedChangesGuard({ enabled });
  return (
    <div>
      <Link href="/admin/settings">Ayarlar&apos;a git</Link>
      <Link href="/admin/appearance">Aynı sayfa</Link>
      <a href="https://example.com">Dış bağlantı</a>
      <button type="button" onClick={() => confirmDiscard()}>
        Sekme değiştir
      </button>
    </div>
  );
}

describe("useUnsavedChangesGuard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enabled=false iken beforeunload olayını engellemez ve confirmDiscard hep true döner", () => {
    render(<TestHarness enabled={false} />);
    const event = new Event("beforeunload", { cancelable: true });
    const prevented = !window.dispatchEvent(event);
    expect(prevented).toBe(false);
  });

  it("enabled=true iken beforeunload olayını engeller (native tarayıcı uyarısı tetiklenir)", () => {
    render(<TestHarness enabled={true} />);
    const event = new Event("beforeunload", { cancelable: true });
    const prevented = !window.dispatchEvent(event);
    expect(prevented).toBe(true);
  });

  it("enabled=true iken bir /admin bağlantısına tıklanınca window.confirm ile onay ister; iptal edilirse gezinme durur", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<TestHarness enabled={true} />);

    await user.click(screen.getByRole("link", { name: "Ayarlar'a git" }));

    expect(confirmSpy).toHaveBeenCalledWith(UNSAVED_CHANGES_WARNING);
  });

  it("aynı sayfaya (mevcut pathname) veya /admin dışı bir bağlantıya tıklanınca onay İSTEMEZ", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<TestHarness enabled={true} />);

    await user.click(screen.getByRole("link", { name: "Aynı sayfa" }));
    await user.click(screen.getByRole("link", { name: "Dış bağlantı" }));

    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("confirmDiscard() enabled=true iken window.confirm çağırır ve dönen değeri yansıtır", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<TestHarness enabled={true} />);

    await user.click(screen.getByRole("button", { name: "Sekme değiştir" }));

    expect(confirmSpy).toHaveBeenCalledWith(UNSAVED_CHANGES_WARNING);
  });

  it("confirmDiscard() enabled=false iken window.confirm HİÇ çağırmadan true döner", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const user = userEvent.setup();
    render(<TestHarness enabled={false} />);

    await user.click(screen.getByRole("button", { name: "Sekme değiştir" }));

    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
