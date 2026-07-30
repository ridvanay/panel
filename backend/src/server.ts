import { buildApp } from "./app";
import { env } from "./config/env";

async function main() {
  const app = buildApp();

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const shutdown = (signal: string) => {
    app.log.info({ signal }, "Kapatma sinyali alındı, sunucu durduruluyor...");
    app.close().then(() => process.exit(0));
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
