import { DisconnectReason } from "livekit-client";
import type { DisconnectKind } from "./use-app-reconnect";

/** `LiveKitRoom.onDisconnected(reason)` nedenini yeniden bağlanma makinesinin kümelerine eşler (reason `undefined` olabilir). */
export function disconnectKind(reason: DisconnectReason | undefined): DisconnectKind {
  if (reason === undefined) return "other";
  if (reason === DisconnectReason.CLIENT_INITIATED) return "client";
  if (reason === DisconnectReason.DUPLICATE_IDENTITY) return "duplicate";
  return "other";
}
