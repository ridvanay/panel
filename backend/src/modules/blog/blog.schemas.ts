import { z } from "zod";
import { PageStatusSchema } from "../../schemas/entities";

export const PostIdParamSchema = z.object({
  postId: z.string().uuid(),
});

export const PostSlugParamSchema = z.object({
  slug: z.string().min(1),
});

export const CategoryIdParamSchema = z.object({
  categoryId: z.string().uuid(),
});

export const CreateBlogPostRequestSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1).optional(),
  excerpt: z.string().optional(),
  contentHtml: z.string().optional(),
  coverImageUrl: z.string().optional(),
  status: PageStatusSchema.optional(),
  categoryId: z.string().uuid().nullable().optional(),
});

export const UpdateBlogPostRequestSchema = z.object({
  title: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  excerpt: z.string().nullable().optional(),
  contentHtml: z.string().optional(),
  coverImageUrl: z.string().nullable().optional(),
  status: PageStatusSchema.optional(),
  categoryId: z.string().uuid().nullable().optional(),
});

export const CreateBlogCategoryRequestSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
});

export const UpdateBlogCategoryRequestSchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
});
