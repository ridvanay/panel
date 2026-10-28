import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  restoreTranslations,
} from "../../src/lib/content-translations";

/**
 * Paket U (B2, kararlar sonrası) — `site_settings.translations`: başlık CTA etiketi, slogan ve footer
 * metni aktif dilde; çeviri yoksa kanonik EN; yalnızca görünen metin alanları kabul edilir; export/
 * import `siteSettings` içe aktarılabilir ve yalnızca bu alanları taşır.
 */
const OP = { operator: "Test Operatör", osUser: "ci", hostname: "test-host" };

describe("site ayarları çevirileri (Paket U, B2)", () => {
  let app: FastifyInstance;
  let auth: { authorization: string };
  const createdLocales: string[] = [];

  const putNavigation = (extra: Record<string, unknown>) =>
    app.inject({
      method: "PUT",
      url: "/api/v1/admin/navigation",
      headers: auth,
      payload: { headerCtaLabel: "Appointment", headerCtaHref: "/doctors", footerCopyrightText: "© WM Health", navigationItems: [], socialLinks: [], footerColumns: [], ...extra },
    });

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    auth = { authorization: `Bearer ${(await registerTestUser(app)).accessToken}` };
    for (const code of ["ro", "fr", "tr"]) {
      const existing = await app.prisma.locale.findUnique({ where: { code } });
      if (!existing) createdLocales.push(code);
      await app.prisma.locale.upsert({
        where: { code },
        create: { code, label: code, nativeLabel: code, enabled: true, isDefault: code === "tr", sortOrder: 5 },
        update: { enabled: true },
      });
    }
    await app.prisma.siteSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", tagline: "Expert care online" }, update: { tagline: "Expert care online" } });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.prisma.locale.deleteMany({ where: { code: { in: createdLocales } } });
    await app.close();
  });

  it("CTA/footer/slogan aktif dilde; çeviri yoksa EN; admin okuması ham çevirileri verir", async () => {
    const saved = await putNavigation({ siteTranslations: { ro: { headerCtaLabel: "Programare", tagline: "Îngrijire online" }, tr: { footerCopyrightText: "© WM Health TR" } } });
    expect(saved.statusCode, saved.body).toBe(200);

    const ro = (await app.inject({ method: "GET", url: "/api/v1/navigation?locale=ro" })).json().data;
    expect([ro.headerCtaLabel, ro.footerCopyrightText, ro.headerCtaHref]).toEqual(["Programare", "© WM Health", "/doctors"]);
    expect(ro.siteTranslations).toBeUndefined();
    const fr = (await app.inject({ method: "GET", url: "/api/v1/navigation?locale=fr" })).json().data;
    expect(fr.headerCtaLabel).toBe("Appointment");
    const tr = (await app.inject({ method: "GET", url: "/api/v1/navigation?locale=tr" })).json().data;
    expect(tr.footerCopyrightText).toBe("© WM Health TR");

    expect((await app.inject({ method: "GET", url: "/api/v1/settings?locale=ro" })).json().data.tagline).toBe("Îngrijire online");
    expect((await app.inject({ method: "GET", url: "/api/v1/settings?locale=fr" })).json().data.tagline).toBe("Expert care online");
    expect((await app.inject({ method: "GET", url: "/api/v1/settings" })).json().data.tagline).toBe("Expert care online");

    const admin = (await app.inject({ method: "GET", url: "/api/v1/admin/navigation", headers: auth })).json().data;
    expect(admin.siteTranslations).toEqual({ ro: { headerCtaLabel: "Programare", tagline: "Îngrijire online" }, tr: { footerCopyrightText: "© WM Health TR" } });
    expect(admin.headerCtaLabel).toBe("Appointment");
  });

  it("yalnızca görünen metin alanları kabul edilir (URL/renk/anahtar reddedilir); gönderilmezse mevcut çeviriler korunur", async () => {
    expect((await putNavigation({ siteTranslations: { ro: { headerCtaHref: "/x" } } })).statusCode).toBe(422);
    expect((await putNavigation({ siteTranslations: { ro: { siteName: "X" } } })).statusCode).toBe(422);
    expect((await putNavigation({})).statusCode).toBe(200);
    const row = await app.prisma.siteSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(row.translations).toMatchObject({ ro: { headerCtaLabel: "Programare" } });
  });

  it("export/import: siteSettings içe aktarılabilir, yalnızca görünen alanlar; geri dönüş", async () => {
    const backupDir = await fs.mkdtemp(path.join(os.tmpdir(), "site-settings-backup-"));
    const data = await buildTranslationExport(app.prisma, new Date(), { locales: ["fr", "sr-latn"] });
    const item = data.items.find((i) => i.type === "siteSettings")!;
    expect(item.importable).toBe(true);
    expect(Object.keys(item.fields).sort()).toEqual(["footerCopyrightText", "headerCtaLabel", "tagline"]);

    item.translations.fr = { headerCtaLabel: "Rendez-vous", footerCopyrightText: "© WM Health FR" };
    item.translations["sr-latn"] = { headerCtaHref: "/zlo" };
    const plan = await buildImportPlan(app.prisma, data);
    expect(plan.entities.filter((e) => e.type === "siteSettings").map((e) => e.locale)).toEqual(["fr"]);
    expect(plan.skipped.find((s) => s.type === "siteSettings")?.reason).toMatch(/Bilinmeyen alan: headerCtaHref/);
    const { backupFile } = await applyImportPlan(app.prisma, plan, { ...OP, confirm: IMPORT_CONFIRM_KEY, backupDir, sourceFile: "x.json", revalidate: false });
    expect((await app.inject({ method: "GET", url: "/api/v1/navigation?locale=fr" })).json().data.headerCtaLabel).toBe("Rendez-vous");

    await restoreTranslations(app.prisma, backupFile, { ...OP, confirm: RESTORE_CONFIRM_KEY, backupDir, revalidate: false });
    expect((await app.inject({ method: "GET", url: "/api/v1/navigation?locale=fr" })).json().data.headerCtaLabel).toBe("Appointment");
    // Diğer dillerin çevirileri geri dönüşten etkilenmez.
    expect((await app.inject({ method: "GET", url: "/api/v1/navigation?locale=ro" })).json().data.headerCtaLabel).toBe("Programare");
  });
});
