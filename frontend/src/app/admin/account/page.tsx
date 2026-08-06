"use client";

import { motion } from "framer-motion";
import { toast } from "sonner";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertCircle, User } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import * as usersApi from "@/lib/api/users";
import type { SiteRole } from "@/lib/api/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { PageHeading } from "@/components/admin/page-heading";
import { ImageUploadField } from "@/components/admin/media/image-upload-field";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

const roleLabels: Record<SiteRole, string> = {
  ADMIN: "Admin",
  EDITOR: "Editor",
  VIEWER: "Viewer",
};

const MIN_PASSWORD_LENGTH = 8;

// `usersApi.updateMe` gövdesini yansıtan istemci tarafı zod şeması. `name` görsel olarak
// "required" işaretli — mevcut davranışta bu client-side kontrol YOKTU (form `noValidate`
// idi), gerçek bir doğrulama mesajına dönüştürülmesi blog başlığındaki gibi KABUL EDİLEBİLİR
// bir iyileştirmedir. `avatarUrl` opsiyonel kalır (boş = avatarı kaldır, bkz. onSubmit).
const profileFormSchema = z.object({
  name: z.string().min(1, "Ad soyad gerekli."),
  avatarUrl: z.string().optional(),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

// `usersApi.changePassword` gövdesini yansıtan şema. Tekil alan kuralları (boş olamaz, en az
// 8 karakter) zod ile doğrulanır — mesaj ve eşik MEVCUT `MIN_PASSWORD_LENGTH` kontrolüyle
// birebir aynıdır. Eşleşme/mevcut şifreden farklılık gibi ÇAPRAZ alan kuralları ise MEVCUT
// tek-Alert UX'ini birebir korumak için `onSubmit` içinde imzalı biçimde bırakıldı (bkz. altta).
const passwordFormSchema = z.object({
  currentPassword: z.string().min(1, "Mevcut şifre gerekli."),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH, "Şifre en az 8 karakter olmalı."),
  newPasswordConfirm: z.string().min(1, "Yeni şifre tekrarını girin."),
});

type PasswordFormValues = z.infer<typeof passwordFormSchema>;

export default function AccountPage() {
  const { user, refreshSession } = useAuth();

  // Bölüm 1-2: Profil + Avatar (tek PATCH altında birleştirildi, kendi useForm instance'ı).
  const {
    register: registerProfile,
    handleSubmit: handleProfileFormSubmit,
    control: profileControl,
    formState: { errors: profileErrors, isSubmitting: profileSaving },
    setError: setProfileFormError,
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      name: user?.name ?? "",
      avatarUrl: user?.avatarUrl ?? "",
    },
  });

  // Bölüm 3: Şifre değiştir (ayrı submit butonu → ayrı useForm instance'ı).
  const {
    register: registerPassword,
    handleSubmit: handlePasswordFormSubmit,
    reset: resetPasswordForm,
    setError: setPasswordFormError,
    formState: { errors: passwordErrors, isSubmitting: passwordSaving },
  } = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      newPasswordConfirm: "",
    },
  });

  if (!user) return null;

  async function onProfileSubmit(values: ProfileFormValues) {
    try {
      // Kritik: ImageUploadField boş string üretir, backend "" yerine null bekliyor
      // (kontrat: null = avatarı kaldır, "" = 422 doğrulama hatası).
      await usersApi.updateMe({ name: values.name, avatarUrl: values.avatarUrl || null });
      await refreshSession();
      toast.success("Profiliniz güncellendi.");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setProfileFormError("root", { message });
      toast.error(message);
    }
  }

  async function onPasswordSubmit(values: PasswordFormValues) {
    // Çapraz alan kuralları — mevcut tek-Alert UX'i birebir korunur (bkz. yukarıdaki not).
    if (values.newPassword !== values.newPasswordConfirm) {
      setPasswordFormError("root", { message: "Yeni şifreler eşleşmiyor." });
      return;
    }
    if (values.newPassword === values.currentPassword) {
      setPasswordFormError("root", { message: "Yeni şifre mevcut şifreden farklı olmalı." });
      return;
    }

    try {
      await usersApi.changePassword({ currentPassword: values.currentPassword, newPassword: values.newPassword });
      resetPasswordForm();
      toast.success("Şifreniz değiştirildi. Diğer cihazlardaki oturumlarınız kapatıldı.");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setPasswordFormError("root", { message });
      toast.error(message);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeading icon={User} title="Hesabım" description="Profil bilgilerinizi ve hesap güvenliğinizi yönetin." />

      <form onSubmit={handleProfileFormSubmit(onProfileSubmit)} noValidate className="space-y-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <Card className="space-y-4">
            <div>
              <h2 className="admin-h2">Profil</h2>
              <p className="mt-1 admin-text-secondary">Ad soyadınızı ve hesap bilgilerinizi görüntüleyin.</p>
            </div>

            {profileErrors.root?.message && (
              <Alert variant="error">
                <span className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {profileErrors.root.message}
                </span>
              </Alert>
            )}

            <Field id="name" label="Ad Soyad" error={profileErrors.name?.message} required>
              {(inputProps) => <Input {...inputProps} maxLength={80} {...registerProfile("name")} />}
            </Field>

            <Field id="email" label="E-posta">
              {(inputProps) => <Input {...inputProps} value={user.email} disabled readOnly />}
            </Field>

            <div>
              <span className="mb-1.5 block text-sm font-medium text-foreground">Rol</span>
              <Badge tone="primary">{roleLabels[user.role]}</Badge>
            </div>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
        >
          <Card className="space-y-4">
            <div>
              <h2 className="admin-h2">Avatar</h2>
              <p className="mt-1 admin-text-secondary">Profilinizde görünecek görseli değiştirin.</p>
            </div>

            <Controller
              control={profileControl}
              name="avatarUrl"
              render={({ field }) => (
                <ImageUploadField
                  id="avatarUrl"
                  label="Avatar"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  previewShape="circle"
                />
              )}
            />

            <Button type="submit" loading={profileSaving}>
              Kaydet
            </Button>
          </Card>
        </motion.div>
      </form>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <Card className="space-y-4">
          <div>
            <h2 className="admin-h2">Şifre</h2>
            <p className="mt-1 admin-text-secondary">
              Şifrenizi değiştirdiğinizde bu cihaz hariç diğer tüm oturumlarınız kapatılır.
            </p>
          </div>

          <form onSubmit={handlePasswordFormSubmit(onPasswordSubmit)} noValidate className="space-y-4">
            {passwordErrors.root?.message && (
              <Alert variant="error">
                <span className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {passwordErrors.root.message}
                </span>
              </Alert>
            )}

            <Field id="currentPassword" label="Mevcut Şifre" error={passwordErrors.currentPassword?.message} required>
              {(inputProps) => (
                <Input {...inputProps} type="password" autoComplete="current-password" {...registerPassword("currentPassword")} />
              )}
            </Field>

            <Field id="newPassword" label="Yeni Şifre" error={passwordErrors.newPassword?.message} required>
              {(inputProps) => (
                <Input {...inputProps} type="password" autoComplete="new-password" {...registerPassword("newPassword")} />
              )}
            </Field>

            <Field
              id="newPasswordConfirm"
              label="Yeni Şifre (Tekrar)"
              error={passwordErrors.newPasswordConfirm?.message}
              required
            >
              {(inputProps) => (
                <Input {...inputProps} type="password" autoComplete="new-password" {...registerPassword("newPasswordConfirm")} />
              )}
            </Field>

            <Button type="submit" variant="default" loading={passwordSaving}>
              Şifreyi Değiştir
            </Button>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}
