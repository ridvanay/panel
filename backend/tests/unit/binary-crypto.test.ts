import crypto from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  BINARY_CRYPTO_MAGIC,
  BINARY_CRYPTO_OVERHEAD_BYTES,
  createBinaryDecryptStream,
  createBinaryEncryptStream,
} from "../../src/lib/binary-crypto";

/**
 * `.claude/architect-scope-telehealth-template.md` (TUR 3, bağlayıcı) — `lib/binary-crypto.ts`
 * için round-trip + büyük-akış + kurcalama/yanlış-anahtar testleri. `lib/crypto.ts` (2FA/epikriz
 * küçük-string sözleşmesi) İLE KARIŞTIRILMAZ — bu dosya STREAM tabanlı, AYRI bir modülü test eder.
 */

async function collectStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Kaynak akışı KASITLI OLARAK tuhaf/küçük chunk sınırlarıyla üretir — MAGIC/IV/auth-tag'in
 * chunk sınırlarını rastgele bölmesi senaryosunu (trailing-buffer mantığını) zorlar. */
function makeChunkedSource(buffer: Buffer, chunkSize: number): Readable {
  let offset = 0;
  return new Readable({
    read() {
      if (offset >= buffer.length) {
        this.push(null);
        return;
      }
      const end = Math.min(offset + chunkSize, buffer.length);
      this.push(buffer.subarray(offset, end));
      offset = end;
    },
  });
}

async function encryptBuffer(plain: Buffer, chunkSize = 64 * 1024): Promise<Buffer> {
  const source = makeChunkedSource(plain, chunkSize);
  const encrypted = source.pipe(createBinaryEncryptStream());
  return collectStream(encrypted);
}

async function decryptBuffer(encrypted: Buffer, chunkSize = 17): Promise<Buffer> {
  const source = makeChunkedSource(encrypted, chunkSize);
  const decrypted = source.pipe(createBinaryDecryptStream());
  return collectStream(decrypted);
}

describe("lib/binary-crypto", () => {
  it("WIRE FORMAT: MAGIC ile başlar, uzunluk = düz metin + sabit ek yük (IV+authTag)", async () => {
    const plain = crypto.randomBytes(10_000);
    const encrypted = await encryptBuffer(plain);

    expect(encrypted.subarray(0, BINARY_CRYPTO_MAGIC.length).equals(BINARY_CRYPTO_MAGIC)).toBe(true);
    expect(encrypted.length).toBe(plain.length + BINARY_CRYPTO_OVERHEAD_BYTES);
  });

  it("round-trip: encrypt→decrypt aynı buffer'ı verir (tuhaf chunk sınırlarıyla)", async () => {
    const plain = crypto.randomBytes(10_000);
    const encrypted = await encryptBuffer(plain);
    const decrypted = await decryptBuffer(encrypted);

    expect(decrypted.equals(plain)).toBe(true);
  });

  it("boş (0 bayt) girdi için de geçerli bir WIRE FORMAT üretir ve boş buffer'a çözülür", async () => {
    const encrypted = await encryptBuffer(Buffer.alloc(0));
    expect(encrypted.length).toBe(BINARY_CRYPTO_OVERHEAD_BYTES);

    const decrypted = await decryptBuffer(encrypted);
    expect(decrypted.length).toBe(0);
  });

  it(
    "≥50 MB sentetik stream ile round-trip yapar — veri tüm akış boyunca küçük chunk'lar hâlinde " +
      "işlenir (kaynak 64KB parçalar üretir, decrypt 17 baytlık tuhaf sınırlarla tüketir); " +
      "`createBinaryEncryptStream`/`createBinaryDecryptStream` HİÇBİR ZAMAN tüm dosyayı tek bir " +
      "buffer'da BİRİKTİRMEZ (yalnızca en fazla 16 baytlık bir trailing-tag tamponu tutar)",
    async () => {
      const size = 50 * 1024 * 1024 + 777; // 50MB + sınır-hizasız fazladan bayt
      const plain = crypto.randomBytes(size);

      const encrypted = await encryptBuffer(plain);
      expect(encrypted.length).toBe(plain.length + BINARY_CRYPTO_OVERHEAD_BYTES);

      const decrypted = await decryptBuffer(encrypted);
      expect(decrypted.length).toBe(plain.length);
      expect(decrypted.equals(plain)).toBe(true);
    },
    30_000
  );

  it("bozulmuş/kurcalanmış veri (auth tag'in son baytı değiştirilmiş) decrypt'te hata fırlatır", async () => {
    const plain = crypto.randomBytes(1000);
    const encrypted = await encryptBuffer(plain);
    const tampered = Buffer.from(encrypted);
    const lastIndex = tampered.length - 1;
    tampered.writeUInt8(tampered.readUInt8(lastIndex) ^ 0xff, lastIndex);

    await expect(decryptBuffer(tampered)).rejects.toThrow();
  });

  it("kurcalanmış ciphertext (ortadaki bir bayt değiştirilmiş) decrypt'te hata fırlatır", async () => {
    const plain = crypto.randomBytes(1000);
    const encrypted = await encryptBuffer(plain);
    const tampered = Buffer.from(encrypted);
    const middle = BINARY_CRYPTO_MAGIC.length + 12 + 500; // header sonrası, ciphertext ortası
    tampered.writeUInt8(tampered.readUInt8(middle) ^ 0xff, middle);

    await expect(decryptBuffer(tampered)).rejects.toThrow();
  });

  it("bozuk MAGIC ile decrypt hata fırlatır", async () => {
    const plain = crypto.randomBytes(100);
    const encrypted = await encryptBuffer(plain);
    const tampered = Buffer.from(encrypted);
    tampered.writeUInt8(tampered.readUInt8(0) ^ 0xff, 0);

    await expect(decryptBuffer(tampered)).rejects.toThrow();
  });

  it("veri MAGIC/IV başlığı için çok kısaysa (kesik stream) decrypt hata fırlatır", async () => {
    const truncated = Buffer.from(BINARY_CRYPTO_MAGIC.subarray(0, 4));
    await expect(decryptBuffer(truncated)).rejects.toThrow();
  });

  it("yanlış ENCRYPTION_KEY ile decrypt hata verir", async () => {
    // `binary-crypto.ts` modül seviyesinde TEK bir `encryptionKey` yükler (bkz. dosya üstü
    // yorumu) — farklı bir anahtarla test etmek için `vi.resetModules()` + geçici
    // `process.env.ENCRYPTION_KEY` değişikliği + dinamik re-import gerekir. Üstteki statik
    // `import` bağları bu resetten ETKİLENMEZ (zaten çözülmüş referanslardır).
    const originalKey = process.env.ENCRYPTION_KEY;
    try {
      vi.resetModules();
      process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
      const moduleA = await import("../../src/lib/binary-crypto");
      const plain = crypto.randomBytes(500);
      const encrypted = await collectStream(makeChunkedSource(plain, 64 * 1024).pipe(moduleA.createBinaryEncryptStream()));

      vi.resetModules();
      process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64"); // FARKLI anahtar
      const moduleB = await import("../../src/lib/binary-crypto");
      const decryptPromise = collectStream(makeChunkedSource(encrypted, 17).pipe(moduleB.createBinaryDecryptStream()));

      await expect(decryptPromise).rejects.toThrow();
    } finally {
      vi.resetModules();
      process.env.ENCRYPTION_KEY = originalKey;
    }
  });
});
