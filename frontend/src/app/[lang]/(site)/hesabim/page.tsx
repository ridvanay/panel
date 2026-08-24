"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import {
  AlertCircle,
  Copy,
  KeyRound,
  LogIn,
  Monitor,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Tablet,
  UserRound,
} from "lucide-react";
import { useAuth } from "@/context/auth-context";
import * as usersApi from "@/lib/api/users";
import * as securityApi from "@/lib/api/security";
import type { Session, TwoFactorSetupResponse } from "@/lib/api/types";
import { getRoleBadgeInfo } from "@/lib/role-badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

// `usersApi.updateMe` gövdesini yansıtan istemci tarafı zod şeması (bkz. `app/admin/account/page.tsx`
// — AYNI desen, storefront'a taşındı). `avatarUrl` burada BİLEREK düz bir URL girişi — medya
// kütüphanesi yükleme akışı (`ImageUploadField`) `/admin/media` ucunu kullanır ve panel erişimi
// gerektirir; CUSTOMER/USER panele giremez (§10.21 §4), bu yüzden storefront'ta o bileşen
// KULLANILMAZ.
const profileFormSchema = z.object({
  name: z.string().min(1, "Ad soyad gerekli."),
  avatarUrl: z.string().optional(),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

const MIN_PASSWORD_LENGTH = 8;

const passwordFormSchema = z.object({
  currentPassword: z.string().min(1, "Mevcut şifre gerekli."),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH, "Şifre en az 8 karakter olmalı."),
  newPasswordConfirm: z.string().min(1, "Yeni şifre tekrarını girin."),
});

type PasswordFormValues = z.infer<typeof passwordFormSchema>;

type DeviceType = "desktop" | "mobile" | "tablet";

const deviceIcons: Record<DeviceType, ComponentType<{ className?: string }>> = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
};

function detectDeviceType(userAgent: string | null | undefined): DeviceType {
  if (!userAgent) return "desktop";
  if (/ipad|tablet/i.test(userAgent)) return "tablet";
  if (/mobile|android(?!.*tablet)|iphone/i.test(userAgent)) return "mobile";
  return "desktop";
}

function extractManualSecret(otpauthUrl: string): string | null {
  try {
    return new URL(otpauthUrl).searchParams.get("secret");
  } catch {
    return null;
  }
}

