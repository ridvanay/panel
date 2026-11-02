import { CoordinatorRoom } from "@/components/admin/service-desk/coordinator-room";

interface RoomPageProps {
  params: Promise<{ id: string }>;
}

/** Paket AI İş 3 - koordinatör görüşme odası (AG `HostMeetingRoom`; kayıt yok). Yetkiyi sunucu doğrular (başkasının görüşmesi 404). */
export default async function CoordinatorRoomPage({ params }: RoomPageProps) {
  const { id } = await params;
  return <CoordinatorRoom consultationId={id} />;
}
