import "fastify";
import type { PrismaClient, MembershipRole, SiteRole, ApiKeyScope } from "@prisma/client";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }

  interface FastifyRequest {
    // `.claude/architect-scope-rbac-5-tier.md` §3 — `advancedBuilderEnabled` alanı KALDIRILDI;
    // `lib/builder-capability.ts::canUseAdvancedBuilder(request.user)` artık saf `role` türevidir.
    user?: { id: string; email: string; role: SiteRole };
    membership?: { role: MembershipRole; organizationId: string };
    // §10.13.4 — Public API (`/api/v1/public/*`) kimlik doğrulaması, `middleware/api-key-auth.ts`
    // tarafından set edilir. `request.user` İLE ASLA BİRLİKTE set edilmez: bir API anahtarı bir
    // kullanıcı DEĞİLDİR — `requireSiteRole` gibi kullanıcı-temelli guard'ların bir API anahtarıyla
    // yanlışlıkla geçmesi bu ayrım sayesinde yapısal olarak imkânsızdır.
    apiKey?: { id: string; name: string; scope: ApiKeyScope; expiresAt: Date | null };
    // §10.13.6 Katman 2 — `lib/api-key-rate-limit.ts::checkApiKeyRateLimit` sonucu, hem
    // `x-ratelimit-*` yanıt header'larında hem `GET /public/me` gövdesinde TEKRAR HESAPLANMADAN
    // kullanılabilsin diye preHandler'da burada saklanır.
    apiKeyRateLimit?: { limit: number; remaining: number; resetSeconds: number };
  }
}
