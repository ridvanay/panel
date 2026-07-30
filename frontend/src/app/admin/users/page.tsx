"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { AlertCircle, Download, Users as UsersIcon } from "lucide-react";
import * as usersAdminApi from "@/lib/api/users-admin";
import type { AdminUser, SiteRole } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Avatar } from "@/components/ui/avatar";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeading } from "@/components/admin/page-heading";
import { NewUserDialog } from "@/components/admin/users/new-user-dialog";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { exportToCsv } from "@/lib/export-csv";

const roleLabels: Record<SiteRole, string> = {
  ADMIN: "Admin",
  EDITOR: "Editor",
  VIEWER: "Viewer",
};

interface PendingRoleChange {
  user: AdminUser;
  newRole: SiteRole;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newUserDialogOpen, setNewUserDialogOpen] = useState(false);

  const [pendingRoleChange, setPendingRoleChange] = useState<PendingRoleChange | null>(null);
  const [roleUpdating, setRoleUpdating] = useState(false);

  const [pendingStatusChange, setPendingStatusChange] = useState<AdminUser | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);

  const load = useCallback(async () => {
    try {
      const page = await usersAdminApi.listAdminUsers();
      setUsers(page.items);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  function handleUserCreated(user: AdminUser) {
    setUsers((prev) => (prev ? [user, ...prev] : [user]));
  }

  async function handleConfirmRoleChange() {
    if (!pendingRoleChange) return;
    const { user, newRole } = pendingRoleChange;
    setRoleUpdating(true);
    try {
      const updated = await usersAdminApi.updateUserRole(user.id, newRole);
      setUsers((prev) => (prev ? prev.map((u) => (u.id === updated.id ? updated : u)) : prev));
      toast.success("Rol güncellendi.");
      setPendingRoleChange(null);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setRoleUpdating(false);
    }
  }

  async function handleConfirmStatusChange() {
    if (!pendingStatusChange) return;
    const nextStatus = pendingStatusChange.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    setStatusUpdating(true);
    try {
      const updated = await usersAdminApi.updateUserStatus(pendingStatusChange.id, nextStatus);
      setUsers((prev) => (prev ? prev.map((u) => (u.id === updated.id ? updated : u)) : prev));
      toast.success(nextStatus === "SUSPENDED" ? "Kullanıcı askıya alındı." : "Kullanıcı aktifleştirildi.");
      setPendingStatusChange(null);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setStatusUpdating(false);
    }
  }

  function formatLastLogin(lastLoginAt: string | null): string {
    if (!lastLoginAt) return "Hiç giriş yapmadı";
    return new Date(lastLoginAt).toLocaleString("tr-TR");
  }

  function handleExport() {
    if (!users || users.length === 0) return;
    exportToCsv("kullanicilar.csv", users, [
      { key: "name", label: "İsim" },
      { key: "email", label: "E-posta" },
      { key: "role", label: "Rol", format: (value) => roleLabels[value as SiteRole] },
      {
        key: "status",
        label: "Durum",
        format: (value) => (value === "ACTIVE" ? "Aktif" : "Askıda"),
      },
      {
        key: "lastLoginAt",
        label: "Son Giriş",
        format: (value) => formatLastLogin(value as string | null),
      },
      {
        key: "createdAt",
        label: "Kayıt Tarihi",
        format: (value) => new Date(value as string).toLocaleDateString("tr-TR"),
      },
    ]);
  }

  return (
    <div className="space-y-6">
      <PageHeading
        icon={UsersIcon}
        title="Kullanıcılar"
        description="Ekip üyelerini ve rollerini yönetin."
        actions={
          <>
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={users === null || users.length === 0}
            >
              <Download className="h-4 w-4" />
              Dışa Aktar
            </Button>
            <Button onClick={() => setNewUserDialogOpen(true)}>Yeni Kullanıcı Ekle</Button>
          </>
        }
      />

      {error && (
        <Alert variant="error">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </span>
        </Alert>
      )}

      {users === null ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-6 w-6 text-primary" />
        </div>
      ) : users.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="Henüz kullanıcı yok"
          description="İlk ekip üyenizi ekleyerek başlayın."
          action={<Button onClick={() => setNewUserDialogOpen(true)}>Yeni Kullanıcı Ekle</Button>}
        />
      ) : (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Profil</TableHead>
                <TableHead>İsim</TableHead>
                <TableHead>E-posta</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>Son Giriş Tarihi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <Avatar name={user.name} src={user.avatarUrl} size={32} />
                  </TableCell>
                  <TableCell className="font-medium text-foreground">{user.name}</TableCell>
                  <TableCell className="text-foreground/60">{user.email}</TableCell>
                  <TableCell>
                    <Select
                      aria-label={`${user.name} rolü`}
                      value={user.role}
                      onChange={(e) =>
                        setPendingRoleChange({ user, newRole: e.target.value as SiteRole })
                      }
                      className="w-32"
                    >
                      <option value="ADMIN">Admin</option>
                      <option value="EDITOR">Editor</option>
                      <option value="VIEWER">Viewer</option>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge tone={user.status === "ACTIVE" ? "success" : "danger"}>
                        {user.status === "ACTIVE" ? "Aktif" : "Askıda"}
                      </Badge>
                      <Button variant="ghost" size="sm" onClick={() => setPendingStatusChange(user)}>
                        {user.status === "ACTIVE" ? "Askıya Al" : "Aktifleştir"}
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="text-foreground/60">{formatLastLogin(user.lastLoginAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </motion.div>
      )}

      <NewUserDialog
        open={newUserDialogOpen}
        onOpenChange={setNewUserDialogOpen}
        onCreated={handleUserCreated}
      />

      <ConfirmDialog
        open={pendingRoleChange !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRoleChange(null);
        }}
        title="Rolü değiştir"
        description={
          pendingRoleChange
            ? `"${pendingRoleChange.user.name}" kullanıcısının rolünü ${roleLabels[pendingRoleChange.newRole]} yapmak istediğinize emin misiniz?`
            : undefined
        }
        confirmText="Rolü Değiştir"
        loading={roleUpdating}
        onConfirm={handleConfirmRoleChange}
      />

      <ConfirmDialog
        open={pendingStatusChange !== null}
        onOpenChange={(open) => {
          if (!open) setPendingStatusChange(null);
        }}
        title={pendingStatusChange?.status === "ACTIVE" ? "Kullanıcıyı askıya al" : "Kullanıcıyı aktifleştir"}
        description={
          pendingStatusChange
            ? pendingStatusChange.status === "ACTIVE"
              ? `"${pendingStatusChange.name}" kullanıcısını askıya almak istediğinize emin misiniz? Askıya alınan kullanıcı sisteme giriş yapamaz.`
              : `"${pendingStatusChange.name}" kullanıcısını yeniden aktifleştirmek istediğinize emin misiniz?`
            : undefined
        }
        confirmText={pendingStatusChange?.status === "ACTIVE" ? "Askıya Al" : "Aktifleştir"}
        destructive={pendingStatusChange?.status === "ACTIVE"}
        loading={statusUpdating}
        onConfirm={handleConfirmStatusChange}
      />
    </div>
  );
}
