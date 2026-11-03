import { z } from "zod";
import { TimeZoneSchema } from "../../lib/dual-time";
import { ConsultationRequestBodySchema } from "../consultation-requests/consultation-requests.routes";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD biçiminde olmalı.");

export const ServiceConfigSchema = z.object({
  enabled: z.boolean(),
  timeZone: z.string(),
  durationMin: z.number(),
  minNoticeMin: z.number(),
  horizonDays: z.number(),
});

export const ServiceSlotsQuerySchema = z.object({ from: dateOnly, to: dateOnly });

export const ServiceSlotsResponseSchema = z.object({
  timeZone: z.string(),
  durationMin: z.number(),
  slots: z.array(z.object({ startsAt: z.string(), endsAt: z.string() })),
  days: z.array(z.object({ date: z.string(), status: z.enum(["available", "full", "closed"]) })),
});

const ExtraBookingFields = z.object({
  startsAt: z.string().datetime({ offset: true }).transform((v) => new Date(v)),
  patientTimeZone: TimeZoneSchema,
  interpreterLanguage: z.string().trim().min(2).max(12).nullable().optional(),
});

/**
 * Gövde = AH `POST /consultation-requests` gövdesi AYNEN (kurallar `ConsultationRequestBodySchema`'dan; kopya yok)
 * + `startsAt`, `patientTimeZone`, `interpreterLanguage?`. `specialtySlug`, AH'nin `serviceSlug` alanının takma adıdır.
 */
export const CreateServiceConsultationSchema = z.preprocess((raw) => {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const body = raw as Record<string, unknown>;
    if (body.specialtySlug !== undefined && (body.serviceSlug === undefined || body.serviceSlug === null)) {
      const { specialtySlug, ...rest } = body;
      return { ...rest, serviceSlug: specialtySlug };
    }
  }
  return raw;
}, ConsultationRequestBodySchema.and(ExtraBookingFields));

export const CreateServiceConsultationResponseSchema = z.object({
  consultationNumber: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  durationMin: z.number(),
  joinOpensAt: z.string(),
});

export const ManageTokenBodySchema = z.object({ t: z.string().max(200) });
export const RescheduleBodySchema = z.object({
  t: z.string().max(200),
  startsAt: z.string().datetime({ offset: true }).transform((v) => new Date(v)),
  patientTimeZone: TimeZoneSchema,
});

export const ManageLookupResponseSchema = z.object({
  consultationNumber: z.string(),
  status: z.enum(["PENDING_PAYMENT", "SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"]),
  startsAt: z.string(),
  endsAt: z.string(),
  durationMin: z.number(),
  serviceName: z.string(),
  canCancel: z.boolean(),
  canReschedule: z.boolean(),
  joinOpensAt: z.string(),
});

export const ManageCancelResponseSchema = z.object({ status: z.literal("CANCELLED") });
