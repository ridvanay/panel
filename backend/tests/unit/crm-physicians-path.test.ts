import { describe, expect, it } from "vitest";
import { canonicalCrmPath, crmPathVariants } from "../../src/modules/crm/crm.privacy";
import { mergeLegacyPageRows } from "../../src/modules/crm/crm.analytics";

/** Paket V — CRM'de eski `/doctors` olayları yeni `/physicians` sayfasıyla aynı sayfa sayılır. */
describe("CRM yol eşlemesi", () => {
  it.each([
    ["/doctors", "/physicians"],
    ["/doctors/hakan-sofu", "/physicians/hakan-sofu"],
    ["/en/doctors/hakan-sofu", "/en/physicians/hakan-sofu"],
    ["/sr-latn/doctors", "/sr-latn/physicians"],
    ["/physicians/x", "/physicians/x"],
    ["/doctor/earnings", "/doctor/earnings"],
    ["/doctors-old", "/doctors-old"],
  ])("%s → %s", (input, expected) => {
    expect(canonicalCrmPath(input)).toBe(expected);
  });

  it("ısı haritası için iki yol varyantı", () => {
    expect(crmPathVariants("/en/physicians/a")).toEqual(["/en/physicians/a", "/en/doctors/a"]);
    expect(crmPathVariants("/doctors")).toEqual(["/physicians", "/doctors"]);
    expect(crmPathVariants("/blog")).toEqual(["/blog"]);
  });

  it("sayfa özetinde eski ve yeni satır toplanır", () => {
    const row = (key: string, pageviews: number, visitors: number) => ({
      key, label: null, visitors, sessions: visitors, pageviews, entries: 0, engagedSeconds: 0, scrollSum: 0, scrollCount: 0,
      clicks: 0, whatsappClicks: 0, phoneClicks: 0, emailClicks: 0, contacts: 0, bookingsStarted: 0,
    });
    const merged = mergeLegacyPageRows([row("/physicians/a", 10, 4), row("/blog", 3, 1), row("/doctors/a", 5, 2)]);
    expect(merged.map((r) => [r.key, r.pageviews, r.visitors])).toEqual([
      ["/physicians/a", 15, 6],
      ["/blog", 3, 1],
    ]);
  });
});
