import { GuestJoinFlow } from "@/components/site/meeting/guest-join-flow";

/**
 * Paket AG İş 3 — misafir giriş sayfası. Belirteç URL parçasındadır (`/{lang}/meet/join#mg_…`); sunucu onu GÖRMEZ, bu yüzden
 * sayfa tamamen istemci bileşenidir (uçlar tarayıcıdan çağrılır). `noindex` + `no-referrer` `meet/layout.tsx`'tedir.
 */
export default function MeetJoinPage() {
  return <GuestJoinFlow />;
}
