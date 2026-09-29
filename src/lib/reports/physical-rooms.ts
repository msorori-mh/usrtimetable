/** Verified by the administrator on 2026-09-29. These are aliases of ONE hall,
 * not a name-based heuristic. Weekly allocation lives in room_availability.
 * Do not merge unrelated rooms just because their labels match. */
export const QARDAI_ROOM_IDS = [
  "0b097849-0658-4d29-a3a7-ee0aaa0e91f2",
  "35355e05-f45a-4f35-875e-3dec562574cd",
  "4e19eef6-6a23-55d5-bfde-1a4af775fbd0",
] as const;

export function physicalRoomKey(id: string) {
  return (QARDAI_ROOM_IDS as readonly string[]).includes(id) ? "shared:qardai" : id;
}

export function physicalRoomGroups<T extends { id: string }>(rooms: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const room of rooms) {
    const key = physicalRoomKey(room.id);
    groups.set(key, [...(groups.get(key) ?? []), room]);
  }
  return [...groups.values()];
}

/** Conflicting seat inventories are unknown, never added or arbitrarily selected. */
export function physicalSeatCount(rooms: { id: string; seats: number | null }[]) {
  const result = physicalSeatSummary(rooms);
  return result.unresolved === 0 ? result.known : null;
}

export function physicalSeatSummary(rooms: { id: string; seats: number | null }[]) {
  let known = 0,
    unresolved = 0;
  for (const group of physicalRoomGroups(rooms)) {
    const values = new Set(group.map((room) => room.seats));
    if (values.size !== 1 || group[0].seats === null) unresolved++;
    else known += group[0].seats;
  }
  return { known, unresolved };
}

export function physicalRoomSourcesComplete(id: string, readableRoomIds: string[]) {
  return (
    physicalRoomKey(id) !== "shared:qardai" ||
    QARDAI_ROOM_IDS.every((alias) => readableRoomIds.includes(alias))
  );
}
