import { describe, expect, it } from "vitest";
import { contentLocaleToIntl, withLatinDigits } from "@/lib/i18n/content-locale-to-intl";
import { formatClockRange } from "@/lib/country-display";

describe("withLatinDigits (hizmet görüşmesi sayfası)", () => {
  it("Arapça için Gregoryen + Latin rakam uzantısı ekler; mevcut uzantıya dokunmaz", () => {
    expect(withLatinDigits("ar-SA")).toBe("ar-SA-u-ca-gregory-nu-latn");
    expect(withLatinDigits("ar-SA-u-nu-arab")).toBe("ar-SA-u-nu-arab");
  });

  it("saat aralığı Latin rakamla biçimlenir; ortak varsayılan (doktor akışı) değişmez", () => {
    const start = "2026-11-12T04:00:00.000Z";
    const end = "2026-11-12T04:30:00.000Z";
    expect(formatClockRange(start, end, "UTC", withLatinDigits(contentLocaleToIntl("ar")), false)).toBe("04:00 – 04:30");
    expect(contentLocaleToIntl("ar")).toBe("ar-SA");
  });
});
