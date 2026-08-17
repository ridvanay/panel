import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmailBlockSettingsPanel } from "@/components/admin/email-editor/block-settings-panel";
import { useVariableTarget } from "@/hooks/use-variable-target";
import { createEmailBlock } from "@/lib/email-blocks/registry";
import type { EmailBlock, EmailHeadingBlock } from "@/lib/api/types";

function Harness({ initial }: { initial: EmailHeadingBlock }) {
  const [block, setBlock] = useState<EmailBlock>(initial);
  const target = useVariableTarget();
  return (
    <>
      <EmailBlockSettingsPanel block={block} onChange={setBlock} target={target} />
      <button type="button" onClick={() => target.insertVariable("user_name")}>
        __insert__
      </button>
    </>
  );
}

describe("EmailBlockSettingsPanel", () => {
  it("başlık bloğu için İçerik/Hizalama/Renk/Boşluk bölümlerini render eder", () => {
    render(<Harness initial={createEmailBlock("heading") as EmailHeadingBlock} />);
    expect(screen.getByText("İçerik")).toBeInTheDocument();
    expect(screen.getByText("Hizalama")).toBeInTheDocument();
    expect(screen.getByText("Renk")).toBeInTheDocument();
    expect(screen.getByText("Boşluk")).toBeInTheDocument();
  });

  it("başlık metni alanı odaklanınca useVariableTarget'a kaydolur ve değişken eklenebilir", async () => {
    const user = userEvent.setup();
    render(<Harness initial={createEmailBlock("heading") as EmailHeadingBlock} />);
    const textInput = screen.getByLabelText(/Başlık metni/);
    await user.click(textInput);
    await user.click(screen.getByText("__insert__"));
    expect((textInput as HTMLInputElement).value).toContain("{{user_name}}");
  });
});
