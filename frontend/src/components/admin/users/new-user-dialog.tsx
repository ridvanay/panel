"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, UserPlus } from "lucide-react";
import * as usersAdminApi from "@/lib/api/users-admin";
import type { AdminUser, CreateAdminUserResponse, SiteRole } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";

interface NewUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (user: AdminUser) => void;
}

interface CreatedUserResult {
  user: AdminUser;
  emailStatus: CreateAdminUserResponse["emailStatus"];
}

/**
 * "Yeni Kullanıcı Ekle" formu. Backend, kullanıcının e-posta adresine şifre belirleme
 * linkini otomatik olarak gönderir; ham link artık response'ta dönmez (güvenlik).
 * `emailStatus` alanına göre gönderim başarı/başarısız durumu kullanıcıya bildirilir.
 */
export function NewUserDialog({ open, onOpenChange, onCreated }: NewUserDialogProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<SiteRole>("EDITOR");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdResult, setCreatedResult] = useState<CreatedUserResult | null>(null);

  function resetForm() {
    setName("");
    setEmail("");
    setRole("EDITOR");
    setError(null);
    setCreatedResult(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm();
    onOpenChange(next);
  }

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await usersAdminApi.createAdminUser({ name, email, role });
      toast.success("Kullanıcı oluşturuldu.");
      onCreated(result.user);
      setCreatedResult({ user: result.user, emailStatus: result.emailStatus });
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UserPlus className="h-4 w-4" />
            </span>
            <div>
              <DialogTitle>Yeni Kullanıcı Ekle</DialogTitle>
              <DialogDescription className="mt-1">
                Ekibinize yeni bir üye ekleyin ve rolünü belirleyin.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {error && (
          <Alert variant="error">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </span>
          </Alert>
        )}

        {createdResult ? (
          <div className="space-y-3">
            {createdResult.emailStatus === "sent" ? (
              <Alert variant="success">
                Kullanıcı oluşturuldu, şifre belirleme bağlantısı{" "}
                <span className="font-medium">{createdResult.user.email}</span> adresine gönderildi.
              </Alert>
            ) : (
              <Alert variant="info">
                <span className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Kullanıcı oluşturuldu, ancak şifre belirleme e-postası gönderilemedi. Kullanıcı giriş
                    ekranındaki &ldquo;Şifremi Unuttum&rdquo; seçeneğiyle şifresini belirleyebilir.
                  </span>
                </span>
              </Alert>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <Field id="new-user-name" label="Ad Soyad" required>
              {(inputProps) => (
                <Input {...inputProps} required value={name} onChange={(e) => setName(e.target.value)} />
              )}
            </Field>
            <Field id="new-user-email" label="E-posta" required>
              {(inputProps) => (
                <Input
                  {...inputProps}
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
            <Field id="new-user-role" label="Rol">
              {(inputProps) => (
                <Select {...inputProps} value={role} onChange={(e) => setRole(e.target.value as SiteRole)}>
                  <option value="ADMIN">Süper Yönetici</option>
                  <option value="MANAGER">Yönetici</option>
                  <option value="EDITOR">Editör</option>
                  <option value="CUSTOMER">Müşteri</option>
                  <option value="USER">Standart Üye</option>
                </Select>
              )}
            </Field>
          </div>
        )}

        <DialogFooter>
          {createdResult ? (
            <Button type="button" onClick={() => handleOpenChange(false)}>
              Kapat
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Vazgeç
              </Button>
              <Button type="button" loading={submitting} disabled={!name || !email} onClick={handleSubmit}>
                Oluştur
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
