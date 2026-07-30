import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const TEST_DB_NAME = "saas_test";
const MAINTENANCE_URL = "postgresql://postgres:postgres@localhost:5432/postgres?schema=public";
const TEST_DB_URL = `postgresql://postgres:postgres@localhost:5432/${TEST_DB_NAME}?schema=public`;

/**
 * Vitest globalSetup — tüm test dosyalarından önce BİR KEZ, ayrı bir process'te çalışır.
 * `saas_test` veritabanını (yoksa) oluşturur ve migration'ları uygular, böylece testler
 * `saas_dev`'e hiç dokunmadan gerçek bir Postgres'e karşı çalışabilir.
 */
export default async function globalSetup() {
  const admin = new PrismaClient({ datasources: { db: { url: MAINTENANCE_URL } } });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE ${TEST_DB_NAME}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.toLowerCase().includes("already exists")) throw err;
  } finally {
    await admin.$disconnect();
  }

  execSync("npx prisma migrate deploy", {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "inherit",
  });
}
