import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers/build-test-app";
import { resetDatabase } from "../helpers/reset-db";
import { registerTestUser } from "../helpers/auth";

// Not: /auth/register ve /auth/login route-bazlı olarak dakikada 5 istekle sınırlı
// (bkz. auth.routes.ts AUTH_RATE_LIMIT). Bu dosyadaki testler tek bir paylaşılan
// kullanıcıyı yeniden kullanır ki toplam çağrı sayısı bu limitin altında kalsın.
describe("auth", () => {
  let app: FastifyInstance;
  let sharedUser: Awaited<ReturnType<typeof registerTestUser>>;

  beforeAll(async () => {
    app = await buildTestApp();
    await resetDatabase(app.prisma);
    sharedUser = await registerTestUser(app, { email: "alice@example.com" });
  });

  afterAll(async () => {
    await resetDatabase(app.prisma);
    await app.close();
  });

  it("registers a user and returns tokens", () => {
    expect(sharedUser.email).toBe("alice@example.com");
    expect(sharedUser.accessToken).toEqual(expect.any(String));
    expect(sharedUser.userId).toEqual(expect.any(String));
  });

  it("rejects registering the same email twice with 409 CONFLICT", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: sharedUser.email, password: "Sifre12345!", name: "Alice Again" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CONFLICT");
  });

  it("rejects registration with a too-short password (422 VALIDATION_ERROR)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: "carol@example.com", password: "short", name: "Carol" },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects login with a wrong password (401)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: sharedUser.email, password: "wrong-password" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("logs in with correct credentials", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: sharedUser.email, password: sharedUser.password },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.user.email).toBe(sharedUser.email);
  });

  it("returns session data for /me with a valid access token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${sharedUser.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.user.id).toBe(sharedUser.userId);
  });

  it("rejects /me without a token (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/auth/me" });
    expect(res.statusCode).toBe(401);
  });
});
