/**
 * Weekly time template generation harness — pure logic, no DB writes.
 */
import {
  ALLOWED_DURATIONS,
  ALL_WEEK_DAYS,
  DEFAULT_DAY_END,
  DEFAULT_DAY_START,
  DEFAULT_GRID_MINUTES,
  DEFAULT_WORKING_DAYS,
  LAB_DURATION_MINUTES,
  diffAgainstExisting,
  expectedDefaultCount,
  generateWeeklyTemplates,
  templateKey,
  validateWeeklySetup,
  type DayOverride,
  type GeneratedTemplate,
} from "../../src/lib/time-templates/weekly-generator";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function defaultOverrides(enabledDays: number[]): Record<number, DayOverride> {
  const o: Record<number, DayOverride> = {};
  for (const d of ALL_WEEK_DAYS) {
    o[d] = {
      enabled: enabledDays.includes(d),
      startTime: DEFAULT_DAY_START,
      endTime: DEFAULT_DAY_END,
      durations: [...ALLOWED_DURATIONS],
      blockedWindows: [],
    };
  }
  return o;
}

function run() {
  const base = {
    studySystem: "regular" as const,
    days: [...DEFAULT_WORKING_DAYS],
    dayStart: DEFAULT_DAY_START,
    dayEnd: DEFAULT_DAY_END,
    gridMinutes: DEFAULT_GRID_MINUTES,
    durations: [...ALLOWED_DURATIONS],
  };

  // 120 + 180 generation → 45
  {
    const r = generateWeeklyTemplates(base);
    assert(r.errors.length === 0, `no errors: ${r.errors.join("; ")}`);
    assert(r.total === 45, `expected 45 got ${r.total}`);
    assert(expectedDefaultCount() === 45, "expectedDefaultCount=45");
    assert(r.selectedDays === 5, "5 days");
    assert(r.slots120PerDay === 5, `120/day got ${r.slots120PerDay}`);
    assert(r.slots180PerDay === 4, `180/day got ${r.slots180PerDay}`);
    const sample120 = r.templates.filter(
      (t) => t.day_of_week === 6 && t.slot_duration_minutes === 120,
    );
    assert(
      sample120.map((t) => `${t.start_time}-${t.end_time}`).join(",") ===
        "08:00-10:00,09:00-11:00,10:00-12:00,11:00-13:00,12:00-14:00",
      "120 windows",
    );
    const sample180 = r.templates.filter(
      (t) => t.day_of_week === 6 && t.slot_duration_minutes === 180,
    );
    assert(
      sample180.map((t) => `${t.start_time}-${t.end_time}`).join(",") ===
        "08:00-11:00,09:00-12:00,10:00-13:00,11:00-14:00",
      "180 windows",
    );
  }

  // A. Thursday not enabled by default → 5 days
  {
    const days = [...DEFAULT_WORKING_DAYS];
    assert(!days.includes(4), "Thursday not in default");
    const r = generateWeeklyTemplates({
      ...base,
      days,
      dayOverrides: defaultOverrides(days),
    });
    assert(r.selectedDays === 5, "A default 5 days");
    assert(!r.templates.some((t) => t.day_of_week === 4), "A no Thursday templates");
  }

  // B. Enable Thursday from customization → 6 days + preview includes Thu
  {
    const days = [...DEFAULT_WORKING_DAYS, 4];
    const r = generateWeeklyTemplates({
      ...base,
      days,
      dayOverrides: defaultOverrides(days),
    });
    assert(r.selectedDays === 6, "B 6 days with Thursday");
    assert(r.templates.some((t) => t.day_of_week === 4), "B Thursday in preview");
    assert(r.total === 54, `B expected 54 got ${r.total}`);
  }

  // C. Disable Sunday → 4 days
  {
    const days = DEFAULT_WORKING_DAYS.filter((d) => d !== 0);
    const r = generateWeeklyTemplates({
      ...base,
      days,
      dayOverrides: defaultOverrides(days),
    });
    assert(r.selectedDays === 4, "C 4 days");
    assert(!r.templates.some((t) => t.day_of_week === 0), "C no Sunday");
  }

  // D. Toggle Thursday on/off — no stale duplicates
  {
    let enabled = [...DEFAULT_WORKING_DAYS];
    let r = generateWeeklyTemplates({ ...base, days: enabled, dayOverrides: defaultOverrides(enabled) });
    assert(r.selectedDays === 5, "D start 5");
    enabled = [...enabled, 4];
    r = generateWeeklyTemplates({ ...base, days: enabled, dayOverrides: defaultOverrides(enabled) });
    assert(r.selectedDays === 6, "D enable Thu");
    enabled = enabled.filter((d) => d !== 4);
    r = generateWeeklyTemplates({ ...base, days: enabled, dayOverrides: defaultOverrides(enabled) });
    assert(r.selectedDays === 5, "D disable Thu");
    const keys = r.templates.map(templateKey);
    assert(new Set(keys).size === keys.length, "D no duplicate keys");
  }

  // E. selectedDays / preview / save payload use same day set (derived from enabled)
  {
    const enabled = [6, 0, 1, 2, 3, 4];
    const overrides = defaultOverrides(enabled);
    const derived = ALL_WEEK_DAYS.filter((d) => overrides[d].enabled);
    const r = generateWeeklyTemplates({ ...base, days: derived, dayOverrides: overrides });
    assert(derived.join(",") === enabled.join(","), "E derived matches");
    assert(r.selectedDays === derived.length, "E count aligned");
    const daysInTemplates = [...new Set(r.templates.map((t) => t.day_of_week))].sort().join(",");
    assert(
      daysInTemplates === [...derived].sort((a, b) => a - b).join(","),
      "E preview days = selected",
    );
  }

  // F. default remains Sat–Wed
  {
    assert(DEFAULT_WORKING_DAYS.join(",") === "6,0,1,2,3", "F Sat-Wed");
  }

  // no slot past 14:00
  {
    const r = generateWeeklyTemplates(base);
    assert(
      r.templates.every((t) => t.end_time <= "14:00"),
      "no past 14:00",
    );
  }

  // break conflict skip
  {
    const r = generateWeeklyTemplates({
      ...base,
      days: [6],
      breaks: [{ start_time: "11:00", end_time: "13:00", days: [6], affects_scheduling: true }],
    });
    assert(
      !r.templates.some((t) => t.start_time === "11:00" && t.end_time === "13:00"),
      "skip 11-13",
    );
    assert(r.skippedBreakConflicts > 0, "skipped count");
  }

  // lab session type: no 180
  {
    const r = generateWeeklyTemplates({ ...base, sessionType: "lab", durations: [120, 180] });
    assert(
      r.templates.every((t) => t.slot_duration_minutes === LAB_DURATION_MINUTES),
      "lab only 120",
    );
    assert(!r.templates.some((t) => t.slot_duration_minutes === 180), "no lab 180");
  }

  // validation messages
  {
    const e1 = validateWeeklySetup({ ...base, dayStart: "14:00", dayEnd: "08:00" });
    assert(
      e1.some((m) => m.includes("نهاية الدوام بعد وقت البداية")),
      "start/end validation",
    );
    const e2 = validateWeeklySetup({ ...base, days: [] });
    assert(e2.some((m) => m.includes("يوم دراسي")), "days validation");
    const e3 = validateWeeklySetup({ ...base, durations: [] });
    assert(e3.some((m) => m.includes("مدة جلسة")), "duration validation");
  }

  // Classification A: no existing → all new
  {
    const r = generateWeeklyTemplates(base);
    const diff = diffAgainstExisting(r.templates, []);
    assert(diff.toInsert.length === 45, "class A 45 new");
    assert(diff.duplicates.length === 0, "class A 0 existing");
    assert(diff.conflicts.length === 0, "class A 0 conflicts");
    assert(diff.duplicatesInGeneratedBatch.length === 0, "class A 0 batch dupes");
  }

  // Classification B: all existing exact
  {
    const r = generateWeeklyTemplates(base);
    const diff = diffAgainstExisting(r.templates, r.templates.map((t) => ({ ...t, is_active: true })));
    assert(diff.toInsert.length === 0, "class B 0 new");
    assert(diff.duplicates.length === 45, "class B 45 existing");
    assert(diff.conflicts.length === 0, "class B 0 conflicts");
  }

  // Classification C: partial existing
  {
    const r = generateWeeklyTemplates({ ...base, days: [6], durations: [120] });
    const half = r.templates.slice(0, 2);
    const diff = diffAgainstExisting(r.templates, half.map((t) => ({ ...t, is_active: true })));
    assert(diff.duplicates.length === 2, "class C existing");
    assert(diff.toInsert.length === r.templates.length - 2, "class C new");
  }

  // Classification D: duplicates in generated batch
  {
    const one: GeneratedTemplate = {
      day_of_week: 6,
      start_time: "08:00",
      end_time: "10:00",
      slot_duration_minutes: 120,
      study_system: "regular",
    };
    const diff = diffAgainstExisting([one, { ...one }, { ...one }], []);
    assert(diff.toInsert.length === 1, "class D insert once");
    assert(diff.duplicatesInGeneratedBatch.length === 2, "class D batch dupes");
  }

  // Classification E: same identity, inactive existing → conflict
  {
    const one: GeneratedTemplate = {
      day_of_week: 6,
      start_time: "08:00",
      end_time: "10:00",
      slot_duration_minutes: 120,
      study_system: "regular",
    };
    const diff = diffAgainstExisting([one], [{ ...one, is_active: false }]);
    assert(diff.conflicts.length === 1, "class E conflict");
    assert(diff.toInsert.length === 0, "class E no insert");
    assert(diff.duplicates.length === 0, "class E not existingExact");
  }

  // Classification F: overlapping 08-10 and 08-11 are NOT conflicts
  {
    const a: GeneratedTemplate = {
      day_of_week: 6,
      start_time: "08:00",
      end_time: "10:00",
      slot_duration_minutes: 120,
      study_system: "regular",
    };
    const b: GeneratedTemplate = {
      day_of_week: 6,
      start_time: "08:00",
      end_time: "11:00",
      slot_duration_minutes: 180,
      study_system: "regular",
    };
    const diff = diffAgainstExisting([a, b], []);
    assert(diff.toInsert.length === 2, "class F both new");
    assert(diff.conflicts.length === 0, "class F overlap not conflict");
  }

  // Classification G: save sends new only (toInsert)
  {
    const r = generateWeeklyTemplates({ ...base, days: [6], durations: [120] });
    const existing = r.templates.slice(0, 1);
    const diff = diffAgainstExisting(r.templates, existing.map((t) => ({ ...t, is_active: true })));
    assert(diff.toInsert.every((t) => !existing.some((e) => templateKey(e) === templateKey(t))), "G new only");
  }

  console.log("PASS weekly-time-templates.harness.ts");
}

run();
