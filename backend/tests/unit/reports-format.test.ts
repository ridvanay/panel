import { describe, expect, it } from "vitest";
import { toCsv } from "../../src/modules/reports/reports.format";

/**
 * security-agent — CSV/Formula Injection (CWE-1236) düzeltmesi (bkz. reports.format.ts).
 * `USERS`/`REVENUE` export türlerindeki `name`/`organization.name` gibi alanlar son
 * kullanıcı tarafından serbestçe girilebiliyor; `=`/`+`/`-`/`@` ile başlayan değerler
 * Excel/Sheets tarafından formül olarak yorumlanmamalı.
 */
describe("toCsv — formula injection neutralization", () => {
  it("prefixes formula-triggering leading characters with a single quote", () => {
    const csv = toCsv(
      ["name"],
      [["=HYPERLINK(\"http://evil.example/steal\")"], ["+1+1"], ["-1+1"], ["@SUM(1,1)"], ["Normal İsim"]]
    ).toString("utf8");

    const lines = csv.replace(/^﻿/, "").split("\r\n").filter(Boolean);
    // lines[0] is the "name" header; data rows follow in insertion order.
    expect(lines[1]).toBe('"\'=HYPERLINK(""http://evil.example/steal"")"');
    expect(lines[2]).toBe("'+1+1");
    expect(lines[3]).toBe("'-1+1");
    // Değer virgül içerdiği için RFC 4180 kaçışıyla (çift tırnak) SARILIR — formül önleme
    // ('-prefix) ve virgül kaçışı bağımsız ama BİRLİKTE çalışır.
    expect(lines[4]).toBe('"\'@SUM(1,1)"');
    expect(lines[5]).toBe("Normal İsim");
  });

  it("leaves benign values untouched and still escapes RFC 4180 special characters", () => {
    const csv = toCsv(["a", "b"], [["hello, world", 'say "hi"']]).toString("utf8");
    const body = csv.replace(/^﻿/, "").split("\r\n")[1];
    expect(body).toBe('"hello, world","say ""hi"""');
  });
});
