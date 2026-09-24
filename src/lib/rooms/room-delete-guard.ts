/**
 * Client-side guards for room delete (UI). DB FK ON DELETE RESTRICT remains authoritative.
 */

export const ROOM_IN_USE_DELETE_MESSAGE = "لا يمكن حذف القاعة لأنها مستخدمة في جلسات دراسية.";

export const ROOM_IN_USE_DEACTIVATE_HINT =
  "يُفضَّل تعطيل القاعة بدل حذفها إذا كانت مستخدمة أو قد تُستخدم لاحقًا.";

export function isRoomInUseDeleteError(message: string): boolean {
  const msg = message ?? "";
  return (
    msg.includes("ROOM_IN_USE") ||
    msg.includes("schedule_sessions_room_id_fkey") ||
    msg.includes("foreign key") ||
    msg.includes("violates foreign key constraint")
  );
}

export type RoomSessionUsage = {
  roomId: string;
  sessionCount: number;
};

export type BulkRoomDeletePlan = {
  allowedIds: string[];
  blocked: RoomSessionUsage[];
};

/** Never silently delete used rooms — callers must surface blocked counts. */
export function planBulkRoomDelete(usages: RoomSessionUsage[]): BulkRoomDeletePlan {
  const allowedIds: string[] = [];
  const blocked: RoomSessionUsage[] = [];
  for (const u of usages) {
    if (u.sessionCount > 0) blocked.push(u);
    else allowedIds.push(u.roomId);
  }
  return { allowedIds, blocked };
}

export function formatBulkRoomDeleteBlockedMessage(blocked: RoomSessionUsage[]): string {
  if (blocked.length === 0) return "";
  const totalSessions = blocked.reduce((n, b) => n + b.sessionCount, 0);
  return `${ROOM_IN_USE_DELETE_MESSAGE} عدد القاعات الممنوعة: ${blocked.length} (إجمالي الجلسات المرتبطة: ${totalSessions}). ${ROOM_IN_USE_DEACTIVATE_HINT}`;
}

export function roomDeleteBlockedToastMessage(): string {
  return `${ROOM_IN_USE_DELETE_MESSAGE} ${ROOM_IN_USE_DEACTIVATE_HINT}`;
}
