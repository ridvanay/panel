import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { NavTreeEditor } from "@/components/admin/navigation/nav-tree-editor";
import type { FlatNavItem } from "@/components/admin/navigation/nav-tree-utils";

const HREF_HINT = "test hint";
const axeOptions = { rules: { region: { enabled: false } } };

function Harness({ initial, onChange }: { initial: FlatNavItem[]; onChange?: (items: FlatNavItem[]) => void }) {
  const [items, setItems] = useState(initial);
  return (
    <NavTreeEditor
      items={items}
      hrefHint={HREF_HINT}
      onChange={(next) => {
        setItems(next);
        onChange?.(next);
      }}
    />
  );
}

describe("NavTreeEditor", () => {
  it("öğe yokken EmptyState gösterir", () => {
    render(<Harness initial={[]} />);
    expect(screen.getByText("Menü öğesi yok")).toBeInTheDocument();
  });

  it("kök + alt öğeleri girintili render eder, alt öğenin indent butonu devre dışıdır", () => {
    const items: FlatNavItem[] = [
      { id: "a", label: "Ana Sayfa", href: "/", parentId: null },
      { id: "a1", label: "Alt Sayfa", href: "/alt", parentId: "a" },
    ];
    render(<Harness initial={items} />);

    expect(screen.getByText("Ana Sayfa")).toBeInTheDocument();
    expect(screen.getByText("Alt Sayfa")).toBeInTheDocument();

    const indentButtons = screen.getAllByRole("button", { name: "Girinti artır (alt öğe yap)" });
    // "Ana Sayfa" tek kök öğe olduğu için indent edilemez (önünde başka kök yok);
    // "Alt Sayfa" zaten derinlik 1 olduğu için indent HER ZAMAN devre dışı.
    expect(indentButtons.every((btn) => btn.hasAttribute("disabled"))).toBe(true);
  });

  it("ikinci kök öğe indent edilince önceki kökün altına taşınır", async () => {
    const items: FlatNavItem[] = [
      { id: "a", label: "Ana Sayfa", href: "/", parentId: null },
      { id: "b", label: "Hakkımızda", href: "/hakkimizda", parentId: null },
    ];
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial={items} onChange={onChange} />);

    const indentButtons = screen.getAllByRole("button", { name: "Girinti artır (alt öğe yap)" });
    // İkinci satır ("Hakkımızda") indent edilebilir olmalı.
    await user.click(indentButtons[1]!);

    expect(onChange).toHaveBeenCalledWith([
      { id: "a", label: "Ana Sayfa", href: "/", parentId: null },
      { id: "b", label: "Hakkımızda", href: "/hakkimizda", parentId: "a" },
    ]);
  });

  it("bir satırın 'Düzenle' paneli açılınca Etiket/Bağlantı düzenlenebilir ve 'Kaldır' öğeyi siler", async () => {
    const items: FlatNavItem[] = [{ id: "a", label: "Ana Sayfa", href: "/", parentId: null }];
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial={items} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Düzenle" }));
    const labelInput = screen.getByLabelText("Etiket");
    await user.clear(labelInput);
    await user.type(labelInput, "Yeni Etiket");
    expect(onChange).toHaveBeenLastCalledWith([{ id: "a", label: "Yeni Etiket", href: "/", parentId: null }]);

    await user.click(screen.getByRole("button", { name: "Kaldır" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("kök öğe silinince alt öğeleri de kaskad olarak silinir", async () => {
    const items: FlatNavItem[] = [
      { id: "a", label: "Ana Sayfa", href: "/", parentId: null },
      { id: "a1", label: "Alt Sayfa", href: "/alt", parentId: "a" },
    ];
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial={items} onChange={onChange} />);

    const editButtons = screen.getAllByRole("button", { name: "Düzenle" });
    await user.click(editButtons[0]!);
    await user.click(screen.getByRole("button", { name: "Kaldır" }));

    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("kritik/ciddi a11y ihlali içermez", async () => {
    const items: FlatNavItem[] = [
      { id: "a", label: "Ana Sayfa", href: "/", parentId: null },
      { id: "a1", label: "Alt Sayfa", href: "/alt", parentId: "a" },
      { id: "b", label: "Hakkımızda", href: "/hakkimizda", parentId: null },
    ];
    const { container } = render(<Harness initial={items} />);
    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});
