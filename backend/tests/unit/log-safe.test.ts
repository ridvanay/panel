import { describe, expect, it } from "vitest";
import { maskEmails, safeErrorMessage } from "../../src/lib/log-safe";

describe("log-safe", () => {
  it("e-posta adresi kalıplarını maskeler", () => {
    expect(maskEmails("550 5.1.1 <ada.lovelace+x@example.co.uk>: user unknown")).toBe("550 5.1.1 <***@***>: user unknown");
    expect(maskEmails("a@b.com, c@d.org failed")).toBe("***@***, ***@*** failed");
    expect(maskEmails("adres yok")).toBe("adres yok");
  });

  it("hata nesnesi ve düz değerler için maskelenmiş ileti döner", () => {
    expect(safeErrorMessage(new Error("Recipient rejected: hasta@example.com"))).toBe("Recipient rejected: ***@***");
    expect(safeErrorMessage("x@y.z")).toBe("***@***");
  });
});
