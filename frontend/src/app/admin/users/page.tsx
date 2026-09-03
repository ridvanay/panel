"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  AlertCircle,
  Download,
  KeyRound,
  RotateCcw,
  Search,
  Trash2,
  UserCheck,
  UserX,
  Users as UsersIcon,
} from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PageHeading } from "@/components/admin/page-heading";
import { ListPagination } from "@/components/admin/list-pagination";
import { NewUserDialog } from "@/components/admin/users/new-user-dialog";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { exportToCsv, type CsvColumn } from "@/lib/export-csv";
import { useFilteredList } from "@/hooks/use-filtered-list";
import { useAuth } from "@/context/auth-context";

function matchesUser(user: AdminUser, query: string): boolean {
  return user.name.toLowerCase().includes(query) || user.email.toLowerCase().includes(query);
}

// `.claude/architect-scope-rbac-5-tier.md` §1.2 — dropdown/CSV/onay diyaloğu için ÇIPLAK rol
// adı (rozet için bkz. `lib/role-badge.ts::getRoleBadgeInfo`, ikon/ton taşıyan zenginleştirilmiş
// versiyon — BU sabitin yerine geçmez, onu tamamlar).
const roleLabels: Record<SiteRole, string> = {
  ADMIN: "Süper Yönetici",
  MANAGER: "Yönetici",
  EDITOR: "Editör",
  CUSTOMER: "Müşteri",
  USER: "Standart Üye",
};

const statusLabels: Record<SiteUserStatus, string> = {
  ACTIVE: "aktif",
  SUSPENDED: "askıda",
  DELETED: "silindi",
};

