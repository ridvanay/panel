import type { FastifyInstance } from "fastify";

// Docker/orkestrasyon HEALTHCHECK'i bu uca bakar (bkz. Dockerfile, docker-compose.yml) —
// sözleşme (200 + `{ status: "ok" }`) KORUNUR, DB erişilemezken SADECE 503 + `{ status: "error" }`
// eklenir. Karar: bu servis DB olmadan neredeyse hiçbir isteğe (auth, içerik, admin paneli)
// gerçek anlamda cevap veremiyor — "canlı ama DB'siz" bir backend'i healthy raporlamak,
// docker-compose'un `depends_on: condition: service_healthy` zincirini (frontend, backend'in
// GERÇEKTEN hazır olduğunu varsayarak başlar) yanıltır. Ayrık bir liveness/readiness
// probe ayrımı (K8s'te olduğu gibi) gerçek hedef platform (bkz. .github/workflows/deploy.yml
// TODO'su) seçildiğinde devops-agent/architect tarafından yeniden değerlendirilebilir; tek
// instance'lı docker-compose ortamında birleşik kontrol daha güvenilir bir sinyal verir.
// `SELECT 1` çok ucuzdur (bkz. modules/system/system.routes.ts::dbPingMs aynı deseni admin
// panelinde de kullanır) — timeout'a gerek yok, Postgres bağlantısı koptuğunda Prisma zaten
// hızlıca reddeder.
export default async function healthRoutes(app: FastifyInstance) {
  app.get("/healthz", async (_request, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return reply.send({ status: "ok" });
    } catch (err) {
      app.log.error({ err }, "Healthcheck başarısız: veritabanına ulaşılamıyor.");
      return reply.code(503).send({ status: "error" });
    }
  });
}
