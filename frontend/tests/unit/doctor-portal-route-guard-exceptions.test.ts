import { describe, expect, it } from "vitest";
import { isDoctorSharedRouteException } from "@/components/site/doctor-portal-route-guard";

/** §5.6.1 + §5.6.2 + Paket AG İş 3 (S10) — doktor oturumunun ana vitrinde kalabildiği YALNIZCA dar istisnalar. */
describe("isDoctorSharedRouteException", () => {
  it("konsültasyon odası ve blog taslak önizlemesi (dil önekli/öneksiz) istisnadır", () => {
    for (const path of ["/consultation/abc", "/tr/consultation/abc", "/blog/preview/123e4567", "/en/blog/preview/123e4567", "/sr-latn/blog/preview/x"]) {
      expect(isDoctorSharedRouteException(path), path).toBe(true);
    }
  });

  it("harici toplantı: ev sahibi odası `/meet/{id}` ve misafir girişi `/meet/join` (dil önekli/öneksiz) istisnadır", () => {
    for (const path of ["/meet/join", "/en/meet/join", "/meet/abc", "/en/meet/abc", "/tr/meet/123e4567-e89b", "/sr-latn/meet/x"]) {
      expect(isDoctorSharedRouteException(path), path).toBe(true);
    }
  });

  it("`/meeting`, çıplak `/meet`, daha derin `/meet/...` yolları ve benzer önekler istisna DEĞİLDİR", () => {
    for (const path of ["/en/meeting", "/meeting", "/meeting/abc", "/meet", "/en/meet", "/meet/", "/meet/a/b", "/en/meet/join/extra", "/meets/abc", "/en/blog/meet/abc", "/doctor/meetings"]) {
      expect(isDoctorSharedRouteException(path), path).toBe(false);
    }
  });

  it("diğer blog ve site sayfaları istisna DEĞİLDİR", () => {
    for (const path of ["/blog", "/en/blog", "/blog/some-post", "/en/blog/some-post", "/blog/preview", "/blog/preview/x/extra", "/products", "/consultation", "/", null]) {
      expect(isDoctorSharedRouteException(path), String(path)).toBe(false);
    }
  });
});
