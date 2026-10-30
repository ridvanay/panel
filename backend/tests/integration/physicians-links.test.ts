import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import {
  PHYSICIANS_AUDIT_ACTION,
  PHYSICIANS_CONFIRM_KEY,
  PhysiciansLinkError,
  applyPhysiciansPlan,
  buildPhysiciansPlan,
  formatPhysiciansPlan,
  rewriteHtmlLinks,
  rewritePhysiciansLink,
} from "../../src/lib/physicians-links";
import { canonicalPathSql } from "../../src/modules/crm/crm.privacy";

/**
 * Paket V (İş 1) — `rename-doctors-to-physicians`: menü/footer/CTA/e-posta şablonlarındaki `/doctors`
 * bağlantıları `/physicians` olur; hekim listesine giden öğenin etiketi "Consult Physicians" + 8 dil.
 * Kuru çalışma yazmaz; idempotent; audit; plan sonrası değişiklik geri alınır.
 */
const OP = { operator: "Test Operatör", osUser: "ci", hostname: "test-host", revalidate: false };

describe("bağlantı dönüşümü (saf fonksiyonlar)", () => {
  it.each([
    ["/doctors", "/physicians"],
    ["/doctors/hakan-sofu", "/physicians/hakan-sofu"],
    ["/en/doctors?specialty=x", "/en/physicians?specialty=x"],
    ["/sr-latn/doctors/a", "/sr-latn/physicians/a"],
    ["{{site_url}}/doctors/a", "{{site_url}}/physicians/a"],
    ["https://wmhealth.example/ru/doctors", "https://wmhealth.example/ru/physicians"],
    ["/doctor", "/doctor"],
    ["/doctors-old", "/doctors-old"],
    ["/admin/telehealth/doctors", "/admin/telehealth/doctors"],
  ])("%s → %s", (input, expected) => {
    expect(rewritePhysiciansLink(input)).toBe(expected);
  });

  it("HTML'de yalnızca href değerleri değişir", () => {
    expect(rewriteHtmlLinks('<a href="{{site_url}}/doctors/a">/doctors</a> <img src="/doctors.png">')).toBe('<a href="{{site_url}}/physicians/a">/doctors</a> <img src="/doctors.png">');
  });
});

