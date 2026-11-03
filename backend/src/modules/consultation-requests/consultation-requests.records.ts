import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { encryptSecret } from "../../lib/crypto";

/**
 * Paket AH/AI - `CrmLead` + `ConsultationRequest` kaydini TEK yerde yazar (AH `POST /consultation-requests` ve
 * AI `POST /service-consultations` ayni islemde bunu cagirir; kod kopyalanmaz). Cagiran transaction saglar.
 * Mesaj saglik verisi icerebilir: yalniz saglik rizasiyla, AES-256-GCM sifreli saklanir.
 */
export interface ConsultationRecordInput {
  /** Verilmezse uretilir. */
  requestId?: string;
  fullName: string;
  email: string;
  phone: string | null;
  country: string;
  contactLanguage: string;
  specialtyId: string | null;
  packageId: string | null;
  serviceName: string;
  landingPath: string;
  preferredFrom?: Date | null;
  preferredTo?: Date | null;
  needsInterpreter: boolean;
  preferredContactChannel: string | null;
  /** Temizlenmis mesaj ("" = yok). */
  message: string;
  healthDataConsent: boolean;
  consentTextVersion: string;
  locale: string;
  ipAddress: string | null;
  userAgent: string | null;
  now: Date;
}

export async function createLeadAndConsultationRequest(tx: Prisma.TransactionClient, input: ConsultationRecordInput): Promise<{ id: string; seq: number; leadId: string }> {
  const requestId = input.requestId ?? crypto.randomUUID();
  const lead = await tx.crmLead.create({
    data: {
      channel: "CONSULTATION_REQUEST",
      status: "NEW",
      name: input.fullName,
      email: input.email,
      phone: input.phone,
      country: input.country,
      language: input.contactLanguage,
      specialtyId: input.specialtyId,
      specialtyName: input.serviceName,
      landingPath: input.landingPath,
      sourceRefId: requestId,
      nextActionAt: input.now,
    },
  });
  const created = await tx.consultationRequest.create({
    data: {
      id: requestId,
      leadId: lead.id,
      specialtyId: input.specialtyId,
      packageId: input.packageId,
      serviceName: input.serviceName,
      preferredFrom: input.preferredFrom ?? null,
      preferredTo: input.preferredTo ?? null,
      country: input.country,
      contactLanguage: input.contactLanguage,
      needsInterpreter: input.needsInterpreter,
      preferredContactChannel: input.preferredContactChannel,
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      messageEncrypted: input.message && input.healthDataConsent ? encryptSecret(input.message) : null,
      contactConsentAt: input.now,
      // Veri minimizasyonu: saglik rizasi yalnizca mesaj yazildiysa kayda gecer.
      healthDataConsentAt: input.message && input.healthDataConsent ? input.now : null,
      consentTextVersion: input.consentTextVersion,
      locale: input.locale,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    },
    select: { id: true, seq: true },
  });
  return { id: created.id, seq: created.seq, leadId: lead.id };
}
