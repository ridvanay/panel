import {
  Activity,
  Baby,
  Bone,
  Brain,
  Dna,
  Ear,
  Eye,
  Flower2,
  Heart,
  HeartPulse,
  Microscope,
  Pill,
  Ribbon,
  Smile,
  Sparkles,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";

/**
 * Paket Z1 — kapak görseli olmayan yazılar için şablon kapakta kullanılan uzmanlık ikonu.
 * Uzmanlık slug'ına ANAHTAR KELİMEYLE eşlenir (slug'lar yönetici verisidir); bilinmeyen: Stethoscope.
 */
const RULES: [RegExp, LucideIcon][] = [
  [/cardi|heart|vascul/, HeartPulse],
  [/dent|tooth|oral|ortodon/, Smile],
  [/ortho|bone|joint|spine|musculo|rheum|physio/, Bone],
  [/neuro|brain|psych|mental/, Brain],
  [/ophthal|eye|optic/, Eye],
  [/(^|-)ent(-|$)|ear|otolar|audio/, Ear],
  [/derm|skin|aesthet|plastic|cosmet|hair/, Sparkles],
  [/gyn|obst|women|fertil/, Flower2],
  [/pedi|child|neonat|baby/, Baby],
  [/onco|cancer|tumou?r|radiat/, Ribbon],
  [/gastro|digest|hepat|liver|nutri|diet/, Pill],
  [/endocr|diab|thyroid|hormon|metabol/, Activity],
  [/genet|dna/, Dna],
  [/patholog|laborat|immun|infect/, Microscope],
  [/urolog|nephro|andro/, Heart],
];

export function specialtyIconFor(slug: string | null | undefined): LucideIcon {
  const key = (slug ?? "").toLowerCase();
  if (!key) return Stethoscope;
  for (const [pattern, icon] of RULES) if (pattern.test(key)) return icon;
  return Stethoscope;
}

/**
 * Paket Z1-ek - uzmanligin tutarli tonu. Yalnizca site tema tokenlarindan turetilir (sabit renk yok);
 * ayni slug her zaman ayni tonu alir (kararli, sunucu/istemci farksiz).
 */
export interface SpecialtyTone {
  /** Hafif zemin + okunur on plan (cip, ikon kutusu, sablon kapak). */
  soft: string;
  /** Yalnizca on plan rengi. */
  text: string;
}

const TONES: SpecialtyTone[] = [
  { soft: "bg-[var(--site-primary)]/10 text-[var(--site-primary)]", text: "text-[var(--site-primary)]" },
  { soft: "bg-[var(--site-secondary)]/10 text-[var(--site-secondary)]", text: "text-[var(--site-secondary)]" },
  { soft: "bg-[var(--site-accent)]/15 text-foreground", text: "text-foreground" },
];

export function specialtyToneFor(slug: string | null | undefined): SpecialtyTone {
  const key = (slug ?? "").toLowerCase();
  if (!key) return TONES[0]!;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return TONES[hash % TONES.length]!;
}
