import { describe, expect, it } from "vitest";
import {
  IMPORT_TYPE_CONFIGS,
  importTypeConfig,
  importTypeLabel,
  visibleImportTypeConfigs,
} from "@/components/admin/import/import-type-config";

describe("import-type-config", () => {
  it("PRODUCTS kartı openapi.yaml/ARCHITECTURE.md §10.8.9 limitleriyle BİREBİR tanımlıdır", () => {
    const config = importTypeConfig("PRODUCTS");
    expect(config.accept).toContain(".xml");
    expect(config.accept).not.toContain(".csv");
    expect(config.maxSizeLabel).toBe("50 MB");
    expect(config.maxRecordsLabel).toContain("5.000");
    expect(config.module).toBe("products");
  });

  it("importTypeLabel PRODUCTS için doğru Türkçe etiketi döner", () => {
    expect(importTypeLabel("PRODUCTS")).toBe("WooCommerce Ürünleri");
  });
});

describe("visibleImportTypeConfigs — modül filtresi (sidebar.tsx::filterVisibleNavItems ile AYNI desen)", () => {
  it("`products` modülü açıkken PRODUCTS kartı listede görünür", () => {
    const visible = visibleImportTypeConfigs(IMPORT_TYPE_CONFIGS, () => true);
    expect(visible.some((c) => c.type === "PRODUCTS")).toBe(true);
  });

  it("`products` modülü kapalıyken PRODUCTS kartı listeden GİZLENİR", () => {
    const visible = visibleImportTypeConfigs(IMPORT_TYPE_CONFIGS, (key) => key !== "products");
    expect(visible.some((c) => c.type === "PRODUCTS")).toBe(false);
  });

  it("modül alanı olmayan kartlar (PAGES/BLOG/WORDPRESS/USERS/MEDIA) modül durumundan ETKİLENMEZ", () => {
    const visible = visibleImportTypeConfigs(IMPORT_TYPE_CONFIGS, () => false);
    const nonModuleTypes = visible.map((c) => c.type);
    expect(nonModuleTypes).toEqual(expect.arrayContaining(["PAGES", "BLOG", "WORDPRESS", "USERS", "MEDIA"]));
    expect(nonModuleTypes).not.toContain("PRODUCTS");
  });
});