function BackupCodesList({ codes }: { codes: string[] }) {
  function copyAll() {
    navigator.clipboard.writeText(codes.join("\n")).then(
      () => toast.success("Yedek kodlar panoya kopyalandı."),
      () => toast.error("Panoya kopyalanamadı.")
    );
  }

  return (
    <div className="space-y-3">
      <Alert variant="info">Bu kodlar bir daha gösterilmeyecek, güvenli bir yere kaydedin.</Alert>
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface-muted p-3 font-mono text-sm">
        {codes.map((code) => (
          <span key={code} className="text-foreground/80">
            {code}
          </span>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={copyAll}>
        <Copy className="h-4 w-4" />
        Tümünü Kopyala
      </Button>
    </div>
  );
}

/**
 * `/hesabim` — §10.21 §8.3 tablosu: ADMIN/MANAGER/EDITOR/CUSTOMER/USER'ın HEPSİ erişebilir.
 * Profil (ad/avatar), şifre ve 2FA + oturumlar (`/admin/settings/security/2fa|/sessions`, §4.3
 * self-servis istisnası — panel erişimi GEREKTİRMEZ, authenticated her rol çağırabilir).
 */
export default function MyAccountPage() {
  const { status, user, refreshSession } = useAuth();
  const pathname = usePathname();

  const {
    register: registerProfile,
    handleSubmit: handleProfileFormSubmit,
    control: profileControl,
    formState: { errors: profileErrors, isSubmitting: profileSaving },
    setError: setProfileFormError,
    reset: resetProfileForm,
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: { name: user?.name ?? "", avatarUrl: user?.avatarUrl ?? "" },
  });

  useEffect(() => {
    if (user) resetProfileForm({ name: user.name, avatarUrl: user.avatarUrl ?? "" });
  }, [user, resetProfileForm]);

  const {
    register: registerPassword,
    handleSubmit: handlePasswordFormSubmit,
    reset: resetPasswordForm,
    setError: setPasswordFormError,
    formState: { errors: passwordErrors, isSubmitting: passwordSaving },
  } = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { currentPassword: "", newPassword: "", newPasswordConfirm: "" },
  });

  // İki faktörlü doğrulama akışı — `app/admin/settings/security/page.tsx` ile BİREBİR aynı mantık.
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupData, setSetupData] = useState<TwoFactorSetupResponse | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupCode, setSetupCode] = useState("");
  const [enabling, setEnabling] = useState(false);

  const [backupCodesOpen, setBackupCodesOpen] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableError, setDisableError] = useState<string | null>(null);
  const [disabling, setDisabling] = useState(false);

  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [regeneratePassword, setRegeneratePassword] = useState("");
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<Session | null>(null);
  const [revokeOthersOpen, setRevokeOthersOpen] = useState(false);
  const [revokingOthers, setRevokingOthers] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      const items = await securityApi.listSessions();
      setSessions(items);
    } catch (err) {
      setSessionsError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    (async () => {
      await loadSessions();
    })();
  }, [status, loadSessions]);

  const otherSessionsExist = useMemo(() => (sessions ?? []).some((s) => !s.isCurrent), [sessions]);

  async function onProfileSubmit(values: ProfileFormValues) {
    try {
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

  async function handleStartSetup() {
    setSetupError(null);
    setSetupLoading(true);
    try {
      const data = await securityApi.setupTwoFactor();
      setSetupData(data);
      setSetupCode("");
      setSetupOpen(true);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setSetupLoading(false);
    }
  }

  async function handleEnable() {
    if (!setupData) return;
    setSetupError(null);
    setEnabling(true);
    try {
      const result = await securityApi.enableTwoFactor({ setupToken: setupData.setupToken, code: setupCode });
      setSetupOpen(false);
      setSetupData(null);
      setBackupCodes(result.backupCodes);
      setBackupCodesOpen(true);
      await refreshSession();
      toast.success("İki faktörlü doğrulama etkinleştirildi.");
    } catch (err) {
      setSetupError(friendlyErrorMessage(err));
    } finally {
      setEnabling(false);
    }
  }

  async function handleDisable() {
    setDisableError(null);
    setDisabling(true);
    try {
      await securityApi.disableTwoFactor({ password: disablePassword });
      setDisableOpen(false);
      setDisablePassword("");
      await refreshSession();
      toast.success("İki faktörlü doğrulama devre dışı bırakıldı.");
    } catch (err) {
      setDisableError(friendlyErrorMessage(err));
    } finally {
      setDisabling(false);
    }
  }

  async function handleRegenerate() {
    setRegenerateError(null);
    setRegenerating(true);
    try {
      const result = await securityApi.regenerateBackupCodes({ password: regeneratePassword });
      setRegenerateOpen(false);
      setRegeneratePassword("");
      setBackupCodes(result.backupCodes);
      setBackupCodesOpen(true);
      toast.success("Yedek kodlar yenilendi.");
    } catch (err) {
      setRegenerateError(friendlyErrorMessage(err));
    } finally {
      setRegenerating(false);
    }
  }

  async function handleRevokeSession() {
    if (!pendingRevoke) return;
    setRevokingId(pendingRevoke.id);
    try {
      await securityApi.revokeSession(pendingRevoke.id);
      toast.success("Oturum sonlandırıldı.");
      setPendingRevoke(null);
      await loadSessions();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setRevokingId(null);
    }
  }

  async function handleRevokeOthers() {
    setRevokingOthers(true);
    try {
      await securityApi.revokeOtherSessions();
      toast.success("Diğer tüm oturumlar sonlandırıldı.");
      setRevokeOthersOpen(false);
      await loadSessions();
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setRevokingOthers(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="mx-auto flex max-w-3xl justify-center px-4 py-24 sm:px-6">
        <Spinner className="h-6 w-6 text-[var(--site-primary)]" />
      </div>
    );
  }

  if (status === "unauthenticated" || !user) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center sm:px-6">
        <UserRound className="mx-auto h-10 w-10 text-foreground/30" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-semibold text-foreground">Hesabınızı görüntülemek için giriş yapın</h1>
        <p className="mt-2 text-sm text-foreground/60">
          Profil bilgilerinizi, şifrenizi ve güvenlik ayarlarınızı yönetmek için oturum açmanız gerekiyor.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(pathname)}`}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[var(--site-button)] px-4 py-2 text-sm font-medium text-[var(--site-button-text)] transition-all duration-300 hover:opacity-85"
        >
          <LogIn className="h-4 w-4" aria-hidden="true" />
          Giriş Yap
        </Link>
      </div>
    );
  }

  const roleBadge = getRoleBadgeInfo(user);
  const manualSecret = setupData ? extractManualSecret(setupData.otpauthUrl) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">Hesabım</h1>
        <p className="mt-1 text-sm text-foreground/60">Profil bilgilerinizi ve hesap güvenliğinizi yönetin.</p>
      </div>

      <form onSubmit={handleProfileFormSubmit(onProfileSubmit)} noValidate className="space-y-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <Card className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">Profil</h2>
              <p className="mt-1 text-sm text-foreground/60">Ad soyadınızı ve hesap bilgilerinizi görüntüleyin.</p>
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

            <Controller
              control={profileControl}
              name="avatarUrl"
              render={({ field }) => (
                <Field id="avatarUrl" label="Avatar URL'si">
                  {(inputProps) => (
                    <Input {...inputProps} placeholder="https://…" value={field.value ?? ""} onChange={field.onChange} />
                  )}
                </Field>
              )}
            />

            <div>
              <span className="mb-1.5 block text-sm font-medium text-foreground">Rol</span>
              <Badge tone={roleBadge.tone} solid={roleBadge.solid}>
                <roleBadge.icon className="mr-1 h-3 w-3" />
                {roleBadge.label}
              </Badge>
            </div>

            <Button type="submit" loading={profileSaving}>
              Kaydet
            </Button>
          </Card>
        </motion.div>
      </form>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 }}>
        <Card className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Şifre</h2>
            <p className="mt-1 text-sm text-foreground/60">
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

            <Field id="newPasswordConfirm" label="Yeni Şifre (Tekrar)" error={passwordErrors.newPasswordConfirm?.message} required>
              {(inputProps) => (
                <Input {...inputProps} type="password" autoComplete="new-password" {...registerPassword("newPasswordConfirm")} />
              )}
            </Field>

            <Button type="submit" loading={passwordSaving}>
              Şifreyi Değiştir
            </Button>
          </form>
        </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.1 }}>
        <Card className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">İki Faktörlü Doğrulama</h2>
              <p className="mt-1 text-sm text-foreground/60">
                Hesabınıza giriş yaparken kimlik doğrulama uygulamanızdan bir kod isteyerek ekstra güvenlik katmanı ekler.
              </p>
            </div>
            {user.twoFactorEnabled ? (
              <Badge tone="success">Etkin</Badge>
            ) : (
              <Badge tone="warning">Kapalı</Badge>
            )}
          </div>

          {user.twoFactorEnabled ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setRegenerateOpen(true)}>
                <KeyRound className="h-4 w-4" />
                Yedek Kodları Yenile
              </Button>
              <Button variant="destructive" onClick={() => setDisableOpen(true)}>
                <ShieldOff className="h-4 w-4" />
                Devre Dışı Bırak
              </Button>
            </div>
          ) : (
            <Button loading={setupLoading} onClick={handleStartSetup}>
              <ShieldCheck className="h-4 w-4" />
              Etkinleştir
            </Button>
          )}
        </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.15 }}>
        <Card className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">Aktif Oturumlar</h2>
              <p className="mt-1 text-sm text-foreground/60">Hesabınıza giriş yapılmış tüm cihazlar.</p>
            </div>
            <Button variant="outline" disabled={!otherSessionsExist} onClick={() => setRevokeOthersOpen(true)}>
              Diğer Tüm Oturumları Sonlandır
            </Button>
          </div>

          {sessionsError && (
            <Alert variant="error">
              <span className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {sessionsError}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => void loadSessions()}>
                  Tekrar Dene
                </Button>
              </span>
            </Alert>
          )}

          {!sessionsError && sessions === null && (
            <div className="flex justify-center py-8">
              <Spinner className="h-6 w-6 text-[var(--site-primary)]" />
            </div>
          )}

          {!sessionsError && sessions !== null && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cihaz / Tarayıcı</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Giriş Tarihi</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>İşlem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => {
                  const DeviceIcon = deviceIcons[detectDeviceType(session.userAgent)];
                  return (
                    <TableRow key={session.id}>
                      <TableCell className="max-w-[280px] text-foreground/80">
                        <span className="flex items-center gap-2">
                          <DeviceIcon className="h-4 w-4 shrink-0 text-foreground/55" />
                          <span className="truncate">{session.userAgent ?? "Bilinmiyor"}</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-foreground/60">{session.ipAddress ?? "Bilinmiyor"}</TableCell>
                      <TableCell className="text-foreground/60">
                        {formatDistanceToNow(new Date(session.createdAt), { addSuffix: true, locale: tr })}
                      </TableCell>
                      <TableCell>{session.isCurrent && <Badge tone="primary">Bu cihaz</Badge>}</TableCell>
                      <TableCell>
                        {!session.isCurrent && (
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={revokingId === session.id}
                            onClick={() => setPendingRevoke(session)}
                          >
                            Sonlandır
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      </motion.div>

      <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
        <DialogContent className="max-w-md sm:max-w-md">
          <DialogHeader>
            <DialogTitle>İki Faktörlü Doğrulamayı Etkinleştir</DialogTitle>
            <DialogDescription>
              Kimlik doğrulama uygulamanızla (Google Authenticator, 1Password vb.) QR kodu tarayın.
            </DialogDescription>
          </DialogHeader>

          {setupData && (
            <div className="space-y-4">
              <div className="flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element -- data URI, next/image uygun değil */}
                <img src={setupData.qrCodeDataUrl} alt="QR kod" className="h-48 w-48 rounded-lg border border-border" />
              </div>

              {manualSecret && (
                <p className="break-all text-center text-xs text-foreground/60">
                  QR kodu tarayamıyorsanız manuel giriş kodu: <span className="font-mono">{manualSecret}</span>
                </p>
              )}

              {setupError && (
                <Alert variant="error">
                  <span className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {setupError}
                  </span>
                </Alert>
              )}

              <Field id="setupCode" label="Doğrulama Kodu" required>
                {(inputProps) => (
                  <Input
                    {...inputProps}
                    required
                    placeholder="123456"
                    value={setupCode}
                    onChange={(e) => setSetupCode(e.target.value)}
                  />
                )}
              </Field>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSetupOpen(false)}>
              Vazgeç
            </Button>
            <Button type="button" loading={enabling} onClick={handleEnable}>
              Doğrula ve Etkinleştir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={backupCodesOpen} onOpenChange={setBackupCodesOpen}>
        <DialogContent className="max-w-md sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Yedek Kodlarınız</DialogTitle>
            <DialogDescription>
              Kimlik doğrulama uygulamanıza erişemediğinizde bu kodlardan birini kullanabilirsiniz.
            </DialogDescription>
          </DialogHeader>
          {backupCodes && <BackupCodesList codes={backupCodes} />}
          <DialogFooter>
            <Button type="button" onClick={() => setBackupCodesOpen(false)}>
              Anladım, Kapat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>İki Faktörlü Doğrulamayı Devre Dışı Bırak</DialogTitle>
            <DialogDescription>
              Onaylamak için şifrenizi girin. Bu işlem mevcut oturumunuz hariç tüm oturumları sonlandırır.
            </DialogDescription>
          </DialogHeader>

          {disableError && (
            <Alert variant="error">
              <span className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {disableError}
              </span>
            </Alert>
          )}

          <Field id="disablePassword" label="Şifre" required>
            {(inputProps) => (
              <Input
                {...inputProps}
                type="password"
                required
                autoComplete="current-password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
              />
            )}
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDisableOpen(false)}>
              Vazgeç
            </Button>
            <Button type="button" variant="destructive" loading={disabling} onClick={handleDisable}>
              Devre Dışı Bırak
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={regenerateOpen} onOpenChange={setRegenerateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Yedek Kodları Yenile</DialogTitle>
            <DialogDescription>Eski yedek kodlarınız geçersiz kılınacak. Onaylamak için şifrenizi girin.</DialogDescription>
          </DialogHeader>

          {regenerateError && (
            <Alert variant="error">
              <span className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {regenerateError}
              </span>
            </Alert>
          )}

          <Field id="regeneratePassword" label="Şifre" required>
            {(inputProps) => (
              <Input
                {...inputProps}
                type="password"
                required
                autoComplete="current-password"
                value={regeneratePassword}
                onChange={(e) => setRegeneratePassword(e.target.value)}
              />
            )}
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRegenerateOpen(false)}>
              Vazgeç
            </Button>
            <Button type="button" loading={regenerating} onClick={handleRegenerate}>
              Yenile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevoke(null);
        }}
        title="Oturumu sonlandır"
        description="Bu oturumu sonlandırmak istediğinize emin misiniz? İlgili cihazdaki kullanıcı yeniden giriş yapmak zorunda kalacak."
        confirmText="Sonlandır"
        destructive
        loading={revokingId === pendingRevoke?.id}
        onConfirm={handleRevokeSession}
      />

      <ConfirmDialog
        open={revokeOthersOpen}
        onOpenChange={setRevokeOthersOpen}
        title="Diğer tüm oturumları sonlandır"
        description="Bu cihaz hariç tüm oturumlar sonlandırılacak. Devam etmek istiyor musunuz?"
        confirmText="Sonlandır"
        destructive
        loading={revokingOthers}
        onConfirm={handleRevokeOthers}
      />
    </div>
  );
}
