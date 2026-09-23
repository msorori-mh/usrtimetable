import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  reconcileBlockReason,
  reconcileErrorMessage,
} from "../src/lib/instructors/faculty-workflow";

const ui = readFileSync("src/components/faculty-workflow.tsx", "utf8");
const ok = {
  canReconcile: true,
  busy: false,
  home: "college-1",
  source: "ins-1",
  sourceIds: ["ins-1", "ins-2"],
  evidence: "خطاب رسمي رقم 15",
};

describe("faculty home reconcile form", () => {
  it("all fields complete => enabled", () => {
    expect(reconcileBlockReason(ok)).toBeNull();
  });

  it("each missing input => disabled with its own reason", () => {
    expect(reconcileBlockReason({ ...ok, canReconcile: false })).toMatch(/لا توجد صلاحية/);
    expect(reconcileBlockReason({ ...ok, home: "" })).toMatch(/اختر الكلية الأصلية/);
    expect(reconcileBlockReason({ ...ok, source: "" })).toMatch(/اختر مصدر/);
    expect(reconcileBlockReason({ ...ok, source: "other" })).toMatch(/اختر مصدر/);
    // the reported case: "رسمي" is 4 chars, server requires ≥ 10
    expect(reconcileBlockReason({ ...ok, evidence: "رسمي" })).toMatch(/لا يقل عن 10.*الحالي 4/);
    expect(reconcileBlockReason({ ...ok, evidence: "   رسمي    " })).toMatch(/الحالي 4/);
  });

  it("busy => disabled", () => {
    expect(reconcileBlockReason({ ...ok, busy: true })).toMatch(/جارٍ حفظ/);
  });

  it("failure keeps dialog open and shows the Arabic error", () => {
    expect(reconcileErrorMessage("STALE_FACULTY_DECISION")).toMatch(/أعد تحميل/);
    expect(reconcileErrorMessage("boom")).toBe("تعذّر حفظ التسوية: boom");
    const onError = ui.slice(ui.indexOf("onError: (e: Error) => {"), ui.indexOf("const rows"));
    expect(onError).toMatch(/setSaveError\(msg\)/);
    expect(onError).not.toMatch(/setEdit\(null\)/);
    expect(ui).toMatch(/role="alert" className="text-sm text-destructive">\s*\{saveError\}/);
  });

  it("success closes the dialog and refreshes the list; button uses blocked state", () => {
    const onSuccess = ui.slice(ui.indexOf("onSuccess: () => {"), ui.indexOf("onError: (e: Error) => {"));
    expect(onSuccess).toMatch(/setEdit\(null\)/);
    expect(onSuccess).toMatch(/invalidateQueries/);
    expect(ui).toMatch(/disabled=\{blocked !== null\}/);
    expect(ui).toMatch(/if \(blocked !== null \|\| save\.isPending\) return;/);
  });
});
