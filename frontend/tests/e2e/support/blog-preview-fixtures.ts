/**
 * qa-agent — Blog taslak onizleme (Z-ONIZLEME) e2e yardimcilari. Gercek backend'e (`saas_e2e`) dogrudan `fetch`;
 * DB okuma/yazma (viewCount, son gecerlilik) backend dizininden kisa omurlu bir `node` sureciyle `@prisma/client`
 * uzerinden yapilir (yalnizca `saas_e2e`; DATABASE_URL acikca verilir). Kayitlar `qa-pv-` onekli slug tasir.
 */
import path from "node:path";
import { execFileSync } from "node:child_process";
import { API_BASE_URL } from "./api";

export const PV_PREFIX = "qa-pv-";

const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/saas_e2e?schema=public";
const BACKEND_DIR = path.resolve(process.cwd(), "..", "backend");

/** SQL calistirir, satirlari JSON olarak dondurur (UPDATE ... RETURNING dahil). */
export function dbRows<T = Record<string, unknown>>(sql: string): T[] {
  const script =
    "const {PrismaClient}=require('@prisma/client');" +
    "const p=new PrismaClient({datasourceUrl:process.env.PV_DB_URL});" +
    "p.$queryRawUnsafe(process.env.PV_SQL).then(r=>{console.log('@@'+JSON.stringify(r,(k,v)=>typeof v==='bigint'?Number(v):v));return p.$disconnect()})" +
    ".catch(e=>{console.error(String(e));process.exit(1)});";
  const out = execFileSync("node", ["-e", script], {
    cwd: BACKEND_DIR,
    env: { ...process.env, PV_DB_URL: E2E_DATABASE_URL, PV_SQL: sql },
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const line = out.split("\n").find((l) => l.startsWith("@@"));
  return (line ? JSON.parse(line.slice(2)) : []) as T[];
}

export interface PostDbState {
  status: string;
  medicalReviewStatus: string | null;
  viewCount: number;
  previewTokenHash: string | null;
  previewTokenExpiresAt: string | null;
}

export function postDbState(postId: string): PostDbState {
  const rows = dbRows<PostDbState>(
    `SELECT "status"::text AS "status", "medicalReviewStatus", "viewCount", "previewTokenHash", "previewTokenExpiresAt" FROM blog_posts WHERE id = '${postId.replace(/'/g, "''")}'`
  );
  if (!rows[0]) throw new Error(`Yazi DB'de yok: ${postId}`);
  return rows[0];
}

/** Paylasim belirtecinin son gecerliligini gecmise ceker. */
export function expirePreviewTokenInDb(postId: string): void {
  const rows = dbRows(
    `UPDATE blog_posts SET "previewTokenExpiresAt" = now() - interval '1 hour' WHERE id = '${postId.replace(/'/g, "''")}' AND "previewTokenHash" IS NOT NULL RETURNING id`
  );
  if (rows.length !== 1) throw new Error("Onizleme belirteci DB'de bulunamadi (son gecerlilik cekilemedi).");
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export async function createShareLink(adminToken: string, postId: string): Promise<{ token: string; expiresAt: string }> {
  const res = await fetch(`${API_BASE_URL}/admin/blog/${postId}/preview-link`, { method: "POST", headers: bearer(adminToken) });
  if (res.status !== 200 && res.status !== 201) throw new Error(`paylasim baglantisi olusturulamadi: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { data: { token: string; expiresAt: string } }).data;
}

export async function getShareLinkStatus(adminToken: string, postId: string): Promise<{ active: boolean; expiresAt: string | null; createdAt: string | null }> {
  const res = await fetch(`${API_BASE_URL}/admin/blog/${postId}/preview-link`, { headers: bearer(adminToken) });
  if (!res.ok) throw new Error(`baglanti durumu okunamadi: ${res.status}`);
  return ((await res.json()) as { data: { active: boolean; expiresAt: string | null; createdAt: string | null } }).data;
}

export async function adminPreviewSession(adminToken: string, postId: string): Promise<{ status: number; token?: string }> {
  const res = await fetch(`${API_BASE_URL}/admin/blog/${postId}/preview-session`, { method: "POST", headers: bearer(adminToken) });
  if (!res.ok) return { status: res.status };
  return { status: res.status, token: ((await res.json()) as { data: { token: string } }).data.token };
}

export async function doctorPreviewSession(doctorToken: string, postId: string): Promise<{ status: number; token?: string }> {
  const res = await fetch(`${API_BASE_URL}/doctor/blog-reviews/${postId}/preview-session`, { method: "POST", headers: bearer(doctorToken) });
  if (!res.ok) return { status: res.status };
  return { status: res.status, token: ((await res.json()) as { data: { token: string } }).data.token };
}

export interface PublicPreviewResult {
  status: number;
  headers: Headers;
  data: Record<string, unknown> | null;
}

export async function publicPreview(postId: string, token: string | null, locale = "en"): Promise<PublicPreviewResult> {
  const qs = new URLSearchParams({ locale });
  if (token !== null) qs.set("t", token);
  const res = await fetch(`${API_BASE_URL}/blog/preview/${encodeURIComponent(postId)}?${qs}`);
  const text = await res.text();
  const body = text ? (JSON.parse(text) as { data?: Record<string, unknown> }) : {};
  return { status: res.status, headers: res.headers, data: res.ok ? (body.data ?? null) : null };
}
