import path from "node:path";
import dotenv from "dotenv";

// `config/env.ts` (dotenv/config) zaten set edilmiş değişkenleri override etmez —
// bu yüzden .env.test'i uygulama kodu import edilmeden ÖNCE, burada yüklüyoruz.
//
// override: true ZORUNLU: `tests/setup/global-setup.ts` en tepede `import { PrismaClient }
// from "@prisma/client"` yapıyor; @prisma/client'ın kendisi require edilirken (henüz
// instantiate bile edilmeden) yan etki olarak backend kökündeki gerçek `.env` dosyasını okuyup
// process.env.DATABASE_URL'i saas_dev'e set ediyor (Node'un yerleşik env-file desteğini
// kullanıyor gibi görünüyor — kanıt: `node -e "require('@prisma/client')"` tek başına bile
// DATABASE_URL'i saas_dev yapıyor). globalSetup ana/orkestratör process'inde çalıştığından bu
// kirlenme oradan başlıyor; Vitest worker'ları (pool: forks) bu process'ten fork'landığında
// process.env'i miras alıyor, dolayısıyla worker'da DATABASE_URL zaten saas_dev olarak
// GELİYOR — bu setup dosyası çalışmadan önce bile. `override` olmadan dotenv.config() zaten
// set edilmiş bir değişkeni asla ezmediği için .env.test'teki saas_test göz ardı ediliyordu.
// `override: true` bu miras kalan kirliliği zorla ezip .env.test'i gerçek kaynak yapar.
dotenv.config({ path: path.resolve(__dirname, "../../.env.test"), override: true });
