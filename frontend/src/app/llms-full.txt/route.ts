import { loadSiteContent } from "@/lib/sitemap/load";
import { LLMS_HEADERS, buildLlmsTxt } from "@/lib/seo/llms";

/** Paket S — `/llms-full.txt`: `/llms.txt` + doktor biyografi özetleri ve uzmanlık açıklamaları. */
export async function GET(): Promise<Response> {
  return new Response(buildLlmsTxt(await loadSiteContent(), { full: true }), { headers: LLMS_HEADERS });
}
