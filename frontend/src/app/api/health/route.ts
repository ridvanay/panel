import { NextResponse } from "next/server";

// Docker/orkestrasyon health check'i için — bkz. Dockerfile HEALTHCHECK ve
// docker-compose.yml. Statik önbelleğe alınmaması için her istekte çalışır.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" });
}
