import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  /** design-notes-header-colors.md §4 — native `<input type="color">` ASLA alfa döndürmez;
   * `ColorField` mevcut alfa son ekini KORUMALI (aksi halde her swatch değişikliği alfayı sessizce `ff`'e düşürür). */
  it("alfa-kanallı bir alanda (maxLength=9) native swatch değişikliğinde mevcut alfa son ekini korur", () => {
    const onChange = vi.fn();
    render(
      <ColorField id="headerBgColor" label="Menü Arka Planı" value="#ffffffcc" onChange={onChange} maxLength={9} />
    );

    const swatch = screen.getByLabelText("Menü Arka Planı — renk seçici");
    // Native `<input type="color">` HER ZAMAN 7 karakter (#rrggbb) döner.
    fireEvent.change(swatch, { target: { value: "#112233" } });

    expect(onChange).toHaveBeenCalledWith("#112233cc");
  });

  it("swatch'ın native value'su alfasız (ilk 7 karakter) gösterilir — 9 haneli value tarayıcı tarafından reddedilebilir", () => {
    render(
      <ColorField id="headerBgColor" label="Menü Arka Planı" value="#ffffffcc" onChange={() => {}} maxLength={9} />
    );

    const swatch = screen.getByLabelText("Menü Arka Planı — renk seçici") as HTMLInputElement;
    expect(swatch.value).toBe("#ffffff");
  });

  it("alfa-kanallı OLMAYAN bir alanda (maxLength=7) swatch değişikliği hiçbir son ek eklemeden onChange'i çağırır", () => {
    const onChange = vi.fn();
    render(<ColorField id="primaryColor" label="Birincil Renk" value="#4f46e5" onChange={onChange} />);

    const swatch = screen.getByLabelText("Birincil Renk — renk seçici");
    fireEvent.change(swatch, { target: { value: "#000000" } });

    expect(onChange).toHaveBeenCalledWith("#000000");
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
