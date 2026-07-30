import path from "node:path";
import dotenv from "dotenv";

// `config/env.ts` (dotenv/config) zaten set edilmiş değişkenleri override etmez —
// bu yüzden .env.test'i uygulama kodu import edilmeden ÖNCE, burada yüklüyoruz.
dotenv.config({ path: path.resolve(__dirname, "../../.env.test") });
