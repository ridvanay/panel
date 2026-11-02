"use client";

import { useMemo } from "react";
import { HostMeetingRoom, type HostRoomSource } from "@/components/site/meeting/host-meeting-room";
import type { Meeting, MeetingPhase } from "@/lib/api/meetings";
import {
  getCoordinatorConsultation,
  requestCoordinatorHostToken,
  type CoordinatorConsultation,
} from "@/lib/api/service-desk-admin";
import { isJoinWindowOpen } from "./service-desk-format";

/** Oda başlığı sabittir (hasta adı / hizmet adı odada gösterilmez). */
export const SERVICE_ROOM_TITLE = "WM Health online consultation";

export const COORDINATOR_LIST_HREF = "/admin/my-consultations";

/** Koordinatör görüşmesini AG `Meeting` biçimine çevirir (HostMeetingRoom bu biçimi bekler). */
export function consultationToMeeting(c: Pick<CoordinatorConsultation, "id" | "startsAt" | "endsAt" | "status">, nowMs: number): Meeting {
  const cancelled = c.status === "CANCELLED";
  let phase: MeetingPhase;
  if (cancelled) phase = "cancelled";
  else if (nowMs >= new Date(c.endsAt).getTime() || c.status === "COMPLETED" || c.status === "NO_SHOW") phase = "ended";
  else if (isJoinWindowOpen(c.startsAt, c.endsAt, nowMs)) phase = "open";
  else phase = "upcoming";
  const durationMin = Math.max(1, Math.round((new Date(c.endsAt).getTime() - new Date(c.startsAt).getTime()) / 60_000));
  return {
    id: c.id,
    title: SERVICE_ROOM_TITLE,
    note: null,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    durationMin,
    maxParticipants: 3,
    autoAdmitGuests: false,
    status: cancelled ? "CANCELLED" : "SCHEDULED",
    phase,
    hostJoinedAt: null,
    guestLinkActive: false,
    createdAt: c.startsAt,
  };
}

/**
 * `/admin/my-consultations/[id]/room` - AG `HostMeetingRoom`/`MeetingRoom` bileşenini koordinatör uçlarıyla kullanır
 * (`POST /coordinator/consultations/:id/host-token`). Kayıt yoktur; ayrılınca görüşme listesine dönülür.
 */
export function CoordinatorRoom({ consultationId }: { consultationId: string }) {
  const source = useMemo<HostRoomSource>(
    () => ({
      loadMeeting: async () => consultationToMeeting(await getCoordinatorConsultation(consultationId), Date.now()),
      requestToken: () => requestCoordinatorHostToken(consultationId),
      backHref: COORDINATOR_LIST_HREF,
      showParticipantsPanel: false,
    }),
    [consultationId]
  );
  return <HostMeetingRoom meetingId={consultationId} source={source} />;
}
