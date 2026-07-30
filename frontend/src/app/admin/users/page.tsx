"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { AlertCircle, Download, Users as UsersIcon } from "lucide-react";
import * as usersAdminApi from "@/lib/api/users-admin";
import type { AdminUser, SiteRole, SiteUserStatus } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Avatar } from "@/components/ui/avatar";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeading } from "@/components/admin/page-heading";
import { NewUserDialog } from "@/components/admin/users/new-user-dialog";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { exportToCsv, type CsvColumn } from "@/lib/export-csv";
import { useAuth } from "@/context/auth-context";

const roleLabels: Record<SiteRole, string> = {
  ADMIN: "Admin",
  EDITOR: "Editor",
  VIEWER: "Viewer",
};

const statusLabels: Record<SiteUserStatus, string> = {
  ACTIVE: "aktif",
  SUSPENDED: "askıda",
};

interface PendingRoleChange {
  user: AdminUser;
  newRole: SiteRole;
}

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newUserDialogOpen, setNewUserDialogOpen] = useState(false);

  const [pendingRoleChange, setPendingRoleChange] = useState<PendingRoleChange | null>(null);
  const [roleUpdating, setRoleUpdating] = useState(false);

  const [pendingStatusChange, setPendingStatusChange] = useState<AdminUser | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);

  // Toplu işlemler için seçim durumu.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRole, setBulkRole] = useState<SiteRole>("ADMIN");
  const [bulkRoleConfirmOpen, setBulkRoleConfirmOpen] = useState(false);
  const [bulkRoleLoading, setBulkRoleLoading] = useState(false);
  const [bulkStatusAction, setBulkStatusAction] = useState<SiteUserStatus | null>(null);
  const [bulkStatusLoading, setBulkStatusLoading] = useState(false);

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

  function csvColumns(): CsvColumn<AdminUser>[] {
    return [
      { key: "name" as const, label: "İsim" },
      { key: "email" as const, label: "E-posta" },
      { key: "role" as const, label: "Rol", format: (value: unknown) => roleLabels[value as SiteRole] },
      {
        key: "status" as const,
        label: "Durum",
        format: (value: unknown) => (value === "ACTIVE" ? "Aktif" : "Askıda"),
      },
      {
        key: "lastLoginAt" as const,
        label: "Son Giriş",
        format: (value: unknown) => formatLastLogin(value as string | null),
      },
      {
        key: "createdAt" as const,
        label: "Kayıt Tarihi",
        format: (value: unknown) => new Date(value as string).toLocaleDateString("tr-TR"),
      },
    ];
  }

  function handleExport() {
    if (!users || users.length === 0) return;
    exportToCsv("kullanicilar.csv", users, csvColumns());
  }

  function handleBulkExport() {
    if (!users) return;
    const selectedUsers = users.filter((u) => selectedIds.has(u.id));
    if (selectedUsers.length === 0) return;
    exportToCsv("secili-kullanicilar.csv", selectedUsers, csvColumns());
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!users) return;
    setSelectedIds((prev) => (prev.size === users.length ? new Set() : new Set(users.map((u) => u.id))));
  }

  const allSelected = users !== null && users.length > 0 && selectedIds.size === users.length;

  async function handleConfirmBulkRoleChange() {
    const ids = Array.from(selectedIds);
    setBulkRoleLoading(true);
    let successCount = 0;
    let failCount = 0;

    for (const id of ids) {
      try {
        const updated = await usersAdminApi.updateUserRole(id, bulkRole);
        setUsers((prev) => (prev ? prev.map((u) => (u.id === updated.id ? updated : u)) : prev));
        successCount += 1;
      } catch {
        failCount += 1;
      }
    }

    setBulkRoleLoading(false);
    setBulkRoleConfirmOpen(false);
    setSelectedIds(new Set());
    await load();

    if (successCount > 0 && failCount === 0) {
      toast.success(
        successCount === 1 ? "1 kullanıcının rolü güncellendi." : `${successCount} kullanıcının rolü güncellendi.`
      );
    } else if (successCount > 0 && failCount > 0) {
      toast.success(`${successCount} kullanıcı güncellendi, ${failCount} kullanıcı başarısız oldu.`);
    } else if (failCount > 0) {
      toast.error(failCount === 1 ? "Rol güncellenemedi." : `${failCount} kullanıcı için rol güncellenemedi.`);
    }
  }

  async function handleConfirmBulkStatusChange() {
    if (!bulkStatusAction) return;
    const targetStatus = bulkStatusAction;
    const ids = Array.from(selectedIds);
    setBulkStatusLoading(true);
    let successCount = 0;
    let failCount = 0;
    let selfFailed = false;

    for (const id of ids) {
      try {
        const updated = await usersAdminApi.updateUserStatus(id, targetStatus);
        setUsers((prev) => (prev ? prev.map((u) => (u.id === updated.id ? updated : u)) : prev));
        successCount += 1;
      } catch {
        failCount += 1;
        if (id === currentUser?.id) selfFailed = true;
      }
    }

    setBulkStatusLoading(false);
    setBulkStatusAction(null);
    setSelectedIds(new Set());
    await load();

    const actionLabel = targetStatus === "SUSPENDED" ? "askıya alındı" : "aktifleştirildi";
    if (successCount > 0 && failCount === 0) {
      toast.success(successCount === 1 ? `1 kullanıcı ${actionLabel}.` : `${successCount} kullanıcı ${actionLabel}.`);
    } else if (successCount > 0 && failCount > 0) {
      toast.success(
        `${successCount} kullanıcı ${actionLabel}, ${failCount} kullanıcı başarısız oldu${
          selfFailed ? " (kendi hesabınız dahil)" : ""
        }.`
      );
    } else if (failCount > 0) {
      toast.error(
        `İşlem başarısız oldu${selfFailed ? " (kendi hesabınızı askıya alamazsınız)" : ""}.`
      );
    }
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

      {selectedIds.size > 0 && (
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <span className="text-sm font-medium text-foreground">{selectedIds.size} seçili</span>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Toplu rol seç"
              value={bulkRole}
              onChange={(e) => setBulkRole(e.target.value as SiteRole)}
              className="w-32"
            >
              <option value="ADMIN">Admin</option>
              <option value="EDITOR">Editor</option>
              <option value="VIEWER">Viewer</option>
            </Select>
            <Button variant="outline" size="sm" onClick={() => setBulkRoleConfirmOpen(true)}>
              Rolü Uygula
            </Button>
            <Button variant="outline" size="sm" onClick={() => setBulkStatusAction("SUSPENDED")}>
              Askıya Al
            </Button>
            <Button variant="outline" size="sm" onClick={() => setBulkStatusAction("ACTIVE")}>
              Aktifleştir
            </Button>
            <Button variant="outline" size="sm" onClick={handleBulkExport}>
              <Download className="h-4 w-4" />
              CSV Dışa Aktar
            </Button>
          </div>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelectedIds(new Set())}>
            Seçimi Temizle
          </Button>
        </Card>
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
                <TableHead>
                  <Checkbox
                    aria-label="Tümünü seç"
                    checked={allSelected}
                    indeterminate={selectedIds.size > 0 && !allSelected}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
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
                    <Checkbox
                      aria-label={`${user.name} kullanıcısını seç`}
                      checked={selectedIds.has(user.id)}
                      onCheckedChange={() => toggleSelect(user.id)}
                    />
                  </TableCell>
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

      <ConfirmDialog
        open={bulkRoleConfirmOpen}
        onOpenChange={(open) => {
          if (!open) setBulkRoleConfirmOpen(false);
        }}
        title="Rolü toplu değiştir"
        description={`${selectedIds.size} kullanıcının rolünü ${roleLabels[bulkRole]} yapmak istediğinize emin misiniz?`}
        confirmText="Rolü Değiştir"
        loading={bulkRoleLoading}
        onConfirm={handleConfirmBulkRoleChange}
      />

      <ConfirmDialog
        open={bulkStatusAction !== null}
        onOpenChange={(open) => {
          if (!open) setBulkStatusAction(null);
        }}
        title={bulkStatusAction === "SUSPENDED" ? "Kullanıcıları askıya al" : "Kullanıcıları aktifleştir"}
        description={
          bulkStatusAction
            ? `${selectedIds.size} kullanıcının durumunu ${statusLabels[bulkStatusAction]} yapmak istediğinize emin misiniz?`
            : undefined
        }
        confirmText={bulkStatusAction === "SUSPENDED" ? "Askıya Al" : "Aktifleştir"}
        destructive={bulkStatusAction === "SUSPENDED"}
        loading={bulkStatusLoading}
        onConfirm={handleConfirmBulkStatusChange}
      />
    </div>
  );
}
