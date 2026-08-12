import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { KeyboardShortcutsModal } from "@/components/admin/keyboard-shortcuts-modal";
import { I18nProvider } from "@/context/i18n-context";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const axeOptions = { rules: { region: { enabled: false } } };

describe("KeyboardShortcutsModal — a11y ve klavye davranışı", () => {
  it("'?' tuşuna basınca açılır ve kritik/ciddi a11y ihlali içermez", async () => {
    const { container } = render(<I18nProvider><KeyboardShortcutsModal /></I18nProvider>);

    expect(screen.queryByText("Klavye Kısayolları")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "?" });

    expect(await screen.findByText("Klavye Kısayolları")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("modal açıkken odak içeride tutulur (focus-trap)", async () => {
    const user = userEvent.setup();
    render(<I18nProvider><KeyboardShortcutsModal /></I18nProvider>);

    fireEvent.keyDown(document, { key: "?" });
    await screen.findByText("Klavye Kısayolları");

    await waitFor(() => {
      expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    });

    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 8; i++) {
      await user.tab();
      await waitFor(() => {
        expect(dialog.contains(document.activeElement)).toBe(true);
      });
    }
  });

  it("ESC tuşuna basınca modal kapanır", async () => {
    const user = userEvent.setup();
    render(<I18nProvider><KeyboardShortcutsModal /></I18nProvider>);

    fireEvent.keyDown(document, { key: "?" });
    await screen.findByText("Klavye Kısayolları");

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByText("Klavye Kısayolları")).not.toBeInTheDocument();
    });
  });

  it("bir input içine yazarken '?' global kısayolu tetiklemez (isTypingTarget koruması)", async () => {
    render(
      <I18nProvider>
        <div>
          <input aria-label="arama" />
          <KeyboardShortcutsModal />
        </div>
      </I18nProvider>
    );

    const input = screen.getByLabelText("arama");
    input.focus();
    fireEvent.keyDown(input, { key: "?" });

    expect(screen.queryByText("Klavye Kısayolları")).not.toBeInTheDocument();
  });
});
