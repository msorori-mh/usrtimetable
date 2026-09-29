import { test } from "node:test";
import assert from "node:assert/strict";
import { roomsExecutiveSummary } from "../src/lib/reports/rooms-executive";
import type { RoomsReportSummaryRow } from "../src/lib/print-center/rooms-report";
const row = (id: string, used: number, available: number, category = "hall") =>
  ({
    room_id: id,
    room_name: id,
    capacity: 100,
    room_category: category,
    scheduled_hours: used,
    used_hours: used,
    available_hours: available,
    free_hours: Math.max(0, available - used),
    outside_hours: 0,
    overlap_hours: 0,
    blocked_hours: 0,
    utilization_percent: available > 0 ? Math.round((used / available) * 100) : 0,
    utilization: available > 0 ? `${Math.round((used / available) * 100)}%` : "—",
  }) as RoomsReportSummaryRow;
test("unknown availability cannot become zero efficiency or a complete college judgement", () => {
  const result = roomsExecutiveSummary([row("known", 20, 40), row("unknown", 10, 0)], []);
  assert.equal(result.complete, false);
  assert.equal(result.utilization, null);
  assert.equal(result.missingAvailability, 1);
  assert.equal(result.opportunities.length, 0);
});
test("balancing compares like resource types only", () => {
  assert.equal(
    roomsExecutiveSummary([row("hall", 40, 40), row("lab", 10, 40, "lab")], []).opportunities
      .length,
    0,
  );
  assert.equal(
    roomsExecutiveSummary([row("high", 40, 40), row("low", 20, 40)], []).opportunities.length,
    1,
  );
});
test("missing student counts never imply low seat use", () => {
  const sessions = [
    {
      id: "s",
      room_id: "hall",
      day_of_week: 0,
      start_time: "08:00",
      end_time: "10:00",
      expected_students: null,
    },
  ];
  assert.equal(roomsExecutiveSummary([row("hall", 40, 40)], sessions).opportunities.length, 0);
  assert.ok(
    roomsExecutiveSummary(
      [row("hall", 40, 40)],
      [{ ...sessions[0], expected_students: 40 }],
    ).opportunities[0].includes("40%"),
  );
});
test("complete data uses weighted time utilization rather than averaging room percentages", () => {
  assert.equal(roomsExecutiveSummary([row("one", 10, 10), row("two", 10, 30)], []).utilization, 50);
});
test("executive wording separates scheduled, inside-availability and outside hours", () => {
  const grand = {
    ...row("القاعة الكبرى", 12, 18),
    scheduled_hours: 28,
    outside_hours: 16,
  };
  const result = roomsExecutiveSummary([grand], []);
  assert.match(result.overview, /28 ساعة مجدولة/);
  assert.match(result.overview, /12 من أصل 18 ساعة/);
  assert.match(result.overview, /6 ساعة غير مشغولة/);
  assert.match(result.overview, /16 ساعة مجدولة خارج الإتاحة/);
  assert.match(result.opportunities[0], /خارج الإتاحة المعتمدة/);
});
