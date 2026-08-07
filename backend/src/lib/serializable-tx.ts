import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";

/**
 * "Check-then-act" (TOCTOU) race'lerine karşı Serializable izolasyonda transaction+retry
 * helper'ı. Aslen `admin-users.routes.ts::assertNotLastActiveAdmin` için yazıldı (son admin
 * kalmadı kontrolü + update'i tek transaction'da serialize etmek üzere); Faz 2b'de checkout
 * webhook'unun stok kontrolü+düşürme+Order.status güncellemesini ATOMIK yapmak için de
 * KULLANILIR (bkz. modules/webhooks/stripe.routes.ts::handleOrderPaid) — iş mantığı farklı
 * olsa da race koruması ihtiyacı BİREBİR aynı, bu yüzden burada tek noktadan paylaşılır.
 *
 * Postgres, Serializable izolasyonda çakışan eşzamanlı transaction'lardan birini P2034
 * (write conflict) ile reddeder — bunu birkaç kez retry ediyoruz (düşük trafikte çakışma
 * nadirdir, ama olası olduğunda sessizce yanlış sonuca değil, ya başarıya ya da açık bir
 * hataya varmalıyız).
 */
export async function runSerializable<T>(
  app: FastifyInstance,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  attempts = 3
): Promise<T> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await app.prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (err) {
      const isSerializationConflict = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034";
      if (!isSerializationConflict || attempt === attempts) throw err;
    }
  }
  /* istanbul ignore next — döngü ya `return` ya da `throw` ile biter. */
  throw new Error("unreachable");
}
