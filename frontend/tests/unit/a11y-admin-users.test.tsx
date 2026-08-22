import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import AdminUsersPage from "@/app/admin/users/page";
import { ApiClientError } from "@/lib/api/error";
import type { AdminUser, User } from "@/lib/api/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api/users-admin", () => ({
  listAdminUsers: vi.fn(),
  listAllAdminUsers: vi.fn(),
  createAdminUser: vi.fn(),
  updateUserRole: vi.fn(),
  updateUserStatus: vi.fn(),
  updateUserBuilderAccess: vi.fn(),
  deleteUser: vi.fn(),
  restoreUser: vi.fn(),
}));

let mockUser: User;
vi.mock("@/context/auth-context", () => ({
  useAuth: () => ({ user: mockUser }),
}));

const usersAdminApi = await import("@/lib/api/users-admin");
const { toast } = await import("sonner");

const axeOptions = { rules: { region: { enabled: false } } };

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "admin@example.com",
    name: "Admin Kullanıcı",
    avatarUrl: null,
    emailVerifiedAt: "2026-01-01T00:00:00.000Z",
    role: "ADMIN",
    canUseAdvancedBuilder: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    twoFactorEnabled: false,
    ...overrides,
  };
}

function makeAdminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: "user-1",
    email: "admin@example.com",
    name: "Admin Kullanıcı",
    avatarUrl: null,
    emailVerifiedAt: "2026-01-01T00:00:00.000Z",
    role: "ADMIN",
    canUseAdvancedBuilder: true,
    advancedBuilderEnabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "ACTIVE",
    lastLoginAt: "2026-08-01T10:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

const adminUsers: AdminUser[] = [
  makeAdminUser(),
  makeAdminUser({
    id: "user-2",
    email: "editor@example.com",
    name: "Editor Kullanıcı",
    role: "EDITOR",
    canUseAdvancedBuilder: true,
    advancedBuilderEnabled: true,
    createdAt: "2026-01-02T00:00:00.000Z",
    lastLoginAt: null,
  }),
  makeAdminUser({
    id: "user-3",
    email: "viewer@example.com",
    name: "Viewer Kullanıcı",
    role: "VIEWER",
    canUseAdvancedBuilder: false,
    advancedBuilderEnabled: false,
    emailVerifiedAt: null,
    createdAt: "2026-01-03T00:00:00.000Z",
    status: "SUSPENDED",
    lastLoginAt: "2026-07-15T09:30:00.000Z",
  }),
];

