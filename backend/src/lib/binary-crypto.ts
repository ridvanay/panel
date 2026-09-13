import crypto from "node:crypto";
import { Transform } from "node:stream";
import { env } from "../config/env";

/**
 * TUR 3 madde 5 (bağlayıcı, `.claude/compliance-notes-telehealth.md`) — büyük BINARY (görüşme
 * kaydı video dosyası) için at-rest AES-256-GCM şifreleme. `lib/crypto.ts` ile AYNI ana anahtar
 * (`ENCRYPTION_KEY`, base64/32 byte) disiplinini paylaşır ama TAMAMEN AYRI, bağımsız bir
 * modüldür: `lib/crypto.ts` küçük string/hex sözleşmesine (2FA secret, epikriz notu) sahiptir,
 * bu modül STREAM tabanlıdır (tüm dosyayı belleğe ALMAZ). İki dosya BİLİNÇLİ OLARAK ortak bir
 * üçüncü dosyaya çıkarılmadı — ikisi de bağımsız kalır.
 *
 * BU E2EE (uçtan uca şifreleme) DEĞİLDİR — sunucu düz metni (video akışını) görür, yalnızca
 * at-rest (S3/MinIO'da dururken) şifreler. Hiçbir yorumda/UI/logda "uçtan uca şifreli" DENMEZ.
 *
 * WIRE FORMAT (bağlayıcı, değiştirilemez):
 *   MAGIC(8 bayt ASCII "TLHREC01") | IV(12 bayt) | CIPHERTEXT(n bayt) | AUTH_TAG(16 bayt)
 */

// `as const` önemli: string'e genişlerse TS `createCipheriv`'in genel (GCM-siz) overload'ını
// seçer ve dönen `Cipher`/`Decipher` tipinde `getAuthTag`/`setAuthTag` bulunmaz (bkz. lib/crypto.ts).
const ALGORITHM = "aes-256-gcm" as const;
const IV_LENGTH_BYTES = 12; // GCM için önerilen 96-bit IV.
const KEY_LENGTH_BYTES = 32; // AES-256.
const AUTH_TAG_LENGTH_BYTES = 16;

export const BINARY_CRYPTO_MAGIC = Buffer.from("TLHREC01", "ascii"); // 8 bayt
const HEADER_LENGTH_BYTES = BINARY_CRYPTO_MAGIC.length + IV_LENGTH_BYTES; // 20

/** Şifreli akışın düz metne göre sabit ek yükü (MAGIC + IV + AUTH_TAG). */
export const BINARY_CRYPTO_OVERHEAD_BYTES = BINARY_CRYPTO_MAGIC.length + IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES; // 36

const encryptionKey = Buffer.from(env.ENCRYPTION_KEY, "base64");

if (encryptionKey.length !== KEY_LENGTH_BYTES) {
  throw new Error(
    `ENCRYPTION_KEY 32 byte (base64) olmalı, ${encryptionKey.length} byte bulundu. Üretmek için: openssl rand -base64 32`
  );
}

/**
 * Düz baytları alır, yukarıdaki WIRE FORMAT'ta şifreli baytlar üretir. İlk chunk (veya girdi
 * hiç veri taşımıyorsa `flush`) ÖNCESİNDE MAGIC+IV başlığı bir kez push edilir; ciphertext
 * parçaları geldikçe akıtılır, `authTag` stream SONUNDA (`flush`) ciphertext'in ARDINDAN yazılır.
 */
export function createBinaryEncryptStream(): Transform {
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey, iv);
  let headerWritten = false;

  function writeHeaderOnce(push: (chunk: Buffer) => void): void {
    if (headerWritten) return;
    headerWritten = true;
    push(Buffer.concat([BINARY_CRYPTO_MAGIC, iv]));
  }

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        writeHeaderOnce((buf) => this.push(buf));
        const encrypted = cipher.update(chunk);
        if (encrypted.length > 0) this.push(encrypted);
        callback();
      } catch (err) {
        callback(err as Error);
      }
    },
    flush(callback) {
      try {
        // Boş girdi (0 baytlık kayıt) olsa dahi geçerli bir WIRE FORMAT üretilmeli.
        writeHeaderOnce((buf) => this.push(buf));
        const final = cipher.final();
        if (final.length > 0) this.push(final);
        this.push(cipher.getAuthTag());
        callback();
      } catch (err) {
        callback(err as Error);
      }
    },
  });
}

