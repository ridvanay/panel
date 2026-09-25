import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

/**
 * Hero seçenekleri (migration `20260927090000_add_slider_hero_options`): cihaza göre arka plan
 * görseli + odak noktası, "görselin tamamını göster" (`imageFit`), slayt başına okunabilirlik
 * gradyanı (varsayılan KAPALI — eskiden kodda sabitti).
 */
describe("slider hero seçenekleri", () => {
  let app: FastifyInstance;
  let accessToken: string;
  let sliderId: string;
  const media: Record<string, string> = {};

  function authHeader() {
    return { authorization: `Bearer ${accessToken}` };
  }

  async function createMedia(mimeType: string, width: number | null, height: number | null) {
    const id = randomUUID();
    await app.prisma.media.create({
      data: { id, path: `${id}.bin`, url: `/uploads/${id}.bin`, filename: "x", mimeType, sizeBytes: 10, width, height },
    });
    return id;
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    ({ accessToken } = await registerTestUser(app));
    media.desktop = await createMedia("image/jpeg", 1920, 720);
    media.tablet = await createMedia("image/jpeg", 1536, 864);
    media.mobile = await createMedia("image/jpeg", 1080, 1440);
    media.pdf = await createMedia("application/pdf", null, null);
    const res = await app.inject({ method: "POST", url: "/api/v1/admin/sliders", headers: authHeader(), payload: { name: "Hero" } });
    sliderId = res.json().data.id;
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("yeni slider `imageFit: cover` ile başlar ve `contain`'e alınabilir", async () => {
    const get = await app.inject({ method: "GET", url: `/api/v1/admin/sliders/${sliderId}`, headers: authHeader() });
    expect(get.json().data.imageFit).toBe("cover");
    const patch = await app.inject({ method: "PATCH", url: `/api/v1/admin/sliders/${sliderId}`, headers: authHeader(), payload: { imageFit: "contain" } });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.imageFit).toBe("contain");
    const bad = await app.inject({ method: "PATCH", url: `/api/v1/admin/sliders/${sliderId}`, headers: authHeader(), payload: { imageFit: "stretch" } });
    expect(bad.statusCode).toBe(422);
  });

  it("slayt: gradyan varsayılan KAPALI; cihaz görselleri, odak noktaları ve gradyan kaydedilir, public uçta döner", async () => {
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/admin/sliders/${sliderId}/slides`,
      headers: authHeader(),
      payload: { bgType: "image", bgMediaId: media.desktop },
    });
    expect(created.statusCode).toBe(201);
    const slide = created.json().data;
    expect(slide).toMatchObject({ bgScrimEnabled: false, bgScrimOpacity: 70, bgTabletMedia: null, bgMobileMedia: null, bgMobilePositionX: null });

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/sliders/${sliderId}/slides/${slide.id}`,
      headers: authHeader(),
      payload: {
        bgTabletMediaId: media.tablet,
        bgMobileMediaId: media.mobile,
        bgMobilePositionX: 50,
        bgMobilePositionY: 20,
        bgScrimEnabled: true,
        bgScrimOpacity: 40,
      },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data).toMatchObject({
      bgTabletMedia: { id: media.tablet },
      bgMobileMedia: { id: media.mobile, width: 1080, height: 1440 },
      bgMobilePositionX: 50,
      bgMobilePositionY: 20,
      bgTabletPositionX: null,
      bgScrimEnabled: true,
      bgScrimOpacity: 40,
    });

    const pub = await app.inject({ method: "GET", url: `/api/v1/sliders/${sliderId}` });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().data).toMatchObject({ imageFit: "contain", slides: [{ bgMobileMedia: { id: media.mobile }, bgScrimEnabled: true }] });

    const dup = await app.inject({ method: "POST", url: `/api/v1/admin/sliders/${sliderId}/slides/${slide.id}/duplicate`, headers: authHeader() });
    // Kopyalanan slayt ilk sırada — eskiden `renumberSlides` geçici `-1` çakışmasıyla 409 dönüyordu.
    expect(dup.statusCode).toBe(201);
    expect(dup.json().data).toMatchObject({ bgMobileMedia: { id: media.mobile }, bgMobilePositionY: 20, bgScrimOpacity: 40 });
  });

  it("görsel olmayan medya cihaz görseli olarak 422 ile reddedilir; medya silinince alan boşalır (yedeğe düşer)", async () => {
    const created = await app.inject({ method: "POST", url: `/api/v1/admin/sliders/${sliderId}/slides`, headers: authHeader(), payload: { bgType: "image" } });
    const slideId = created.json().data.id;
    const bad = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/sliders/${sliderId}/slides/${slideId}`,
      headers: authHeader(),
      payload: { bgMobileMediaId: media.pdf },
    });
    expect(bad.statusCode).toBe(422);

    const temp = await createMedia("image/png", 800, 800);
    await app.inject({ method: "PATCH", url: `/api/v1/admin/sliders/${sliderId}/slides/${slideId}`, headers: authHeader(), payload: { bgTabletMediaId: temp } });
    await app.prisma.media.delete({ where: { id: temp } });
    const row = await app.prisma.slide.findUnique({ where: { id: slideId } });
    expect(row?.bgTabletMediaId).toBeNull();
  });

  it("slider kopyalama yeni alanları taşır", async () => {
    const dup = await app.inject({ method: "POST", url: `/api/v1/admin/sliders/${sliderId}/duplicate`, headers: authHeader() });
    expect(dup.statusCode).toBe(201);
    const copy = dup.json().data;
    expect(copy.imageFit).toBe("contain");
    expect(copy.slides[0]).toMatchObject({ bgMobileMedia: { id: media.mobile }, bgScrimEnabled: true });
  });
});
