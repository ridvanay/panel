import { z } from "zod";

export const RegisterRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Şifre en az 8 karakter olmalı."),
  name: z.string().min(1),
});

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const ForgotPasswordRequestSchema = z.object({
  email: z.string().email(),
});

export const ResetPasswordRequestSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, "Şifre en az 8 karakter olmalı."),
});