/**
 * Şifreli baytları alır, düz baytlar üretir. Formatı doğrular (MAGIC eşleşmeli, aksi hâlde
 * `flush`/`transform` hata fırlatır), IV'yi baştan okur, SON 16 baytı auth tag olarak GERİDE
 * TUTAR (gelen chunk'lar sınırları rastgele böldüğü için bir "trailing buffer" biriktirme
 * mantığı gerekir) ve `flush()`'ta `decipher.setAuthTag()` + `decipher.final()` ile doğrular.
 *
 * BİLİNÇLİ TAVİZ (Node'un stream'li GCM API'sinin doğal sonucu): GCM akış çözümünde düz metin,
 * auth tag doğrulanmadan ÖNCE (yani `decipher.update()` çağrıldığı anda) tüketiciye akabilir.
 * Bozulma/kurcalama durumunda stream SONUNDA (`flush`/`decipher.final()`) hata fırlatır; çağıran
 * taraf (route katmanı, integration-agent/backend-agent'ın FAZ B'si) bu hatada yanıtı KESMELİDİR
 * (`reply.raw.destroy()`) — bu dosyanın sorumluluğu DEĞİLDİR, burada yalnızca hata doğru fırlatılır.
 */
export function createBinaryDecryptStream(): Transform {
  let headerBuffer = Buffer.alloc(0);
  let headerParsed = false;
  let decipher: crypto.DecipherGCM | null = null;
  // Son (en fazla) 16 baytı biriktirir — bu baytlar auth tag OLABİLİR, henüz kesin değildir.
  let tail = Buffer.alloc(0);

  function parseHeader(buf: Buffer): Buffer {
    const magic = buf.subarray(0, BINARY_CRYPTO_MAGIC.length);
    if (!magic.equals(BINARY_CRYPTO_MAGIC)) {
      throw new Error("Geçersiz görüşme kaydı şifreleme formatı (MAGIC baytları uyuşmuyor).");
    }
    const iv = buf.subarray(BINARY_CRYPTO_MAGIC.length, HEADER_LENGTH_BYTES);
    decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey, iv);
    headerParsed = true;
    return Buffer.from(buf.subarray(HEADER_LENGTH_BYTES));
  }

  function consumeBody(chunk: Buffer, push: (buf: Buffer) => void): void {
    // `Buffer.concat` her zaman kullanılır (tail boş olsa dahi) — `chunk`'ı DOĞRUDAN `tail`'e
    // atamak, Node'un `Buffer<ArrayBufferLike>` (transform girdisi) ile `Buffer<ArrayBuffer>`
    // (yerel değişken) generic tiplerini UYUŞTURAMAZ (bkz. tsc hatası).
    const combined = Buffer.concat([tail, chunk]);
    if (combined.length <= AUTH_TAG_LENGTH_BYTES) {
      tail = combined;
      return;
    }
    const emitLength = combined.length - AUTH_TAG_LENGTH_BYTES;
    const toDecrypt = combined.subarray(0, emitLength);
    tail = Buffer.from(combined.subarray(emitLength));
    // BİLİNÇLİ TAVİZ (yukarıdaki JSDoc) — bu düz metin auth tag doğrulanmadan ÖNCE akıyor.
    const plain = decipher!.update(toDecrypt);
    if (plain.length > 0) push(plain);
  }

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        let rest = chunk;
        if (!headerParsed) {
          headerBuffer = Buffer.concat([headerBuffer, chunk]);
          if (headerBuffer.length < HEADER_LENGTH_BYTES) {
            callback();
            return;
          }
          rest = parseHeader(headerBuffer);
          headerBuffer = Buffer.alloc(0);
        }
        if (rest.length > 0) {
          consumeBody(rest, (buf) => this.push(buf));
        }
        callback();
      } catch (err) {
        callback(err as Error);
      }
    },
    flush(callback) {
      try {
        if (!headerParsed) {
          callback(new Error("Görüşme kaydı şifre çözme hatası: veri MAGIC/IV başlığı için çok kısa."));
          return;
        }
        if (tail.length !== AUTH_TAG_LENGTH_BYTES) {
          callback(new Error("Görüşme kaydı şifre çözme hatası: auth tag eksik/kısa (veri bozulmuş olabilir)."));
          return;
        }
        decipher!.setAuthTag(tail);
        // Doğrulama TAM OLARAK burada yapılır — bozulma/kurcalama varsa `final()` fırlatır.
        const final = decipher!.final();
        if (final.length > 0) this.push(final);
        callback();
      } catch (err) {
        callback(err as Error);
      }
    },
  });
}
