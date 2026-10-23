import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";
import {
  IMPORT_CONFIRM_KEY,
  RESTORE_CONFIRM_KEY,
  applyImportPlan,
  buildImportPlan,
  buildTranslationExport,
  readTranslationFile,
  restoreTranslations,
} from "../../src/lib/content-translations";

/**
 * Paket O (İş 4) — menü, footer, uzmanlık ve slayt çevirileri (`translations` kolonu, tek migration).
 *  - aktif dilde okunur, çeviri yoksa kanonik (EN) metne düşer; varsayılan dil (TR) de kendi çevirisini uygular
 *  - public yanıtta ham çeviri haritası yok; admin okumasında var (düzenleme formları için)
 *  - slayt: dile özel görsel YALNIZCA medya kütüphanesinden (dış URL / görsel olmayan medya 422)
 *  - export/import bu modelleri kapsar (artık `importable: true`)
 */
describe("Paket O — menü/footer/uzmanlık/slayt çevirileri", () => {
  let app: FastifyInstance;
  let token: string;
  let dir: string;
  const createdLocales: string[] = [];

  const auth = () => ({ authorization: `Bearer ${token}` });

  async function createMedia(mimeType: string) {
    const id = randomUUID();
    await app.prisma.media.create({ data: { id, path: `${id}.bin`, url: `/uploads/${id}.bin`, filename: "x", mimeType, sizeBytes: 10 } });
    return id;
  }

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    ({ accessToken: token } = await registerTestUser(app));
    await app.prisma.siteModule.upsert({ where: { key: "telehealth" }, create: { key: "telehealth", enabled: true }, update: { enabled: true } });
    for (const code of ["ru", "de"]) {
      const existing = await app.prisma.locale.findUnique({ where: { code } });
      if (!existing) createdLocales.push(code);
      await app.prisma.locale.upsert({
        where: { code },
        create: { code, label: code, nativeLabel: code, enabled: true, isDefault: false, sortOrder: 5 },
        update: { enabled: true },
      });
    }
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "entity-translations-"));
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.prisma.locale.deleteMany({ where: { code: { in: createdLocales } } });
    await app.close();
  });

  const columnId = randomUUID();
  const linkId = randomUUID();
  const itemId = randomUUID();

  async function putNavigation(overrides: Record<string, unknown> = {}) {
    return app.inject({
      method: "PUT",
      url: "/api/v1/admin/navigation",
      headers: auth(),
      payload: {
        navigationItems: [{ id: itemId, label: "Doctors", href: "/doctors", order: 0, parentId: null, translations: { ru: { label: "Врачи" }, tr: { label: "Doktorlar" }, de: { label: "  " } } }],
        socialLinks: [],
        footerColumns: [
          { id: columnId, title: "Company", order: 0, translations: { ru: { title: "Компания" } }, links: [{ id: linkId, label: "About", href: "/about", order: 0, translations: { ru: { label: "О нас" } } }] },
        ],
        ...overrides,
      },
    });
  }

  it("menü ve footer: aktif dilde, yoksa EN; id'ler korunur; public yanıtta ham çeviri yok", async () => {
    const put = await putNavigation();
    expect(put.statusCode).toBe(200);
    const admin = put.json().data;
    expect(admin.navigationItems[0]).toMatchObject({ id: itemId, label: "Doctors", translations: { ru: { label: "Врачи" }, tr: { label: "Doktorlar" } } });
    expect(admin.navigationItems[0].translations).not.toHaveProperty("de"); // boş dil atılır
    expect(admin.footerColumns[0]).toMatchObject({ id: columnId, translations: { ru: { title: "Компания" } } });
    expect(admin.footerColumns[0].links[0]).toMatchObject({ id: linkId, translations: { ru: { label: "О нас" } } });

    const ru = (await app.inject({ method: "GET", url: "/api/v1/navigation?locale=ru" })).json().data;
    expect(ru.navigationItems[0].label).toBe("Врачи");
    expect(ru.footerColumns[0].title).toBe("Компания");
    expect(ru.footerColumns[0].links[0].label).toBe("О нас");
    expect(ru.navigationItems[0]).not.toHaveProperty("translations");

    const de = (await app.inject({ method: "GET", url: "/api/v1/navigation?locale=de" })).json().data;
    expect(de.navigationItems[0].label).toBe("Doctors");
    expect(de.footerColumns[0].title).toBe("Company");

    const tr = (await app.inject({ method: "GET", url: "/api/v1/navigation?locale=tr" })).json().data;
    expect(tr.navigationItems[0].label).toBe("Doktorlar");
    expect(tr.footerColumns[0].title).toBe("Company");

    // Kapalı/bilinmeyen dil → kanonik, hata yok.
    const xx = await app.inject({ method: "GET", url: "/api/v1/navigation?locale=es" });
    expect(xx.statusCode).toBe(200);
    expect(xx.json().data.navigationItems[0].label).toBe("Doctors");
  });

  it("menü çevirisi: bilinmeyen alan, geçersiz dil kodu ve tekrarlanan footer id 422", async () => {
    const badField = await putNavigation({
      navigationItems: [{ label: "Doctors", href: "/doctors", order: 0, translations: { ru: { label: "Врачи", href: "https://evil.example" } } }],
    });
    expect(badField.statusCode).toBe(422);
    const badLocale = await putNavigation({ navigationItems: [{ label: "Doctors", href: "/doctors", order: 0, translations: { "../x": { label: "x" } } }] });
    expect(badLocale.statusCode).toBe(422);
    const dupId = await putNavigation({
      footerColumns: [{ id: columnId, title: "A", order: 0, links: [{ id: columnId, label: "B", href: "/b", order: 0 }] }],
    });
    expect(dupId.statusCode).toBe(422);
  });

  it("uzmanlık: admin dil sekmesi verisi kaydedilir; public uçlar ve doktor DTO'su aktif dilde", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/telehealth/specialties",
      headers: auth(),
      payload: { name: "Surgical Oncology", icon: "heart-pulse", description: "Cancer surgery", translations: { ru: { name: "Хирургическая онкология" }, tr: { name: "Cerrahi Onkoloji", description: "Kanser cerrahisi" } } },
    });
    expect(created.statusCode).toBe(201);
    const specialty = created.json().data;
    expect(specialty.translations).toEqual({ ru: { name: "Хирургическая онкология" }, tr: { name: "Cerrahi Onkoloji", description: "Kanser cerrahisi" } });

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/telehealth/specialties/${specialty.id}`,
      headers: auth(),
      payload: { translations: { ru: { name: "Онкохирургия", description: "Хирургия рака" }, tr: { name: "Cerrahi Onkoloji" } } },
    });
    expect(patched.statusCode).toBe(200);

    const ru = (await app.inject({ method: "GET", url: "/api/v1/specialties?locale=ru" })).json().data[0];
    expect(ru).toMatchObject({ name: "Онкохирургия", description: "Хирургия рака" });
    const de = (await app.inject({ method: "GET", url: `/api/v1/specialties/${specialty.slug}?locale=de` })).json().data;
    expect(de).toMatchObject({ name: "Surgical Oncology", description: "Cancer surgery" });
    const tr = (await app.inject({ method: "GET", url: `/api/v1/specialties/${specialty.slug}?locale=tr` })).json().data;
    expect(tr).toMatchObject({ name: "Cerrahi Onkoloji", description: "Cancer surgery" });

    await app.prisma.doctorProfile.create({
      data: { title: "Dr.", fullName: "Test Doctor", slug: "test-doctor", bio: "Bio", languages: ["en"], timeZone: "Europe/Istanbul", isActive: true, specialtyId: specialty.id },
    });
    const doctors = (await app.inject({ method: "GET", url: "/api/v1/doctors?locale=ru" })).json().data;
    expect(doctors[0].specialty.name).toBe("Онкохирургия");
    const doctorTr = (await app.inject({ method: "GET", url: "/api/v1/doctors/test-doctor?locale=tr" })).json().data;
    expect(doctorTr.specialty.name).toBe("Cerrahi Onkoloji");

    const tooLong = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/telehealth/specialties/${specialty.id}`,
      headers: auth(),
      payload: { translations: { ru: { name: "x".repeat(81) } } },
    });
    expect(tooLong.statusCode).toBe(422);
  });

  it("slayt: dile özel görsel yalnızca kütüphaneden; public uç aktif dilin görselini, yoksa varsayılanı döner", async () => {
    const defaultImage = await createMedia("image/jpeg");
    const ruImage = await createMedia("image/webp");
    const ruMobile = await createMedia("image/jpeg");
    const pdf = await createMedia("application/pdf");
    const sliderId = (await app.inject({ method: "POST", url: "/api/v1/admin/sliders", headers: auth(), payload: { name: "Hero" } })).json().data.id;
    const slide = (
      await app.inject({ method: "POST", url: `/api/v1/admin/sliders/${sliderId}/slides`, headers: auth(), payload: { bgType: "image", bgMediaId: defaultImage } })
    ).json().data;
    const slideUrl = `/api/v1/admin/sliders/${sliderId}/slides/${slide.id}`;

    const external = await app.inject({ method: "PATCH", url: slideUrl, headers: auth(), payload: { translations: { ru: { bgMediaId: "https://evil.example/x.jpg" } } } });
    expect(external.statusCode).toBe(422);
    const extraKey = await app.inject({ method: "PATCH", url: slideUrl, headers: auth(), payload: { translations: { ru: { bgUrl: "https://evil.example/x.jpg" } } } });
    expect(extraKey.statusCode).toBe(422);
    const notImage = await app.inject({ method: "PATCH", url: slideUrl, headers: auth(), payload: { translations: { ru: { bgMediaId: pdf } } } });
    expect(notImage.statusCode).toBe(422);
    const missing = await app.inject({ method: "PATCH", url: slideUrl, headers: auth(), payload: { translations: { ru: { bgMediaId: randomUUID() } } } });
    expect(missing.statusCode).toBe(404);

    const ok = await app.inject({ method: "PATCH", url: slideUrl, headers: auth(), payload: { translations: { ru: { bgMediaId: ruImage, bgMobileMediaId: ruMobile } } } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.translations).toMatchObject({ ru: { bgMedia: { id: ruImage }, bgTabletMedia: null, bgMobileMedia: { id: ruMobile } } });
    const adminGet = (await app.inject({ method: "GET", url: `/api/v1/admin/sliders/${sliderId}`, headers: auth() })).json().data;
    expect(adminGet.slides[0].translations.ru.bgMedia.id).toBe(ruImage);

    const ru = (await app.inject({ method: "GET", url: `/api/v1/sliders/${sliderId}?locale=ru` })).json().data.slides[0];
    expect(ru.bgMedia.id).toBe(ruImage);
    expect(ru.bgMobileMedia.id).toBe(ruMobile);
    expect(ru.bgTabletMedia).toBeNull();
    expect(ru).not.toHaveProperty("translations");
    const de = (await app.inject({ method: "GET", url: `/api/v1/sliders/${sliderId}?locale=de` })).json().data.slides[0];
    expect(de.bgMedia.id).toBe(defaultImage);
    const none = (await app.inject({ method: "GET", url: `/api/v1/sliders/${sliderId}` })).json().data.slides[0];
    expect(none.bgMedia.id).toBe(defaultImage);

    // Dil görseli silinirse varsayılan görsele düşer (500 yok).
    await app.prisma.media.delete({ where: { id: ruImage } });
    const afterDelete = await app.inject({ method: "GET", url: `/api/v1/sliders/${sliderId}?locale=ru` });
    expect(afterDelete.statusCode).toBe(200);
    expect(afterDelete.json().data.slides[0].bgMedia.id).toBe(defaultImage);

    // Kopyalanan slayt dil görsellerini taşır.
    const dup = await app.inject({ method: "POST", url: `${slideUrl}/duplicate`, headers: auth() });
    expect(dup.statusCode).toBe(201);
    expect((await app.prisma.slide.findUniqueOrThrow({ where: { id: dup.json().data.id } })).translations).toMatchObject({ ru: { bgMobileMediaId: ruMobile } });
  });

  it("export/import: uzmanlık, menü ve footer artık içe aktarılabilir; TR doluysa korunur; geri dönüş", async () => {
    const data = await buildTranslationExport(app.prisma, new Date(), { only: [`navigationItem:${itemId}`, `footerLink:${linkId}`, "specialty:surgical-oncology"] });
    expect(data.items.map((i) => [i.type, i.importable])).toEqual([
      ["specialty", true],
      ["navigationItem", true],
      ["footerLink", true],
    ]);
    const nav = data.items.find((i) => i.type === "navigationItem")!;
    expect(nav.existingLocales).toEqual(["ru", "tr"]);
    nav.translations.de = { label: "Ärzte" };
    nav.translations.tr = { label: "Hekimler" }; // TR dolu → atlanır
    data.items.find((i) => i.type === "footerLink")!.translations.de = { label: "Über uns", href: "/x" }; // bilinmeyen alan → atlanır
    data.items.find((i) => i.type === "specialty")!.translations.de = { name: "Chirurgische Onkologie" };
    const file = path.join(dir, "translated.json");
    await fs.writeFile(file, JSON.stringify(data));

    const plan = await buildImportPlan(app.prisma, await readTranslationFile(file));
    expect(plan.entities.map((e) => `${e.type}/${e.locale}`).sort()).toEqual(["navigationItem/de", "specialty/de"]);
    expect(plan.skipped.map((s) => `${s.type}/${s.locale}`).sort()).toEqual(["footerLink/de", "navigationItem/tr"]);

    const { backupFile, entities } = await applyImportPlan(app.prisma, plan, {
      operator: "Test Operatör",
      osUser: "ci",
      hostname: "test",
      revalidate: false,
      confirm: IMPORT_CONFIRM_KEY,
      backupDir: dir,
      sourceFile: file,
    });
    expect(entities).toBe(2);
    const item = await app.prisma.navigationItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.label).toBe("Doctors");
    expect(item.translations).toEqual({ ru: { label: "Врачи" }, tr: { label: "Doktorlar" }, de: { label: "Ärzte" } });
    expect((await app.inject({ method: "GET", url: "/api/v1/navigation?locale=de" })).json().data.navigationItems[0].label).toBe("Ärzte");

    // Kanonik metin değişirse (menü yeniden kaydedildi) kalem bayat sayılır.
    await app.prisma.navigationItem.update({ where: { id: itemId }, data: { label: "Our Doctors" } });
    const stale = await buildImportPlan(app.prisma, await readTranslationFile(file));
    expect(stale.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ type: "navigationItem", reason: expect.stringMatching(/değişmiş/) })]));
    await app.prisma.navigationItem.update({ where: { id: itemId }, data: { label: "Doctors" } });

    await restoreTranslations(app.prisma, backupFile, { operator: "Test Operatör", osUser: "ci", hostname: "test", revalidate: false, confirm: RESTORE_CONFIRM_KEY, backupDir: dir });
    expect((await app.prisma.navigationItem.findUniqueOrThrow({ where: { id: itemId } })).translations).toEqual({ ru: { label: "Врачи" }, tr: { label: "Doktorlar" } });
  });
});
