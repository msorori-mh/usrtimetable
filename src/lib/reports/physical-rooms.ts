/** Room rows that are aliases of ONE physical hall (verified by the administrator).
 * Aliasing is data — rooms.physical_group_key — never a name-based heuristic and no
 * production id lives in the bundle (M-11). Weekly allocation lives in room_availability.
 * Do not merge unrelated rooms just because their labels match.
 * Pure module: the registry is filled by ./physical-rooms-loader.ts (or explicitly). */

let keyByRoom: ReadonlyMap<string, string> = new Map();
let sizeByKey: ReadonlyMap<string, number> = new Map();

export function setPhysicalRoomGroups(
  rooms: ReadonlyArray<{ id: string; physical_group_key: string | null }>,
  groupSizes?: ReadonlyArray<{ group_key: string; room_count: number }>,
): void {
  keyByRoom = new Map(
    rooms.flatMap((r) => (r.physical_group_key ? [[r.id, r.physical_group_key] as const] : [])),
  );
  const sizes = new Map<string, number>();
  for (const key of keyByRoom.values()) sizes.set(key, (sizes.get(key) ?? 0) + 1);
  for (const g of groupSizes ?? []) sizes.set(g.group_key, Math.max(g.room_count, sizes.get(g.group_key) ?? 0));
  sizeByKey = sizes;
}

export function physicalRoomKey(id: string) {
  return keyByRoom.get(id) ?? id;
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

/** A shared hall's occupancy is only known when every alias row (all colleges) was read. */
export function physicalRoomSourcesComplete(id: string, readableRoomIds: string[]) {
  const key = physicalRoomKey(id);
  if (key === id) return true;
  const readable = new Set(readableRoomIds);
  const readAliases = [...keyByRoom.entries()].filter(([room, k]) => k === key && readable.has(room));
  return readAliases.length >= (sizeByKey.get(key) ?? Number.POSITIVE_INFINITY);
}