describe("AdminUsersPage — a11y", () => {
  it("ADMIN/EDITOR/VIEWER rollerini ve aktif/askıda durumları içeren kullanıcı listesi yüklendikten sonra kritik/ciddi a11y ihlali içermez", async () => {
    mockUser = makeUser();
    vi.mocked(usersAdminApi.listAdminUsers).mockResolvedValue({ items: adminUsers, meta: { nextCursor: null } });

    const { container } = render(<AdminUsersPage />);

    expect(await screen.findByText("Admin Kullanıcı")).toBeInTheDocument();
    expect(screen.getByText("Editor Kullanıcı")).toBeInTheDocument();
    expect(screen.getByText("Viewer Kullanıcı")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });

  it("kullanıcı seçilip toplu işlem çubuğu göründükten sonra da kritik/ciddi a11y ihlali içermez", async () => {
    mockUser = makeUser();
    vi.mocked(usersAdminApi.listAdminUsers).mockResolvedValue({ items: adminUsers, meta: { nextCursor: null } });

    const user = userEvent.setup();
    const { container } = render(<AdminUsersPage />);

    await screen.findByText("Admin Kullanıcı");
    await user.click(screen.getByRole("checkbox", { name: "Editor Kullanıcı kullanıcısını seç" }));

    expect(await screen.findByText("1 seçili")).toBeInTheDocument();

    const results = await axe(container, axeOptions);
    expect(results).toHaveNoViolations();
  });
});

describe("AdminUsersPage — kullanıcı silme / geri yükleme", () => {
  it("kendi hesabınız için Sil butonu devre dışıdır ve nedeni açıkça belirtilir", async () => {
    // Sistemin tek aktif admini VE giriş yapan kullanıcı aynı kişi (user-1) — hem
    // self-delete hem last-admin kuralı aynı anda geçerli, self mesajı öncelenmeli.
    mockUser = makeUser({ id: "user-1" });
    vi.mocked(usersAdminApi.listAdminUsers).mockResolvedValue({ items: adminUsers, meta: { nextCursor: null } });

    render(<AdminUsersPage />);
    await screen.findByText("Admin Kullanıcı");

    const deleteButton = screen.getByRole("button", { name: "Kendi hesabınızı silemezsiniz." });
    expect(deleteButton).toBeDisabled();
  });

  it("sistemdeki tek aktif admin başkasıysa Sil butonu 'en az bir yönetici kalmalı' mesajıyla devre dışı kalır", async () => {
    // Giriş yapan kullanıcı (user-2, editör) sistemin tek aktif admini DEĞİL — bu durumda
    // self-delete DEĞİL, last-admin kuralı devreye girmeli.
    mockUser = makeUser({ id: "user-2", role: "EDITOR" });
    vi.mocked(usersAdminApi.listAdminUsers).mockResolvedValue({ items: adminUsers, meta: { nextCursor: null } });

    render(<AdminUsersPage />);
    const adminRow = (await screen.findByText("Admin Kullanıcı")).closest("tr") as HTMLElement;

    // Hem askıya alma hem silme aksiyonu son aktif admin kuralına takılır — ikisi de aynı
    // uyarı metniyle devre dışı bırakılmış olmalı.
    const blockedButtons = within(adminRow).getAllByRole("button", { name: "Sistemde en az bir yönetici kalmalı." });
    expect(blockedButtons).toHaveLength(2);
    blockedButtons.forEach((button) => expect(button).toBeDisabled());
  });

  it("golden path: bir kullanıcıyı silme onayı verildiğinde deleteUser çağrılır ve satır varsayılan listeden kaybolur", async () => {
    mockUser = makeUser({ id: "user-1" });
    vi.mocked(usersAdminApi.listAdminUsers).mockResolvedValue({ items: adminUsers, meta: { nextCursor: null } });
    vi.mocked(usersAdminApi.deleteUser).mockResolvedValue({
      ...adminUsers[2],
      status: "DELETED",
      deletedAt: "2026-08-18T12:00:00.000Z",
    });

    const user = userEvent.setup();
    render(<AdminUsersPage />);
    const viewerRow = (await screen.findByText("Viewer Kullanıcı")).closest("tr") as HTMLElement;

    await user.click(within(viewerRow).getByRole("button", { name: "Sil" }));

    const dialog = await screen.findByRole("dialog", { name: "Kullanıcıyı sil" });
    expect(within(dialog).getByText(/kalıcı bir silme DEĞİLDİR/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Kullanıcıyı Sil" }));

    expect(usersAdminApi.deleteUser).toHaveBeenCalledWith("user-3");
    expect(screen.queryByText("Viewer Kullanıcı")).not.toBeInTheDocument();
  });

  it("409 hatası onay diyaloğu açıkken görünür şekilde gösterilir (dialog backdrop'ının arkasında kaybolmaz)", async () => {
    mockUser = makeUser({ id: "user-1" });
    vi.mocked(usersAdminApi.listAdminUsers).mockResolvedValue({ items: adminUsers, meta: { nextCursor: null } });
    vi.mocked(usersAdminApi.deleteUser).mockRejectedValue(
      new ApiClientError(409, { code: "CONFLICT", message: "Sistemde en az bir yönetici kalmalı." })
    );

    const user = userEvent.setup();
    render(<AdminUsersPage />);
    const viewerRow = (await screen.findByText("Viewer Kullanıcı")).closest("tr") as HTMLElement;

    await user.click(within(viewerRow).getByRole("button", { name: "Sil" }));
    const dialog = await screen.findByRole("dialog", { name: "Kullanıcıyı sil" });
    await user.click(within(dialog).getByRole("button", { name: "Kullanıcıyı Sil" }));

    // Hata `toast.error` ile gösterilir — sayfanın üst kısmındaki `<Alert>` banner'ının
    // aksine, sonner portalı dialog'un tam ekran backdrop'ının ÜZERİNDE render olur; bu
    // yüzden dialog AÇIKKEN de görünür kalır (bkz. bilinen sorun notu, rol/durum
    // değişikliğinde aynı hata `setError` ile banner'a yazılıyor ve backdrop arkasında
    // kayboluyordu).
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Sistemde en az bir yönetici kalmalı.");
    });
    // Diyalog başarısızlıkta kapanmamalı — kullanıcı tekrar deneyebilmeli.
    expect(screen.getByRole("dialog", { name: "Kullanıcıyı sil" })).toBeInTheDocument();
  });

  it("'Silinen kullanıcıları göster' açıldığında silinmiş kullanıcı listelenir ve Geri Yükle akışı çalışır", async () => {
    const deletedUser = makeAdminUser({
      id: "user-4",
      email: "silinmis@example.com",
      name: "Silinmiş Kullanıcı",
      role: "VIEWER",
      status: "DELETED",
      deletedAt: "2026-08-10T00:00:00.000Z",
    });

    mockUser = makeUser({ id: "user-1" });
    vi.mocked(usersAdminApi.listAdminUsers).mockImplementation(async (_cursor?: string, includeDeleted?: boolean) => ({
      items: includeDeleted ? [...adminUsers, deletedUser] : adminUsers,
      meta: { nextCursor: null },
    }));
    vi.mocked(usersAdminApi.restoreUser).mockResolvedValue({
      ...deletedUser,
      status: "ACTIVE",
      deletedAt: null,
    });

    const user = userEvent.setup();
    render(<AdminUsersPage />);
    await screen.findByText("Admin Kullanıcı");
    expect(screen.queryByText("Silinmiş Kullanıcı")).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Silinen kullanıcıları göster" }));
    await screen.findByText("Silinmiş Kullanıcı");

    await user.click(screen.getByRole("button", { name: "Geri Yükle" }));
    const dialog = await screen.findByRole("dialog", { name: "Kullanıcıyı geri yükle" });
    await user.click(within(dialog).getByRole("button", { name: "Geri Yükle" }));

    expect(usersAdminApi.restoreUser).toHaveBeenCalledWith("user-4");

    const restoredRow = (await screen.findByText("Silinmiş Kullanıcı")).closest("tr");
    expect(restoredRow).not.toBeNull();
    expect(within(restoredRow as HTMLElement).getByText("aktif")).toBeInTheDocument();
    expect(within(restoredRow as HTMLElement).queryByRole("button", { name: "Geri Yükle" })).not.toBeInTheDocument();
  });
});

describe("AdminUsersPage — toplu silme", () => {
  it("golden path: seçili kullanıcılar (admin koruması içermeyen) toplu silinir ve net bir başarı mesajı gösterilir", async () => {
    mockUser = makeUser({ id: "user-1" });
    vi.mocked(usersAdminApi.listAdminUsers).mockResolvedValue({ items: adminUsers, meta: { nextCursor: null } });
    vi.mocked(usersAdminApi.deleteUser).mockImplementation(async (userId: string) => {
      const target = adminUsers.find((u) => u.id === userId)!;
      return { ...target, status: "DELETED", deletedAt: "2026-08-18T12:00:00.000Z" };
    });

    const user = userEvent.setup();
    render(<AdminUsersPage />);
    await screen.findByText("Admin Kullanıcı");

    // Editor ve Viewer — ikisi de ne self ne de son aktif admin.
    await user.click(screen.getByRole("checkbox", { name: "Editor Kullanıcı kullanıcısını seç" }));
    await user.click(screen.getByRole("checkbox", { name: "Viewer Kullanıcı kullanıcısını seç" }));

    // Sayfada satır bazlı "Sil" butonları da bulunduğundan, toplu işlem çubuğuyla sınırlıyoruz
    // (bkz. "Rolü Uygula" ile aynı konteyner).
    const toolbar = screen.getByRole("button", { name: "Rolü Uygula" }).closest("div") as HTMLElement;
    await user.click(within(toolbar).getByRole("button", { name: "Sil" }));
    const dialog = await screen.findByRole("dialog", { name: "Kullanıcıları toplu sil" });
    expect(within(dialog).getByText(/2 kullanıcıyı silmek istediğinize emin misiniz/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/admin koruması/)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Kullanıcıları Sil" }));

    await waitFor(() => {
      expect(usersAdminApi.deleteUser).toHaveBeenCalledWith("user-2");
      expect(usersAdminApi.deleteUser).toHaveBeenCalledWith("user-3");
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("2 kullanıcı silindi.");
    });
  });

  it("sistemin tek aktif admini seçime dahil edilse bile toplu silmede otomatik hariç tutulur ve bu net bir mesajla bildirilir", async () => {
    // user-1: hem giriş yapan kullanıcı (self) hem de sistemin tek aktif admini —
    // API'ye HİÇ gönderilmemeli, sadece Editor için `deleteUser` çağrılmalı.
    mockUser = makeUser({ id: "user-1" });
    vi.mocked(usersAdminApi.listAdminUsers).mockResolvedValue({ items: adminUsers, meta: { nextCursor: null } });
    vi.mocked(usersAdminApi.deleteUser).mockResolvedValue({
      ...adminUsers[1],
      status: "DELETED",
      deletedAt: "2026-08-18T12:00:00.000Z",
    });

    const user = userEvent.setup();
    render(<AdminUsersPage />);
    await screen.findByText("Admin Kullanıcı");

    await user.click(screen.getByRole("checkbox", { name: "Admin Kullanıcı kullanıcısını seç" }));
    await user.click(screen.getByRole("checkbox", { name: "Editor Kullanıcı kullanıcısını seç" }));

    const toolbar = screen.getByRole("button", { name: "Rolü Uygula" }).closest("div") as HTMLElement;
    await user.click(within(toolbar).getByRole("button", { name: "Sil" }));
    const dialog = await screen.findByRole("dialog", { name: "Kullanıcıları toplu sil" });
    // Diyalog, silinecek gerçek sayıyı (1) ve hariç tutulan sayıyı (1) ÖNCEDEN gösterir.
    expect(within(dialog).getByText(/1 kullanıcıyı silmek istediğinize emin misiniz/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/1 kullanıcı admin koruması nedeniyle bu işlemin dışında tutulacak/)
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Kullanıcıları Sil" }));

    await waitFor(() => {
      expect(usersAdminApi.deleteUser).toHaveBeenCalledWith("user-2");
    });
    expect(usersAdminApi.deleteUser).not.toHaveBeenCalledWith("user-1");

    // Sonuç mesajı SESSİZCE iptal etmez — başarı + admin koruması nedeniyle hariç tutulanı
    // net biçimde ayırır.
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("1 kullanıcı silindi, 1 kullanıcı admin koruması nedeniyle silinemedi.");
    });

    // Seçim temizlenmiş olmalı (mevcut bulk desenlerdeki gibi).
    expect(screen.queryByText(/seçili/)).not.toBeInTheDocument();
  });
});

describe("AdminUsersPage — durum / rol değişikliği", () => {
  // Regresyon testi (qa-agent bulgusu): "Askıya Al" butonunun disabled mantığı önceden yalnızca
  // `isLastActiveAdmin`'e bakıyordu, `isSelf`'e BAKMIYORDU — bu yüzden 2+ aktif admin varken bir
  // admin kendi satırında "Askıya Al"a tıklayabiliyordu (backend 409 ile reddediyor ama bu, "Sil"
  // butonundaki `deleteDisabled = isSelf || isLastActiveAdmin` deseniyle TUTARSIZDI). Bu test, iki
  // aktif admin olduğunda ("son yönetici" kuralı TETİKLENMEDİĞİNDE) bile kendi satırındaki durum
  // butonunun `isSelf` nedeniyle devre dışı kaldığını doğrular.
  it("2+ aktif admin varken kendi hesabınız için durum butonu (Askıya Al) devre dışıdır", async () => {
    const secondAdmin = makeAdminUser({
      id: "user-5",
      email: "ikinci-admin@example.com",
      name: "İkinci Admin",
      createdAt: "2026-01-04T00:00:00.000Z",
    });
    mockUser = makeUser({ id: "user-1" });
    vi.mocked(usersAdminApi.listAdminUsers).mockResolvedValue({
      items: [...adminUsers, secondAdmin],
      meta: { nextCursor: null },
    });

    render(<AdminUsersPage />);
    const selfRow = (await screen.findByText("Admin Kullanıcı")).closest("tr") as HTMLElement;

    const statusButton = within(selfRow).getByRole("button", {
      name: "Kendi hesabınızın durumunu değiştiremezsiniz.",
    });
    expect(statusButton).toBeDisabled();

    // Diğer aktif admin kendi satırı DEĞİL — ve artık "son yönetici" de o değil (2 aktif admin
    // var) — bu yüzden onun durum butonu normal şekilde tıklanabilir kalmalı.
    const otherAdminRow = (await screen.findByText("İkinci Admin")).closest("tr") as HTMLElement;
    expect(within(otherAdminRow).getByRole("button", { name: "Askıya Al" })).toBeEnabled();
  });

  it("durum değişikliği 409 hatası onay diyaloğu açıkken toast ile gösterilir (banner'a değil)", async () => {
    mockUser = makeUser({ id: "user-1" });
    vi.mocked(usersAdminApi.listAdminUsers).mockResolvedValue({ items: adminUsers, meta: { nextCursor: null } });
    vi.mocked(usersAdminApi.updateUserStatus).mockRejectedValue(
      new ApiClientError(409, { code: "CONFLICT", message: "Sistemde en az bir yönetici kalmalı." })
    );

    const user = userEvent.setup();
    render(<AdminUsersPage />);
    const editorRow = (await screen.findByText("Editor Kullanıcı")).closest("tr") as HTMLElement;

    await user.click(within(editorRow).getByRole("button", { name: "Askıya Al" }));
    const dialog = await screen.findByRole("dialog", { name: "Kullanıcıyı askıya al" });
    await user.click(within(dialog).getByRole("button", { name: "Askıya Al" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Sistemde en az bir yönetici kalmalı.");
    });
    // Diyalog başarısızlıkta kapanmamalı — kullanıcı tekrar deneyebilmeli (delete akışıyla
    // tutarlı — bkz. yukarıdaki "409 hatası onay diyaloğu açıkken görünür şekilde gösterilir").
    expect(screen.getByRole("dialog", { name: "Kullanıcıyı askıya al" })).toBeInTheDocument();
  });

  it("rol değişikliği 409 hatası onay diyaloğu açıkken toast ile gösterilir (banner'a değil)", async () => {
    mockUser = makeUser({ id: "user-1" });
    vi.mocked(usersAdminApi.listAdminUsers).mockResolvedValue({ items: adminUsers, meta: { nextCursor: null } });
    vi.mocked(usersAdminApi.updateUserRole).mockRejectedValue(
      new ApiClientError(409, { code: "CONFLICT", message: "Sistemde en az bir yönetici kalmalı." })
    );

    const user = userEvent.setup();
    render(<AdminUsersPage />);
    const editorRow = (await screen.findByText("Editor Kullanıcı")).closest("tr") as HTMLElement;

    await user.selectOptions(within(editorRow).getByRole("combobox", { name: /rolü/ }), "VIEWER");
    const dialog = await screen.findByRole("dialog", { name: "Rolü değiştir" });
    await user.click(within(dialog).getByRole("button", { name: "Rolü Değiştir" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Sistemde en az bir yönetici kalmalı.");
    });
    expect(screen.getByRole("dialog", { name: "Rolü değiştir" })).toBeInTheDocument();
  });
});
