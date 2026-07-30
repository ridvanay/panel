import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import path from "node:path";
import fs from "node:fs";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";

export const UPLOAD_DIR = path.join(process.cwd(), "uploads");
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

export default fp(async function uploadsPlugin(app: FastifyInstance) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  });

  // /uploads/* herkese açık statik servis — görseller siteyi ziyaret eden herkes tarafından görülebilmeli.
  await app.register(fastifyStatic, {
    root: UPLOAD_DIR,
    prefix: "/uploads/",
  });
});