const statusBadgeTone: Record<SiteUserStatus, "success" | "danger" | "neutral"> = {
  ACTIVE: "success",
  SUSPENDED: "danger",
  DELETED: "neutral",
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

  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [pendingDeleteUser, setPendingDeleteUser] = useState<AdminUser | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [pendingRestoreUser, setPendingRestoreUser] = useState<AdminUser | null>(null);
  const [restoreLoading, setRestoreLoading] = useState(false);

  const [pendingResetPasswordUser, setPendingResetPasswordUser] = useState<AdminUser | null>(null);
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false);

  // Toplu işlemler için seçim durumu.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRole, setBulkRole] = useState<SiteRole>("ADMIN");
  const [bulkRoleConfirmOpen, setBulkRoleConfirmOpen] = useState(false);
  const [bulkRoleLoading, setBulkRoleLoading] = useState(false);
  const [bulkStatusAction, setBulkStatusAction] = useState<Exclude<SiteUserStatus, "DELETED"> | null>(null);
  const [bulkStatusLoading, setBulkStatusLoading] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);

  const [exporting, setExporting] = useState(false);

  const {
    search,
    setSearch,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages,
    filteredCount,
    items: visibleUsers,
  } = useFilteredList(users, matchesUser);

  const load = useCallback(async () => {
    try {
      const page = await usersAdminApi.listAdminUsers(undefined, includeDeleted);
      setUsers(page.items);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }, [includeDeleted]);

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
      // `toast.error` kullanılır: `setError` ile sayfa üstü `<Alert>` banner'ı, onay diyaloğu
      // AÇIKKEN dialog'un tam ekran backdrop'ının ARKASINDA kalıp görünmez oluyor (bkz. delete/
      // restore akışındaki aynı düzeltme ve durum değişikliği akışındaki karşılığı aşağıda).
      toast.error(friendlyErrorMessage(err));
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
      // `toast.error` kullanılır — bkz. `handleConfirmRoleChange` üstündeki not.
      toast.error(friendlyErrorMessage(err));
    } finally {
      setStatusUpdating(false);
    }
  }

  // Silme/geri yükleme 409'ları (kendi hesap / son yönetici / zaten geri alınmış) burada
  // `toast.error` ile gösterilir — sayfanın üst kısmındaki `<Alert>` banner'ı, onay diyaloğu
  // AÇIKKEN dialog'un tam ekran backdrop'ının ARKASINDA kalıp görünmez oluyordu (bkz. rol/durum
  // değişikliğindeki bilinen sorun); toast ise diyaloğun üzerinde render olur.
  async function handleConfirmDelete() {
    if (!pendingDeleteUser) return;
    const target = pendingDeleteUser;
    setDeleteLoading(true);
    try {
      const updated = await usersAdminApi.deleteUser(target.id);
      setUsers((prev) => {
        if (!prev) return prev;
        if (!includeDeleted) return prev.filter((u) => u.id !== updated.id);
        return prev.map((u) => (u.id === updated.id ? updated : u));
      });
      setSelectedIds((prev) => {
        if (!prev.has(updated.id)) return prev;
        const next = new Set(prev);
        next.delete(updated.id);
        return next;
      });
      toast.success(`"${target.name}" silindi. Gerekirse "Geri Yükle" ile hesabı yeniden etkinleştirebilirsiniz.`);
      setPendingDeleteUser(null);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handleConfirmRestore() {
    if (!pendingRestoreUser) return;
    const target = pendingRestoreUser;
    setRestoreLoading(true);
    try {
      const updated = await usersAdminApi.restoreUser(target.id);
      setUsers((prev) => (prev ? prev.map((u) => (u.id === updated.id ? updated : u)) : prev));
      toast.success(`"${target.name}" geri yüklendi.`);
      setPendingRestoreUser(null);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setRestoreLoading(false);
    }
  }

  // Backend hata FIRLATMAZ (200 döner) — başarı/başarısızlık `emailStatus` alanına bakılarak
  // ayırt edilir; bkz. `NewUserDialog`'daki AYNI desen (`createAdminUser` → `emailStatus`).
  // Gerçek hata durumları (404/409/429) `catch` bloğunda diğer aksiyonlarla AYNI şekilde
  // `toast.error` + `friendlyErrorMessage(err)` ile gösterilir.
  async function handleConfirmResetPassword() {
    if (!pendingResetPasswordUser) return;
    const target = pendingResetPasswordUser;
    setResetPasswordLoading(true);
    try {
      const result = await usersAdminApi.resetUserPassword(target.id);
      setUsers((prev) => (prev ? prev.map((u) => (u.id === result.user.id ? result.user : u)) : prev));
      if (result.emailStatus === "sent") {
        toast.success("Şifre sıfırlama e-postası gönderildi.");
      } else {
        toast.error("E-posta gönderilemedi, kullanıcıya bilgi verin.");
      }
      setPendingResetPasswordUser(null);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setResetPasswordLoading(false);
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
        format: (value: unknown) =>
          value === "ACTIVE" ? "Aktif" : value === "SUSPENDED" ? "Askıda" : "Silindi",
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

  // `users` state (liste ekranını besleyen) SADECE `listAdminUsers()`'ın tek sayfasını
  // taşır (bkz. `load()` yukarıda) — 100'den fazla kullanıcıda dışa aktarma sessizce
  // eksik veri üretmesin diye burada `listAllAdminUsers()` ile TÜM kayıtlar ayrıca
  // (cursor döngüsüyle) çekilir (bkz. `use-content-list.ts` satır ~87-106 ile aynı desen).
  async function handleExport() {
    setExporting(true);
    try {
      const allUsers = await usersAdminApi.listAllAdminUsers();
      if (allUsers.length === 0) return;
      exportToCsv("kullanicilar.csv", allUsers, csvColumns());
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setExporting(false);
    }
  }

  async function handleBulkExport() {
    if (selectedIds.size === 0) return;
    setExporting(true);
    try {
      const allUsers = await usersAdminApi.listAllAdminUsers();
      const selectedUsers = allUsers.filter((u) => selectedIds.has(u.id));
      if (selectedUsers.length === 0) return;
      exportToCsv("secili-kullanicilar.csv", selectedUsers, csvColumns());
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setExporting(false);
    }
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
    if (visibleUsers.length === 0) return;
    const visibleIds = visibleUsers.map((u) => u.id);
    const allVisibleSelected = visibleIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  const allSelected = visibleUsers.length > 0 && visibleUsers.every((u) => selectedIds.has(u.id));

  // Backend `assertNotLastActiveAdmin` ile serbest transaction içinde son aktif admin'i
  // koruyor; burada aynı kuralı istemci tarafında öngörerek kullanıcının önceden
  // reddedileceğini görmesini sağlıyoruz (backend kontrolünün yerine geçmez).
  const activeAdminCount = users?.filter((u) => u.role === "ADMIN" && u.status === "ACTIVE").length ?? 0;
  const LAST_ADMIN_MESSAGE = "Sistemde en az bir yönetici kalmalı.";
  const SELF_DELETE_MESSAGE = "Kendi hesabınızı silemezsiniz.";
  // Backend `PATCH /admin/users/{userId}/status` kendi hesabın durumunu değiştirmeyi
  // (askıya alma VEYA aktifleştirme, ikisi de) koşulsuz reddeder — bkz.
  // `backend/src/modules/users/admin-users.routes.ts` satır ~204.
  const SELF_STATUS_MESSAGE = "Kendi hesabınızın durumunu değiştiremezsiniz.";
  // Backend `POST /admin/users/{userId}/reset-password` `SUSPENDED` hedefi 409 ile reddeder
  // ("Askıya alınmış kullanıcı için şifre sıfırlama başlatılamaz.") — istemci tarafında
  // ÖNGÖRÜLÜR (diğer `isLastActiveAdmin`/`isSelf` desenleriyle tutarlı). Self-reset İZİNLİDİR
  // (architect kararı), bu yüzden burada `isSelf` kontrolü BİLEREK YOKTUR.
  const RESET_PASSWORD_SUSPENDED_MESSAGE = "Askıya alınmış kullanıcı için şifre sıfırlama gönderilemez.";

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

  // Backend zaten kendi hesabı / son aktif admin için 409 ile reddedecek — ama burada bu
  // kullanıcıları API'ye HİÇ göndermeden istemci tarafında (mevcut `isSelf`/`isLastActiveAdmin`
  // hesaplamasıyla, bkz. satır ~298 ve satır ~529-530'daki tekil silme akışındaki karşılığı)
  // önceden filtreliyoruz — gereksiz başarısız istek + kafa karıştırıcı hata yerine, sonuç
  // mesajında net bir "admin koruması" ayrımı gösteriyoruz.
  function getBulkDeleteEligibility(): { eligibleIds: string[]; excludedCount: number } {
    const selectedUsers = users?.filter((u) => selectedIds.has(u.id)) ?? [];
    const eligibleIds: string[] = [];
    let excludedCount = 0;
    for (const u of selectedUsers) {
      const isSelf = u.id === currentUser?.id;
      const isLastActiveAdmin = u.role === "ADMIN" && u.status === "ACTIVE" && activeAdminCount === 1;
      if (isSelf || isLastActiveAdmin) {
        excludedCount += 1;
      } else {
        eligibleIds.push(u.id);
      }
    }
    return { eligibleIds, excludedCount };
  }

  async function handleConfirmBulkDelete() {
    const { eligibleIds, excludedCount } = getBulkDeleteEligibility();
    setBulkDeleteLoading(true);
    let successCount = 0;
    let failCount = 0;

    for (const id of eligibleIds) {
      try {
        const updated = await usersAdminApi.deleteUser(id);
        setUsers((prev) => {
          if (!prev) return prev;
          if (!includeDeleted) return prev.filter((u) => u.id !== updated.id);
          return prev.map((u) => (u.id === updated.id ? updated : u));
        });
        successCount += 1;
      } catch {
        failCount += 1;
      }
    }

    setBulkDeleteLoading(false);
    setBulkDeleteConfirmOpen(false);
    setSelectedIds(new Set());
    await load();

    const parts: string[] = [];
    if (successCount > 0) {
      parts.push(successCount === 1 ? "1 kullanıcı silindi" : `${successCount} kullanıcı silindi`);
    }
    if (excludedCount > 0) {
      parts.push(
        excludedCount === 1
          ? "1 kullanıcı admin koruması nedeniyle silinemedi"
          : `${excludedCount} kullanıcı admin koruması nedeniyle silinemedi`
      );
    }
    if (failCount > 0) {
      parts.push(failCount === 1 ? "1 kullanıcı başarısız oldu" : `${failCount} kullanıcı başarısız oldu`);
    }

    if (parts.length > 0) {
      const message = `${parts.join(", ")}.`;
      if (successCount > 0) {
        toast.success(message);
      } else {
        toast.error(message);
      }
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
              onClick={() => void handleExport()}
              loading={exporting}
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
              className="w-36"
            >
              <option value="ADMIN">{roleLabels.ADMIN}</option>
              <option value="MANAGER">{roleLabels.MANAGER}</option>
              <option value="EDITOR">{roleLabels.EDITOR}</option>
              <option value="CUSTOMER">{roleLabels.CUSTOMER}</option>
              <option value="USER">{roleLabels.USER}</option>
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
            <Button variant="outline" size="sm" onClick={() => void handleBulkExport()} loading={exporting}>
              <Download className="h-4 w-4" />
              CSV Dışa Aktar
            </Button>
            <Button variant="outline" size="sm" onClick={() => setBulkDeleteConfirmOpen(true)}>
              <Trash2 className="h-4 w-4" />
              Sil
            </Button>
          </div>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelectedIds(new Set())}>
            Seçimi Temizle
          </Button>
        </Card>
      )}

      <div className="flex items-center gap-2">
        <Switch
          id="include-deleted-switch"
          checked={includeDeleted}
          onCheckedChange={(checked) => {
            setIncludeDeleted(checked);
            setSelectedIds(new Set());
          }}
          aria-label="Silinen kullanıcıları göster"
        />
        <label htmlFor="include-deleted-switch" className="cursor-pointer text-sm text-foreground/70">
          Silinen kullanıcıları göster
        </label>
      </div>

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
        <>
          <div className="flex flex-wrap items-center gap-3">
            <InputGroup className="w-full sm:max-w-xs">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="İsim veya e-posta ara..."
                aria-label="İsim veya e-posta ara"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </InputGroup>
            {totalPages > 1 && (
              <Select
                aria-label="Sayfa boyutu"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="w-auto"
              >
                <option value={10}>10 / sayfa</option>
                <option value={20}>20 / sayfa</option>
                <option value={50}>50 / sayfa</option>
              </Select>
            )}
          </div>

          {filteredCount === 0 ? (
            <EmptyState icon={Search} title="Sonuç bulunamadı" description="Arama kriterlerinize uyan bir kullanıcı yok." />
          ) : (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label="Tümünü seç"
                        checked={allSelected}
                        indeterminate={selectedIds.size > 0 && !allSelected}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead className="w-14">Profil</TableHead>
                    <TableHead className="w-auto">İsim</TableHead>
                    <TableHead className="w-56">E-posta</TableHead>
                    <TableHead className="w-36">Rol</TableHead>
                    <TableHead className="w-28">Durum</TableHead>
                    <TableHead className="w-40 text-right">İşlemler</TableHead>
                    <TableHead className="w-40 text-right">Son Giriş Tarihi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleUsers.map((user) => {
                    const isDeleted = user.status === "DELETED";
                    const isSelf = user.id === currentUser?.id;
                    // Backend `assertNotLastActiveAdmin` `DELETE /admin/users/{userId}`'de de
                    // `PATCH /status` ile AYNI kuralı uygular — burada da aynı ön-kontrolü
                    // silme aksiyonu için tekrar kullanıyoruz.
                    const isLastActiveAdmin =
                      user.role === "ADMIN" && user.status === "ACTIVE" && activeAdminCount === 1;
                    const statusActionLabel = user.status === "ACTIVE" ? "Askıya Al" : "Aktifleştir";
                    const statusDisabled = isSelf || isLastActiveAdmin;
                    // NOT: sıra bilinçli — `isLastActiveAdmin` burada `isSelf`'ten ÖNCE kontrol
                    // edilir (silme butonundaki `isSelf`-önce sırasının AKSİNE). Tek aktif admin
                    // + kendi hesabı çakıştığında (senaryo (a)) kullanıcı "son yönetici" kısıtını
                    // görmeli — bu, "2+ admin varken bile kendi durumunu değiştiremez" mesajından
                    // (SELF_STATUS_MESSAGE) daha genel/öncelikli bir uyarı (bkz.
                    // `tests/e2e/admin-user-management.spec.ts` senaryo (a)).
                    const tooltipLabel = isLastActiveAdmin
                      ? LAST_ADMIN_MESSAGE
                      : isSelf
                        ? SELF_STATUS_MESSAGE
                        : statusActionLabel;
                    const deleteDisabled = isSelf || isLastActiveAdmin;
                    const deleteTooltipLabel = isSelf
                      ? SELF_DELETE_MESSAGE
                      : isLastActiveAdmin
                        ? LAST_ADMIN_MESSAGE
                        : "Sil";
                    const isSuspended = user.status === "SUSPENDED";
                    const resetPasswordTooltipLabel = isSuspended
                      ? RESET_PASSWORD_SUSPENDED_MESSAGE
                      : "Şifre Sıfırlama Gönder";

                    return (
                      <TableRow key={user.id}>
                        <TableCell className="w-10">
                          <Checkbox
                            aria-label={`${user.name} kullanıcısını seç`}
                            checked={selectedIds.has(user.id)}
                            onCheckedChange={() => toggleSelect(user.id)}
                          />
                        </TableCell>
                        <TableCell className="w-14">
                          <Avatar name={user.name} src={user.avatarUrl} size={32} />
                        </TableCell>
                        <TableCell className="w-auto font-medium text-foreground">{user.name}</TableCell>
                        <TableCell className="w-56 text-foreground/60">{user.email}</TableCell>
                        <TableCell className="w-36">
                          <Select
                            aria-label={`${user.name} rolü`}
                            value={user.role}
                            onChange={(e) =>
                              setPendingRoleChange({ user, newRole: e.target.value as SiteRole })
                            }
                            disabled={isLastActiveAdmin || isDeleted}
                            title={isLastActiveAdmin ? LAST_ADMIN_MESSAGE : isDeleted ? "Silinmiş kullanıcı — önce geri yükleyin." : undefined}
                            className="w-36"
                          >
                            <option value="ADMIN">{roleLabels.ADMIN}</option>
                            <option value="MANAGER">{roleLabels.MANAGER}</option>
                            <option value="EDITOR">{roleLabels.EDITOR}</option>
                            <option value="CUSTOMER">{roleLabels.CUSTOMER}</option>
                            <option value="USER">{roleLabels.USER}</option>
                          </Select>
                        </TableCell>
                        <TableCell className="w-28">
                          <Badge tone={statusBadgeTone[user.status]}>{statusLabels[user.status]}</Badge>
                        </TableCell>
                        <TableCell className="w-40 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {isDeleted ? (
                              <Tooltip>
                                <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Geri Yükle"
                                    onClick={() => setPendingRestoreUser(user)}
                                  >
                                    <RotateCcw className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Geri Yükle</TooltipContent>
                              </Tooltip>
                            ) : (
                              <>
                                <Tooltip>
                                  <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      aria-label={tooltipLabel}
                                      disabled={statusDisabled}
                                      onClick={() => setPendingStatusChange(user)}
                                    >
                                      {user.status === "ACTIVE" ? (
                                        <UserX className="h-4 w-4" />
                                      ) : (
                                        <UserCheck className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{tooltipLabel}</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      aria-label={resetPasswordTooltipLabel}
                                      disabled={isSuspended}
                                      onClick={() => setPendingResetPasswordUser(user)}
                                    >
                                      <KeyRound className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{resetPasswordTooltipLabel}</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      aria-label={deleteTooltipLabel}
                                      disabled={deleteDisabled}
                                      onClick={() => setPendingDeleteUser(user)}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{deleteTooltipLabel}</TooltipContent>
                                </Tooltip>
                              </>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="w-40 text-right text-foreground/60">
                          {formatLastLogin(user.lastLoginAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </motion.div>
          )}

          {totalPages > 1 && <ListPagination page={page} totalPages={totalPages} onPageChange={setPage} />}
        </>
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

      <ConfirmDialog
        open={bulkDeleteConfirmOpen}
        onOpenChange={(open) => {
          if (!open) setBulkDeleteConfirmOpen(false);
        }}
        title="Kullanıcıları toplu sil"
        description={(() => {
          const { eligibleIds, excludedCount } = getBulkDeleteEligibility();
          const base = `${eligibleIds.length} kullanıcıyı silmek istediğinize emin misiniz? Bu, kalıcı bir silme DEĞİLDİR: hesaplar devre dışı bırakılır, kullanıcılar giriş yapamaz ve mevcut oturumları sonlandırılır. Dilediğiniz zaman "Geri Yükle" ile hesapları yeniden etkinleştirebilirsiniz.`;
          return excludedCount > 0
            ? `${base} (${excludedCount} kullanıcı admin koruması nedeniyle bu işlemin dışında tutulacak.)`
            : base;
        })()}
        confirmText="Kullanıcıları Sil"
        tone="danger"
        loading={bulkDeleteLoading}
        onConfirm={handleConfirmBulkDelete}
      />

      <ConfirmDialog
        open={pendingDeleteUser !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteUser(null);
        }}
        title="Kullanıcıyı sil"
        description={
          pendingDeleteUser
            ? `"${pendingDeleteUser.name}" kullanıcısını silmek istediğinize emin misiniz? Bu, kalıcı bir silme DEĞİLDİR: hesap devre dışı bırakılır, kullanıcı giriş yapamaz ve mevcut oturumları sonlandırılır. Dilediğiniz zaman "Geri Yükle" ile hesabı yeniden etkinleştirebilirsiniz.`
            : undefined
        }
        confirmText="Kullanıcıyı Sil"
        tone="danger"
        loading={deleteLoading}
        onConfirm={handleConfirmDelete}
      />

      <ConfirmDialog
        open={pendingRestoreUser !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRestoreUser(null);
        }}
        title="Kullanıcıyı geri yükle"
        description={
          pendingRestoreUser
            ? `"${pendingRestoreUser.name}" kullanıcısını geri yüklemek istediğinize emin misiniz? Hesap yeniden aktif duruma geçer ve kullanıcı tekrar giriş yapabilir (önceki oturumları geri gelmez).`
            : undefined
        }
        confirmText="Geri Yükle"
        loading={restoreLoading}
        onConfirm={handleConfirmRestore}
      />

      <ConfirmDialog
        open={pendingResetPasswordUser !== null}
        onOpenChange={(open) => {
          if (!open) setPendingResetPasswordUser(null);
        }}
        title="Şifre sıfırlama gönder"
        description={
          pendingResetPasswordUser
            ? `"${pendingResetPasswordUser.name}" kullanıcısına şifre sıfırlama e-postası göndermek istediğinize emin misiniz?`
            : undefined
        }
        confirmText="Gönder"
        loading={resetPasswordLoading}
        onConfirm={handleConfirmResetPassword}
      />
    </div>
  );
}
