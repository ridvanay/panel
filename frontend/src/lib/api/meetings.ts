import { apiFetch, apiFetchWithMeta } from "./client";
import type { MeetingTokenResponse } from "./types";

/**
 * Paket AG İş 3 — harici görüntülü toplantı uçları (tasarım: docs/prompts/2026-11-02-AG-IS3-TASARIM.md §4).
 * Randevudan bağımsızdır; `/meetings/*` (oturumlu ev sahibi) ve `/meet/guest/*` (oturumsuz misafir) aileleri.
 */

export type MeetingPhase = "upcoming" | "open" | "ended" | "cancelled";

/** `Meeting` DTO — belirteç veya özet ASLA içermez. `host`/`hostName` yalnızca `GET /admin/meetings` gözetim listesinde gelebilir. */
export interface Meeting {
  id: string;
  title: string;
  /** Yalnızca ev sahibine görünür; misafire ve e-postaya gitmez. */
  note: string | null;
  startsAt: string;
  endsAt: string;
  durationMin: number;
  /** Ev sahibi dahil toplam katılımcı (2–8). */
  maxParticipants: number;
  autoAdmitGuests: boolean;
  status: "SCHEDULED" | "CANCELLED";
  phase: MeetingPhase;
  hostJoinedAt: string | null;
  guestLinkActive: boolean;
  createdAt: string;
  /** Yönetici gözetim listesi: ev sahibi görünen adı (varsa). */
  hostName?: string | null;
  host?: { id?: string; name?: string | null } | null;
}

export interface MeetingList {
  items: Meeting[];
  nextCursor: string | null;
}

export interface CreateMeetingInput {
  title: string;
  startsAt: string;
  durationMin: number;
  maxParticipants?: number;
  note?: string;
  autoAdmitGuests?: boolean;
}

export type UpdateMeetingInput = Partial<CreateMeetingInput>;

export interface CreateMeetingResponse {
  meeting: Meeting;
  /** Düz misafir bağlantısı — YALNIZCA bu yanıtta (ve yeniden üretmede) döner. */
  guestLink: string;
}

export interface MeetingGuestRow {
  id: string;
  displayName: string;
  createdAt: string;
  admittedAt: string | null;
  removedAt: string | null;
  waiting: boolean;
}

export type HostTokenResponse = MeetingTokenResponse;

/** Cursor yanıtı her iki şekilde de gelebilir: `data: Meeting[] + meta.nextCursor` (proje standardı) ya da `data: { items, nextCursor }` (tasarım §4.2). */
function normalizeList(data: unknown, metaCursor: string | null): MeetingList {
  if (Array.isArray(data)) return { items: data as Meeting[], nextCursor: metaCursor };
  const obj = (data ?? {}) as { items?: Meeting[]; nextCursor?: string | null };
  return { items: obj.items ?? [], nextCursor: obj.nextCursor ?? metaCursor };
}

export async function listMeetings(scope: "upcoming" | "past", cursor?: string): Promise<MeetingList> {
  const { data, meta } = await apiFetchWithMeta<unknown>("/meetings", { query: { scope, cursor } });
  return normalizeList(data, meta?.nextCursor ?? null);
}

/** `GET /admin/meetings` — yalnızca ADMIN; tüm toplantılar (misafir adları hariç). */
export async function listAdminMeetings(scope: "upcoming" | "past", cursor?: string): Promise<MeetingList> {
  const { data, meta } = await apiFetchWithMeta<unknown>("/admin/meetings", { query: { scope, cursor } });
  return normalizeList(data, meta?.nextCursor ?? null);
}

export function createMeeting(input: CreateMeetingInput): Promise<CreateMeetingResponse> {
  return apiFetch<CreateMeetingResponse>("/meetings", { method: "POST", body: input });
}

export function getMeeting(id: string): Promise<Meeting> {
  return apiFetch<Meeting>(`/meetings/${encodeURIComponent(id)}`);
}

export function updateMeeting(id: string, input: UpdateMeetingInput): Promise<Meeting> {
  return apiFetch<Meeting>(`/meetings/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
}

/** Yeni belirteç üretir; ESKİ bağlantıyı anında geçersiz kılar. */
export function regenerateGuestLink(id: string): Promise<{ guestLink: string }> {
  return apiFetch<{ guestLink: string }>(`/meetings/${encodeURIComponent(id)}/guest-link`, { method: "POST" });
}

export function revokeGuestLink(id: string): Promise<void> {
  return apiFetch<void>(`/meetings/${encodeURIComponent(id)}/guest-link`, { method: "DELETE" });
}

export function cancelMeeting(id: string): Promise<Meeting> {
  return apiFetch<Meeting>(`/meetings/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}

/** `POST /admin/meetings/:id/cancel` — ADMIN gözetimi (katılım hakkı yoktur). */
export function adminCancelMeeting(id: string): Promise<Meeting> {
  return apiFetch<Meeting>(`/admin/meetings/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}

export function requestHostToken(id: string): Promise<HostTokenResponse> {
  return apiFetch<HostTokenResponse>(`/meetings/${encodeURIComponent(id)}/host-token`, { method: "POST" });
}

export function listMeetingGuests(id: string): Promise<MeetingGuestRow[]> {
  return apiFetch<MeetingGuestRow[]>(`/meetings/${encodeURIComponent(id)}/guests`);
}

export function removeMeetingGuest(id: string, guestId: string): Promise<void> {
  return apiFetch<void>(`/meetings/${encodeURIComponent(id)}/guests/${encodeURIComponent(guestId)}/remove`, { method: "POST" });
}

/** Davet e-postası — bağlantı yalnızca oluşturma/yeniden üretme anında bellekte olduğu için istemci gönderir (S5). */
export function sendMeetingInviteEmail(id: string, input: { link: string; to: string }): Promise<void> {
  return apiFetch<void>(`/meetings/${encodeURIComponent(id)}/invite-email`, { method: "POST", body: input });
}

/** `PATCH /admin/users/:userId/meeting-host` (yalnızca ADMIN). */
export function setMeetingHostAccess(userId: string, enabled: boolean): Promise<{ canHostMeetings: boolean }> {
  return apiFetch<{ canHostMeetings: boolean }>(`/admin/users/${encodeURIComponent(userId)}/meeting-host`, {
    method: "PATCH",
    body: { enabled },
  });
}

// ---- Misafir uçları (oturumsuz; YALNIZCA tarayıcıdan çağrılır, SSR'den değil) ----

export interface GuestPreflight {
  title: string;
  hostName: string;
  startsAt: string;
  endsAt: string;
  phase: "upcoming" | "open";
}

export type GuestJoinResponse =
  | { status: "waiting"; guestSession: string; pollAfterSec?: number }
  | ({ status: "ready"; guestSession: string } & HostTokenResponse);

/** Belirteç yalnızca POST gövdesinde gider (URL parçasından okunur; query/path'e ASLA yazılmaz). */
export function guestPreflight(t: string): Promise<GuestPreflight> {
  return apiFetch<GuestPreflight>("/meet/guest/preflight", { method: "POST", body: { t }, skipAuthRetry: true });
}

export function guestJoin(input: { t: string; name?: string; guestSession?: string }): Promise<GuestJoinResponse> {
  return apiFetch<GuestJoinResponse>("/meet/guest/join", { method: "POST", body: input, skipAuthRetry: true });
}
