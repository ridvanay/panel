/**
 * Paket AK (K5) — iletişim sayfası "Çalışma saatleri" kartı: panelde girilen satır etiketi Türkçe gün adlarıysa
 * ("Pazartesi – Cuma") ziyaretçinin dilindeki gün adlarına eşlenir. Etiket başka bir şeyse olduğu gibi gösterilir.
 * Bu dosya Türkçe gün adlarını TESPİT eden bir yardımcıdır (yalnızca eşleme anahtarı, ziyaretçiye Türkçe metin göstermez).
 */
type HoursKey = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday" | "weekdays" | "weekend" | "everyday";
type DayTable = Record<HoursKey, string>;

/** Panelde yazılabilecek Türkçe karşılıklar (küçük harf, `tr` yerel ayarıyla karşılaştırılır). */
const TURKISH_DAYS: Record<HoursKey, string[]> = {
  monday: ["pazartesi"],
  tuesday: ["salı", "sali"],
  wednesday: ["çarşamba", "carsamba"],
  thursday: ["perşembe", "persembe"],
  friday: ["cuma"],
  saturday: ["cumartesi"],
  sunday: ["pazar"],
  weekdays: ["hafta içi", "hafta ici"],
  weekend: ["hafta sonu"],
  everyday: ["her gün", "her gun"],
};

/** Ziyaretçi dilleri (tr yok): gün adları sözlüğü. */
export const CONTACT_DAY_NAMES: Record<string, DayTable> = {
  en: { monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday", weekdays: "Weekdays", weekend: "Weekend", everyday: "Every day" },
  de: { monday: "Montag", tuesday: "Dienstag", wednesday: "Mittwoch", thursday: "Donnerstag", friday: "Freitag", saturday: "Samstag", sunday: "Sonntag", weekdays: "Werktags", weekend: "Wochenende", everyday: "Täglich" },
  ar: { monday: "الاثنين", tuesday: "الثلاثاء", wednesday: "الأربعاء", thursday: "الخميس", friday: "الجمعة", saturday: "السبت", sunday: "الأحد", weekdays: "أيام الأسبوع", weekend: "عطلة نهاية الأسبوع", everyday: "كل يوم" },
  fr: { monday: "Lundi", tuesday: "Mardi", wednesday: "Mercredi", thursday: "Jeudi", friday: "Vendredi", saturday: "Samedi", sunday: "Dimanche", weekdays: "En semaine", weekend: "Week-end", everyday: "Tous les jours" },
  ro: { monday: "Luni", tuesday: "Marți", wednesday: "Miercuri", thursday: "Joi", friday: "Vineri", saturday: "Sâmbătă", sunday: "Duminică", weekdays: "În zilele lucrătoare", weekend: "Weekend", everyday: "În fiecare zi" },
  "sr-latn": { monday: "Ponedeljak", tuesday: "Utorak", wednesday: "Sreda", thursday: "Četvrtak", friday: "Petak", saturday: "Subota", sunday: "Nedelja", weekdays: "Radnim danima", weekend: "Vikendom", everyday: "Svaki dan" },
  es: { monday: "Lunes", tuesday: "Martes", wednesday: "Miércoles", thursday: "Jueves", friday: "Viernes", saturday: "Sábado", sunday: "Domingo", weekdays: "Días laborables", weekend: "Fin de semana", everyday: "Todos los días" },
  ru: { monday: "Понедельник", tuesday: "Вторник", wednesday: "Среда", thursday: "Четверг", friday: "Пятница", saturday: "Суббота", sunday: "Воскресенье", weekdays: "По будням", weekend: "По выходным", everyday: "Ежедневно" },
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Uzun adlar önce ("cumartesi", "cuma"dan önce) — örtüşen eşleşmeler aşağıda elenir.
const MATCHERS: { key: HoursKey; pattern: RegExp }[] = (Object.entries(TURKISH_DAYS) as [HoursKey, string[]][])
  .flatMap(([key, names]) => names.map((name) => ({ key, name })))
  .sort((a, b) => b.name.length - a.name.length)
  .map(({ key, name }) => ({ key, pattern: new RegExp(`(?<![\\p{L}])${escapeRegExp(name)}(?![\\p{L}])`, "giu") }));

/**
 * Etiketteki Türkçe gün adlarını ziyaretçi diline çevirir. Eşleşme yoksa ya da dil sözlükte yoksa (Türkçe dahil)
 * etiket AYNEN döner. Büyük/küçük harfe duyarsızdır ve "–", "-", "—" gibi ayraçları korur.
 */
export function localizeHoursLabel(label: string, lang: string): string {
  const table = CONTACT_DAY_NAMES[lang];
  if (!table || !label) return label;
  // `İ`/`I` küçültülürken `tr` yerel ayarı kullanılır; uzunluk değişirse (birleşik nokta) düz küçültmeye düşülür.
  let lowered = label.toLocaleLowerCase("tr");
  if (lowered.length !== label.length) lowered = label.toLowerCase();
  if (lowered.length !== label.length) return label;
  const spans: { start: number; end: number; text: string }[] = [];
  for (const { key, pattern } of MATCHERS) {
    for (const m of lowered.matchAll(pattern)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (spans.some((s) => start < s.end && end > s.start)) continue;
      spans.push({ start, end, text: table[key] });
    }
  }
  if (spans.length === 0) return label;
  spans.sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const s of spans) {
    out += label.slice(cursor, s.start) + s.text;
    cursor = s.end;
  }
  return out + label.slice(cursor);
}
