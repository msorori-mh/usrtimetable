/** Loads rooms.physical_group_key aliases into the pure registry of ./physical-rooms.ts. */
import { supabase } from "@/integrations/supabase/client";
import { setPhysicalRoomGroups } from "./physical-rooms";

let inflight: Promise<void> | null = null;

export function loadPhysicalRoomGroups(): Promise<void> {
  inflight ??= (async () => {
    const [rooms, sizes] = await Promise.all([
      supabase
        .from("rooms")
        .select("id, physical_group_key" as never)
        .not("physical_group_key" as never, "is", null),
      (
        supabase.rpc.bind(supabase) as unknown as (
          name: string,
        ) => Promise<{ data: unknown; error: { message: string } | null }>
      )("physical_room_group_sizes"),
    ]);
    if (rooms.error || sizes.error) {
      inflight = null;
      throw new Error(rooms.error?.message ?? sizes.error?.message ?? "PHYSICAL_ROOMS_READ_FAILED");
    }
    setPhysicalRoomGroups(
      (rooms.data ?? []) as unknown as Array<{ id: string; physical_group_key: string | null }>,
      (sizes.data ?? []) as Array<{ group_key: string; room_count: number }>,
    );
  })();
  return inflight;
}

if (typeof window !== "undefined") {
  void loadPhysicalRoomGroups().catch(() => undefined);
}
