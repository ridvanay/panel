import { buildApp } from "../../src/app";

export async function buildTestApp() {
  const app = buildApp();
  await app.ready();
  return app;
}
