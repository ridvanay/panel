import { HostMeetingRoom } from "@/components/site/meeting/host-meeting-room";

interface MeetPageProps {
  params: Promise<{ lang: string; id: string }>;
}

/** Paket AG İş 3 — ev sahibi odası (oturum gerekli; ev sahibi olmayan herkes — ADMIN dahil — "bulunamadı" görür). */
export default async function MeetHostPage({ params }: MeetPageProps) {
  const { id } = await params;
  return <HostMeetingRoom meetingId={id} />;
}
