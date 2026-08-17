import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVariableTarget } from "@/hooks/use-variable-target";

describe("useVariableTarget", () => {
  it("hedef yokken hasTarget false'tur ve insertVariable sessizce hiçbir şey yapmaz", () => {
    const { result } = renderHook(() => useVariableTarget());
    expect(result.current.hasTarget).toBe(false);
    expect(() => act(() => result.current.insertVariable("user_name"))).not.toThrow();
  });

  it("setTarget çağrılınca hasTarget true olur ve insertVariable {{key}}'i hedefin insert'ine iletir", () => {
    const { result } = renderHook(() => useVariableTarget());
    const inserted: string[] = [];

    act(() => {
      result.current.setTarget({ insert: (token) => inserted.push(token) });
    });
    expect(result.current.hasTarget).toBe(true);

    act(() => {
      result.current.insertVariable("reset_link");
    });
    expect(inserted).toEqual(["{{reset_link}}"]);
  });

  it("clearTarget hedefi temizler, hasTarget false olur", () => {
    const { result } = renderHook(() => useVariableTarget());
    act(() => {
      result.current.setTarget({ insert: () => {} });
    });
    expect(result.current.hasTarget).toBe(true);

    act(() => {
      result.current.clearTarget();
    });
    expect(result.current.hasTarget).toBe(false);
  });
});
