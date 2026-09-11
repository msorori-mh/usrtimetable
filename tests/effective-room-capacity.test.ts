import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  effectiveRoomTypeCapacity,
  resolveDeliveryGroupCapacityLimit,
  uniformActiveRoomCapacity,
} from "@/lib/academic-delivery/effective-room-capacity";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");
const HELPER_SQL = readFileSync(
  join(MIGRATIONS, "20260911220912_bcb246f9-254c-45d8-8403-cd42dc86565f.sql"),
  "utf8",
);
const GENERATOR_SQL = readFileSync(
  join(MIGRATIONS, "20260911221118_3a6c3f9c-80ef-4dbf-af55-af86c1ceb1bc.sql"),
  "utf8",
);

const rooms = (caps: Array<number | null>, isActive = true) =>
  caps.map((capacity) => ({ capacity, isActive }));

describe("effective room-type capacity rule", () => {
  it("uses 75 when all active lecture halls are 75", () => {
    expect(uniformActiveRoomCapacity(rooms(Array(12).fill(75)))).toBe(75);
    expect(effectiveRoomTypeCapacity(rooms(Array(12).fill(75)), 60)).toBe(75);
  });

  it("uses 38 when all active computer labs are 38", () => {
    expect(effectiveRoomTypeCapacity(rooms([38, 38, 38, 38]), 30)).toBe(38);
  });

  it("falls back to the default capacity on mixed capacities (never max/min)", () => {
    const mixed = rooms([75, 60, 40]);
    expect(uniformActiveRoomCapacity(mixed)).toBeNull();
    expect(effectiveRoomTypeCapacity(mixed, 60)).toBe(60);
  });

  it("falls back to the default capacity when there are no active rooms", () => {
    expect(effectiveRoomTypeCapacity(rooms([75, 75], false), 60)).toBe(60);
    expect(effectiveRoomTypeCapacity([], 30)).toBe(30);
  });

  it("ignores inactive and non-positive capacities", () => {
    expect(
      effectiveRoomTypeCapacity(
        [
          { capacity: 75, isActive: true },
          { capacity: 0, isActive: true },
          { capacity: 40, isActive: false },
        ],
        60,
      ),
    ).toBe(75);
  });

  it("never replaces an explicit component group size", () => {
    expect(
      resolveDeliveryGroupCapacityLimit({
        explicitGroupSize: 25,
        rooms: rooms([75, 75]),
        defaultCapacity: 60,
      }),
    ).toBe(25);
    expect(
      resolveDeliveryGroupCapacityLimit({
        explicitGroupSize: null,
        rooms: rooms([75, 75]),
        defaultCapacity: 60,
      }),
    ).toBe(75);
  });
});

describe("source-of-truth SQL", () => {
  it("helper returns a value only for uniform active capacities", () => {
    expect(HELPER_SQL).toContain("effective_room_type_capacity");
    expect(HELPER_SQL).toContain("COUNT(DISTINCT r.capacity) = 1");
    expect(HELPER_SQL).toContain("is_active");
    expect(HELPER_SQL).not.toContain("MAX(r.capacity)");
  });

  it("capacity sync only touches non-obsolete groups without an explicit size", () => {
    expect(HELPER_SQL).toContain("explicit_group_size IS NULL");
    expect(HELPER_SQL).toContain("is_obsolete");
    expect(HELPER_SQL).not.toContain("DELETE FROM public.delivery_groups");
  });

  it("generator prefers the effective capacity and keeps the default as fallback", () => {
    expect(GENERATOR_SQL).toContain(
      "public.effective_room_type_capacity(pcc.college_id, pcc.required_room_type_id)",
    );
    expect(GENERATOR_SQL).toContain("rt.default_capacity");
    expect(GENERATOR_SQL).toContain("v_capacity := r.explicit_group_size;");
  });
});
