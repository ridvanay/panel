import { describe, expect, it } from "vitest";
import { isDoctorSharedRouteException } from "@/components/site/doctor-portal-route-guard";

/** §5.6.1 + §5.6.2 — doktor oturumunun ana vitrinde kalabildiği YALNIZCA iki dar istisna. */
describe("isDoctorSharedRouteException", () => {
  it("konsültasyon odası ve blog taslak önizlemesi (dil önekli/öneksiz) istisnadır", () => {
    for (const path of ["/consultation/abc", "/tr/consultation/abc", "/blog/preview/123e4567", "/en/blog/preview/123e4567", "/sr-latn/blog/preview/x"]) {
      expect(isDoctorSharedRouteException(path), path).toBe(true);
    }
  });

  it("diğer blog ve site sayfaları istisna DEĞİLDİR", () => {
    for (const path of ["/blog", "/en/blog", "/blog/some-post", "/en/blog/some-post", "/blog/preview", "/blog/preview/x/extra", "/products", "/consultation", "/", null]) {
      expect(isDoctorSharedRouteException(path), String(path)).toBe(false);
    }
  });
});
