import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useAutosave } from "@/hooks/use-autosave";

/**
 * `useAutosave` — sade `setTimeout`/`useEffect` tabanlı bir hook (TanStack Query DEĞİL), bu
 * yüzden `use-export-jobs-polling.test.tsx`'teki "fake timer'lar TanStack Query ile güvenilmez"
 * uyarısı BURADA geçerli değil — `vi.useFakeTimers()` sorunsuz çalışır.
 */
describe("useAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("değerler değiştikten 3sn sonra save() çağrılır, öncesinde ÇAĞRILMAZ", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAutosave({ values: ["a"], save, enabled: true }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999);
    });
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("ardışık değişikliklerde debounce sıfırlanır — yalnızca SON değişiklikten 3sn sonra bir kez çağrılır", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ values }) => useAutosave({ values, save, enabled: true }), {
      initialProps: { values: ["a"] as unknown[] },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(save).not.toHaveBeenCalled();

    // 2sn'de yeni bir değişiklik gelir — bekleyen zamanlayıcı İPTAL edilip yeniden başlar.
    rerender({ values: ["b"] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("status: idle -> saving -> saved geçişini yapar, lastSavedAt set edilir", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave({ values: ["a"], save, enabled: true }));

    expect(result.current.status).toBe("idle");
    expect(result.current.lastSavedAt).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(result.current.status).toBe("saved");
    expect(result.current.lastSavedAt).not.toBeNull();
  });

  it("save() reddedilirse status 'error' olur, akış KESİLMEZ", async () => {
    const save = vi.fn().mockRejectedValue(new Error("ağ hatası"));
    const { result } = renderHook(() => useAutosave({ values: ["a"], save, enabled: true }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(result.current.status).toBe("error");
  });

  it("enabled: false iken hiçbir zamanlayıcı kurulmaz, save() hiç ÇAĞRILMAZ", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useAutosave({ values: ["a"], save, enabled: false }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(save).not.toHaveBeenCalled();
  });

  it("unmount olduğunda bekleyen debounce temizlenir — save() ÇAĞRILMAZ (memory leak/stale update önleme)", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useAutosave({ values: ["a"], save, enabled: true }));

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(save).not.toHaveBeenCalled();
  });
});