describe("rename-doctors-to-physicians", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app.prisma);
    const root = await app.prisma.navigationItem.create({ data: { label: "Doctors", href: "/doctors", order: 0, translations: { tr: { label: "Doktorlar" }, it: { label: "Medici" } } } });
    await app.prisma.navigationItem.create({ data: { label: "Cardiology", href: "/doctors?specialty=kardiyoloji", order: 0, parentId: root.id } });
    await app.prisma.navigationItem.create({ data: { label: "Blog", href: "/blog", order: 1 } });
    const column = await app.prisma.footerColumn.create({ data: { title: "Site", order: 0 } });
    await app.prisma.footerLink.create({ data: { columnId: column.id, label: "Our doctors", href: "/doctors/", order: 0 } });
    await app.prisma.siteSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", headerCtaHref: "/doctors" }, update: { headerCtaHref: "/doctors" } });
    await app.prisma.emailTemplate.create({
      data: { name: "Hatırlatma", subject: "x", bodyHtml: '<p><a href="{{site_url}}/doctors/{{doctor_slug}}">Profil</a></p>', blocks: [{ type: "button", data: { label: "Profil", url: "{{site_url}}/doctors" } }], availableVariables: [] },
    });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("kuru çalışma listeler, yazmaz; gerçek yazma bağlantı + etiket + 8 dil çevirisi; idempotent; audit", async () => {
    const plan = await buildPhysiciansPlan(app.prisma);
    expect(plan.links).toHaveLength(3);
    expect(plan.headerCta).toEqual({ before: "/doctors", after: "/physicians" });
    expect(plan.emailTemplates).toHaveLength(1);
    expect(formatPhysiciansPlan(plan)).toContain('"Doctors" /doctors → "Consult Physicians" /physicians');
    expect((await app.prisma.navigationItem.findFirstOrThrow({ where: { label: "Doctors" } })).href).toBe("/doctors");
    await expect(applyPhysiciansPlan(app.prisma, plan, OP)).rejects.toThrow(PhysiciansLinkError);
    await expect(applyPhysiciansPlan(app.prisma, plan, { ...OP, confirm: PHYSICIANS_CONFIRM_KEY, operator: " " })).rejects.toThrow(/--operator/);

    await applyPhysiciansPlan(app.prisma, plan, { ...OP, confirm: PHYSICIANS_CONFIRM_KEY });
    const root = await app.prisma.navigationItem.findFirstOrThrow({ where: { parentId: null, order: 0 } });
    expect(root).toMatchObject({ label: "Consult Physicians", href: "/physicians" });
    expect(root.translations).toMatchObject({ tr: { label: "Hekime Danışın" }, ar: { label: "استشر طبيبًا" }, "sr-latn": { label: "Konsultujte lekara" }, it: { label: "Medici" } });
    const child = await app.prisma.navigationItem.findFirstOrThrow({ where: { parentId: root.id } });
    expect(child).toMatchObject({ label: "Cardiology", href: "/physicians?specialty=kardiyoloji" });
    expect(await app.prisma.footerLink.findFirstOrThrow()).toMatchObject({ label: "Consult Physicians", href: "/physicians/" });
    expect((await app.prisma.siteSettings.findUniqueOrThrow({ where: { id: "singleton" } })).headerCtaHref).toBe("/physicians");
    const template = await app.prisma.emailTemplate.findFirstOrThrow();
    expect(template.bodyHtml).toBe('<p><a href="{{site_url}}/physicians/{{doctor_slug}}">Profil</a></p>');
    expect(template.blocks).toEqual([{ type: "button", data: { label: "Profil", url: "{{site_url}}/physicians" } }]);
    expect((await app.prisma.navigationItem.findFirstOrThrow({ where: { label: "Blog" } })).href).toBe("/blog");

    const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: PHYSICIANS_AUDIT_ACTION } });
    expect(audit.metadata).toMatchObject({ operator: "Test Operatör", headerCta: { before: "/doctors" } });

    const second = await buildPhysiciansPlan(app.prisma);
    expect([second.links.length, second.headerCta, second.emailTemplates.length]).toEqual([0, null, 0]);
    expect(formatPhysiciansPlan(second)).toContain("Değiştirilecek kayıt yok.");
  });

  it("plan alındıktan sonra panelden değişen kayıt varsa hiçbir şey yazılmaz", async () => {
    const plan = await buildPhysiciansPlan(app.prisma);
    await app.prisma.navigationItem.updateMany({ where: { label: "Doctors" }, data: { label: "Uzmanlar" } });
    await expect(applyPhysiciansPlan(app.prisma, plan, { ...OP, confirm: PHYSICIANS_CONFIRM_KEY })).rejects.toThrow(/değişmiş/);
    expect((await app.prisma.siteSettings.findUniqueOrThrow({ where: { id: "singleton" } })).headerCtaHref).toBe("/doctors");
    expect(await app.prisma.auditLog.count({ where: { action: PHYSICIANS_AUDIT_ACTION } })).toBe(0);
  });

  it("CRM: eski /doctors yolu Postgres ifadesiyle de yeni yola eşlenir (aynı sayfa sayılır)", async () => {
    const rows = await app.prisma.$queryRawUnsafe<{ a: string; b: string; c: string; d: string }[]>(
      `SELECT ${canonicalPathSql("'/doctors/x'")} AS a, ${canonicalPathSql("'/sr-latn/doctors'")} AS b, ${canonicalPathSql("'/doctor/earnings'")} AS c, ${canonicalPathSql("'/doctors-x'")} AS d`
    );
    expect(rows[0]).toEqual({ a: "/physicians/x", b: "/sr-latn/physicians", c: "/doctor/earnings", d: "/doctors-x" });
  });
});
