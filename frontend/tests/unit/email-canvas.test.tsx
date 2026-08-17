import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmailCanvas } from "@/components/admin/email-editor/email-canvas";
import { createEmailBlock } from "@/lib/email-blocks/registry";
import type { EmailBlock } from "@/lib/api/types";

function Harness({ initial, onSelect }: { initial: EmailBlock[]; onSelect?: (id: string | null) => void }) {
  const [blocks, setBlocks] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <EmailCanvas
      blocks={blocks}
      onChange={setBlocks}
      selectedBlockId={selected}
      onSelect={(id) => {
        setSelected(id);
        onSelect?.(id);
      }}
    />
  );
}

describe("EmailCanvas", () => {
  it("blok yokken boş durum mesajı gösterir", () => {
    render(<Harness initial={[]} />);
    expect(screen.getByText(/Henüz blok yok/)).toBeInTheDocument();
  });

  it("bloğa tıklanınca seçilir ve 'Düzenleniyor' rozeti görünür", async () => {
    const user = userEvent.setup();
    const heading = createEmailBlock("heading");
    render(<Harness initial={[heading]} />);
    await user.click(screen.getByText("Başlık"));
    expect(screen.getByText("Düzenleniyor")).toBeInTheDocument();
  });

  it("Yukarı/Aşağı butonları blok sırasında ilk/son öğeleri doğru devre dışı bırakır", () => {
    const a = createEmailBlock("heading");
    const b = createEmailBlock("text");
    render(<Harness initial={[a, b]} />);

    const upButtons = screen.getAllByRole("button", { name: "Yukarı taşı" });
    // İlk blok için "Yukarı" disabled olmalı.
    expect(upButtons[0]).toBeDisabled();

    const downButtons = screen.getAllByRole("button", { name: "Aşağı taşı" });
    expect(downButtons[1]).toBeDisabled();
  });

  it("Sil butonu bloğu kaldırır", async () => {
    const user = userEvent.setup();
    const a = createEmailBlock("heading");
    render(<Harness initial={[a]} />);
    await user.click(screen.getByRole("button", { name: "Bloğu sil" }));
    expect(screen.getByText(/Henüz blok yok/)).toBeInTheDocument();
  });
});
