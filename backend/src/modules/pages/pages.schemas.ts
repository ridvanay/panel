import { z } from "zod";
import { PageStatusSchema } from "../../schemas/entities";

export const PageIdParamSchema = z.object({
  pageId: z.string().uuid(),
});

export const PageSlugParamSchema = z.object({
  slug: z.string().min(1),
});

const BlockSchema = z.record(z.unknown());

export const CreatePageRequestSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1).optional(),
  status: PageStatusSchema.optional(),
  blocks: z.array(BlockSchema).optional(),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
});

export const UpdatePageRequestSchema = z.object({
  title: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  status: PageStatusSchema.optional(),
  blocks: z.array(BlockSchema).optional(),
  seoTitle: z.string().nullable().optional(),
  seoDescription: z.string().nullable().optional(),
});
