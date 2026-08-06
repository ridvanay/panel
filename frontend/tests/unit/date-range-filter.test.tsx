import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateRangeFilter } from "@/components/admin/stats/date-range-filter";
import type { StatsFilterState } from "@/lib/stats-range";

/**
 * `DateRangeFilter` — preset seçimi (7/30/90/YTD/özel), özel aralık tarih girişleri ve
 * granularity seçicisinin davranış testi. Saf tarih ARİTMETİĞİ (`computePresetRange` vb.)
 * zaten `tests/unit/stats-range.test.ts`'te kapsanıyor; bu dosya BİLEŞENİN kontrollü
 * (value/onChange) davranışını doğrular — `admin/stats/page.tsx`'in URL query param
 * senkronizasyonu bu bileşenin `onChange`'ine bağlı olduğundan, `onChange`'e giden state'in
 * DOĞRU şekilde üretildiğini doğrulamak dolaylı olarak URL senkronizasyonunu da garanti eder.
 */
const baseState: StatsFilterState = { preset: "30d", from: "2026-07-08", to: "2026-08-06", granularity: "day" };

describe("DateRangeFilter", () => {
  it("mevcut preset'i aktif sekme olarak render eder", () => {
    render(<DateRangeFilter value={baseState} onChange={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "30 gün" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "7 gün" })).toHaveAttribute("aria-selected", "false");
  });

  it("varsayılan (30d) preset'te özel tarih aralığı girişleri GÖRÜNMEZ", () => {
    render(<DateRangeFilter value={baseState} onChange={vi.fn()} />);
    expect(screen.queryByLabelText("Başlangıç tarihi")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Bitiş tarihi")).not.toBeInTheDocument();
  });

  it("bir preset'e (7 gün) tıklamak, o preset'in hesaplanan from/to'suyla onChange çağırır, mevcut granularity korunur", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateRangeFilter value={{ ...baseState, granularity: "week" }} onChange={onChange} />);

    await user.click(screen.getByRole("tab", { name: "7 gün" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as StatsFilterState;
    expect(next.preset).toBe("7d");
    expect(next.granularity).toBe("week");
    // `from`/`to` computePresetRange("7d")'den türetilir — tam değer stats-range.test.ts'te
    // zaten doğrulanıyor, burada sadece BİLEŞENİN doğru fonksiyonu çağırdığını (gerçek bir
    // tarih aralığı ürettiğini) doğrularız.
    expect(next.from <= next.to).toBe(true);
    expect(next.from).not.toBe(baseState.from);
  });

  it("\"Özel aralık\" sekmesine tıklamak preset'i custom'a çevirir ve tarih girişlerini gösterir", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<DateRangeFilter value={baseState} onChange={onChange} />);

    await user.click(screen.getByRole("tab", { name: "Özel aralık" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as StatsFilterState;
    expect(next.preset).toBe("custom");

    rerender(<DateRangeFilter value={next} onChange={onChange} />);
    expect(screen.getByLabelText("Başlangıç tarihi")).toBeInTheDocument();
    expect(screen.getByLabelText("Bitiş tarihi")).toBeInTheDocument();
  });

  it("özel aralıkta başlangıç/bitiş tarihini değiştirmek onChange'i güncellenmiş from/to ile çağırır", () => {
    const onChange = vi.fn();
    const customState: StatsFilterState = { preset: "custom", from: "2026-03-01", to: "2026-03-15", granularity: "day" };
    render(<DateRangeFilter value={customState} onChange={onChange} />);

    // `<input type="date">` — `userEvent.type` jsdom'da bu tip alanlarda güvenilir değil,
    // native `fireEvent.change` ile `target.value` doğrudan set edilir (native tarayıcı tarih
    // seçici davranışının test ortamındaki eşdeğeri).
    fireEvent.change(screen.getByLabelText("Başlangıç tarihi"), { target: { value: "2026-03-05" } });
    expect(onChange).toHaveBeenCalledWith({ ...customState, from: "2026-03-05" });

    onChange.mockClear();
    fireEvent.change(screen.getByLabelText("Bitiş tarihi"), { target: { value: "2026-03-20" } });
    expect(onChange).toHaveBeenCalledWith({ ...customState, to: "2026-03-20" });
  });

  it("gruplama (granularity) seçicisini değiştirmek onChange'i güncellenmiş granularity ile çağırır, preset/from/to KORUNUR", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateRangeFilter value={baseState} onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText("Zaman aralığı gruplama"), "month");

    expect(onChange).toHaveBeenCalledWith({ ...baseState, granularity: "month" });
  });
});
