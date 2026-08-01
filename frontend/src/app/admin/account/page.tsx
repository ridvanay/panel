"use client";

import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
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

export default function AccountPage() {
  const { user, refreshSession } = useAuth();

  // Bölüm 1-2: Profil + Avatar (tek PATCH altında birleştirildi).
  const [name, setName] = useState(user?.name ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Bölüm 3: Şifre değiştir.
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  if (!user) return null;

  async function handleProfileSubmit(event: FormEvent) {
    event.preventDefault();
    setProfileError(null);
    setProfileSaving(true);
    try {
      // Kritik: ImageUploadField boş string üretir, backend "" yerine null bekliyor
      // (kontrat: null = avatarı kaldır, "" = 422 doğrulama hatası).
      await usersApi.updateMe({ name, avatarUrl: avatarUrl || null });
      await refreshSession();
      toast.success("Profiliniz güncellendi.");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setProfileError(message);
      toast.error(message);
    } finally {
      setProfileSaving(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent) {
    event.preventDefault();
    setPasswordError(null);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordError("Şifre en az 8 karakter olmalı.");
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setPasswordError("Yeni şifreler eşleşmiyor.");
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError("Yeni şifre mevcut şifreden farklı olmalı.");
      return;
    }

    setPasswordSaving(true);
    try {
      await usersApi.changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
      toast.success("Şifreniz değiştirildi. Diğer cihazlardaki oturumlarınız kapatıldı.");
    } catch (err) {
      const message = friendlyErrorMessage(err);
      setPasswordError(message);
      toast.error(message);
    } finally {
      setPasswordSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeading icon={User} title="Hesabım" description="Profil bilgilerinizi ve hesap güvenliğinizi yönetin." />

      <form onSubmit={handleProfileSubmit} noValidate className="space-y-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <Card className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Profil</h2>
              <p className="mt-1 text-sm text-foreground/60">Ad soyadınızı ve hesap bilgilerinizi görüntüleyin.</p>
            </div>

            {profileError && (
              <Alert variant="error">
                <span className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {profileError}
                </span>
              </Alert>
            )}

            <Field id="name" label="Ad Soyad" required>
              {(inputProps) => (
                <Input
                  {...inputProps}
                  required
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
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
              <h2 className="text-sm font-semibold text-foreground">Avatar</h2>
              <p className="mt-1 text-sm text-foreground/60">Profilinizde görünecek görseli değiştirin.</p>
            </div>

            <ImageUploadField
              id="avatarUrl"
              label="Avatar"
              value={avatarUrl}
              onChange={setAvatarUrl}
              previewShape="circle"
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
            <h2 className="text-sm font-semibold text-foreground">Şifre</h2>
            <p className="mt-1 text-sm text-foreground/60">
              Şifrenizi değiştirdiğinizde bu cihaz hariç diğer tüm oturumlarınız kapatılır.
            </p>
          </div>

          <form onSubmit={handlePasswordSubmit} noValidate className="space-y-4">
            {passwordError && (
              <Alert variant="error">
                <span className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {passwordError}
                </span>
              </Alert>
            )}

            <Field id="currentPassword" label="Mevcut Şifre" required>
              {(inputProps) => (
                <Input
                  {...inputProps}
                  type="password"
                  required
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              )}
            </Field>

            <Field id="newPassword" label="Yeni Şifre" required>
              {(inputProps) => (
                <Input
                  {...inputProps}
                  type="password"
                  required
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              )}
            </Field>

            <Field id="newPasswordConfirm" label="Yeni Şifre (Tekrar)" required>
              {(inputProps) => (
                <Input
                  {...inputProps}
                  type="password"
                  required
                  autoComplete="new-password"
                  value={newPasswordConfirm}
                  onChange={(e) => setNewPasswordConfirm(e.target.value)}
                />
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
