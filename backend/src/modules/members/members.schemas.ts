import { z } from "zod";

export const UpdateMembershipRequestSchema = z.object({
  role: z.enum(["ADMIN", "MEMBER"]),
});
