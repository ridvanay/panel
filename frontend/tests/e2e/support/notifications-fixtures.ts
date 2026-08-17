/**
 * qa-agent — §10.16 (E-posta Şablonu Blok Editörü + İletişim Formu) E2E fixture yardımcıları.
 * `support/blog-fixtures.ts`'teki desenin (doğrudan `fetch`, gerçek backend'e karşı) bu bölüme
 * genişlemesi: e-posta şablonu + iletişim formu gönderimi temizliği.
 *
 * ÖNEMLİ — bilinen backend sınırlaması (qa-agent bulgusu, backend-agent'a raporlandı, bkz.
 * TEST_COVERAGE.md): `purpose = CUSTOM` bir şablon aktifleştirildikten (`POST .../activate`)
 * SONRA hiçbir uçla tekrar `isActive = false` yapılamaz — `activate` yalnızca `purpose !==
 * "CUSTOM"` iken kardeş satırları pasifleştirir (§10.16.3 "teklik kuralı CUSTOM'a uygulanmaz"
 * kararının bir sonucu), `PATCH` gövdesi `isActive` kabul etmez. `DELETE` ise `isActive === true`
 * iken KOŞULSUZ 409 döner. Sonuç: aktifleştirilmiş bir CUSTOM şablon kalıcı olarak silinemez hale
 * gelir. `cleanupEmailTemplatesByPrefix` bu yüzden 409'u YUTAR (fırlatmaz) ve konsola bilgilendirici
 * bir uyarı yazar — aksi halde `afterAll` her koşumda fırlayıp suite'i kırardı.
 */
import { API_BASE_URL } from "./api";

function authHeadersNoBody(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

export interface AdminEmailTemplateSummary {
  id: string;
  name: string;
  purpose: string;
  isSystem: boolean;
  isActive: boolean;
  [key: string]: unknown;
}

export async function listEmailTemplates(token: string): Promise<AdminEmailTemplateSummary[]> {
  const res = await fetch(`${API_BASE_URL}/admin/notifications/templates`, { headers: authHeadersNoBody(token) });
  return json<{ data: AdminEmailTemplateSummary[] }>(res).then((b) => b.data);
}

/** `name` `namePrefix` ile başlayan TÜM şablonları silmeyi DENER — bkz. dosya başlığı (CUSTOM +
 * aktif şablon 409 döner, bu YUTULUR ve konsola not düşülür, fırlatılmaz). */
export async function cleanupEmailTemplatesByPrefix(token: string, namePrefix: string): Promise<void> {
  const all = await listEmailTemplates(token);
  const matching = all.filter((t) => t.name.startsWith(namePrefix));
  for (const t of matching) {
    const res = await fetch(`${API_BASE_URL}/admin/notifications/templates/${t.id}`, {
      method: "DELETE",
      headers: authHeadersNoBody(token),
    });
    if (res.status === 409) {
      console.warn(
        `[qa-agent fixture] E-posta şablonu "${t.name}" (${t.id}) silinemedi (409 — isActive=true, CUSTOM ` +
          `deaktivasyon yolu yok). Bilinen backend sınırlaması, bkz. notifications-fixtures.ts başlığı.`
      );
      continue;
    }
    if (!res.ok && res.status !== 404) {
      const body = await res.text().catch(() => "");
      throw new Error(`Fixture cleanup DELETE başarısız — email template ${t.id}: ${res.status} ${body}`);
    }
  }
}

export interface AdminContactSubmissionSummary {
  id: string;
  name: string;
  email: string;
  status: string;
  [key: string]: unknown;
}

export async function listContactSubmissions(token: string, q: string): Promise<AdminContactSubmissionSummary[]> {
  const url = new URL(`${API_BASE_URL}/admin/contact/submissions`);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "50");
  const res = await fetch(url, { headers: authHeadersNoBody(token) });
  return json<{ data: AdminContactSubmissionSummary[] }>(res).then((b) => b.data);
}

export async function deleteContactSubmission(token: string, submissionId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/admin/contact/submissions/${submissionId}`, {
    method: "DELETE",
    headers: authHeadersNoBody(token),
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => "");
    throw new Error(`Fixture cleanup DELETE başarısız — contact submission ${submissionId}: ${res.status} ${body}`);
  }
}

/** `email` alanı tam olarak `email` ile eşleşen (arama `q` kısmi eşleşme yaptığı için istemci
 * tarafında tam eşleşmeye daraltılır) tüm gönderimleri kalıcı siler. */
export async function cleanupContactSubmissionsByEmail(token: string, email: string): Promise<void> {
  const matching = await listContactSubmissions(token, email);
  const exact = matching.filter((s) => s.email === email);
  await Promise.all(exact.map((s) => deleteContactSubmission(token, s.id)));
}
