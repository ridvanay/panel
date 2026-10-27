import { loadSiteContent } from "@/lib/sitemap/load";
import { LLMS_HEADERS, buildLlmsTxt } from "@/lib/seo/llms";

/** Paket S — `/llms.txt` (llmstxt.org; kanonik dil EN). */
export async function GET(): Promise<Response> {
  return new Response(buildLlmsTxt(await loadSiteContent()), { headers: LLMS_HEADERS });
}
