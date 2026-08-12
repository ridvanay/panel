import { describe, expect, it } from "vitest";
import { escapeEmbeddedClosingTags } from "@/lib/site-settings/appearance";

describe("escapeEmbeddedClosingTags", () => {
  it("düz metni değiştirmeden bırakır", () => {
    expect(escapeEmbeddedClosingTags(".site-scope h1 { color: red; }")).toBe(".site-scope h1 { color: red; }");
  });

  it("</script> enjeksiyonunu kaçırır (kapanış etiketinin belgeyi kırmasını önler)", () => {
    const malicious = "</script><script>alert(1)</script>";
    const escaped = escapeEmbeddedClosingTags(malicious);
    expect(escaped).not.toContain("</script>");
    expect(escaped).toBe("<\\/script><script>alert(1)<\\/script>");
  });

  it("</style> enjeksiyonunu kaçırır", () => {
    const malicious = "</style><img src=x onerror=alert(1)>";
    const escaped = escapeEmbeddedClosingTags(malicious);
    expect(escaped).not.toContain("</style>");
    expect(escaped).toBe("<\\/style><img src=x onerror=alert(1)>");
  });

  it("büyük/küçük harf duyarsızdır", () => {
    expect(escapeEmbeddedClosingTags("</SCRIPT>")).toBe("<\\/SCRIPT>");
    expect(escapeEmbeddedClosingTags("</Style>")).toBe("<\\/Style>");
  });

  it("açılış etiketlerini KAÇIRMAZ — yalnızca kapanış yönü hedeflenir", () => {
    expect(escapeEmbeddedClosingTags("<script>ok</script>")).toBe("<script>ok<\\/script>");
  });

  it("null/boş girdiyi güvenle işler", () => {
    expect(escapeEmbeddedClosingTags("")).toBe("");
  });

  it("kapanış etiketinden sonra boşluk/öznitelik olsa bile kaçırır (`</script >`, `</script data-x>`) — HTML ayrıştırıcısı kapanışı `</script` önekiyle tanır, `>` beklemesi ZORUNLU değildir", () => {
    expect(escapeEmbeddedClosingTags("</script >")).toBe("<\\/script >");
    expect(escapeEmbeddedClosingTags("</script data-x='y'>")).toBe("<\\/script data-x='y'>");
  });

  it("aynı belgede tekrarlı/iç içe kaçış senaryolarının HEPSİNİ kaçırır (global eşleşme)", () => {
    const malicious = "</script></style></script></style>";
    const escaped = escapeEmbeddedClosingTags(malicious);
    expect(escaped).toBe("<\\/script><\\/style><\\/script><\\/style>");
    expect(escaped).not.toContain("</script>");
    expect(escaped).not.toContain("</style>");
  });

  it("zaten kaçırılmış bir diziyi TEKRAR kaçırmaz (idempotent) — `<\\/script` deseni yeniden eşleşmez", () => {
    const alreadyEscaped = escapeEmbeddedClosingTags("</script>");
    const twiceEscaped = escapeEmbeddedClosingTags(alreadyEscaped);
    expect(twiceEscaped).toBe(alreadyEscaped);
    expect(twiceEscaped).toBe("<\\/script>");
  });

  it("kapanış tag'i önekiyle başlayan ama gerçek bir kapanış olmayan diziyi de (false positive, ZARARSIZ aşırı-kaçış) kaçırır — `</scriptalert`", () => {
    // Gerçek bir tarayıcı `</scriptX` dizisini kapanış etiketi olarak yorumlamaz (script veri
    // durumundan çıkmak için tam `</script` + tag-adı-sınırlayıcı gerekir), ama fonksiyon
    // bilinçli olarak AŞIRI kaçış yapar (önek eşleşmesi yeterlidir) — güvenlik tarafında hata
    // yapmak (fazla kaçırmak) her zaman zararsızdır, eksik kaçırmak DEĞİLDİR.
    expect(escapeEmbeddedClosingTags("</scriptalert(1)")).toBe("<\\/scriptalert(1)");
  });
});
