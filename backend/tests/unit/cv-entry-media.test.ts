import { describe, expect, it } from "vitest";
import { resolveCvEntryMedia } from "../../src/modules/telehealth/lib/cv-entry-media";
import { DoctorCvEntrySchema } from "../../src/schemas/entities";
import { ValidationError } from "../../src/lib/errors";

/**
 * Paket L (2026-10-23) — CV belge bağlantısı istemciden alınmaz: `mediaId` → `Media.url`. Dış site
 * bağlantısı (mediaId'siz url, yanlış tür, `..`) reddedilir.
 */
const MEDIA_ID = "11111111-1111-4111-8111-111111111111";
const db = {
  media: {
    findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
      [
        { id: MEDIA_ID, url: "/uploads/wiley.pdf", mimeType: "application/pdf" },
        { id: "22222222-2222-4222-8222-222222222222", url: "/uploads/x.zip", mimeType: "application/zip" },
      ].filter((m) => where.id.in.includes(m.id)),
  },
} as unknown as Parameters<typeof resolveCvEntryMedia>[0];

const cert = { kind: "CERTIFICATE" as const, title: "Reviewer", organization: "Wiley", startYear: 2025, endYear: 2025 };

describe("CV belge bağlantısı", () => {
  it("url istemciden gelse de Media.url'den yeniden türetilir; mediaId yoksa url silinir", async () => {
    const [withMedia, withoutMedia] = (await resolveCvEntryMedia(db, [
      { ...cert, mediaId: MEDIA_ID, url: "https://evil.example/phish.pdf" },
      { ...cert, url: "https://evil.example/x" },
    ]))!;
    expect(withMedia).toMatchObject({ mediaId: MEDIA_ID, url: "/uploads/wiley.pdf" });
    expect(withoutMedia).toMatchObject({ mediaId: null, url: null });
  });

  it("bulunamayan ya da PDF/görsel olmayan medya reddedilir", async () => {
    await expect(resolveCvEntryMedia(db, [{ ...cert, mediaId: "33333333-3333-4333-8333-333333333333" }])).rejects.toThrow(ValidationError);
    await expect(resolveCvEntryMedia(db, [{ ...cert, mediaId: "22222222-2222-4222-8222-222222222222" }])).rejects.toThrow(ValidationError);
  });

  it("şema: url mediaId olmadan, sertifika/ödül dışı kalemde veya '..' ile kabul edilmez", () => {
    expect(DoctorCvEntrySchema.safeParse({ ...cert, url: "/uploads/a.pdf" }).success).toBe(false);
    expect(DoctorCvEntrySchema.safeParse({ ...cert, kind: "EDUCATION", mediaId: MEDIA_ID, url: "/uploads/a.pdf" }).success).toBe(false);
    expect(DoctorCvEntrySchema.safeParse({ ...cert, mediaId: MEDIA_ID, url: "/uploads/../api/x" }).success).toBe(false);
    expect(DoctorCvEntrySchema.safeParse({ ...cert, mediaId: MEDIA_ID, url: "/uploads/a.pdf" }).success).toBe(true);
  });
});
