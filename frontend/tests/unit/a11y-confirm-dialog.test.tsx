import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const axeOptions = { rules: { region: { enabled: false } } };

describe("ConfirmDialog — a11y ve klavye davranışı (content-list kalıcı silme onayı)", () => {
  it("yıkıcı (destructive) onay modalı kritik/ciddi a11y ihlali içermez", async () => {
    const { container } = render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Sayfayı kalıcı sil"
        description={'"Örnek Sayfa" sayfasını kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz.'}
        confirmText="Kalıcı Sil"
        destructive
        onConfirm={vi.fn()}
      />
    );

    expect(await screen.findByText("Sayfayı kalıcı sil")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("modal açıldığında odak içeride tutulur (focus-trap)", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Sayfayı kalıcı sil"
        description="Bu işlem geri alınamaz."
        confirmText="Kalıcı Sil"
        destructive
        onConfirm={vi.fn()}
      />
    );

    await screen.findByText("Sayfayı kalıcı sil");

    const dialog = screen.getByRole("dialog");
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    for (let i = 0; i < 8; i++) {
      await user.tab();
      await waitFor(() => {
        expect(dialog.contains(document.activeElement)).toBe(true);
      });
    }
  });

  it("ESC tuşuna basınca onOpenChange(false) çağrılır", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Sayfayı kalıcı sil"
        confirmText="Kalıcı Sil"
        destructive
        onConfirm={vi.fn()}
      />
    );

    await screen.findByText("Sayfayı kalıcı sil");
    await user.keyboard("{Escape}");

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("'Vazgeç' tıklanınca onOpenChange(false), 'Kalıcı Sil' tıklanınca onConfirm çağrılır", async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Sayfayı kalıcı sil"
        confirmText="Kalıcı Sil"
        destructive
        onConfirm={onConfirm}
      />
    );

    await user.click(screen.getByRole("button", { name: "Kalıcı Sil" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
