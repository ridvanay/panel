import { describe, expect, it } from "vitest";
import yazl from "yazl";
import { parseMediaZip } from "../../src/modules/import/parsers/zip.parser";
import { ValidationError } from "../../src/lib/errors";

// 1x1 transparent PNG (valid PNG magic bytes).
const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000100000001080600000" + "01f15c4890000000a4944415478da6360000002000155bb84770000000049454e44ae426082",
  "hex"
);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

async function buildZip(entries: { name: string; content: Buffer }[]): Promise<Buffer> {
  const zipfile = new yazl.ZipFile();
  for (const entry of entries) {
    if (entry.name.endsWith("/")) {
      zipfile.addEmptyDirectory(entry.name);
    } else {
      zipfile.addBuffer(entry.content, entry.name);
    }
  }
  zipfile.end();

  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    zipfile.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zipfile.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zipfile.outputStream.on("error", reject);
  });
}

/**
 * `yazl` (bilinçli olarak) `..` içeren adları REDDEDER — bu yüzden kötü niyetli bir zip-slip
 * arşivi normal API ile üretilemez. Aynı bayt uzunluğunda zararsız bir ad ile arşiv üretip
 * (yerel dosya başlığı + merkezi dizin kaydındaki AYNI ad iki kez geçer) ham baytları
 * yerinde değiştiriyoruz — uzunluk aynı kaldığı için ofset/CRC/uzunluk alanları GEÇERLİ kalır.
 */
async function buildZipWithUnsafeName(unsafeName: string, content: Buffer): Promise<Buffer> {
  const placeholder = "z".repeat(unsafeName.length);
  const zip = await buildZip([{ name: placeholder, content }]);
  const from = Buffer.from(placeholder, "utf8");
  const to = Buffer.from(unsafeName, "utf8");
  let index = zip.indexOf(from);
  while (index !== -1) {
    to.copy(zip, index);
    index = zip.indexOf(from, index + from.length);
  }
  return zip;
}

describe("parseMediaZip", () => {
  it("extracts recognized image entries with magic-byte MIME detection", async () => {
    const zip = await buildZip([
      { name: "a.png", content: PNG_BYTES },
      { name: "b.jpg", content: JPEG_BYTES },
    ]);
    const { entries } = await parseMediaZip(zip);
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.name === "a.png")?.mimeType).toBe("image/png");
    expect(entries.find((e) => e.name === "b.jpg")?.mimeType).toBe("image/jpeg");
  });

  it("flags SVG entries as isSvg (rejected regardless of extension)", async () => {
    const zip = await buildZip([{ name: "evil.svg", content: SVG_BYTES }]);
    const { entries } = await parseMediaZip(zip);
    expect(entries[0]!.isSvg).toBe(true);
  });

  it("detects an unrecognized/renamed file via magic bytes even with an image extension", async () => {
    const zip = await buildZip([{ name: "fake.png", content: Buffer.from("not actually an image") }]);
    const { entries } = await parseMediaZip(zip);
    expect(entries[0]!.mimeType).toBeNull();
  });

  it("silently skips directory entries, __MACOSX/, and dotfiles", async () => {
    const zip = await buildZip([
      { name: "folder/", content: Buffer.alloc(0) },
      { name: "__MACOSX/a.png", content: PNG_BYTES },
      { name: ".DS_Store", content: Buffer.from("x") },
      { name: "real.png", content: PNG_BYTES },
    ]);
    const { entries } = await parseMediaZip(zip);
    expect(entries.map((e) => e.name)).toEqual(["real.png"]);
  });

  it("rejects the whole archive when an entry uses a zip-slip style path (`..`)", async () => {
    // `yauzl` girişin adını KENDİSİ doğrular ve `..` içeren TEK bir giriş bulsa bile TÜM
    // arşivi reddeder (node_modules/yauzl/index.js::validateFileName) — bu yüzden zip-slip
    // koruması pratikte "arşivin tamamı reddedilir" şeklinde gerçekleşir, per-entry değil.
    const zip = await buildZipWithUnsafeName("../../etc/passwd", Buffer.from("x"));
    await expect(parseMediaZip(zip)).rejects.toThrow(ValidationError);
  });

  it("rejects the whole archive when the entry count exceeds the bomb-protection limit", async () => {
    const many = Array.from({ length: 501 }, (_, i) => ({ name: `f${i}.png`, content: PNG_BYTES }));
    const zip = await buildZip(many);
    await expect(parseMediaZip(zip)).rejects.toThrow(ValidationError);
  });

  it("rejects a corrupted / non-ZIP buffer", async () => {
    await expect(parseMediaZip(Buffer.from("this is not a zip file at all"))).rejects.toThrow(ValidationError);
  });
});
