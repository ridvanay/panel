import { describe, expect, it } from "vitest";
import { siteDictionary as en } from "@/lib/i18n/site-dictionaries/en";
import { siteDictionary as tr } from "@/lib/i18n/site-dictionaries/tr";

/**
 * Paket A2 (2026-10-18) — site sözlüklerinin (portal dahil) EN/TR'de eksiksiz olması. Tip sistemi
 * TR'de EKSİK anahtarı derlemede yakalar; bu test ayrıca FAZLA anahtarı, boş değeri ve `{param}`
 * yer tutucularının iki dilde aynı olmasını çalışma zamanında doğrular.
 */

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}

const enFlat = flatten(en as unknown as Tree);
const trFlat = flatten(tr as unknown as Tree);

describe("site sözlükleri — EN/TR eşliği", () => {
  it("iki dil aynı anahtar kümesine sahip", () => {
    expect([...trFlat.keys()].sort()).toEqual([...enFlat.keys()].sort());
  });

  it("hiçbir değer boş değil", () => {
    const empty = [...enFlat, ...trFlat].filter(([, value]) => value.trim() === "").map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it("yer tutucular ({param}) iki dilde aynı", () => {
    const mismatched = [...enFlat.keys()].filter((key) => placeholders(enFlat.get(key)!).join() !== placeholders(trFlat.get(key) ?? "").join());
    expect(mismatched).toEqual([]);
  });

  it("portal bölümü kapsamlı (hasta, doktor, sihirbaz, hata kodları)", () => {
    for (const section of ["patientNav", "patientBookings", "doctorConsole", "doctorEarnings", "wizard", "identity", "intake", "calendar", "errors"]) {
      expect(en.portal).toHaveProperty(section);
    }
    expect(tr.portal.appointmentStatus.ENDED).toBe("Sona erdi");
    expect(en.portal.appointmentStatus.ENDED).toBe("Ended");
  });
});
