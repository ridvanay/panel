import { z } from "zod";

/** Tek tek: id param'ı UUID dayatmaz (bozuk id de olmayan toplantı gibi 404 verir, 422 değil). */
export const MeetingIdParamSchema = z.object({ id: z.string().min(1).max(100) });
export const MeetingGuestParamSchema = z.object({ id: z.string().min(1).max(100), guestId: z.string().min(1).max(100) });

const LocaleSchema = z.string().regex(/^[a-z]{2,3}(-[a-z]{2,8})?$/, "Geçersiz dil kodu.");

/** Başlık misafire GÖRÜNÜR: düz metin, kontrol/biçim karakteri yok. */
const TitleSchema = z
  .string()
  .trim()
  .min(3, "Başlık en az 3 karakter olmalıdır.")
  .max(120, "Başlık en çok 120 karakter olabilir.")
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "Başlık kontrol veya görünmez karakter içeremez.");

/** Not yalnızca ev sahibine görünür; yeni satır serbest, diğer kontrol karakterleri yasak. */
const NoteSchema = z
  .string()
  .trim()
  .max(1000, "Not en çok 1000 karakter olabilir.")
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value.replace(/[\n\r\t]/g, " ")), "Not kontrol veya görünmez karakter içeremez.");

const StartsAtSchema = z.string().datetime({ message: "startsAt ISO-8601 (Z) olmalıdır." }).transform((value) => new Date(value));
const DurationSchema = z
  .number()
  .int()
  .min(15, "Süre en az 15 dakika olmalıdır.")
  .max(120, "Süre en çok 120 dakika olabilir.")
  .refine((value) => value % 5 === 0, "Süre 5 dakikanın katı olmalıdır.");
/** Ev sahibi DAHİL toplam katılımcı: 2–8, varsayılan 4. */
const MaxParticipantsSchema = z.number().int().min(2, "En az 2 katılımcı.").max(8, "En çok 8 katılımcı.");

export const CreateMeetingRequestSchema = z.object({
  title: TitleSchema,
  startsAt: StartsAtSchema,
  durationMin: DurationSchema,
  maxParticipants: MaxParticipantsSchema.default(4),
  note: NoteSchema.optional(),
  autoAdmitGuests: z.boolean().default(false),
  /** Misafir bağlantısındaki dil öneki (`/{locale}/meet/join#…`). */
  locale: LocaleSchema.default("en"),
});

export const UpdateMeetingRequestSchema = z
  .object({
    title: TitleSchema,
    startsAt: StartsAtSchema,
    durationMin: DurationSchema,
    maxParticipants: MaxParticipantsSchema,
    note: NoteSchema.nullable(),
    autoAdmitGuests: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "En az bir alan gönderilmelidir.");

/** Gövdesiz çağrı da geçerli: Fastify gövde yokken `null` verir. */
export const GuestLinkRequestSchema = z.preprocess((value) => value ?? {}, z.object({ locale: LocaleSchema.default("en") }));

export const ListMeetingsQuerySchema = z.object({
  scope: z.enum(["upcoming", "past"]).default("upcoming"),
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const ListAdminMeetingsQuerySchema = z.object({
  scope: z.enum(["upcoming", "past", "all"]).default("upcoming"),
  hostUserId: z.string().min(1).max(100).optional(),
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const InviteEmailRequestSchema = z.object({
  /** Oluşturma / yeniden üretme yanıtındaki bağlantı (veya çıplak `mg_…` belirteci) — yalnızca o an bellekte durur. */
  guestLink: z.string().min(40).max(600),
  email: z.string().trim().email().max(254),
  locale: LocaleSchema.default("en"),
});

export const GuestPreflightRequestSchema = z.object({ t: z.string().max(200) });
export const GuestJoinRequestSchema = z.object({
  t: z.string().max(200),
  name: z.string().max(200).optional(),
  guestSession: z.string().max(400).optional(),
});

// --- Yanıt şemaları ---

export const MeetingPhaseSchema = z.enum(["upcoming", "open", "ended", "cancelled"]);

export const MeetingSchema = z.object({
  id: z.string(),
  title: z.string(),
  note: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
  durationMin: z.number(),
  maxParticipants: z.number(),
  autoAdmitGuests: z.boolean(),
  status: z.enum(["SCHEDULED", "CANCELLED"]),
  phase: MeetingPhaseSchema,
  hostJoinedAt: z.string().nullable(),
  guestLinkActive: z.boolean(),
  /** Pencere açılış anı (başlangıçtan 15 dk önce) — istemci "Katıl" düğmesini buna göre etkinleştirir. */
  opensAt: z.string(),
  createdAt: z.string(),
});

export const AdminMeetingSchema = MeetingSchema.omit({ note: true }).extend({
  host: z.object({ id: z.string(), name: z.string() }),
});

export const HostStatusSchema = z.object({ canHostMeetings: z.boolean(), twoFactorEnabled: z.boolean() });

export const MeetingTokenResponseSchema = z.object({
  token: z.string(),
  serverUrl: z.string(),
  roomName: z.string(),
  expiresAt: z.string(),
});

export const MeetingGuestListItemSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  createdAt: z.string(),
  admittedAt: z.string().nullable(),
  removedAt: z.string().nullable(),
  waiting: z.boolean(),
  /** Odada mı? `null` = LiveKit Server API yapılandırılmamış, bilinmiyor. */
  inRoom: z.boolean().nullable(),
});

export const GuestPreflightResponseSchema = z.object({
  title: z.string(),
  hostName: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  phase: z.enum(["upcoming", "open"]),
  /** AI İş 3: hizmet görüşmesine bağlı toplantıda `service_consultation` (misafir ekranı amaç metinlerini seçer). */
  purpose: z.enum(["general", "service_consultation"]),
});

export const GuestJoinResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("waiting"), guestSession: z.string(), pollAfterSec: z.number() }),
  z.object({
    status: z.literal("ready"),
    guestSession: z.string(),
    token: z.string(),
    serverUrl: z.string(),
    roomName: z.string(),
    expiresAt: z.string(),
  }),
]);
