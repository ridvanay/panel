import type { FastifyInstance } from "fastify";

interface RegisteredUser {
  email: string;
  password: string;
  name: string;
  userId: string;
  accessToken: string;
}

/** Testlerde tekrar tekrar kullanılan akış: yeni bir kullanıcı kaydeder, access token'ını döner. */
export async function registerTestUser(
  app: FastifyInstance,
  overrides: Partial<{ email: string; password: string; name: string }> = {}
): Promise<RegisteredUser> {
  const email = overrides.email ?? `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = overrides.password ?? "Sifre12345!";
  const name = overrides.name ?? "Test User";

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, password, name },
  });

  const body = res.json() as { data: { user: { id: string }; tokens: { accessToken: string } } };
  return { email, password, name, userId: body.data.user.id, accessToken: body.data.tokens.accessToken };
}
