import type { ConsultationStrings } from "@/lib/i18n/site-dictionaries/en/consultation";
import { isQaListenerParticipant } from "@/components/site/telehealth/qa-listener-notice";
import { interpreterLanguageOf, isInterpreterParticipant, languageNativeName } from "@/components/site/interpreter/interpreter-participant";

/**
 * Paket AF (İş 1) — video kutusu ad etiketi. SAF yardımcı: katılımcının ROLÜ identity ÖNEKİNDEN (ve tercüman için
 * metadata'dan) çıkarılır; görünen ad izleyicinin rolüne göre belirlenir. IDENTITY HİÇBİR KOŞULDA etiket olamaz
 * (ad bulunamazsa izleyicinin dilinde rol adı döner).
 *
 * Hasta adı token'da YOKTUR; istemcide randevu/atama verisinden rol bazlı eşlenir:
 *  - hasta ve doktor ekranında `patientName` (tam ad),
 *  - tercüman ekranında `patientInitial` ("Z. K." — sunucu üretir; tam ad tercümana HİÇ gelmez).
 */
export type ParticipantRole = "doctor" | "patient" | "interpreter" | "listener" | "unknown";
export type ViewerRole = "doctor" | "patient" | "interpreter";

export interface LabelParticipant {
  identity: string;
  name?: string | null;
  metadata?: string | null;
}

export type LabelStrings = Pick<
  ConsultationStrings,
  "roleDoctor" | "rolePatient" | "roleInterpreter" | "interpreterLabel" | "interpreterLabelNoName" | "screenShareOf"
>;

export interface LabelContext {
  viewer: ViewerRole;
  /** Doktor/hasta ekranı: randevudaki hasta adı. Tercüman ekranında KULLANILMAZ. */
  patientName?: string | null;
  /** Tercüman ekranı: sunucunun ürettiği baş harfler ("Z. K."). */
  patientInitial?: string | null;
  /** Randevudaki doktor: izleyicinin görmesi gereken "unvan + görünen ad". */
  doctorName?: string | null;
  /** `doctorName` yoksa token `name` sonra bu (ör. tercüman atamasındaki görünen ad). */
  doctorFallbackName?: string | null;
  t: LabelStrings;
  fmt: (template: string, params?: Record<string, string | number>) => string;
  /** Dilin kendi adı ("ar" → "العربية"); testlerde enjekte edilebilir. */
  languageName?: (code: string) => string;
}

const IDENTITY_PREFIXES = ["doctor:", "patient:", "interpreter:", "qa-listener-"];

export function participantRole(p: { identity: string; metadata?: string | null }): ParticipantRole {
  const meta = p.metadata ?? undefined;
  if (isQaListenerParticipant({ identity: p.identity, metadata: meta })) return "listener";
  if (isInterpreterParticipant({ identity: p.identity, metadata: meta })) return "interpreter";
  if (p.identity.startsWith("doctor:")) return "doctor";
  if (p.identity.startsWith("patient:")) return "patient";
  return "unknown";
}

/** Token `name`'i yalnızca identity'ye benzemiyorsa ad sayılır (SDK boş adda identity gösterir; biz göstermeyiz). */
function usableName(name: string | null | undefined, identity: string): string | null {
  const n = (name ?? "").trim();
  if (!n || n === identity) return null;
  if (IDENTITY_PREFIXES.some((prefix) => n.startsWith(prefix))) return null;
  return n;
}

/** Tercüman token adı "A. Yılmaz · Interpreter (العربية)" — ad kısmı ilk " · " öncesidir. */
function interpreterBaseName(p: LabelParticipant): string | null {
  const full = usableName(p.name, p.identity);
  if (!full) return null;
  const base = full.split(" · ")[0]?.trim();
  return base ? base : null;
}

function roleName(role: ParticipantRole, t: LabelStrings): string | null {
  switch (role) {
    case "doctor":
      return t.roleDoctor;
    case "patient":
      return t.rolePatient;
    case "interpreter":
      return t.roleInterpreter;
    default:
      return null;
  }
}

/** Kutunun ad etiketi; dinleyici (video kutusu yok) için `null`. */
export function resolveParticipantLabel(p: LabelParticipant, ctx: LabelContext): string | null {
  const role = participantRole(p);
  if (role === "listener") return null;

  if (role === "interpreter") {
    const code = interpreterLanguageOf({ metadata: p.metadata ?? undefined });
    const language = code ? (ctx.languageName ?? languageNativeName)(code) : "";
    const base = interpreterBaseName(p);
    if (base) return ctx.fmt(ctx.t.interpreterLabel, { name: base, language }).replace(/\s*\(\)\s*$/, "");
    return ctx.fmt(ctx.t.interpreterLabelNoName, { language }).replace(/\s*·\s*$/, "");
  }

  if (role === "patient") {
    const value = ctx.viewer === "interpreter" ? ctx.patientInitial : ctx.patientName;
    return (value ?? "").trim() || ctx.t.rolePatient;
  }

  if (role === "doctor") {
    return (
      (ctx.doctorName ?? "").trim() ||
      usableName(p.name, p.identity) ||
      (ctx.doctorFallbackName ?? "").trim() ||
      ctx.t.roleDoctor
    );
  }

  return usableName(p.name, p.identity) ?? roleName(role, ctx.t) ?? "";
}

/** Ekran paylaşımı kutusu etiketi. */
export function resolveScreenShareLabel(p: LabelParticipant, ctx: LabelContext): string {
  const name = resolveParticipantLabel(p, ctx) ?? "";
  return ctx.fmt(ctx.t.screenShareOf, { name });
}
