import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  firstQueryError,
  runBulkConfirm,
  selectAll,
  selectedIds,
  shortRef,
} from "../src/lib/data-cleanup-bulk";

// L-14: the data-cleanup page was split into the route + src/components/data-cleanup/*.
const src = [
  "src/routes/_authenticated/data-cleanup.tsx",
  "src/components/data-cleanup/cleanup-data.ts",
  "src/components/data-cleanup/cleanup-diagnostics.ts",
  "src/components/data-cleanup/cleanup-shared.tsx",
  "src/components/data-cleanup/courses-section.tsx",
  "src/components/data-cleanup/instructors-section.tsx",
  "src/components/data-cleanup/rooms-section.tsx",
  "src/components/data-cleanup/offerings-section.tsx",
]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
const items = [
  { id: "a", title: "CS101 · برمجة", details: "الطبيعة: غير محددة" },
  { id: "b", title: "CS102 · هياكل", details: "القسم: غير محدد" },
];

describe("data-cleanup BulkDialog", () => {
  it("selects every item when the controlled dialog opens", () => {
    expect(selectedIds(items, selectAll(items))).toEqual(["a", "b"]);
    expect(src).toMatch(
      /useEffect\(\(\) => \{\s*if \(open\) setSelected\(selectAll\(items\)\);\s*else setBusy\(false\);/,
    );
    expect(src).not.toMatch(/handleOpen/);
  });

  it("shows item titles/current values and lets one item be deselected", () => {
    expect(src).toMatch(/\{it\.title\}/);
    expect(src).toMatch(/\{it\.details\}/);
    expect(src).toMatch(/<Checkbox[\s\S]*?checked=\{!!selected\[it\.id\]\}/);
    expect(src).toMatch(/max-h-60[^"]*overflow-y-auto/);
    expect(src).not.toMatch(/void Checkbox/);
    const sel = { ...selectAll(items), a: false };
    expect(selectedIds(items, sel)).toEqual(["b"]);
  });

  it("keeps the dialog open when validation fails, returns false, or throws", async () => {
    const errs: string[] = [];
    expect(
      await runBulkConfirm(
        () => false,
        ["a"],
        (m) => errs.push(m),
      ),
    ).toBe(false);
    expect(
      await runBulkConfirm(
        async () => {
          throw new Error("x");
        },
        ["a"],
        (m) => errs.push(m),
      ),
    ).toBe(false);
    expect(errs[0]).toMatch(/تعذّر تنفيذ العملية/);
    expect(
      await runBulkConfirm(
        () => true,
        ["a"],
        () => {},
      ),
    ).toBe(true);
    expect(src).toMatch(/if \(ok\) onOpenChange\(false\)/);
    expect(src).not.toMatch(/\n\s*return;\n/);
  });

  it("uses name_ar (not name) for instructor_types and room_types", () => {
    expect(src).toMatch(/from\("instructor_types"\)\.select\("id, name_ar, code, is_active"\)/);
    expect(src).toMatch(
      /from\("room_types"\)\.select\("id, name_ar, code, default_capacity, is_active"\)/,
    );
    expect(src).not.toMatch(/\{t\.name\}/);
  });

  it("surfaces query errors instead of empty lists", () => {
    expect(firstQueryError([{ label: "القاعات", error: null }])).toBeNull();
    // L-5: raw (English) database text is no longer shown; Arabic server messages pass through.
    const raw = firstQueryError([{ label: "القاعات", error: { message: "denied" } }]);
    expect(raw).toMatch(/القاعات/);
    expect(raw).not.toMatch(/denied/);
    expect(firstQueryError([{ label: "القاعات", error: { message: "لا صلاحية" } }])).toMatch(
      /القاعات.*لا صلاحية/,
    );
    expect(src).toMatch(/if \(loadError\) throw new Error\(loadError\)/);
    expect(shortRef("12345678-aaaa")).toBe("مرجع 12345678");
  });

  it("every BulkDialog passes meaningful items (no bare ids)", () => {
    const dialogs = src
      .split("<BulkDialog")
      .slice(1)
      .map((d) => d.slice(0, 400));
    expect(dialogs.length).toBe(10);
    for (const d of dialogs) {
      expect(d).toMatch(
        /items=\{(tempItems|natureItems|roomReqItems|insItems\(|roomItems\(|offItems\()/,
      );
      expect(d).not.toMatch(/\bids=/);
    }
  });
});
