import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import {
  NameShortenError,
  SHORTEN_AUDIT_ACTION,
  SHORTEN_CONFIRM_KEY,
  SHORTEN_RESTORE_CONFIRM_KEY,
  applyShortenPlan,
  buildShortenPlan,
  formatShortenPlan,
  restoreShortenBackup,
} from "../../src/lib/doctor-name-content";

/**
 * `shorten-doctor-names-in-content`: kuru çalışma yazmaz; kurucu ve `publicName`'i tam ada eşit
 * doktor değişmez; kanonik + tüm dillerin bio/aboutHtml/subSpecialty alanları kısalır, `publicName`
 * doluysa o kullanılır; başka alfabe yalnızca raporlanır; yedek + tek transaction + audit + geri dönüş.
 */
const OP = { operator: "Test Operatör", osUser: "ci", hostname: "test-host" };

describe("doktor içerik metinlerinde tam ad kısaltma", () => {
  let app: FastifyInstance;
  let backupDir: string;
  const base = { languages: ["tr"], timeZone: "Europe/Istanbul", sessionDurationMin: 30, sessionPriceCents: 50000, currency: "EUR" };

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app.prisma);
    backupDir = await fs.mkdtemp(path.join(os.tmpdir(), "names-backup-"));
    await app.prisma.doctorProfile.create({
      data: {
        ...base,
        title: "Prof. Dr.",
        fullName: "Hakan SOFU",
        slug: "hakan-sofu",
        bio: "Prof. Dr. Hakan Sofu graduated in 2006. Dr. Sofu is an orthopedic surgeon.",
        aboutHtml: '<p><a href="/doctors/hakan-sofu" title="Hakan Sofu">Hakan Sofu</a>’s career</p>',
        subSpecialty: null,
        translations: {
          tr: { title: "Prof. Dr.", bio: "Prof. Dr. Hakan Sofu'nun deneyimi.", aboutHtml: "<p>HAKAN SOFU</p>" },
          ru: { bio: "Проф. д-р Хакан Софу работает. Проф. д-р Hakan Sofu" },
        },
      },
    });
    await app.prisma.doctorProfile.create({
      data: { ...base, title: "Prof. Dr.", fullName: "Kamil ÖZDİL", publicName: "K. Özdil (Prof.)", slug: "kamil-ozdil", bio: "Prof. Dr. Kamil Özdil graduated.", translations: {} },
    });
    await app.prisma.doctorProfile.create({
      data: { ...base, title: "Doç. Dr.", fullName: "Vahit MUTLU", slug: "vahit-mutlu", isFounder: true, bio: "Dr. Vahit Mutlu studied medicine.", translations: { es: { bio: "Vahit Mutlu estudió." } } },
    });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("kuru çalışma: sayılar ve örnekler; hiçbir şey yazılmaz; Kiril aday listelenir", async () => {
    const plan = await buildShortenPlan(app.prisma);
    const text = formatShortenPlan(plan);
    expect(text).toContain('hakan-sofu: "Hakan SOFU" → "H. Sofu" — toplam 5 değişiklik');
    expect(text).toContain("[en] bio: 1");
    expect(text).toContain("[tr] bio: 1");
    expect(text).toContain("önce:  …Prof. Dr. Hakan Sofu graduated in 2006.");
    expect(text).toContain("sonra: …Prof. Dr. H. Sofu graduated in 2006.");
    expect(text).toContain('kamil-ozdil: "Kamil ÖZDİL" → "K. Özdil (Prof.)"');
    expect(text).not.toContain("vahit-mutlu");
    expect(plan.otherScriptCandidates).toEqual([{ slug: "hakan-sofu", locale: "ru", field: "bio", text: "Хакан Софу" }]);
    expect((await app.prisma.doctorProfile.findUniqueOrThrow({ where: { slug: "hakan-sofu" } })).bio).toContain("Hakan Sofu");
    await expect(applyShortenPlan(app.prisma, plan, { ...OP, backupDir, revalidate: false })).rejects.toThrow(NameShortenError);
    expect(await app.prisma.auditLog.count()).toBe(0);
  });

  it("kuru çalıştırma: sabit eşleme ve tekrarlayan parantez önce/sonra görünür; eşlenen adlar aday listesine düşmez", async () => {
    await app.prisma.doctorProfile.create({
      data: {
        ...base,
        title: "Prof. Dr.",
        fullName: "Doğukan YILDIRIM",
        slug: "dogukan-yildirim",
        bio: "Prof. Dr. Doğukan Yıldırım (Dogukan Yildirim) is a gynecologic oncologist.",
        translations: {
          ru: { bio: "Проф. д-р Догукан Йылдырым (Doğukan Yıldırım) — гинеколог-онколог." },
          ar: { bio: "أ. د. دوغوكان يلدريم (Doğukan Yıldırım) طبيب." },
        },
      },
    });
    const plan = await buildShortenPlan(app.prisma);
    const text = formatShortenPlan(plan);
    expect(text).toContain("sonra: …Prof. Dr. D. Yıldırım is a gynecologic oncologist.");
    expect(text).toContain("önce:  …Проф. д-р Догукан Йылдырым (Doğukan Yıldırım) — гинеколог-онколог.");
    expect(text).toContain("sonra: …Проф. д-р Д. Йылдырым — гинеколог-онколог.");
    expect(text).toContain("sonra: …أ. د. يلدريم طبيب.");
    expect(plan.otherScriptCandidates.filter((c) => c.slug === "dogukan-yildirim")).toEqual([]);
    // Eşlemede olmayan aday (Хакан Софу) eskisi gibi yalnızca listelenir.
    expect(plan.otherScriptCandidates).toContainEqual({ slug: "hakan-sofu", locale: "ru", field: "bio", text: "Хакан Софу" });

    await applyShortenPlan(app.prisma, plan, { ...OP, confirm: SHORTEN_CONFIRM_KEY, backupDir, revalidate: false });
    const row = await app.prisma.doctorProfile.findUniqueOrThrow({ where: { slug: "dogukan-yildirim" } });
    expect(row.bio).toBe("Prof. Dr. D. Yıldırım is a gynecologic oncologist.");
    expect(row.translations).toEqual({
      ru: { bio: "Проф. д-р Д. Йылдырым — гинеколог-онколог." },
      ar: { bio: "أ. د. يلدريم طبيب." },
    });
  });

  it("görünen ad tam adı içeriyorsa (publicName = tam ad) doktor atlanır ve tekrar çalıştırmada birikmez", async () => {
    await app.prisma.doctorProfile.update({ where: { slug: "kamil-ozdil" }, data: { publicName: "Kamil Özdil" } });
    const plan = await buildShortenPlan(app.prisma);
    expect(plan.skipped).toEqual([{ slug: "kamil-ozdil", displayName: "Kamil Özdil" }]);
    expect(plan.doctors.map((d) => d.slug)).toEqual(["hakan-sofu"]);
    expect(formatShortenPlan(plan)).toContain('Atlandı: kamil-ozdil — görünen ad ("Kamil Özdil") tam adı zaten içeriyor.');
  });

  it("yazma: kanonik + diller kısalır; öznitelik/href, yalnız soyad, kurucu ve başka alfabe değişmez; yedek + audit + geri dönüş", async () => {
    const before = await app.prisma.doctorProfile.findUniqueOrThrow({ where: { slug: "hakan-sofu" } });
    const plan = await buildShortenPlan(app.prisma);
    await expect(applyShortenPlan(app.prisma, plan, { ...OP, operator: "", confirm: SHORTEN_CONFIRM_KEY, backupDir, revalidate: false })).rejects.toThrow(/--operator/);
    const { backupFile, doctors, replacements } = await applyShortenPlan(app.prisma, plan, { ...OP, confirm: SHORTEN_CONFIRM_KEY, backupDir, revalidate: false });
    expect([doctors, replacements]).toEqual([2, 6]);
    expect(path.basename(backupFile)).toMatch(/^names-.*\.json$/);

    const hakan = await app.prisma.doctorProfile.findUniqueOrThrow({ where: { slug: "hakan-sofu" } });
    expect(hakan.bio).toBe("Prof. Dr. H. Sofu graduated in 2006. Dr. Sofu is an orthopedic surgeon.");
    expect(hakan.aboutHtml).toBe('<p><a href="/doctors/hakan-sofu" title="Hakan Sofu">H. Sofu</a>’s career</p>');
    expect(hakan.translations).toEqual({
      tr: { title: "Prof. Dr.", bio: "Prof. Dr. H. Sofu'nun deneyimi.", aboutHtml: "<p>H. Sofu</p>" },
      ru: { bio: "Проф. д-р Хакан Софу работает. Проф. д-р H. Sofu" },
    });
    expect(hakan.fullName).toBe("Hakan SOFU");
    expect((await app.prisma.doctorProfile.findUniqueOrThrow({ where: { slug: "kamil-ozdil" } })).bio).toBe("Prof. Dr. K. Özdil (Prof.) graduated.");
    const founder = await app.prisma.doctorProfile.findUniqueOrThrow({ where: { slug: "vahit-mutlu" } });
    expect([founder.bio, founder.translations]).toEqual(["Dr. Vahit Mutlu studied medicine.", { es: { bio: "Vahit Mutlu estudió." } }]);
    const audit = await app.prisma.auditLog.findFirstOrThrow({ where: { action: SHORTEN_AUDIT_ACTION } });
    expect(audit.metadata).toMatchObject({ operator: "Test Operatör", replacements: 6, doctors: ["hakan-sofu", "kamil-ozdil"] });

    // Plan sonrası kayıt değiştiyse yazma geri alınır.
    await expect(applyShortenPlan(app.prisma, plan, { ...OP, confirm: SHORTEN_CONFIRM_KEY, backupDir, revalidate: false })).rejects.toThrow(/değişmiş/);
    // İkinci kuru çalışma: değiştirilecek bir şey kalmadı.
    expect((await buildShortenPlan(app.prisma)).doctors).toHaveLength(0);

    await restoreShortenBackup(app.prisma, backupFile, { ...OP, confirm: SHORTEN_RESTORE_CONFIRM_KEY, backupDir, revalidate: false });
    const restored = await app.prisma.doctorProfile.findUniqueOrThrow({ where: { slug: "hakan-sofu" } });
    expect([restored.bio, restored.aboutHtml, restored.translations]).toEqual([before.bio, before.aboutHtml, before.translations]);
  });
});
