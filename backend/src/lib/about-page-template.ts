/**
 * "Hakkımızda" (About Us) şablonu — `about-page` blok tipinin sabitleri.
 *
 * Şablon ayrı bir `Page` kolonu DEĞİLDİR: `slug = "about"` olan sayfanın `blocks` dizisinde (ve
 * `translations.<locale>.blocks`'ta) TEK kök düğüm olarak duran bir `about-page` bloğudur. Böylece
 * doğrulama, revizyon, autosave, çok dillilik ve şablon-modu (Yazar rolü) altyapısı olduğu gibi
 * kullanılır — şema/migration değişikliği GEREKMEZ.
 *
 * **Ayna (frontend):** `frontend/src/lib/about-page.ts` — `ABOUT_ICON_KEYS` ve sınırlar BİREBİR
 * aynı olmak ZORUNDADIR (frontend yalnızca form/render için kullanır; asıl doğrulama buradadır).
 */
export const ABOUT_PAGE_BLOCK_TYPE = "about-page";
export const ABOUT_PAGE_SLUG = "about";

/** Admin'in seçebildiği ikonlar — kapalı liste (lucide-react bileşen adları). */
export const ABOUT_ICON_KEYS = [
  "Scale",
  "Ribbon",
  "Baby",
  "Smile",
  "Scissors",
  "Sparkles",
  "Stethoscope",
  "ClipboardCheck",
  "Globe",
  "HeartPulse",
  "Heart",
  "Brain",
  "Bone",
  "Eye",
  "Activity",
  "ShieldCheck",
  "ShieldPlus",
  "Syringe",
  "Pill",
  "Microscope",
  "Hospital",
  "Users",
  "Handshake",
  "Plane",
  "MapPin",
  "Award",
  "Clock",
  "MessageCircle",
  "Languages",
  "BadgeCheck",
] as const;

export const ABOUT_MAX_TREATMENT_ITEMS = 12;
export const ABOUT_MAX_APPROACH_ITEMS = 6;
export const ABOUT_MIN_DOCTORS = 1;
export const ABOUT_MAX_DOCTORS = 6;
