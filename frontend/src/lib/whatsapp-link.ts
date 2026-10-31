/**
 * Paket X — WhatsApp bağlantısı: `https://wa.me/<numara>?text=<hazır mesaj>`. Mesaja YALNIZCA paket ya da sayfa adı
 * girer (`{package}` yer tutucusu); ad, telefon, sağlık bilgisi gibi kişisel veri asla eklenmez. CRM izleyicisi (onay
 * varsa) `wa.me` tıklamasını kendiliğinden "aday talep" olarak kaydeder; onay yoksa yalnızca bağlantı açılır.
 */
export function buildWhatsappHref(whatsapp: { number: string; message: string }, topic: string): string {
  const digits = whatsapp.number.replace(/[^0-9]/g, "");
  const cleanTopic = topic.replace(/\s+/g, " ").trim().slice(0, 120);
  const text = whatsapp.message.replace(/\{package\}/g, cleanTopic).trim();
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
