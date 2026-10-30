import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import {
  ADD_SPECIALTIES_AUDIT_ACTION,
  ADD_SPECIALTIES_CONFIRM_KEY,
  AddSpecialtiesError,
  applyAddSpecialtiesPlan,
  buildAddSpecialtiesPlan,
  formatAddSpecialtiesPlan,
} from "../../src/lib/specialty-additions";

/** Paket V (İş 5) — `add-specialties`: kuru çalışma, idempotent, mevcut uzmanlıklara dokunmaz, audit. */
const OP = { operator: "Test Operatör", osUser: "ci", hostname: "test-host", revalidate: false };

describe("add-specialties", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(app.prisma);
    await app.prisma.specialty.create({ data: { name: "Cardiology", slug: "kardiyoloji", icon: "Heart", order: 4, description: "Heart" } });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("kuru çalışma yazmaz; gerçek yazma iki uzmanlığı sona ekler; ikinci çalıştırmada eklenecek yok", async () => {
    const plan = await buildAddSpecialtiesPlan(app.prisma);
    expect(formatAddSpecialtiesPlan(plan)).toContain('[ekle] thoracic-surgery: "Thoracic Surgery" ikon=Wind sıra=5');
    expect(formatAddSpecialtiesPlan(plan)).toContain('[ekle] neurosurgery: "Neurosurgery" ikon=Brain sıra=6');
    expect(await app.prisma.specialty.count()).toBe(1);
    await expect(applyAddSpecialtiesPlan(app.prisma, plan, OP)).rejects.toThrow(AddSpecialtiesError);
    await expect(applyAddSpecialtiesPlan(app.prisma, plan, { ...OP, confirm: ADD_SPECIALTIES_CONFIRM_KEY, operator: "" })).rejects.toThrow(/--operator/);

    const result = await applyAddSpecialtiesPlan(app.prisma, plan, { ...OP, confirm: ADD_SPECIALTIES_CONFIRM_KEY });
    expect(result.created).toEqual(["thoracic-surgery", "neurosurgery"]);
    const rows = await app.prisma.specialty.findMany({ orderBy: { order: "asc" } });
    expect(rows.map((r) => [r.slug, r.icon, r.isActive])).toEqual([
      ["kardiyoloji", "Heart", true],
      ["thoracic-surgery", "Wind", true],
      ["neurosurgery", "Brain", true],
    ]);
    expect(rows[0]).toMatchObject({ name: "Cardiology", description: "Heart", order: 4 });
    expect(rows[1]!.description).toMatch(/lungs/);
    expect((await app.prisma.auditLog.findFirstOrThrow({ where: { action: ADD_SPECIALTIES_AUDIT_ACTION } })).metadata).toMatchObject({ created: ["thoracic-surgery", "neurosurgery"] });

    const again = await buildAddSpecialtiesPlan(app.prisma);
    expect(again.toCreate).toEqual([]);
    expect(again.skipped).toEqual(["thoracic-surgery", "neurosurgery"]);
    expect(formatAddSpecialtiesPlan(again)).toContain("Eklenecek uzmanlık yok.");
  });

  it("slug zaten varsa o uzmanlık atlanır ve değiştirilmez", async () => {
    await app.prisma.specialty.create({ data: { name: "Beyin Cerrahisi", slug: "neurosurgery", icon: "Sparkles", order: 9 } });
    const plan = await buildAddSpecialtiesPlan(app.prisma);
    expect(plan.toCreate.map((s) => s.slug)).toEqual(["thoracic-surgery"]);
    await applyAddSpecialtiesPlan(app.prisma, plan, { ...OP, confirm: ADD_SPECIALTIES_CONFIRM_KEY });
    expect(await app.prisma.specialty.findUniqueOrThrow({ where: { slug: "neurosurgery" } })).toMatchObject({ name: "Beyin Cerrahisi", icon: "Sparkles" });
  });
});
