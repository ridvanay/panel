import Stripe from "stripe";
import { env } from "../config/env";

// Trivy secret taramasi (KRITIK) — eskiden burada, gercek bir Stripe anahtari GIBI GORUNEN
// sabit bir "test" onekli dize (fallback deger) vardi; kaynak koda ASLA duz metin token
// gomulmez. `STRIPE_SECRET_KEY` bos oldugunda (dev/CI/demo ortami) burada UYDURMA bir anahtar
// DEGERI VERILMEZ — Stripe SDK'sinin kendisi bos/undefined bir anahtarla istemci
// olusturmaya izin verir (agin yalnizca GERCEKTEN bir API cagrisi yapildiginda, o cagriya
// ozel, kimlik dogrulama hatasiyla reddedilir). `webhooks.constructEvent` (bkz.
// modules/webhooks/stripe.routes.ts) SADECE STRIPE_WEBHOOK_SECRET ile yerel/senkron imza
// dogrulamasi yapar, API anahtarina hic dokunmaz — bu yuzden anahtar bos olsa BILE webhook
// akisi (ve onunla birlikte order/randevu durumu guncellemeleri) ETKILENMEZ. Ayri bir mock
// proxy nesnesi KASITLI olarak KULLANILMADI: `stripe.webhooks` gibi ic kaynaklari da
// kapsayan bir mock, gercek Stripe istemcisinin anahtardan BAGIMSIZ calisan bu kismini da
// engeller ve webhook/siparis akisini kirar (bkz. tests/integration/webhook-order.test.ts).
export const stripe = new Stripe(env.STRIPE_SECRET_KEY);
