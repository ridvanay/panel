/** Paket Z1 — paylaşım bağlantıları. Üçüncü taraf script/SDK YOK; yalnızca düz bağlantılar. */
export function buildShareLinks(url: string, title: string): { whatsapp: string; email: string } {
  const text = encodeURIComponent(`${title} ${url}`);
  return {
    whatsapp: `https://wa.me/?text=${text}`,
    email: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`,
  };
}
