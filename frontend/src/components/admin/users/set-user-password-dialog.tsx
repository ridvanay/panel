"use client";

import { authStrings as trAuthStrings } from "@/lib/i18n/site-dictionaries/tr/auth";
import { PasswordField, passwordPolicyMessage } from "@/components/auth/password-field";
import { PASSWORD_MAX_LENGTH } from "@/lib/password-policy";
import { useEffect } from "react";
import { toast } from "sonner";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound } from "lucide-react";
import * as usersAdminApi from "@/lib/api/users-admin";
import type { AdminUser } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fieldErrorsFrom, friendlyErrorMessage } from "@/lib/api/friendly-error";

const passwordStrings = trAuthStrings.passwordRules;

/**
 * Backend `PATCH /admin/users/{userId}/password` gövdesini yansıtan istemci tarafı zod şeması —
 * min 8/max 200 karakter kuralı `hesabim/profil/page.tsx::passwordFormSchema` (kullanıcının KENDİ
 * şifre değiştirme akışı) İLE TUTARLI, ama BURADA `currentPassword` YOKTUR: bu, SÜPER YÖNETİCİ'nin
 * başka bir kullanıcının şifresini manuel belirlemesidir, o akışla KARIŞTIRILMAZ.
 */
const setPasswordFormSchema = z
  .object({
    // Paket S — asıl kurallar sunucuda (`lib/password-policy.ts`); burada yalnızca boş olmama + üst sınır.
    password: z.string().min(1, "Yeni şifre gerekli.").max(PASSWORD_MAX_LENGTH, `Şifre en fazla ${PASSWORD_MAX_LENGTH} karakter olabilir.`),
    passwordConfirm: z.string().min(1, "Şifre tekrarını girin."),
  })
  .refine((v) => v.password === v.passwordConfirm, {
    message: "Şifreler eşleşmiyor.",
    path: ["passwordConfirm"],
  });

type SetPasswordFormValues = z.infer<typeof setPasswordFormSchema>;

interface SetUserPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` iken dialog kapalı sayılır (`open` zaten `false` olur, ama içerik render edilmeye çalışılmaz). */
  user: AdminUser | null;
}

/**
 * "Şifre Değiştir" — admin panelinden bir kullanıcının şifresini MANUEL belirleme. Bu, kullanıcının
 * KENDİ şifre değiştirme formuyla (`hesabim/profil/page.tsx`) AYRI bir özelliktir: mevcut şifre
 * İSTENMEZ (yönetici zaten kullanıcı adına işlem yapıyor), `PATCH /admin/users/{userId}/password`
 * yalnızca `SiteRole.ADMIN` tarafından çağrılabilir (backend `requireSiteRole(...ROLES_ADMIN)`).
 */
export function SetUserPasswordDialog({ open, onOpenChange, user }: SetUserPasswordDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<SetPasswordFormValues>({
    resolver: zodResolver(setPasswordFormSchema),
    defaultValues: { password: "", passwordConfirm: "" },
  });
  const passwordValue = useWatch({ control: control, name: "password" }) ?? "";

  // Dialog her açılışta (farklı bir kullanıcı için yeniden açılsa dahi) temiz bir formla başlar —
  // önceki kullanıcı için girilmiş bir şifrenin YANLIŞLIKLA başka bir kullanıcıya gönderilmesi
  // riskini ortadan kaldırır.
  useEffect(() => {
    if (open) reset({ password: "", passwordConfirm: "" });
  }, [open, reset]);

  function handleOpenChange(next: boolean) {
    if (!isSubmitting) onOpenChange(next);
  }

  async function onSubmit(values: SetPasswordFormValues) {
    if (!user) return;
    try {
      await usersAdminApi.setAdminUserPassword(user.id, values.password);
    } catch (err) {
      // Paket S — şifre politikası ihlali kural kodlarından; diğer 422'ler `password` alanına, gerisi genel hata.
      const policy = passwordPolicyMessage(err, passwordStrings);
      if (policy) {
        setError("password", { message: policy });
        return;
      }
      const fieldErrors = fieldErrorsFrom(err);
      if (fieldErrors.password) {
        setError("password", { message: fieldErrors.password });
      } else {
        setError("root", { message: friendlyErrorMessage(err) });
      }
      return;
    }
    toast.success("Şifre güncellendi.");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <KeyRound className="h-4 w-4" />
            </span>
            <div>
              <DialogTitle>Şifreyi Değiştir</DialogTitle>
              <DialogDescription className="mt-1">
                {user ? `"${user.name}" kullanıcısı için yeni bir şifre belirleyin.` : undefined}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          {errors.root?.message && <Alert variant="error">{errors.root.message}</Alert>}

          <PasswordField
            id="set-user-password"
            label="Yeni Şifre"
            error={errors.password?.message}
            required
            value={passwordValue}
            context={{ email: user?.email, name: user?.name }}
            strings={passwordStrings}
            inputProps={register("password")}
          />

          <Field id="set-user-password-confirm" label="Şifreyi Onayla" error={errors.passwordConfirm?.message} required>
            {(inputProps) => (
              <Input {...inputProps} type="password" autoComplete="new-password" {...register("passwordConfirm")} />
            )}
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
              Vazgeç
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Şifreyi Değiştir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
