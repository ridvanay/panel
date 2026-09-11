import { describe, expect, it } from "vitest";
import { contentLocaleToIntl } from "@/lib/i18n/content-locale-to-intl";

describe("contentLocaleToIntl", () => {
  it("bilinen İÇERİK dili kodlarını (`Locale.code`) BCP-47 etiketine çevirir", () => {
    expect(contentLocaleToIntl("tr")).toBe("tr-TR");
    expect(contentLocaleToIntl("en")).toBe("en-US");
    expect(contentLocaleToIntl("de")).toBe("de-DE");
    expect(contentLocaleToIntl("fr")).toBe("fr-FR");
    expect(contentLocaleToIntl("es")).toBe("es-ES");
    expect(contentLocaleToIntl("ar")).toBe("ar-SA");
  });

  it("haritada olmayan bir kod (panelden sonradan eklenen yeni bir dil) İÇİN Intl'e bırakılır, HATA FIRLATMAZ", () => {
    expect(contentLocaleToIntl("pt")).toBe("pt");
    expect(() => new Intl.NumberFormat(contentLocaleToIntl("pt"), { style: "currency", currency: "EUR" })).not.toThrow();
  });
});
