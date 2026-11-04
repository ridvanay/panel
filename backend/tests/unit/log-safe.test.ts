import { describe, expect, it } from "vitest";
import pino from "pino";
import { maskEmails, maskUrlQuery, safeErrorMessage, serializeRequestForLog } from "../../src/lib/log-safe";

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

  describe("maskUrlQuery (Paket AL İş 5)", () => {
    it("token/t/key/code/signature değerlerini *** yapar, diğerlerini korur", () => {
      expect(maskUrlQuery("/api/v1/x?token=abc&page=2&t=zzz&key=k&code=123&signature=s")).toBe(
        "/api/v1/x?token=***&page=2&t=***&key=***&code=***&signature=***",
      );
    });

    it("anahtar adı büyük/küçük harf duyarsızdır ve kodlanmış adı çözer", () => {
      expect(maskUrlQuery("/a?Token=1&SIGNATURE=2&T=3&%74oken=4")).toBe("/a?Token=***&SIGNATURE=***&T=***&%74oken=***");
    });

    it("sorgusuz, değersiz ve benzer adlı parametrelere dokunmaz", () => {
      expect(maskUrlQuery("/a/b")).toBe("/a/b");
      expect(maskUrlQuery("/a?token")).toBe("/a?token");
      expect(maskUrlQuery("/a?tokens=1&t2=2&stoken=3")).toBe("/a?tokens=1&t2=2&stoken=3");
      expect(maskUrlQuery("/a?")).toBe("/a?");
    });

    it("parça (#) kısmını korur", () => {
      expect(maskUrlQuery("/a?t=1#frag")).toBe("/a?t=***#frag");
    });

    it("pino req serializer'ı ile log satırında token düz metin olarak görünmez", () => {
      const lines: string[] = [];
      const logger = pino({ serializers: { req: serializeRequestForLog } }, { write: (l: string) => void lines.push(l) });
      logger.info(
        { req: { method: "GET", url: "/api/v1/meetings/join?token=SECRET123&lang=tr", headers: {}, host: "h", ip: "1.2.3.4", socket: { remotePort: 1 } } },
        "incoming request",
      );
      expect(lines.join("")).not.toContain("SECRET123");
      expect(lines.join("")).toContain("token=***&lang=tr");
    });
  });
});
