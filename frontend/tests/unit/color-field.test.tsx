import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ColorField, ContrastBadge } from "@/components/admin/appearance/color-field";

describe("ColorField", () => {
  it("değer değiştiğinde onChange'i çağırır", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ColorField id="primaryColor" label="Birincil Renk" value="#4f46e5" onChange={onChange} />);

    const hexInput = screen.getByLabelText("Birincil Renk — hex kod");
    await user.clear(hexInput);
    await user.type(hexInput, "#000000");

    expect(onChange).toHaveBeenCalled();
  });

  it("checkAgainst verilince ContrastBadge render eder", () => {
    render(<ColorField id="buttonColor" label="Buton Zemini" value="#4f46e5" onChange={() => {}} checkAgainst="#ffffff" />);
    expect(screen.getByText(/Kontrast yeterli/)).toBeInTheDocument();
  });

  it("checkAgainst verilmezse rozet render etmez", () => {
    render(<ColorField id="primaryColor" label="Birincil Renk" value="#4f46e5" onChange={() => {}} />);
    expect(screen.queryByText(/Kontrast/)).not.toBeInTheDocument();
  });
});

describe("ContrastBadge", () => {
  it("düşük kontrastta warning tonuyla render eder", () => {
    render(<ContrastBadge foreground="#e5e7eb" background="#ffffff" />);
    expect(screen.getByText(/Düşük kontrast/)).toBeInTheDocument();
  });

  it("yeterli kontrastta success tonuyla render eder", () => {
    render(<ContrastBadge foreground="#000000" background="#ffffff" />);
    expect(screen.getByText(/Kontrast yeterli/)).toBeInTheDocument();
  });
});
