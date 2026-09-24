import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * RTL-01 — Arabic dropdown/select surfaces must render right-to-left with
 * right-aligned text. Presentation-only guard: no data or permission logic.
 */
describe("RTL direction for shared selectors", () => {
  it("select trigger, content and items are RTL and right-aligned", () => {
    const src = read("src/components/ui/select.tsx");
    const trigger = src.slice(
      src.indexOf("const SelectTrigger"),
      src.indexOf("const SelectScrollUpButton"),
    );
    const content = src.slice(src.indexOf("const SelectContent"), src.indexOf("const SelectLabel"));
    const item = src.slice(src.indexOf("const SelectItem"), src.indexOf("const SelectSeparator"));

    for (const block of [trigger, content, item]) {
      expect(block).toContain('dir="rtl"');
      expect(block).toContain("text-right");
    }
    // check indicator sits on the logical end side, not hardcoded right/left
    expect(item).toContain("absolute end-2");
  });

  it("dropdown menu defaults to RTL and right-aligns content and items", () => {
    const src = read("src/components/ui/dropdown-menu.tsx");
    // Radix drives menu direction from the root
    expect(src).toContain('dir = "rtl"');
    expect(src).toContain("<DropdownMenuPrimitive.Root dir={dir}");
    const content = src.slice(
      src.indexOf("const DropdownMenuContent"),
      src.indexOf("const DropdownMenuCheckboxItem"),
    );
    expect(content).toContain("text-right");
    expect(src).toContain("rtl:rotate-180");
    expect(src).not.toContain("absolute left-2");
  });

  it("command palette (combobox list) is RTL", () => {
    const src = read("src/components/ui/command.tsx");
    expect(src.match(/dir="rtl"/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(src).toContain("text-right");
    expect(src).not.toContain("mr-2 h-4 w-4 shrink-0");
  });

  it("popover content is RTL", () => {
    const src = read("src/components/ui/popover.tsx");
    expect(src).toContain('dir="rtl"');
    expect(src).toContain("text-right");
  });

  it("instructor combobox trigger is RTL with logical icon spacing", () => {
    const src = read("src/components/teaching-assignments/instructor-combobox.tsx");
    expect(src).toContain('dir="rtl"');
    expect(src).toContain("text-right");
    expect(src).toContain("ms-2 h-4 w-4 shrink-0");
    expect(src).not.toContain('"ml-2 h-4 w-4"');
  });
});
