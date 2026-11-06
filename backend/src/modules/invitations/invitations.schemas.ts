import { z } from "zod";

export const CreateInvitationRequestSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "MEMBER"]),
});

export const InvitationTokenParamSchema = z.object({
  token: z.string().min(1),
});

/** Paket AP — token POST gövdesinde. */
export const InvitationTokenBodySchema = z.object({
  token: z.string().min(1).max(200),
});
