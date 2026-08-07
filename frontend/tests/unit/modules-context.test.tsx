import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { ModulesProvider, useModules } from "@/context/modules-context";
import type { SiteModule } from "@/lib/api/types";

vi.mock("@/lib/api/modules", () => ({
  listModules: vi.fn(),
}));

const modulesApi = await import("@/lib/api/modules");

const modules: SiteModule[] = [
  {
    key: "products",
    label: "Ürünler",
    description: "",
    enabled: false,
    updatedAt: null,
    updatedBy: null,
  },
  {
    key: "portfolio",
    label: "Portfolyo",
    description: "",
    enabled: true,
    updatedAt: null,
    updatedBy: null,
  },
];

describe("ModulesProvider / useModules", () => {
  it("registry'de kayıtlı ve enabled:false olan bir key için false döner", async () => {
    vi.mocked(modulesApi.listModules).mockResolvedValue(modules);

    const { result } = renderHook(() => useModules(), { wrapper: ModulesProvider });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isModuleEnabled("products")).toBe(false);
  });

  it("registry'de kayıtlı ve enabled:true olan bir key için true döner", async () => {
    vi.mocked(modulesApi.listModules).mockResolvedValue(modules);

    const { result } = renderHook(() => useModules(), { wrapper: ModulesProvider });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isModuleEnabled("portfolio")).toBe(true);
  });

  it("registry'de HİÇ kayıtlı olmayan bir key için HER ZAMAN true döner", async () => {
    vi.mocked(modulesApi.listModules).mockResolvedValue(modules);

    const { result } = renderHook(() => useModules(), { wrapper: ModulesProvider });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isModuleEnabled("unknown-key")).toBe(true);
  });

  it("liste boşken (Faz 1) her key için true döner", async () => {
    vi.mocked(modulesApi.listModules).mockResolvedValue([]);

    const { result } = renderHook(() => useModules(), { wrapper: ModulesProvider });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isModuleEnabled("anything")).toBe(true);
    expect(result.current.modules).toEqual([]);
  });
});
