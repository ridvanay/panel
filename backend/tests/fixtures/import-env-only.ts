// `tests/unit/env-demo-payments.test.ts` — `config/env.ts`'in modül-yükleme anındaki fail-closed
// boot koruması `process.exit(1)` çağırır; bu, ÇAĞIRAN vitest worker process'ini de öldürürdü.
// Bu yüzden ayrı bir alt process (`node:child_process`) içinde, `npx tsx` ile çalıştırılan minik
// bir fixture — yalnızca `config/env.ts`'i import eder ve boot BAŞARILIYSA `isDemoPaymentsEnabled`
// değerini stdout'a yazar. Testler exit code + stdout/stderr'i doğrular.
import { isDemoPaymentsEnabled } from "../../src/config/env";

// eslint-disable-next-line no-console
console.log(JSON.stringify({ ok: true, isDemoPaymentsEnabled }));
