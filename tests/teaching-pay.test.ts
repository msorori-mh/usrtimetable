import test from "node:test";
import assert from "node:assert/strict";
import {
  applicableRate,
  filterPayEntries,
  parsePayData,
  payReportRows,
  payTotals,
  spreadsheetSafeText,
  type PayEntry,
  type PayRate,
} from "../src/lib/reports/teaching-pay.ts";

test("financial export neutralizes formulas but preserves numeric amounts", () => {
  for (const input of ["=1+1", "+cmd", "-cmd", "@sum(1)", "  =1", "\ttext", "\rtext"])
    assert.equal(spreadsheetSafeText(input), "'" + input);
  assert.equal(spreadsheetSafeText(125.5), 125.5);
  assert.equal(spreadsheetSafeText("قرار 1"), "قرار 1");
});
const entry: PayEntry = {
  id: "e1",
  identity_id: "i1",
  instructor_name: "محاضر",
  university_number: "1",
  rank: "محاضر",
  department_id: "d1",
  department_name: "قسم",
  program_id: "p1",
  program_name: "برنامج",
  kind: "overload",
  system: "regular",
  work_date: "2026-10-01",
  starts_at: "08:00:00",
  ends_at: "10:00:00",
  actual_hours: 2,
  payable_hours: 1.5,
  approval_ref: "قرار 1",
  note: "",
  status: "approved",
  rate_id: "r1",
  hourly_rate: 125.5,
  currency: "YER",
  amount: 188.25,
  approved_at: "2026-10-02T10:00:00Z",
};
const rate: PayRate = {
  id: "r1",
  rank: "محاضر",
  kind: "overload",
  system: "regular",
  effective_from: "2026-09-01",
  hourly_rate: 125.5,
  currency: "YER",
  decision_ref: "1",
};
const data = (entries: PayEntry[]) => ({
  terms: [],
  programs: [],
  instructors: [],
  rates: [rate],
  entries,
});
test("uses certified payable hours, not all actual hours", () => {
  assert.equal(parsePayData(data([entry])).entries[0].amount, 188.25);
  assert.equal(payReportRows([entry])[0].payable, 1.5);
});
test("draft and void never enter money reports", () => {
  const rows = [
    entry,
    { ...entry, id: "d", status: "draft" as const, amount: null },
    { ...entry, id: "v", status: "void" as const, amount: null },
  ];
  assert.equal(payReportRows(rows).length, 1);
  assert.deepEqual(payTotals(rows), { YER: 188.25 });
});
test("currencies are never added together", () =>
  assert.deepEqual(payTotals([entry, { ...entry, id: "e2", currency: "USD", amount: 1.25 }]), {
    YER: 188.25,
    USD: 1.25,
  }));
test("effective date uses execution date and correct rank/category/system", () => {
  const rates = [
    rate,
    { ...rate, id: "future", effective_from: "2026-10-02" },
    { ...rate, id: "new", effective_from: "2026-10-01" },
    { ...rate, id: "parallel", system: "parallel" as const },
    { ...rate, id: "contract", kind: "contractual" as const },
  ];
  assert.equal(applicableRate(entry, rates)?.id, "new");
  assert.equal(applicableRate({ ...entry, rank: "معيد" }, rates), undefined);
});
test("approved report keeps its snapshot when prices change", () => {
  const rows = payReportRows([entry]);
  assert.equal(applicableRate(entry, [{ ...rate, hourly_rate: 500 }])?.hourly_rate, 500);
  assert.equal(rows[0].amount, 188.25);
  assert.equal(rows[0].rate, 125.5);
});
test("filters select entries without reallocating entitlement", () => {
  const f = {
    department: "d1",
    program: "p1",
    instructor: "i1",
    kind: "overload",
    system: "regular",
    from: "2026-10-01",
    to: "2026-10-01",
  };
  assert.deepEqual(filterPayEntries([entry, { ...entry, id: "e2", program_id: "p2" }], f), [entry]);
  assert.equal(filterPayEntries([entry], { ...f, system: "parallel" }).length, 0);
});
test("rejects incomplete and duplicate results", () => {
  assert.throws(() => parsePayData({}));
  assert.throws(() => parsePayData(data([entry, entry])));
  assert.throws(() => parsePayData(data([{ ...entry, amount: null }])));
});
test("rejects invalid money and inconsistent payable hours", () => {
  for (const e of [
    { ...entry, amount: 250 },
    { ...entry, amount: NaN },
    { ...entry, payable_hours: 3 },
    { ...entry, hourly_rate: Infinity },
  ])
    assert.throws(() => parsePayData(data([e])));
});
