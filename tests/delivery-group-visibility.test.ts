import { expect, test } from "bun:test";
import {
  isOperationalDeliveryGroup,
  splitDeliveryGroupsByObsolescence,
  visibleDeliveryGroups,
} from "@/lib/academic-delivery/delivery-group-visibility";

const rows = [
  { id: "a", is_obsolete: false },
  { id: "b", is_obsolete: true },
  { id: "c" },
  { id: "d", is_obsolete: null },
  { id: "e", is_obsolete: true },
];

test("operational means is_obsolete is not true (false/undefined/null all count)", () => {
  expect(isOperationalDeliveryGroup(rows[0])).toBe(true);
  expect(isOperationalDeliveryGroup(rows[2])).toBe(true);
  expect(isOperationalDeliveryGroup(rows[3])).toBe(true);
  expect(isOperationalDeliveryGroup(rows[1])).toBe(false);
});

test("default view excludes obsolete rows; counters split correctly", () => {
  const { operational, obsolete } = splitDeliveryGroupsByObsolescence(rows);
  expect(operational.map((r) => r.id)).toEqual(["a", "c", "d"]);
  expect(obsolete.map((r) => r.id)).toEqual(["b", "e"]);
});

test("visibleDeliveryGroups defaults to operational only and returns all when opted in", () => {
  expect(visibleDeliveryGroups(rows, false).map((r) => r.id)).toEqual(["a", "c", "d"]);
  expect(visibleDeliveryGroups(rows, true).map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
});
