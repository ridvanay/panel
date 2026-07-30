import { z } from "zod";
import { SocialPlatform } from "@prisma/client";

// Not: `\/(?!\/|\\)` yalnızca TEK bir "/" ile başlayan gerçek göreli yollara izin verir.
// Bare "/" whitelisti "//evil.com" (protokol-relative URL) veya "/\evil.com" (tarayıcılar
// WHATWG URL spesine göre "\" karakterini "/" gibi normalize eder) gibi girdilerin göreli
// yol sanılıp kabul edilmesine ve tarayıcının bunu mutlak (harici) bir yönlendirme olarak
// yorumlamasına (open-redirect/phishing) yol açardı — bu yüzden ikinci karakterin "/" veya
// "\" olması reddedilir.
const HrefSchema = z
  .string()
  .min(1)
  .max(500)
  .regex(
    /^(https?:\/\/|\/(?!\/|\\)|#)/,
    "Geçersiz bağlantı: yalnızca http(s)://, / (protokol-relative olmayan) veya # ile başlayan yollar kabul edilir"
  );

export const NavigationItemInputSchema = z.object({
  label: z.string().min(1).max(80),
  href: HrefSchema,
  order: z.number().int().min(0),
});

export const SocialLinkInputSchema = z.object({
  platform: z.nativeEnum(SocialPlatform),
  url: HrefSchema,
  order: z.number().int().min(0),
});

export const FooterLinkInputSchema = z.object({
  label: z.string().min(1).max(80),
  href: HrefSchema,
  order: z.number().int().min(0),
});

export const FooterColumnInputSchema = z.object({
  title: z.string().min(1).max(80),
  order: z.number().int().min(0),
  links: z.array(FooterLinkInputSchema).max(20),
});

export const UpdateNavigationConfigRequestSchema = z.object({
  headerCtaLabel: z.string().max(60).nullable().optional(),
  headerCtaHref: HrefSchema.nullable().optional(),
  footerCopyrightText: z.string().max(200).nullable().optional(),
  navigationItems: z.array(NavigationItemInputSchema).max(20),
  socialLinks: z.array(SocialLinkInputSchema).max(15),
  footerColumns: z.array(FooterColumnInputSchema).max(8),
});
